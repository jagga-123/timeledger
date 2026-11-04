import mongoose from 'mongoose';
import request from 'supertest';
import { jest } from '@jest/globals';
import { DateTime } from 'luxon';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Invoice from '../models/Invoice.js';
import generateToken from '../utils/generateToken.js';
import { EmailError, clearSentEmails, getSentEmails, sendEmail, setEmailProvider } from '../services/email.service.js';

const APP = 'https://app.example.test';
const savedEnv = { ...process.env };

let mongod;
let priya; // India: client Acme with billing@acme.com
let bruno; // another user

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.APP_URL = APP;

  // Sending needs no transactions, so a plain in-memory server is enough here
  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongod.getUri());
  await Promise.all([User.init(), Client.init(), Invoice.init()]);
});

beforeEach(async () => {
  clearSentEmails();
  priya = await createUser('Priya', { clientEmail: 'billing@acme.com' });
  bruno = await createUser('Bruno', { clientEmail: 'finance@other.com' });
});

afterEach(async () => {
  jest.restoreAllMocks();
  setEmailProvider(null);
  process.env = { ...savedEnv, JWT_SECRET: 'test-secret', JWT_EXPIRES_IN: '1h', APP_URL: APP };
  await Promise.all([User.deleteMany({}), Client.deleteMany({}), Invoice.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ---------- helpers ----------

const createUser = async (name, { timezone = 'Asia/Kolkata', clientEmail = '' } = {}) => {
  const user = await User.create({ name, email: `${name.toLowerCase()}@example.com`, passwordHash: 'not-used', timezone });
  const client = await Client.create({ userId: user._id, name: 'Acme', email: clientEmail || undefined, company: 'Acme Inc' });
  return { id: user._id, name, email: user.email, timezone, token: generateToken(user), clientId: client._id, clientEmail };
};

let sequence = 0;
const makeInvoice = (user, overrides = {}) =>
  Invoice.create({
    userId: user.id,
    clientId: user.clientId,
    number: `INV-${String(++sequence).padStart(4, '0')}`,
    periodStart: '2026-03-09',
    periodEnd: '2026-03-13',
    timezone: user.timezone,
    issuedAt: new Date(),
    dueDate: DateTime.now().plus({ days: 14 }).toJSDate(),
    client: { name: 'Acme', email: user.clientEmail, company: 'Acme Inc' },
    from: { name: user.name, email: user.email },
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
const send = (user, invoice, body = {}) => api('post', `/api/invoices/${invoice._id}/send`, user.token, body);
const reload = (invoice) => Invoice.findById(invoice._id);

// ---------- sending ----------

describe('POST /api/invoices/:id/send', () => {
  it('emails the client with a link, and moves the invoice from draft to sent', async () => {
    const invoice = await makeInvoice(priya);

    const res = await send(priya, invoice);
    expect(res.status).toBe(200);
    expect(res.body.invoice).toMatchObject({ status: 'sent', displayStatus: 'sent', daysOverdue: 0, sentTo: 'billing@acme.com' });
    expect(res.body.invoice.sentAt).toEqual(expect.any(String));
    expect(res.body.invoice.lastSentAt).toBe(res.body.invoice.sentAt);
    expect(res.body.sentTo).toBe('billing@acme.com');

    // the link is /i/<token> on APP_URL, the token is stored on the invoice and is never part of the invoice JSON
    const saved = await reload(invoice);
    expect(saved.publicToken).toMatch(/^[A-Za-z0-9_-]{32}$/); // 24 random bytes
    expect(res.body.shareUrl).toBe(`${APP}/i/${saved.publicToken}`);
    expect(res.body.invoice.publicToken).toBeUndefined();
    expect(saved.status).toBe('sent');
    expect(saved.sentTo).toBe('billing@acme.com');

    // what the (console) provider was given
    const [email, ...others] = getSentEmails();
    expect(others).toHaveLength(0);
    expect(email.to).toEqual(['billing@acme.com']);
    expect(email.cc).toEqual([]);
    expect(email.subject).toBe(`Invoice ${invoice.number} from Priya`);
    expect(email.replyTo).toEqual({ email: 'priya@example.com', name: 'Priya' }); // replies go to the freelancer
    expect(email.html).toContain(`href="${APP}/i/${saved.publicToken}"`);
    expect(email.html).toContain('View invoice');
    expect(email.html).toContain('$100.00');
    expect(email.html).toContain(`Invoice ${invoice.number} from Priya`);
    expect(email.text).toContain(`${APP}/i/${saved.publicToken}`);
    expect(email.text).toContain('$100.00');
  });

  it('sends to the address typed in, copies others, and puts the personal message in both versions (escaped in the HTML)', async () => {
    const invoice = await makeInvoice(priya);

    const res = await send(priya, invoice, { to: 'accounts@acme.com', cc: ['boss@acme.com', 'me@priya.dev'], message: '<b>Hi</b> there,\nThanks & bye' });
    expect(res.status).toBe(200);
    expect(res.body.invoice).toMatchObject({ sentTo: 'accounts@acme.com', sentCc: ['boss@acme.com', 'me@priya.dev'] });

    const [email] = getSentEmails();
    expect(email.to).toEqual(['accounts@acme.com']);
    expect(email.cc).toEqual(['boss@acme.com', 'me@priya.dev']);
    expect(email.html).toContain('&lt;b&gt;Hi&lt;/b&gt; there,');
    expect(email.html).toContain('Thanks &amp; bye');
    expect(email.html).not.toContain('<b>Hi</b>');
    expect(email.text).toContain('<b>Hi</b> there,\nThanks & bye');
  });

  it("goes to the client's email as it is now when it was corrected after the invoice was made", async () => {
    const invoice = await makeInvoice(priya); // the copy on the invoice says billing@acme.com
    await Client.updateOne({ _id: priya.clientId }, { email: 'new-address@acme.com' });

    await send(priya, invoice);
    expect(getSentEmails()[0].to).toEqual(['new-address@acme.com']);
  });

  it('needs somebody to send it to: 400 "Add the client\'s email first", nothing is sent, nothing changes', async () => {
    const alone = await createUser('Anna', { clientEmail: '' });
    const invoice = await makeInvoice(alone);

    const res = await send(alone, invoice);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Add the client's email first");
    expect(res.body.errors).toEqual([{ path: 'to', message: "Add the client's email first" }]);
    expect(getSentEmails()).toHaveLength(0);
    expect(await reload(invoice)).toMatchObject({ status: 'draft', sentAt: null, lastSentAt: null });

    // typing an address in is enough
    expect((await send(alone, invoice, { to: 'someone@acme.com' })).status).toBe(200);
  });

  it('validates the addresses and the message', async () => {
    const invoice = await makeInvoice(priya);

    const bad = await send(priya, invoice, { to: 'not-an-email', cc: ['fine@acme.com', 'nope'], message: 'x'.repeat(1001) });
    expect(bad.status).toBe(400);
    expect(bad.body.errors.map((e) => e.path).sort()).toEqual(['cc.1', 'message', 'to']);

    const many = await send(priya, invoice, { cc: Array.from({ length: 6 }, (_, i) => `p${i}@acme.com`) });
    expect(many.body.errors).toEqual([{ path: 'cc', message: 'At most 5 people can be copied' }]);

    // empty fields from a form count as "not given"
    const empty = await send(priya, invoice, { to: '', message: '  ', cc: [] });
    expect(empty.status).toBe(200);
    expect(getSentEmails()).toHaveLength(1);
    expect(getSentEmails()[0].to).toEqual(['billing@acme.com']);
  });

  it('refuses a paid invoice (409) and sends nothing', async () => {
    const invoice = await makeInvoice(priya, { status: 'paid', sentAt: new Date(), paidAt: new Date() });

    const res = await send(priya, invoice);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('This invoice is already paid');
    expect(getSentEmails()).toHaveLength(0);
  });

  it("when the provider fails: 502 \"Couldn't send the email. Try again.\" and the invoice is left as it was", async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const invoice = await makeInvoice(priya);

    for (const failure of [new EmailError('Brevo answered 401: key not found'), new Error('socket hang up')]) {
      setEmailProvider({ name: 'broken', send: async () => { throw failure; } });

      const res = await send(priya, invoice);
      expect(res.status).toBe(502);
      expect(res.body.message).toBe("Couldn't send the email. Try again.");
      expect(JSON.stringify(res.body)).not.toContain('Brevo'); // the details stay in the server log

      const saved = await reload(invoice);
      expect(saved).toMatchObject({ status: 'draft', sentAt: null, lastSentAt: null, sentTo: '' });
    }
    expect(getSentEmails()).toHaveLength(0);

    // and once the provider works again, the same invoice can be sent
    setEmailProvider(null);
    expect((await send(priya, invoice)).status).toBe(200);
  });

  it('can be sent again: only lastSentAt (and the recipient) change, sentAt stays and the same link is used', async () => {
    const invoice = await makeInvoice(priya);
    const first = await send(priya, invoice);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await send(priya, invoice, { to: 'other@acme.com' });

    expect(second.status).toBe(200);
    expect(second.body.invoice.sentAt).toBe(first.body.invoice.sentAt);
    expect(new Date(second.body.invoice.lastSentAt).getTime()).toBeGreaterThan(new Date(first.body.invoice.lastSentAt).getTime());
    expect(second.body.invoice.sentTo).toBe('other@acme.com');
    expect(second.body.shareUrl).toBe(first.body.shareUrl);
    expect(getSentEmails().map((e) => e.to[0])).toEqual(['billing@acme.com', 'other@acme.com']);
  });

  it('an overdue invoice can be sent again too, and stays overdue', async () => {
    const invoice = await makeInvoice(priya, { status: 'sent', sentAt: new Date(), dueDate: DateTime.now().minus({ days: 3 }).toJSDate() });

    const res = await send(priya, invoice);
    expect(res.status).toBe(200);
    expect(res.body.invoice).toMatchObject({ status: 'sent', displayStatus: 'overdue', daysOverdue: 3 });
    expect(getSentEmails()).toHaveLength(1);
  });

  it("is private: user B can't send user A's invoice (404, nothing is sent), and a login is needed", async () => {
    const invoice = await makeInvoice(priya);

    const res = await send(bruno, invoice, { to: 'x@acme.com' });
    expect(res.status).toBe(404);
    expect(getSentEmails()).toHaveLength(0);
    expect(await reload(invoice)).toMatchObject({ status: 'draft', sentAt: null });

    expect((await send(priya, { _id: new mongoose.Types.ObjectId() })).status).toBe(404);
    expect((await api('post', `/api/invoices/${invoice._id}/send`, null, {})).status).toBe(401);
    expect((await api('post', '/api/invoices/not-an-id/send', priya.token, {})).status).toBe(400);
  });
});

// ---------- the Brevo provider (the network is replaced by a fake) ----------

describe('email providers', () => {
  const fakeFetch = (response) => {
    const calls = [];
    globalThis.fetch = jest.fn(async (url, init) => {
      calls.push({ url, init });
      return response;
    });
    return calls;
  };
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const brevoEnv = () => {
    process.env.EMAIL_PROVIDER = 'brevo';
    process.env.BREVO_API_KEY = 'test-api-key-123';
    process.env.EMAIL_FROM = 'sender@example.com';
    process.env.EMAIL_FROM_NAME = 'TimeLedger';
  };

  it('brevo: one POST to the transactional API with the key in a header and the whole email in the body', async () => {
    brevoEnv();
    const calls = fakeFetch({ ok: true, status: 201 });

    await sendEmail({
      to: 'billing@acme.com',
      cc: ['boss@acme.com'],
      subject: 'Invoice INV-0001 from Priya',
      html: '<p>hi</p>',
      text: 'hi',
      replyTo: { email: 'priya@example.com', name: 'Priya' },
      fromName: 'Priya via TimeLedger',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers['api-key']).toBe('test-api-key-123');
    expect(JSON.parse(calls[0].init.body)).toEqual({
      sender: { name: 'Priya via TimeLedger', email: 'sender@example.com' },
      to: [{ email: 'billing@acme.com' }],
      cc: [{ email: 'boss@acme.com' }],
      replyTo: { email: 'priya@example.com', name: 'Priya' },
      subject: 'Invoice INV-0001 from Priya',
      htmlContent: '<p>hi</p>',
      textContent: 'hi',
    });
  });

  it('brevo: an error answer, a network failure or a missing key all become an EmailError (and the key is never in the message)', async () => {
    brevoEnv();
    fakeFetch({ ok: false, status: 401, text: async () => '{"message":"Key not found"}' });
    const rejected = await sendEmail({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }).catch((e) => e);
    expect(rejected).toBeInstanceOf(EmailError);
    expect(rejected.message).toContain('401');
    expect(rejected.message).not.toContain('test-api-key-123');

    globalThis.fetch = jest.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(sendEmail({ to: 'a@b.com', subject: 's', html: 'h', text: 't' })).rejects.toBeInstanceOf(EmailError);

    delete process.env.BREVO_API_KEY;
    await expect(sendEmail({ to: 'a@b.com', subject: 's', html: 'h', text: 't' })).rejects.toThrow(/BREVO_API_KEY/);
  });

  it('through the API: Brevo refusing the email gives 502 and leaves the invoice a draft', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    brevoEnv();
    fakeFetch({ ok: false, status: 401, text: async () => 'Key not found' });
    const invoice = await makeInvoice(priya);

    const res = await send(priya, invoice);
    expect(res.status).toBe(502);
    expect((await reload(invoice)).status).toBe('draft');
  });

  it('console is the default while developing; in production an unset provider is an error, not a silent log', async () => {
    delete process.env.EMAIL_PROVIDER;
    await sendEmail({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });
    expect(getSentEmails()).toHaveLength(1);

    process.env.NODE_ENV = 'production';
    await expect(sendEmail({ to: 'a@b.com', subject: 's', html: 'h', text: 't' })).rejects.toThrow(/EMAIL_PROVIDER is not set/);

    process.env.EMAIL_PROVIDER = 'carrier-pigeon';
    await expect(sendEmail({ to: 'a@b.com', subject: 's', html: 'h', text: 't' })).rejects.toThrow(/Unknown EMAIL_PROVIDER/);
    expect(getSentEmails()).toHaveLength(1);
  });
});

// ---------- overdue: worked out, not stored ----------

describe('overdue', () => {
  const sentDue = (user, dueDate, extra = {}) => makeInvoice(user, { status: 'sent', sentAt: new Date(), dueDate, ...extra });
  const inZone = (zone) => DateTime.now().setZone(zone);
  const detail = async (user, invoice) => (await api('get', `/api/invoices/${invoice._id}`, user.token)).body.invoice;

  it('a sent invoice that was due yesterday (Asia/Kolkata) is overdue by 1 day', async () => {
    const invoice = await sentDue(priya, inZone('Asia/Kolkata').minus({ days: 1 }).toJSDate());

    expect(await detail(priya, invoice)).toMatchObject({ status: 'sent', displayStatus: 'overdue', daysOverdue: 1 });
  });

  it('due today is not overdue yet, even at 00:00 today; one minute earlier is', async () => {
    const midnight = inZone('Asia/Kolkata').startOf('day');
    const today = await sentDue(priya, midnight.toJSDate());
    const justBefore = await sentDue(priya, midnight.minus({ minutes: 1 }).toJSDate());
    const later = await sentDue(priya, midnight.plus({ hours: 23, minutes: 59 }).toJSDate());

    expect(await detail(priya, today)).toMatchObject({ displayStatus: 'sent', daysOverdue: 0 });
    expect(await detail(priya, later)).toMatchObject({ displayStatus: 'sent', daysOverdue: 0 });
    expect(await detail(priya, justBefore)).toMatchObject({ displayStatus: 'overdue', daysOverdue: 1 });
  });

  it('counts the days: due 5 days ago is 5 days overdue', async () => {
    const invoice = await sentDue(priya, inZone('Asia/Kolkata').minus({ days: 5 }).toJSDate());
    expect((await detail(priya, invoice)).daysOverdue).toBe(5);
  });

  it('a paid invoice is never overdue, and neither is a draft', async () => {
    const longAgo = inZone('Asia/Kolkata').minus({ days: 40 }).toJSDate();
    const paid = await makeInvoice(priya, { status: 'paid', sentAt: longAgo, paidAt: new Date(), dueDate: longAgo });
    const draft = await makeInvoice(priya, { status: 'draft', dueDate: longAgo });

    expect(await detail(priya, paid)).toMatchObject({ status: 'paid', displayStatus: 'paid', daysOverdue: 0 });
    expect(await detail(priya, draft)).toMatchObject({ status: 'draft', displayStatus: 'draft', daysOverdue: 0 });
  });

  it("uses the user's own time zone: 23:00 yesterday in New York is overdue for a New York user", async () => {
    const nick = await createUser('Nick', { timezone: 'America/New_York', clientEmail: 'ap@acme.com' });
    const yesterday = inZone('America/New_York').startOf('day').minus({ hours: 1 });
    const overdue = await sentDue(nick, yesterday.toJSDate());
    const today = await sentDue(nick, inZone('America/New_York').startOf('day').plus({ hours: 1 }).toJSDate());

    expect(await detail(nick, overdue)).toMatchObject({ displayStatus: 'overdue', daysOverdue: 1 });
    expect(await detail(nick, today)).toMatchObject({ displayStatus: 'sent', daysOverdue: 0 });
  });

  it('GET /api/invoices has displayStatus and daysOverdue on every invoice, and ?status=overdue / sent / draft / paid filter by it', async () => {
    const day = (n) => inZone('Asia/Kolkata').plus({ days: n }).toJSDate();
    const overdue = await sentDue(priya, day(-2));
    const sent = await sentDue(priya, day(3));
    const draft = await makeInvoice(priya);
    const paid = await makeInvoice(priya, { status: 'paid', paidAt: new Date(), dueDate: day(-9) });
    await sentDue(bruno, day(-4)); // someone else's overdue invoice

    const list = async (query = '') => (await api('get', `/api/invoices${query}`, priya.token)).body.invoices;
    const all = await list();
    expect(all).toHaveLength(4);
    expect(Object.fromEntries(all.map((i) => [i.number, [i.displayStatus, i.daysOverdue]]))).toEqual({
      [overdue.number]: ['overdue', 2],
      [sent.number]: ['sent', 0],
      [draft.number]: ['draft', 0],
      [paid.number]: ['paid', 0],
    });
    expect(all.every((i) => i.publicToken === undefined && i.lineItems === undefined)).toBe(true);

    expect((await list('?status=overdue')).map((i) => i.number)).toEqual([overdue.number]);
    expect((await list('?status=sent')).map((i) => i.number)).toEqual([sent.number]); // overdue ones are not "sent" here
    expect((await list('?status=draft')).map((i) => i.number)).toEqual([draft.number]);
    expect((await list('?status=paid')).map((i) => i.number)).toEqual([paid.number]);
    expect((await api('get', '/api/invoices?status=late', priya.token)).status).toBe(400);
  });

  it('marking it paid ends the overdue state', async () => {
    const invoice = await sentDue(priya, inZone('Asia/Kolkata').minus({ days: 4 }).toJSDate());

    const res = await api('patch', `/api/invoices/${invoice._id}/status`, priya.token, { status: 'paid' });
    expect(res.status).toBe(200);
    expect(res.body.invoice).toMatchObject({ status: 'paid', displayStatus: 'paid', daysOverdue: 0 });
  });
});
