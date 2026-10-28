import mongoose from 'mongoose';
import request from 'supertest';
import { jest } from '@jest/globals';
import { DateTime } from 'luxon';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../app.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Project from '../models/Project.js';
import TimeEntry from '../models/TimeEntry.js';
import Invoice from '../models/Invoice.js';
import Counter from '../models/Counter.js';
import generateToken from '../utils/generateToken.js';

const NOTHING = 'No unbilled billable time for this client in this period';

let replSet;
let priya; // India (UTC+5:30): clients Acme (Website $50, App $60) and Zeta (Brand $80)
let bruno;

// Invoices run in transactions, which need a replica set (the other test files use a plain server).
// Starting one takes longer than a plain server, especially while the other test files start theirs,
// so this hook gets a generous timeout instead of Jest's default 5 seconds.
beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';

  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60_000 }] });
  await mongoose.connect(replSet.getUri());
  await Promise.all([User.init(), Client.init(), Project.init(), TimeEntry.init(), Invoice.init(), Counter.init()]);
}, 120_000);

beforeEach(async () => {
  priya = await createUser('priya');
  bruno = await createUser('bruno');
});

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([
    User.deleteMany({}),
    Client.deleteMany({}),
    Project.deleteMany({}),
    TimeEntry.deleteMany({}),
    Invoice.deleteMany({}),
    Counter.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
}, 60_000);

// ---------- helpers ----------

const createUser = async (name, { timezone = 'Asia/Kolkata', currency = 'USD' } = {}) => {
  const user = await User.create({ name, email: `${name}@example.com`, passwordHash: 'not-used', timezone, currency });
  const [acme, zeta] = await Client.create([
    { userId: user._id, name: 'Acme', email: 'billing@acme.com', company: 'Acme Inc' },
    { userId: user._id, name: 'Zeta' },
  ]);
  const [website, app_, brand] = await Project.create([
    { userId: user._id, clientId: acme._id, name: 'Website', hourlyRate: 50, color: '#10B981' },
    { userId: user._id, clientId: acme._id, name: 'App', hourlyRate: 60 },
    { userId: user._id, clientId: zeta._id, name: 'Brand', hourlyRate: 80 },
  ]);
  return {
    id: user._id,
    token: generateToken(user),
    acme: String(acme._id),
    zeta: String(zeta._id),
    website: String(website._id),
    app: String(app_._id),
    brand: String(brand._id),
  };
};

const api = (method, url, token, body) => {
  const req = request(app)[method](url);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
};

// wall-clock time in India, e.g. ist('2026-03-09', '09:00')
const ist = (date, time) => new Date(`${date}T${time}:00+05:30`);

// A finished entry (billable and unbilled unless said otherwise)
const addEntry = (user, projectId, start, end, extra = {}) =>
  TimeEntry.create({
    userId: user.id,
    projectId,
    clientId: projectId === user.brand ? user.zeta : user.acme,
    startedAt: start,
    endedAt: end,
    durationSeconds: Math.floor((end - start) / 1000),
    ...extra,
  });

const range = (clientId, from, to, extra = {}) => ({ clientId, from, to, ...extra });
const createInvoice = (user, body) => api('post', '/api/invoices', user.token, body);
const previewInvoice = (user, body) => api('post', '/api/invoices/preview', user.token, body);
const sorted = (ids) => ids.map(String).sort();

// ---------- what gets billed ----------

describe('POST /api/invoices: which entries are billed', () => {
  it('bills billable, unbilled, finished entries of that client inside the range, and nothing else', async () => {
    const included = [
      await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '11:00')),
      await addEntry(priya, priya.app, ist('2026-03-10', '10:00'), ist('2026-03-10', '11:30')),
      await addEntry(priya, priya.website, ist('2026-03-13', '23:00'), ist('2026-03-13', '23:30')), // last day, 23:30
    ];
    const leftOut = {
      nonBillable: await addEntry(priya, priya.website, ist('2026-03-11', '09:00'), ist('2026-03-11', '10:00'), { billable: false }),
      alreadyBilled: await addEntry(priya, priya.website, ist('2026-03-12', '09:00'), ist('2026-03-12', '10:00'), {
        invoiceId: new mongoose.Types.ObjectId(),
      }),
      otherClient: await addEntry(priya, priya.brand, ist('2026-03-10', '14:00'), ist('2026-03-10', '15:00')),
      before: await addEntry(priya, priya.website, ist('2026-03-08', '22:00'), ist('2026-03-08', '23:00')),
      after: await addEntry(priya, priya.website, ist('2026-03-14', '00:15'), ist('2026-03-14', '01:00')),
      running: await TimeEntry.create({
        userId: priya.id,
        projectId: priya.website,
        clientId: priya.acme,
        startedAt: ist('2026-03-11', '12:00'),
      }),
    };
    const oldInvoiceId = leftOut.alreadyBilled.invoiceId;

    const res = await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13'));
    expect(res.status).toBe(201);
    const { invoice } = res.body;

    expect(sorted(invoice.entryIds)).toEqual(sorted(included.map((e) => e._id)));

    for (const entry of included) {
      expect(String((await TimeEntry.findById(entry._id)).invoiceId)).toBe(invoice._id);
    }
    for (const [name, entry] of Object.entries(leftOut)) {
      const saved = await TimeEntry.findById(entry._id);
      const expected = name === 'alreadyBilled' ? String(oldInvoiceId) : null;
      expect(saved.invoiceId === null ? null : String(saved.invoiceId)).toBe(expected);
    }
  });

  it('shows the same entries in a preview without saving anything', async () => {
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '11:00'));
    await addEntry(priya, priya.app, ist('2026-03-10', '10:00'), ist('2026-03-10', '11:30'));

    const res = await previewInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13'));
    expect(res.status).toBe(200);
    expect(res.body.preview).toMatchObject({
      entryCount: 2,
      total: 190, // 2h x $50 + 1.5h x $60
      timezone: 'Asia/Kolkata',
      currency: 'USD',
      client: { name: 'Acme', email: 'billing@acme.com', company: 'Acme Inc' },
    });
    expect(res.body.preview.lineItems.map((l) => l.projectName)).toEqual(['App', 'Website']);
    expect(res.body.preview.entries.map((e) => e.projectName)).toEqual(['Website', 'App']); // in time order

    // nothing was claimed, saved or numbered
    expect(await TimeEntry.countDocuments({ invoiceId: { $ne: null } })).toBe(0);
    expect(await Invoice.countDocuments()).toBe(0);
    expect(await Counter.countDocuments()).toBe(0);
  });

  it('answers a preview and a create with "nothing to bill" when no entry matches', async () => {
    for (const send of [previewInvoice, createInvoice]) {
      const res = await send(priya, range(priya.acme, '2026-03-09', '2026-03-13'));
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(NOTHING);
    }
    expect(await Invoice.countDocuments()).toBe(0);
    expect(await Counter.countDocuments()).toBe(0); // the failed attempt didn't use up a number
  });
});

// ---------- line items and totals ----------

describe('line items and totals', () => {
  it('makes one line per project with hours, rate and amount rounded to cents, and a total that adds up', async () => {
    // Website $50: 2h + 1000 s + 30 min = 10000 s; App $60: 1.5h + 20 min = 6600 s
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '11:00'));
    await addEntry(priya, priya.website, ist('2026-03-12', '14:00'), new Date(ist('2026-03-12', '14:00').getTime() + 1000 * 1000));
    await addEntry(priya, priya.website, ist('2026-03-13', '23:00'), ist('2026-03-13', '23:30'));
    await addEntry(priya, priya.app, ist('2026-03-10', '10:00'), ist('2026-03-10', '11:30'));
    await addEntry(priya, priya.app, ist('2026-03-11', '10:00'), ist('2026-03-11', '10:20'));

    const { body } = await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13'));
    const { invoice } = body;

    expect(invoice.lineItems).toEqual([
      { projectId: priya.app, projectName: 'App', hourlyRate: 60, rawSeconds: 6600, billedSeconds: 6600, hours: 1.83, amount: 110 },
      { projectId: priya.website, projectName: 'Website', hourlyRate: 50, rawSeconds: 10000, billedSeconds: 10000, hours: 2.78, amount: 138.89 },
    ]);
    expect(invoice.subtotal).toBe(248.89);
    expect(invoice.total).toBe(248.89); // 110 + 138.89
    expect(invoice.currency).toBe('USD');
  });

  it('the total is the sum of the rounded lines, not the rounded sum of the exact amounts', async () => {
    // 100 s at $60/h = 1.6667 and 120 s at $50/h = 1.6667: each line rounds to 1.67, so the total is 3.34 (not 3.33)
    await addEntry(priya, priya.app, ist('2026-03-09', '09:00'), new Date(ist('2026-03-09', '09:00').getTime() + 100 * 1000));
    await addEntry(priya, priya.website, ist('2026-03-10', '09:00'), new Date(ist('2026-03-10', '09:00').getTime() + 120 * 1000));

    const { body } = await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13'));
    expect(body.invoice.lineItems.map((l) => l.amount)).toEqual([1.67, 1.67]);
    expect(body.invoice.total).toBe(3.34);
  });

  it('snapshots the client, the sender, the period, the time zone, the dates and the notes', async () => {
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '10:00'));

    const before = Date.now();
    const { body } = await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13', { notes: '  Thanks for your business  ' }));
    const { invoice } = body;

    expect(invoice).toMatchObject({
      number: 'INV-0001',
      status: 'draft',
      periodStart: '2026-03-09',
      periodEnd: '2026-03-13',
      timezone: 'Asia/Kolkata',
      client: { name: 'Acme', email: 'billing@acme.com', company: 'Acme Inc' },
      from: { name: 'priya', email: 'priya@example.com' },
      notes: 'Thanks for your business',
      sentAt: null,
      paidAt: null,
      clientId: priya.acme,
    });
    expect(Date.parse(invoice.issuedAt)).toBeGreaterThanOrEqual(before - 1000);

    // due 14 days after it was issued
    const issued = DateTime.fromISO(invoice.issuedAt, { zone: 'Asia/Kolkata' });
    const due = DateTime.fromISO(invoice.dueDate, { zone: 'Asia/Kolkata' });
    expect(due.diff(issued, 'days').days).toBe(14);
  });

  it('later changes to a rate, a project, the client or the user never change an existing invoice', async () => {
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '11:00'));
    const { body } = await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13'));
    const original = body.invoice;

    await Project.updateOne({ _id: priya.website }, { hourlyRate: 99, name: 'Website v2' });
    await Client.updateOne({ _id: priya.acme }, { name: 'Acme Renamed', email: 'new@acme.com' });
    await User.updateOne({ _id: priya.id }, { name: 'Priya Sharma', currency: 'EUR' });

    const fetched = (await api('get', `/api/invoices/${original._id}`, priya.token)).body.invoice;
    expect(fetched.lineItems).toEqual(original.lineItems);
    expect(fetched.lineItems[0]).toMatchObject({ projectName: 'Website', hourlyRate: 50, amount: 100 });
    expect(fetched.total).toBe(100);
    expect(fetched.client).toEqual(original.client);
    expect(fetched.client.name).toBe('Acme');
    expect(fetched.from.name).toBe('priya');
    expect(fetched.currency).toBe('USD');
  });
});

// ---------- billed entries ----------

describe('billed entries', () => {
  it('become billed, cannot be edited or deleted, and cannot be invoiced a second time', async () => {
    const entry = await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '11:00'));
    const { body } = await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13'));

    // listed as billed, linked to the invoice
    const billed = await api('get', '/api/entries?status=billed', priya.token);
    expect(billed.body.entries).toHaveLength(1);
    expect(billed.body.entries[0]).toMatchObject({ _id: String(entry._id), invoiceId: body.invoice._id });
    expect((await api('get', '/api/entries?status=unbilled', priya.token)).body.entries).toHaveLength(0);

    // Step 5 rules: a billed entry is locked
    const edit = await api('patch', `/api/entries/${entry._id}`, priya.token, { description: 'changed' });
    expect(edit.status).toBe(409);
    expect(edit.body.message).toBe("This entry is on an invoice and can't be changed");
    expect((await api('delete', `/api/entries/${entry._id}`, priya.token)).status).toBe(409);

    // a second invoice for the same period has nothing left to bill
    const again = await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13'));
    expect(again.status).toBe(400);
    expect(again.body.message).toBe(NOTHING);
    expect((await previewInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13'))).status).toBe(400);
    expect(await Invoice.countDocuments()).toBe(1);
  });
});

// ---------- THE KEY RULE: an entry can never be on two invoices ----------

describe('concurrency: an entry is never on two invoices', () => {
  const seedMarch = async (days) => {
    const entries = [];
    for (let day = 1; day <= days; day++) {
      const date = `2026-03-${String(day).padStart(2, '0')}`;
      entries.push(await addEntry(priya, priya.website, ist(date, '09:00'), ist(date, '10:00')));
    }
    return entries;
  };

  const invoiceIdOf = async (entry) => String((await TimeEntry.findById(entry._id)).invoiceId);

  it('two identical requests at the same time: one invoice, every entry on exactly that one', async () => {
    const entries = await seedMarch(12);

    const results = await Promise.all([
      createInvoice(priya, range(priya.acme, '2026-03-01', '2026-03-12')),
      createInvoice(priya, range(priya.acme, '2026-03-01', '2026-03-12')),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(results.find((r) => r.status === 400).body.message).toBe(NOTHING);

    const winner = results.find((r) => r.status === 201).body.invoice;
    expect(winner.entryIds).toHaveLength(12);
    for (const entry of entries) {
      expect(await invoiceIdOf(entry)).toBe(winner._id);
    }
    expect(await Invoice.countDocuments()).toBe(1);
    expect((await Counter.findOne({ userId: priya.id })).seq).toBe(1); // the loser didn't use up a number
  });

  it('eight requests at once: exactly one wins', async () => {
    const entries = await seedMarch(10);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => createInvoice(priya, range(priya.acme, '2026-03-01', '2026-03-10')))
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(7);
    const winner = results.find((r) => r.status === 201).body.invoice;
    for (const entry of entries) {
      expect(await invoiceIdOf(entry)).toBe(winner._id);
    }
    expect(await Invoice.countDocuments()).toBe(1);
  });

  it('overlapping ranges at the same time: every entry still ends up on exactly one invoice', async () => {
    const entries = await seedMarch(15);

    const results = await Promise.all([
      createInvoice(priya, range(priya.acme, '2026-03-01', '2026-03-10')),
      createInvoice(priya, range(priya.acme, '2026-03-05', '2026-03-15')),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]); // each has entries the other can't reach

    const [a, b] = results.map((r) => r.body.invoice);
    const inA = new Set(a.entryIds);
    const inB = new Set(b.entryIds);

    // no entry is on both
    expect([...inA].filter((id) => inB.has(id))).toEqual([]);
    // together they cover all 15, and the entries point back at the invoice that lists them
    expect(inA.size + inB.size).toBe(15);
    for (const entry of entries) {
      const id = String(entry._id);
      const owner = inA.has(id) ? a : b;
      expect(owner.entryIds).toContain(id);
      expect(await invoiceIdOf(entry)).toBe(owner._id);
    }
    // each invoice's lines match its own entries
    for (const invoice of [a, b]) {
      expect(invoice.lineItems[0].billedSeconds).toBe(invoice.entryIds.length * 3600);
    }
    expect([a.number, b.number].sort()).toEqual(['INV-0001', 'INV-0002']);
  });

  it('two users invoicing at the same time do not affect each other', async () => {
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '10:00'));
    await addEntry(bruno, bruno.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '10:00'));

    const [a, b] = await Promise.all([
      createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13')),
      createInvoice(bruno, range(bruno.acme, '2026-03-09', '2026-03-13')),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.body.invoice.number, b.body.invoice.number]).toEqual(['INV-0001', 'INV-0001']); // numbers are per user
  });
});

// ---------- all or nothing ----------

describe('all or nothing', () => {
  it('if saving the invoice fails, the claimed entries are released and no number is used up', async () => {
    const entry = await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '11:00'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(Invoice, 'create').mockRejectedValueOnce(new Error('disk full'));

    const failed = await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13'));
    expect(failed.status).toBe(500);

    expect((await TimeEntry.findById(entry._id)).invoiceId).toBeNull(); // released again
    expect(await Invoice.countDocuments()).toBe(0);
    expect(await Counter.countDocuments()).toBe(0); // the number was rolled back too

    // and the same period can be invoiced afterwards, starting at INV-0001
    const ok = await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13'));
    expect(ok.status).toBe(201);
    expect(ok.body.invoice.number).toBe('INV-0001');
  });

  it('explains clearly when MongoDB has no transactions (a plain local server)', async () => {
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '10:00'));
    jest.spyOn(mongoose.connection, 'transaction').mockRejectedValueOnce(
      Object.assign(new Error('Transaction numbers are only allowed on a replica set member or mongos'), { code: 20 })
    );
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13'));
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/replica set/);
    expect((await TimeEntry.findOne({ userId: priya.id })).invoiceId).toBeNull();
  });
});

// ---------- rounding: each entry is rounded up to 15 minutes when billing ----------

const setRounding = (user, roundingMinutes) => User.updateOne({ _id: user.id }, { roundingMinutes });
const minutes = (n) => n * 60 * 1000;
const plusMinutes = (date, n) => new Date(date.getTime() + minutes(n));

describe('rounding each entry up to 15 minutes', () => {
  it('bills 7 min + 22 min as 15 + 30 min (per entry), and leaves the entries themselves alone', async () => {
    await setRounding(priya, 15);
    const short = await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), plusMinutes(ist('2026-03-09', '09:00'), 7));
    const longer = await addEntry(priya, priya.website, ist('2026-03-09', '10:00'), plusMinutes(ist('2026-03-09', '10:00'), 22));

    const preview = await previewInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-09'));
    expect(preview.status).toBe(200);
    expect(preview.body.preview.roundingMinutes).toBe(15);
    expect(preview.body.preview.lineItems).toEqual([
      { projectId: priya.website, projectName: 'Website', hourlyRate: 50, rawSeconds: 29 * 60, billedSeconds: 45 * 60, hours: 0.75, amount: 37.5 },
    ]);
    expect(preview.body.preview.total).toBe(37.5); // 0.75 h at $50, not 0.48 h

    const { body } = await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-09'));
    expect(body.invoice.roundingMinutes).toBe(15);
    expect(body.invoice.lineItems).toEqual(preview.body.preview.lineItems);
    expect(body.invoice.total).toBe(37.5);

    // the entries keep their real durations
    expect((await TimeEntry.findById(short._id)).durationSeconds).toBe(7 * 60);
    expect((await TimeEntry.findById(longer._id)).durationSeconds).toBe(22 * 60);

    // the invoice page shows both, entry by entry
    const page = await api('get', `/api/invoices/${body.invoice._id}`, priya.token);
    expect(page.body.entries.map((e) => [e.durationSeconds, e.billedSeconds])).toEqual([
      [7 * 60, 15 * 60],
      [22 * 60, 30 * 60],
    ]);
  });

  it('is off by default: the same entries are billed as tracked', async () => {
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), plusMinutes(ist('2026-03-09', '09:00'), 7));
    await addEntry(priya, priya.website, ist('2026-03-09', '10:00'), plusMinutes(ist('2026-03-09', '10:00'), 22));

    const { body } = await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-09'));
    expect(body.invoice.roundingMinutes).toBe(0);
    expect(body.invoice.lineItems[0]).toMatchObject({ rawSeconds: 29 * 60, billedSeconds: 29 * 60, hours: 0.48, amount: 24.17 });
    expect(body.invoice.total).toBe(24.17);
  });

  it('rounds every entry, not the total, and one project at a time', async () => {
    await setRounding(priya, 15);
    // Website: three entries of 5 min (15 min in total, but billed as 3 x 15 = 45 min)
    for (const hour of ['09', '10', '11']) {
      await addEntry(priya, priya.website, ist('2026-03-10', `${hour}:00`), plusMinutes(ist('2026-03-10', `${hour}:00`), 5));
    }
    // App: exactly 15 min (stays 15), 15 min 1 s (becomes 30) and an empty entry (stays 0)
    const at = (time, seconds) => [ist('2026-03-11', time), new Date(ist('2026-03-11', time).getTime() + seconds * 1000)];
    await addEntry(priya, priya.app, ...at('09:00', 900));
    await addEntry(priya, priya.app, ...at('10:00', 901));
    await addEntry(priya, priya.app, ...at('11:00', 0));

    const { body } = await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13'));
    expect(body.invoice.lineItems).toEqual([
      { projectId: priya.app, projectName: 'App', hourlyRate: 60, rawSeconds: 1801, billedSeconds: 2700, hours: 0.75, amount: 45 }, // 15 + 30 + 0 min
      { projectId: priya.website, projectName: 'Website', hourlyRate: 50, rawSeconds: 900, billedSeconds: 2700, hours: 0.75, amount: 37.5 },
    ]);
    expect(body.invoice.total).toBe(82.5);
  });

  it('never changes an invoice that already exists when the setting is changed later (either way)', async () => {
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), plusMinutes(ist('2026-03-09', '09:00'), 7));
    await addEntry(priya, priya.website, ist('2026-03-10', '09:00'), plusMinutes(ist('2026-03-10', '09:00'), 22));

    // an invoice made with rounding OFF, then rounding is switched on
    const plain = (await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-09'))).body.invoice;
    await setRounding(priya, 15);
    // an invoice made with rounding ON, then it is switched off again
    const rounded = (await createInvoice(priya, range(priya.acme, '2026-03-10', '2026-03-10'))).body.invoice;
    await setRounding(priya, 0);

    const plainAgain = (await api('get', `/api/invoices/${plain._id}`, priya.token)).body;
    const roundedAgain = (await api('get', `/api/invoices/${rounded._id}`, priya.token)).body;

    expect(plainAgain.invoice).toMatchObject({ roundingMinutes: 0, total: plain.total });
    expect(plainAgain.invoice.lineItems[0]).toMatchObject({ rawSeconds: 7 * 60, billedSeconds: 7 * 60, amount: 5.83 });
    expect(plainAgain.entries.map((e) => e.billedSeconds)).toEqual([7 * 60]);

    expect(roundedAgain.invoice).toMatchObject({ roundingMinutes: 15, total: 25 });
    expect(roundedAgain.invoice.lineItems[0]).toMatchObject({ rawSeconds: 22 * 60, billedSeconds: 30 * 60, amount: 25 });
    expect(roundedAgain.entries.map((e) => e.billedSeconds)).toEqual([30 * 60]);
  });
});

// ---------- time zones ----------

describe('the date range uses the user\'s time zone', () => {
  it('India: 23:30 on the last day is in, 00:15 the next morning is out', async () => {
    const inside = await addEntry(priya, priya.website, ist('2026-03-13', '23:00'), ist('2026-03-13', '23:30'));
    const outside = await addEntry(priya, priya.website, ist('2026-03-14', '00:15'), ist('2026-03-14', '01:00'));
    const insideFirst = await addEntry(priya, priya.website, ist('2026-03-09', '00:00'), ist('2026-03-09', '00:30'));
    const outsideFirst = await addEntry(priya, priya.website, ist('2026-03-08', '23:15'), ist('2026-03-08', '23:45'));

    const { body } = await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13'));
    expect(sorted(body.invoice.entryIds)).toEqual(sorted([inside._id, insideFirst._id]));
    expect((await TimeEntry.findById(outside._id)).invoiceId).toBeNull();
    expect((await TimeEntry.findById(outsideFirst._id)).invoiceId).toBeNull();
  });

  it('New York (UTC-4 in March): the day starts at 04:00 UTC', async () => {
    const nick = await createUser('nick', { timezone: 'America/New_York' });
    const utc = (iso) => new Date(iso);
    const add = (start, end) => addEntry(nick, nick.website, utc(start), utc(end));

    const lateTheDayBefore = await add('2026-03-12T03:00:00Z', '2026-03-12T03:30:00Z'); // 23:00 on 11 March
    const first = await add('2026-03-12T04:30:00Z', '2026-03-12T05:00:00Z'); //             00:30 on 12 March
    const last = await add('2026-03-13T03:30:00Z', '2026-03-13T03:55:00Z'); //              23:30 on 12 March
    const earlyTheDayAfter = await add('2026-03-13T04:30:00Z', '2026-03-13T05:00:00Z'); //  00:30 on 13 March

    const { body } = await createInvoice(nick, range(nick.acme, '2026-03-12', '2026-03-12'));
    expect(body.invoice.timezone).toBe('America/New_York');
    expect(sorted(body.invoice.entryIds)).toEqual(sorted([first._id, last._id]));
    expect((await TimeEntry.findById(lateTheDayBefore._id)).invoiceId).toBeNull();
    expect((await TimeEntry.findById(earlyTheDayAfter._id)).invoiceId).toBeNull();
  });
});

// ---------- validation ----------

describe('validation', () => {
  beforeEach(async () => {
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '10:00'));
  });

  it("rejects a client that isn't the user's, or missing", async () => {
    const foreign = await createInvoice(priya, range(bruno.acme, '2026-03-09', '2026-03-13'));
    expect(foreign.status).toBe(400);
    expect(foreign.body.message).toBe('Client not found');
    expect(foreign.body.errors).toEqual([{ path: 'clientId', message: 'Client not found' }]);
    expect((await previewInvoice(priya, range(bruno.acme, '2026-03-09', '2026-03-13'))).status).toBe(400);

    const missing = await createInvoice(priya, { from: '2026-03-09', to: '2026-03-13' });
    expect(missing.status).toBe(400);
    expect(missing.body.errors).toEqual([{ path: 'clientId', message: 'Client is required' }]);
  });

  it('rejects bad dates, from after to, ranges over 366 days and an end date after today', async () => {
    const bad = await createInvoice(priya, range(priya.acme, 'yesterday', '2026-3-13'));
    expect(bad.status).toBe(400);
    expect(bad.body.errors.map((e) => e.path).sort()).toEqual(['from', 'to']);

    const backwards = await createInvoice(priya, range(priya.acme, '2026-03-13', '2026-03-09'));
    expect(backwards.body.errors).toEqual([{ path: 'to', message: 'The end date must not be before the start date' }]);

    // 366 days is allowed (it just has nothing to bill), 367 is not
    const from366 = '2025-03-01'; // 1 March 2025 to 1 March 2026 is 366 days, both ends included
    const ok = await createInvoice(priya, range(priya.acme, from366, '2026-03-01'));
    expect(ok.body.message).toBe(NOTHING);
    const tooLong = await createInvoice(priya, range(priya.acme, '2025-02-28', '2026-03-01'));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.errors).toEqual([{ path: 'to', message: 'A period can be at most 366 days' }]);

    const tomorrow = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).toISODate();
    const future = await createInvoice(priya, range(priya.acme, '2026-03-09', tomorrow));
    expect(future.body.errors).toEqual([{ path: 'to', message: "The end date can't be after today" }]);

    const today = DateTime.now().setZone('Asia/Kolkata').toISODate();
    const todayOk = await createInvoice(priya, range(priya.acme, '2026-03-09', today));
    expect(todayOk.status).toBe(201); // today is allowed
  });

  it('rejects notes over 500 characters', async () => {
    const res = await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13', { notes: 'x'.repeat(501) }));
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ path: 'notes', message: 'Notes must be at most 500 characters' }]);
    expect(await Invoice.countDocuments()).toBe(0);
  });
});

// ---------- numbers ----------

describe('invoice numbers', () => {
  it('count up per user (INV-0001, INV-0002, ...) and are never reused', async () => {
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '10:00'));
    await addEntry(priya, priya.website, ist('2026-03-16', '09:00'), ist('2026-03-16', '10:00'));
    await addEntry(priya, priya.website, ist('2026-03-23', '09:00'), ist('2026-03-23', '10:00'));
    await addEntry(bruno, bruno.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '10:00'));

    const one = await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13'));
    const two = await createInvoice(priya, range(priya.acme, '2026-03-16', '2026-03-20'));
    expect([one.body.invoice.number, two.body.invoice.number]).toEqual(['INV-0001', 'INV-0002']);
    expect((await createInvoice(bruno, range(bruno.acme, '2026-03-09', '2026-03-13'))).body.invoice.number).toBe('INV-0001');

    // deleting the newest draft does not hand its number out again
    expect((await api('delete', `/api/invoices/${two.body.invoice._id}`, priya.token)).status).toBe(204);
    const three = await createInvoice(priya, range(priya.acme, '2026-03-16', '2026-03-27'));
    expect(three.body.invoice.number).toBe('INV-0003');
  });

  it('are unique per user in the database too', async () => {
    const indexes = await Invoice.collection.indexes();
    const index = indexes.find((i) => i.unique && i.key.userId === 1 && i.key.number === 1);
    expect(index).toBeDefined();
  });
});

// ---------- status ----------

describe('PATCH /api/invoices/:id/status', () => {
  const makeInvoice = async (user = priya, date = '2026-03-09') => {
    await addEntry(user, user.website, ist(date, '09:00'), ist(date, '10:00'));
    return (await createInvoice(user, range(user.acme, date, date))).body.invoice;
  };
  const setStatus = (id, status, user = priya) => api('patch', `/api/invoices/${id}/status`, user.token, { status });

  it('allows draft to sent, sent to paid, and draft to paid, and records when', async () => {
    const a = await makeInvoice(priya, '2026-03-09');
    const sent = await setStatus(a._id, 'sent');
    expect(sent.status).toBe(200);
    expect(sent.body.invoice).toMatchObject({ status: 'sent', paidAt: null });
    expect(sent.body.invoice.sentAt).toEqual(expect.any(String));

    const paid = await setStatus(a._id, 'paid');
    expect(paid.body.invoice.status).toBe('paid');
    expect(paid.body.invoice.paidAt).toEqual(expect.any(String));
    expect(paid.body.invoice.sentAt).toBe(sent.body.invoice.sentAt); // kept

    const b = await makeInvoice(priya, '2026-03-10');
    const direct = await setStatus(b._id, 'paid');
    expect(direct.status).toBe(200);
    expect(direct.body.invoice).toMatchObject({ status: 'paid', sentAt: null });
  });

  it('rejects every other change with 409 "Can\'t change status from X to Y"', async () => {
    const draft = await makeInvoice(priya, '2026-03-09');
    const sent = await makeInvoice(priya, '2026-03-10');
    await setStatus(sent._id, 'sent');
    const paid = await makeInvoice(priya, '2026-03-11');
    await setStatus(paid._id, 'paid');

    const cases = [
      [draft._id, 'draft', 'draft'],
      [sent._id, 'sent', 'sent'],
      [sent._id, 'draft', 'sent'],
      [paid._id, 'draft', 'paid'],
      [paid._id, 'sent', 'paid'],
      [paid._id, 'paid', 'paid'],
    ];
    for (const [id, target, current] of cases) {
      const res = await setStatus(id, target);
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(`Can't change status from ${current} to ${target}`);
    }
    expect((await Invoice.findById(paid._id)).status).toBe('paid');
  });

  it('rejects a status that does not exist', async () => {
    const invoice = await makeInvoice();
    const res = await setStatus(invoice._id, 'cancelled');
    expect(res.status).toBe(400);
    expect(res.body.errors[0].path).toBe('status');
  });
});

// ---------- deleting ----------

describe('DELETE /api/invoices/:id', () => {
  const makeInvoice = async (date = '2026-03-09') => {
    const entry = await addEntry(priya, priya.website, ist(date, '09:00'), ist(date, '10:00'));
    const invoice = (await createInvoice(priya, range(priya.acme, date, date))).body.invoice;
    return { entry, invoice };
  };

  it('deletes a draft and gives its entries back so they can be invoiced again', async () => {
    const { entry, invoice } = await makeInvoice();

    expect((await api('delete', `/api/invoices/${invoice._id}`, priya.token)).status).toBe(204);
    expect(await Invoice.countDocuments()).toBe(0);
    expect((await TimeEntry.findById(entry._id)).invoiceId).toBeNull();
    expect((await api('get', '/api/entries?status=unbilled', priya.token)).body.entries).toHaveLength(1);

    // the entry can be edited again, and billed again
    expect((await api('patch', `/api/entries/${entry._id}`, priya.token, { description: 'free again' })).status).toBe(200);
    expect((await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-09'))).status).toBe(201);
  });

  it('refuses to delete a sent or a paid invoice (409) and keeps its entries billed', async () => {
    const sent = await makeInvoice('2026-03-09');
    const paid = await makeInvoice('2026-03-10');
    await api('patch', `/api/invoices/${sent.invoice._id}/status`, priya.token, { status: 'sent' });
    await api('patch', `/api/invoices/${paid.invoice._id}/status`, priya.token, { status: 'paid' });

    for (const { invoice, entry } of [sent, paid]) {
      const res = await api('delete', `/api/invoices/${invoice._id}`, priya.token);
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Only draft invoices can be deleted');
      expect(String((await TimeEntry.findById(entry._id)).invoiceId)).toBe(invoice._id);
    }
    expect(await Invoice.countDocuments()).toBe(2);
  });

  it('returns 404 for an invoice that does not exist and 400 for a malformed id', async () => {
    expect((await api('delete', `/api/invoices/${new mongoose.Types.ObjectId()}`, priya.token)).status).toBe(404);
    const malformed = await api('delete', '/api/invoices/not-an-id', priya.token);
    expect(malformed.status).toBe(400);
    expect(malformed.body.message).toBe('Invalid id');
  });
});

// ---------- reading ----------

describe('GET /api/invoices and /api/invoices/:id', () => {
  it('lists my invoices newest first with filters, without the heavy fields', async () => {
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '10:00'));
    await addEntry(priya, priya.brand, ist('2026-03-10', '09:00'), ist('2026-03-10', '10:00'));
    await addEntry(priya, priya.website, ist('2026-03-11', '09:00'), ist('2026-03-11', '10:00'));
    const a = (await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-09'))).body.invoice;
    const b = (await createInvoice(priya, range(priya.zeta, '2026-03-10', '2026-03-10'))).body.invoice;
    const c = (await createInvoice(priya, range(priya.acme, '2026-03-11', '2026-03-11'))).body.invoice;
    await api('patch', `/api/invoices/${a._id}/status`, priya.token, { status: 'paid' });

    const all = await api('get', '/api/invoices', priya.token);
    expect(all.body.invoices.map((i) => i.number)).toEqual(['INV-0003', 'INV-0002', 'INV-0001']);
    expect(all.body.invoices[0]).toMatchObject({ _id: c._id, status: 'draft', total: 50, client: { name: 'Acme' } });
    expect(all.body.invoices[0].lineItems).toBeUndefined();
    expect(all.body.invoices[0].entryIds).toBeUndefined();

    expect((await api('get', '/api/invoices?status=paid', priya.token)).body.invoices.map((i) => i.number)).toEqual(['INV-0001']);
    expect((await api('get', '/api/invoices?status=draft', priya.token)).body.invoices.map((i) => i.number)).toEqual(['INV-0003', 'INV-0002']);
    expect((await api('get', `/api/invoices?clientId=${priya.zeta}`, priya.token)).body.invoices.map((i) => i._id)).toEqual([b._id]);
    expect((await api('get', '/api/invoices?status=weird', priya.token)).status).toBe(400);
    expect((await api('get', '/api/invoices?clientId=abc', priya.token)).status).toBe(400);
  });

  it('returns one invoice with its lines, and the entries on it in time order', async () => {
    await addEntry(priya, priya.app, ist('2026-03-10', '10:00'), ist('2026-03-10', '11:00'), { description: 'second' });
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '10:30'), { description: 'first' });
    const { invoice } = (await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13'))).body;

    const res = await api('get', `/api/invoices/${invoice._id}`, priya.token);
    expect(res.status).toBe(200);
    expect(res.body.invoice.lineItems).toHaveLength(2);
    expect(res.body.invoice.entryIds).toHaveLength(2);
    expect(res.body.entries.map((e) => [e.description, e.projectName, e.durationSeconds])).toEqual([
      ['first', 'Website', 5400],
      ['second', 'App', 3600],
    ]);
  });
});

// ---------- privacy and auth ----------

describe("users can't touch each other's invoices", () => {
  it("user B cannot see, change or delete user A's invoice (404) and it is not in B's list", async () => {
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '10:00'));
    const { invoice } = (await createInvoice(priya, range(priya.acme, '2026-03-09', '2026-03-13'))).body;

    expect((await api('get', `/api/invoices/${invoice._id}`, bruno.token)).status).toBe(404);
    expect((await api('patch', `/api/invoices/${invoice._id}/status`, bruno.token, { status: 'paid' })).status).toBe(404);
    expect((await api('delete', `/api/invoices/${invoice._id}`, bruno.token)).status).toBe(404);
    expect((await api('get', '/api/invoices', bruno.token)).body.invoices).toEqual([]);

    // untouched for the owner
    const still = await Invoice.findById(invoice._id);
    expect(still.status).toBe('draft');
    expect(await TimeEntry.countDocuments({ invoiceId: invoice._id })).toBe(1);
  });

  it("user B cannot bill user A's entries, even by using A's client id", async () => {
    const entry = await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '10:00'));
    const res = await createInvoice(bruno, range(priya.acme, '2026-03-09', '2026-03-13'));
    expect(res.status).toBe(400);
    expect((await TimeEntry.findById(entry._id)).invoiceId).toBeNull();
  });

  it('requires a login', async () => {
    for (const [method, url] of [
      ['get', '/api/invoices'],
      ['post', '/api/invoices'],
      ['post', '/api/invoices/preview'],
      ['get', `/api/invoices/${new mongoose.Types.ObjectId()}`],
      ['patch', `/api/invoices/${new mongoose.Types.ObjectId()}/status`],
      ['delete', `/api/invoices/${new mongoose.Types.ObjectId()}`],
    ]) {
      expect((await api(method, url, null, {})).status).toBe(401);
    }
  });
});
