import mongoose from 'mongoose';
import request from 'supertest';
import { DateTime } from 'luxon';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Invoice from '../models/Invoice.js';
import generateToken from '../utils/generateToken.js';
import { clearSentEmails, getSentEmails } from '../services/email.service.js';

const APP = 'https://app.example.test';
const LINK = 'https://rzp.io/l/alex-morgan';

let mongod;
let alex;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.APP_URL = APP;

  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongod.getUri());
  await Promise.all([User.init(), Client.init(), Invoice.init()]);
});

beforeEach(async () => {
  clearSentEmails();
  const user = await User.create({ name: 'Alex Morgan', email: 'alex@example.com', passwordHash: 'not-used', timezone: 'Asia/Kolkata' });
  const client = await Client.create({ userId: user._id, name: 'Acme', email: 'billing@acme.com', company: 'Acme Inc' });
  alex = { id: user._id, token: generateToken(user), clientId: client._id };
});

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Client.deleteMany({}), Invoice.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ---------- helpers ----------

let sequence = 0;
const makeInvoice = (overrides = {}) =>
  Invoice.create({
    userId: alex.id,
    clientId: alex.clientId,
    number: `INV-${String(++sequence).padStart(4, '0')}`,
    periodStart: '2026-03-09',
    periodEnd: '2026-03-13',
    timezone: 'Asia/Kolkata',
    issuedAt: new Date(),
    dueDate: DateTime.now().plus({ days: 14 }).toJSDate(),
    client: { name: 'Acme', email: 'billing@acme.com', company: 'Acme Inc' },
    from: { name: 'Alex Morgan', email: 'alex@example.com' },
    lineItems: [{ projectId: new mongoose.Types.ObjectId(), projectName: 'Website', hourlyRate: 50, rawSeconds: 7200, billedSeconds: 7200, hours: 2, amount: 100 }],
    entryIds: [new mongoose.Types.ObjectId()],
    subtotal: 100,
    total: 100,
    currency: 'USD',
    ...overrides,
  });

const api = (method, url, token, body) => {
  const req = request(app)[method](url);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
};
const setPayment = (payment) => api('patch', '/api/auth/me', alex.token, { payment });
const savedPayment = async () => {
  const { payment } = await User.findById(alex.id).lean();
  return payment;
};

// ---------- saving the payment details ----------

describe('PATCH /api/auth/me: payment details', () => {
  it('saves a payment link, a UPI ID and bank details, and /me gives them back', async () => {
    const res = await setPayment({ link: LINK, upiId: 'alex.morgan@okhdfcbank', bankDetails: 'HDFC Bank\nA/C 1234567890\nIFSC HDFC0001234' });
    expect(res.status).toBe(200);
    expect(res.body.user.payment).toEqual({ link: LINK, upiId: 'alex.morgan@okhdfcbank', bankDetails: 'HDFC Bank\nA/C 1234567890\nIFSC HDFC0001234' });

    const me = await api('get', '/api/auth/me', alex.token);
    expect(me.body.user.payment.link).toBe(LINK);
    expect(await savedPayment()).toMatchObject({ link: LINK, upiId: 'alex.morgan@okhdfcbank' });
  });

  it('a new user has no payment details at all', async () => {
    expect((await api('get', '/api/auth/me', alex.token)).body.user.payment).toEqual({ link: '', upiId: '', bankDetails: '' });
  });

  it('changes only what is sent: the other details stay, and an empty string removes one', async () => {
    await setPayment({ link: LINK, upiId: 'alex@okaxis', bankDetails: 'HDFC Bank' });

    await setPayment({ upiId: 'alex.new@oksbi' });
    expect(await savedPayment()).toEqual({ link: LINK, upiId: 'alex.new@oksbi', bankDetails: 'HDFC Bank' });

    await setPayment({ link: '' });
    expect(await savedPayment()).toEqual({ link: '', upiId: 'alex.new@oksbi', bankDetails: 'HDFC Bank' });
  });

  it('can be saved together with other settings without touching the reminder settings', async () => {
    const res = await api('patch', '/api/auth/me', alex.token, { name: 'Alex M. Morgan', payment: { link: LINK }, roundingMinutes: 15 });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: 'Alex M. Morgan', roundingMinutes: 15, payment: { link: LINK, upiId: '', bankDetails: '' } });
    expect(res.body.user.reminders).toEqual({ enabled: true, beforeDueDays: 3, onDueDate: true, afterDueDays: [7, 14] });
  });

  it('trims the text, normalises line endings and drops control characters from the bank details', async () => {
    await setPayment({ link: `  ${LINK}  `, upiId: '  alex@okaxis ', bankDetails: '  HDFC\r\nA/C 123\u0007\u0000\r\n  ' });
    expect(await savedPayment()).toEqual({ link: LINK, upiId: 'alex@okaxis', bankDetails: 'HDFC\nA/C 123' });
  });

  it('saves the UPI ID trimmed and in lower case, and gives it back that way', async () => {
    const res = await setPayment({ upiId: '  Alex.Morgan@OkHDFCBank  ' });

    expect(res.status).toBe(200);
    expect(res.body.user.payment.upiId).toBe('alex.morgan@okhdfcbank');
    expect(await savedPayment()).toMatchObject({ upiId: 'alex.morgan@okhdfcbank' });

    await setPayment({ upiId: 'ALEX@YBL' });
    expect((await savedPayment()).upiId).toBe('alex@ybl');
    expect((await api('get', '/api/auth/me', alex.token)).body.user.payment.upiId).toBe('alex@ybl');
  });

  it('a UPI ID with a handle that is not a known one is still saved (the warning is only shown on screen)', async () => {
    const res = await setPayment({ upiId: 'Alex@OkHDFCNK' }); // a typo of okhdfcbank

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(await savedPayment()).toMatchObject({ upiId: 'alex@okhdfcnk' });
  });

  it('only spaces remove the UPI ID, like an empty string does', async () => {
    await setPayment({ upiId: 'alex@okaxis' });
    await setPayment({ upiId: '   ' });

    expect((await savedPayment()).upiId).toBe('');
  });
});

describe('payment details are validated', () => {
  const refused = async (payment, path, message) => {
    const res = await setPayment(payment);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ path, message }]);
  };

  it('the payment link must be a full https address: no javascript:, http, ftp, bare words, passwords or spaces', async () => {
    const message = 'Payment link must be a full https:// address, like https://rzp.io/l/yourname';
    for (const link of ['javascript:alert(1)', 'http://rzp.io/l/alex', 'ftp://files.example.com/pay', 'rzp.io/l/alex', 'https://localhost/pay', 'https://user:secret@pay.example.com/x', 'https://pay.example.com/a b', 'data:text/html,<script>1</script>', 'not a link']) {
      await refused({ link }, 'payment.link', message);
    }
    expect(await savedPayment()).toMatchObject({ link: '' }); // nothing was saved
  });

  it('accepts real payment links (Stripe, PayPal, Razorpay)', async () => {
    for (const link of ['https://buy.stripe.com/test_8wMcN1dZ', 'https://www.paypal.com/paypalme/alexmorgan/100', 'https://rzp.io/l/alex-morgan', 'https://pages.razorpay.com/pl_abc123?ref=invoice']) {
      expect((await setPayment({ link })).status).toBe(200);
    }
  });

  it('the payment link can be at most 500 characters', async () => {
    await refused({ link: `https://pay.example.com/${'a'.repeat(500)}` }, 'payment.link', 'The payment link must be at most 500 characters');
  });

  it('the UPI ID must look like name@bank', async () => {
    const message = 'UPI ID must look like name@bank, for example alex@okhdfcbank';
    for (const upiId of ['bad id', 'alex', 'alex@', '@okhdfcbank', 'a@b', 'alex@@bank', 'alex@bank!', 'al ex@okaxis']) {
      await refused({ upiId }, 'payment.upiId', message);
    }
    for (const upiId of ['alex@okhdfcbank', 'alex.morgan-1@ybl', '9876543210@paytm', 'shop_name@axl']) {
      expect((await setPayment({ upiId })).status).toBe(200);
    }
  });

  it('upper case and spaces are no way round the format check: a space inside the ID is still refused', async () => {
    await refused({ upiId: ' AL EX@OKAXIS ' }, 'payment.upiId', 'UPI ID must look like name@bank, for example alex@okhdfcbank');
    expect((await savedPayment()).upiId).toBe('');
  });

  it('the bank details can be at most 500 characters', async () => {
    await refused({ bankDetails: 'x'.repeat(501) }, 'payment.bankDetails', 'Bank details must be at most 500 characters');
    expect((await setPayment({ bankDetails: 'x'.repeat(500) })).status).toBe(200);
  });

  it('wrong types and an empty payment are refused', async () => {
    expect((await setPayment({ link: 42 })).status).toBe(400);
    expect((await setPayment({ upiId: ['a@b.c'] })).status).toBe(400);
    expect((await setPayment({ bankDetails: { a: 1 } })).status).toBe(400);
    await refused({}, 'payment', 'Send at least one payment detail');
    expect((await api('patch', '/api/auth/me', alex.token, { payment: 'https://rzp.io/l/x' })).status).toBe(400);
  });

  it('several mistakes are all reported, each under its own field', async () => {
    const res = await setPayment({ link: 'http://insecure.example.com', upiId: 'nope', bankDetails: 'ok' });
    expect(res.body.errors.map((e) => e.path).sort()).toEqual(['payment.link', 'payment.upiId']);
    expect(await savedPayment()).toEqual({ link: '', upiId: '', bankDetails: '' }); // all or nothing
  });

  it('needs a login', async () => {
    expect((await api('patch', '/api/auth/me', null, { payment: { link: LINK } })).status).toBe(401);
  });
});

// ---------- the "Pay now" button ----------

describe('the "Pay now" button in the invoice e-mail', () => {
  const sendInvoice = async () => {
    const invoice = await makeInvoice();
    const res = await api('post', `/api/invoices/${invoice._id}/send`, alex.token, {});
    expect(res.status).toBe(200);
    return getSentEmails().at(-1);
  };

  it('is not there when no payment link is set', async () => {
    const email = await sendInvoice();
    expect(email.html).not.toContain('Pay now');
    expect(email.text).not.toContain('Pay now');
    expect(email.html).not.toContain('UPI ID');
    expect(email.html).toContain('View invoice'); // the invoice button is always there
  });

  it('is there, linking to the payment link, when one is set', async () => {
    await setPayment({ link: LINK });
    const email = await sendInvoice();
    expect(email.html).toContain(`href="${LINK}"`);
    expect(email.html).toContain('>Pay now<');
    expect(email.text).toContain(`Pay now:\n${LINK}`);
  });

  it('with only a UPI ID or bank details there is no button, but the details are shown', async () => {
    await setPayment({ upiId: 'alex@okhdfcbank', bankDetails: 'HDFC Bank\nA/C 1234567890' });
    const email = await sendInvoice();

    expect(email.html).not.toContain('Pay now');
    expect(email.html).toContain('How to pay');
    expect(email.html).toContain('UPI ID: <strong>alex@okhdfcbank</strong>');
    expect(email.html).toContain('HDFC Bank\nA/C 1234567890');
    expect(email.text).toContain('UPI ID: alex@okhdfcbank');
    expect(email.text).toContain('Bank details:\nHDFC Bank\nA/C 1234567890');
  });

  it('with a link and details: the button, and the details below it', async () => {
    await setPayment({ link: LINK, upiId: 'alex@okhdfcbank' });
    const { html } = await sendInvoice();

    expect(html.indexOf('>Pay now<')).toBeGreaterThan(-1);
    expect(html.indexOf('Or pay another way')).toBeGreaterThan(html.indexOf('>Pay now<')); // below the button
    expect(html.indexOf('UPI ID:')).toBeGreaterThan(html.indexOf('Or pay another way'));
    expect(html.indexOf('>Pay now<')).toBeGreaterThan(html.indexOf('View invoice'));
  });

  it('what the owner typed is escaped, so it can not add markup to the e-mail', async () => {
    await setPayment({ bankDetails: '<script>alert(1)</script> & "quotes"' });
    const { html, text } = await sendInvoice();

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;');
    expect(text).toContain('<script>alert(1)</script> & "quotes"');
  });

  it('removing the link removes the button from the next e-mail', async () => {
    await setPayment({ link: LINK });
    expect((await sendInvoice()).html).toContain('>Pay now<');

    await setPayment({ link: '' });
    expect((await sendInvoice()).html).not.toContain('Pay now');
  });
});

describe('the payment details on the public invoice', () => {
  const publicPayment = async (overrides = {}) => {
    const invoice = await makeInvoice(overrides);
    const shared = await api('post', `/api/invoices/${invoice._id}/share-link`, alex.token);
    const res = await request(app).get(`/api/public/invoices/${shared.body.shareUrl.split('/i/')[1]}`);
    expect(res.status).toBe(200);
    return res.body.invoice.payment;
  };

  it('are null when the owner set up nothing', async () => {
    expect(await publicPayment()).toBeNull();
  });

  it('have the link, the UPI ID and the bank details when they are set', async () => {
    await setPayment({ link: LINK, upiId: 'alex@okhdfcbank', bankDetails: 'HDFC Bank' });
    expect(await publicPayment()).toEqual({ link: LINK, upiId: 'alex@okhdfcbank', bankDetails: 'HDFC Bank' });
  });

  it('have no link (null) when only a UPI ID is set, so the page can show no button', async () => {
    await setPayment({ upiId: 'alex@okhdfcbank' });
    expect(await publicPayment()).toEqual({ link: null, upiId: 'alex@okhdfcbank', bankDetails: null });
  });

  it('follow the owner\'s current settings, also for invoices made before', async () => {
    const invoice = await makeInvoice();
    const token = (await api('post', `/api/invoices/${invoice._id}/share-link`, alex.token)).body.shareUrl.split('/i/')[1];
    const before = (await request(app).get(`/api/public/invoices/${token}`)).body.invoice.payment;
    await setPayment({ link: LINK });
    const after = (await request(app).get(`/api/public/invoices/${token}`)).body.invoice.payment;

    expect(before).toBeNull();
    expect(after.link).toBe(LINK);
  });

  it('are left out once the invoice is paid (nothing to pay any more)', async () => {
    await setPayment({ link: LINK, upiId: 'alex@okhdfcbank', bankDetails: 'HDFC Bank' });
    expect(await publicPayment({ status: 'paid', sentAt: new Date(), paidAt: new Date() })).toBeNull();
    expect(await publicPayment({ status: 'sent', sentAt: new Date() })).not.toBeNull();
  });

  it('are the only owner data on the public page: no other user field is added', async () => {
    await setPayment({ link: LINK });
    const invoice = await makeInvoice();
    const token = (await api('post', `/api/invoices/${invoice._id}/share-link`, alex.token)).body.shareUrl.split('/i/')[1];
    const body = (await request(app).get(`/api/public/invoices/${token}`)).body;

    expect(Object.keys(body.invoice.payment).sort()).toEqual(['bankDetails', 'link', 'upiId']);
    expect(JSON.stringify(body)).not.toMatch(/"(reminders|roundingMinutes\":\d+,\"reminders|passwordHash|userId)"/);
  });
});
