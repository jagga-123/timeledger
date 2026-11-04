import mongoose from 'mongoose';
import request from 'supertest';
import { DateTime } from 'luxon';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Invoice from '../models/Invoice.js';
import generateToken from '../utils/generateToken.js';
import { clearSentEmails } from '../services/email.service.js';

const APP = 'https://app.example.test';

let mongod;
let priya;
let bruno;

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
  priya = await createUser('Priya', 'billing@acme.com');
  bruno = await createUser('Bruno', 'finance@other.com');
});

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Client.deleteMany({}), Invoice.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ---------- helpers ----------

const createUser = async (name, clientEmail) => {
  const user = await User.create({ name, email: `${name.toLowerCase()}@example.com`, passwordHash: 'not-used', timezone: 'Asia/Kolkata' });
  const client = await Client.create({ userId: user._id, name: 'Acme', email: clientEmail, company: 'Acme Inc' });
  return { id: user._id, name, email: user.email, token: generateToken(user), clientId: client._id, clientEmail };
};

let sequence = 0;
const makeInvoice = (user, overrides = {}) =>
  Invoice.create({
    userId: user.id,
    clientId: user.clientId,
    number: `INV-${String(++sequence).padStart(4, '0')}`,
    periodStart: '2026-03-09',
    periodEnd: '2026-03-13',
    timezone: 'Asia/Kolkata',
    issuedAt: new Date(),
    dueDate: DateTime.now().plus({ days: 14 }).toJSDate(),
    client: { name: 'Acme', email: user.clientEmail, company: 'Acme Inc' },
    from: { name: user.name, email: user.email },
    lineItems: [
      { projectId: new mongoose.Types.ObjectId(), projectName: 'Website', hourlyRate: 50, rawSeconds: 7200, billedSeconds: 7200, hours: 2, amount: 100 },
      { projectId: new mongoose.Types.ObjectId(), projectName: 'App', hourlyRate: 60, rawSeconds: 5400, billedSeconds: 5400, hours: 1.5, amount: 90 },
    ],
    entryIds: [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()],
    subtotal: 190,
    total: 190,
    currency: 'USD',
    notes: 'Thank you!',
    ...overrides,
  });

const api = (method, url, token, body) => {
  const req = request(app)[method](url);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
};

// every request to the public route counts towards the rate limit, so they are counted here
let publicRequests = 0;
const openLink = (token) => {
  publicRequests++;
  return request(app).get(`/api/public/invoices/${token}`); // no Authorization header: nobody is logged in
};

const shareLink = async (user, invoice) => (await api('post', `/api/invoices/${invoice._id}/share-link`, user.token)).body.shareUrl;
const tokenOf = (shareUrl) => shareUrl.split('/i/')[1];

// ---------- the public link ----------

describe('GET /api/public/invoices/:token', () => {
  it('shows the invoice to anybody with the link: no login, and only what the client needs', async () => {
    const invoice = await makeInvoice(priya);
    const token = tokenOf(await shareLink(priya, invoice));

    const res = await openLink(token);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['invoice']);

    const shown = res.body.invoice;
    expect(Object.keys(shown).sort()).toEqual(
      [
        'client', 'currency', 'daysOverdue', 'displayStatus', 'dueDate', 'from', 'issuedAt', 'lineItems', 'notes', 'number',
        'paidAt', 'periodEnd', 'periodStart', 'roundingMinutes', 'sentAt', 'subtotal', 'timezone', 'total',
      ].sort()
    );
    expect(shown).toMatchObject({
      number: invoice.number,
      displayStatus: 'draft',
      currency: 'USD',
      subtotal: 190,
      total: 190,
      notes: 'Thank you!',
      from: { name: 'Priya', email: 'priya@example.com' },
      client: { name: 'Acme', email: 'billing@acme.com', company: 'Acme Inc' },
    });
    expect(shown.lineItems).toEqual([
      { projectName: 'Website', hourlyRate: 50, hours: 2, amount: 100 },
      { projectName: 'App', hourlyRate: 60, hours: 1.5, amount: 90 },
    ]);

    // nothing private, anywhere in the answer: no ids of any kind, no entries, no token
    const text = JSON.stringify(res.body);
    for (const secret of [String(priya.id), String(priya.clientId), ...invoice.entryIds.map(String), ...invoice.lineItems.map((l) => String(l.projectId)), String(invoice._id), token]) {
      expect(text).not.toContain(secret);
    }
    for (const field of ['userId', 'entryIds', 'clientId', 'projectId', '_id', 'publicToken', 'viewedAt', 'sentTo']) {
      expect(text).not.toContain(`"${field}"`);
    }
  });

  it('is not cached or indexed', async () => {
    const invoice = await makeInvoice(priya);
    const res = await openLink(tokenOf(await shareLink(priya, invoice)));

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('shows the real state: sent, overdue (with the days) and paid', async () => {
    const sent = await makeInvoice(priya, { status: 'sent', sentAt: new Date() });
    const overdue = await makeInvoice(priya, { status: 'sent', sentAt: new Date(), dueDate: DateTime.now().minus({ days: 6 }).toJSDate() });
    const paid = await makeInvoice(priya, { status: 'paid', sentAt: new Date(), paidAt: new Date(), dueDate: DateTime.now().minus({ days: 30 }).toJSDate() });

    const shown = async (invoice) => (await openLink(tokenOf(await shareLink(priya, invoice)))).body.invoice;
    expect(await shown(sent)).toMatchObject({ displayStatus: 'sent', daysOverdue: 0 });
    expect(await shown(overdue)).toMatchObject({ displayStatus: 'overdue', daysOverdue: 6 });
    expect(await shown(paid)).toMatchObject({ displayStatus: 'paid', daysOverdue: 0 });
  });

  it('answers 404 for a token that does not exist, however it is written', async () => {
    const invoice = await makeInvoice(priya);
    const real = tokenOf(await shareLink(priya, invoice));

    for (const token of ['nope', 'x'.repeat(32), `${real.slice(0, -1)}${real.endsWith('A') ? 'B' : 'A'}`, real.toUpperCase() === real ? real.toLowerCase() : real.toUpperCase(), '%24ne', 'a'.repeat(300)]) {
      const res = await openLink(token);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'This invoice link is not valid' });
    }
  });

  it("a token query can't be turned into a database query", async () => {
    await shareLink(priya, await makeInvoice(priya));
    publicRequests++;
    const res = await request(app).get('/api/public/invoices/x').query({ token: { $ne: null } });
    expect(res.status).toBe(404);
  });

  it('an invoice that has no link yet is not reachable', async () => {
    await makeInvoice(priya); // never shared: no token at all
    expect((await openLink('undefined')).status).toBe(404);
    expect((await openLink('null')).status).toBe(404);
  });
});

describe('viewedAt', () => {
  it('is set the first time the client opens the link and never overwritten', async () => {
    const invoice = await makeInvoice(priya);
    const token = tokenOf(await shareLink(priya, invoice));
    expect((await Invoice.findById(invoice._id)).viewedAt).toBeNull();

    await openLink(token);
    const first = (await Invoice.findById(invoice._id)).viewedAt;
    expect(first).toBeInstanceOf(Date);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await openLink(token);
    await openLink(token);
    expect((await Invoice.findById(invoice._id)).viewedAt.getTime()).toBe(first.getTime());

    // the owner sees it on the invoice
    const detail = await api('get', `/api/invoices/${invoice._id}`, priya.token);
    expect(new Date(detail.body.invoice.viewedAt).getTime()).toBe(first.getTime());
  });

  it("an unknown token or the owner's own login never sets it", async () => {
    const invoice = await makeInvoice(priya);
    await shareLink(priya, invoice);

    await openLink('not-a-real-token');
    await api('get', `/api/invoices/${invoice._id}`, priya.token);
    expect((await Invoice.findById(invoice._id)).viewedAt).toBeNull();
  });
});

// ---------- making and replacing the link ----------

describe('share links', () => {
  it('POST /:id/share-link makes the link once and gives the same one every time, even when asked at the same moment', async () => {
    const invoice = await makeInvoice(priya);

    const urls = await Promise.all(Array.from({ length: 6 }, () => shareLink(priya, invoice)));
    expect(new Set(urls).size).toBe(1);
    expect(urls[0]).toMatch(new RegExp(`^${APP}/i/[A-Za-z0-9_-]{32}$`));

    const saved = await Invoice.findById(invoice._id);
    expect(urls[0]).toBe(`${APP}/i/${saved.publicToken}`);
    expect(await Invoice.countDocuments({ publicToken: { $type: 'string' } })).toBe(1);
  });

  it('the invoice page data has the link (and no raw token), the list has neither', async () => {
    const invoice = await makeInvoice(priya);
    expect((await api('get', `/api/invoices/${invoice._id}`, priya.token)).body.invoice.shareUrl).toBeNull();

    const url = await shareLink(priya, invoice);
    const detail = (await api('get', `/api/invoices/${invoice._id}`, priya.token)).body.invoice;
    expect(detail.shareUrl).toBe(url);
    expect(detail.defaultRecipient).toBe('billing@acme.com');
    expect(detail.publicToken).toBeUndefined();

    const list = (await api('get', '/api/invoices', priya.token)).body.invoices;
    expect(JSON.stringify(list)).not.toContain(tokenOf(url));
  });

  it('every invoice gets its own token', async () => {
    const [a, b] = [await makeInvoice(priya), await makeInvoice(priya)];
    expect(tokenOf(await shareLink(priya, a))).not.toBe(tokenOf(await shareLink(priya, b)));
  });

  it('regenerate makes a new link and the old one stops working at once', async () => {
    const invoice = await makeInvoice(priya);
    const oldToken = tokenOf(await shareLink(priya, invoice));
    expect((await openLink(oldToken)).status).toBe(200);

    const res = await api('post', `/api/invoices/${invoice._id}/share-link/regenerate`, priya.token);
    expect(res.status).toBe(200);
    const newToken = tokenOf(res.body.shareUrl);
    expect(newToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(newToken).not.toBe(oldToken);

    expect((await openLink(oldToken)).status).toBe(404);
    expect((await openLink(newToken)).status).toBe(200);
    expect((await Invoice.findById(invoice._id)).publicToken).toBe(newToken);
    // the owner's "copy link" now gives the new one
    expect(await shareLink(priya, invoice)).toBe(res.body.shareUrl);
  });

  it('regenerate starts "viewed" again, because the new link has not been opened yet', async () => {
    const invoice = await makeInvoice(priya);
    await openLink(tokenOf(await shareLink(priya, invoice)));
    expect((await Invoice.findById(invoice._id)).viewedAt).not.toBeNull();

    await api('post', `/api/invoices/${invoice._id}/share-link/regenerate`, priya.token);
    expect((await Invoice.findById(invoice._id)).viewedAt).toBeNull();
  });

  it("is private: user B can't get or regenerate user A's link (404), and a login is needed", async () => {
    const invoice = await makeInvoice(priya);
    const token = tokenOf(await shareLink(priya, invoice));

    expect((await api('post', `/api/invoices/${invoice._id}/share-link`, bruno.token)).status).toBe(404);
    expect((await api('post', `/api/invoices/${invoice._id}/share-link/regenerate`, bruno.token)).status).toBe(404);
    expect((await api('post', `/api/invoices/${invoice._id}/share-link/regenerate`)).status).toBe(401);
    expect((await api('post', `/api/invoices/${invoice._id}/share-link`)).status).toBe(401);
    expect((await api('post', `/api/invoices/${new mongoose.Types.ObjectId()}/share-link`, priya.token)).status).toBe(404);

    // user A's link still works and still points at the same invoice
    expect((await openLink(token)).status).toBe(200);
    expect((await Invoice.findById(invoice._id)).publicToken).toBe(token);
  });

  it("the link made by sending an email opens the invoice", async () => {
    const invoice = await makeInvoice(priya);

    const sent = await api('post', `/api/invoices/${invoice._id}/send`, priya.token, {});
    expect(sent.status).toBe(200);

    const res = await openLink(tokenOf(sent.body.shareUrl));
    expect(res.status).toBe(200);
    expect(res.body.invoice).toMatchObject({ number: invoice.number, displayStatus: 'sent' });
  });

  it('a deleted draft takes its link with it', async () => {
    // deleting needs transactions, so the invoice is removed directly, as the service does
    const invoice = await makeInvoice(priya);
    const token = tokenOf(await shareLink(priya, invoice));
    await Invoice.deleteOne({ _id: invoice._id });

    expect((await openLink(token)).status).toBe(404);
  });
});

// ---------- rate limit (last: it uses up the minute's allowance) ----------

describe('rate limit on the public route', () => {
  it('answers 429 after 60 requests in a minute from one address, and only for this route', async () => {
    const invoice = await makeInvoice(priya);
    const token = tokenOf(await shareLink(priya, invoice));

    let blocked = null;
    let before = 0;
    for (let i = 0; i < 80 && !blocked; i++) {
      const res = await openLink(token);
      if (res.status === 429) blocked = res;
      else before++;
    }

    expect(blocked).not.toBeNull();
    expect(blocked.body).toEqual({ message: 'Too many requests. Please try again in a minute.' });
    expect(blocked.headers.ratelimit).toBeDefined(); // the standard RateLimit header tells the caller how long to wait
    expect(publicRequests).toBeLessThanOrEqual(61 + 1); // 60 were allowed, the next one (counting every request above) was refused
    expect(before).toBeGreaterThan(0);

    // the rest of the API is not affected
    expect((await api('get', '/api/health')).status).toBe(200);
    expect((await api('get', '/api/invoices', priya.token)).status).toBe(200);
  });
});
