import mongoose from 'mongoose';
import request from 'supertest';
import { DateTime } from 'luxon';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Project from '../models/Project.js';
import TimeEntry from '../models/TimeEntry.js';
import Invoice from '../models/Invoice.js';
import generateToken from '../utils/generateToken.js';
import * as receivables from '../services/receivables.service.js';

const ZONE = 'Asia/Kolkata';
// Wednesday 18 March 2026, 10:00 in India: the same "now" every time the tests run
const NOW = DateTime.fromISO('2026-03-18T10:00:00', { zone: ZONE });

let mongod;
let alex; // the user whose numbers are checked
let sam; // somebody else, with numbers of their own

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';

  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongod.getUri());
  await Promise.all([User.init(), Client.init(), Project.init(), TimeEntry.init(), Invoice.init()]);
});

beforeEach(async () => {
  alex = await createUser('Alex', ZONE);
  sam = await createUser('Sam', ZONE);
});

afterEach(async () => {
  await Promise.all([User, Client, Project, TimeEntry, Invoice].map((model) => model.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ---------- helpers ----------

const createUser = async (name, timezone) => {
  const user = await User.create({ name, email: `${name.toLowerCase()}@example.com`, passwordHash: 'not-used', timezone });
  return { id: user._id, name, email: user.email, token: generateToken(user), timezone };
};

const createClient = (user, name) => Client.create({ userId: user.id, name, email: `${name.toLowerCase().replace(/\W/g, '')}@client.example`, company: `${name} Inc` });

// Noon of a local day, a number of days from today (negative = in the past): never close to a midnight
const dueIn = (days, zone = ZONE) => NOW.setZone(zone).startOf('day').plus({ days }).set({ hour: 12 }).toJSDate();
// The same, from the real today: the routes use the real clock, so their tests can't use the fixed NOW
const dueFromToday = (days) => DateTime.now().setZone(ZONE).startOf('day').plus({ days }).set({ hour: 12 }).toJSDate();
const at = (iso, zone = ZONE) => DateTime.fromISO(iso, { zone }).toJSDate();

let sequence = 0;
const makeInvoice = (user, client, overrides = {}) => {
  const status = overrides.status ?? 'sent';
  const issuedAt = overrides.issuedAt ?? at('2026-02-20T10:00:00');
  return Invoice.create({
    userId: user.id,
    clientId: client._id,
    number: `INV-${String(++sequence).padStart(4, '0')}`,
    periodStart: '2026-02-09',
    periodEnd: '2026-02-19',
    timezone: user.timezone,
    status,
    issuedAt,
    dueDate: dueIn(5, user.timezone),
    sentAt: status === 'draft' ? null : issuedAt,
    paidAt: null,
    client: { name: client.name, email: client.email, company: client.company },
    from: { name: user.name, email: user.email },
    subtotal: overrides.total ?? 100,
    total: 100,
    currency: 'USD',
    ...overrides,
  });
};

// an invoice that is still waiting: a due date this many days from today (negative = already late)
const unpaid = (user, client, total, daysFromToday, overrides = {}) => makeInvoice(user, client, { total, subtotal: total, dueDate: dueIn(daysFromToday, user.timezone), ...overrides });
const paidInvoice = (user, client, total, sentAt, paidAt, overrides = {}) =>
  makeInvoice(user, client, { total, subtotal: total, status: 'paid', issuedAt: sentAt, sentAt, paidAt, ...overrides });

const createProject = (user, client, name, hourlyRate) => Project.create({ userId: user.id, clientId: client._id, name, hourlyRate });
const addEntry = (user, project, { start = '2026-03-10T10:00:00', seconds = 3600, billable = true, invoiceId = null, running = false } = {}) => {
  const startedAt = at(start);
  return TimeEntry.create({
    userId: user.id,
    projectId: project._id,
    clientId: project.clientId,
    description: 'work',
    billable,
    startedAt,
    endedAt: running ? null : new Date(startedAt.getTime() + seconds * 1000),
    durationSeconds: running ? 0 : seconds,
    invoiceId,
  });
};

const api = (url, token) => {
  const req = request(app).get(url);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

const rowOf = (rows, name) => rows.find((row) => row.client.name === name);

// ---------- the summary ----------

describe('summary: totals and the aging breakdown', () => {
  it('puts invoices in every bucket: not due and due today are Current, then 1-30, 31-60 and 61+ days overdue', async () => {
    const acme = await createClient(alex, 'Acme');
    await unpaid(alex, acme, 100, 5); //   due in 5 days     -> current
    await unpaid(alex, acme, 200, 0); //   due today         -> current (not overdue yet)
    await unpaid(alex, acme, 300, -1); //  1 day overdue     -> 1-30
    await unpaid(alex, acme, 400, -30); // 30 days overdue   -> 1-30
    await unpaid(alex, acme, 500, -31); // 31 days overdue   -> 31-60
    await unpaid(alex, acme, 600, -60); // 60 days overdue   -> 31-60
    await unpaid(alex, acme, 700, -61); // 61 days overdue   -> 61+
    await unpaid(alex, acme, 800, -100); // 100 days overdue -> 61+

    const result = await receivables.summary(alex.id, { now: NOW });

    expect(result.currency).toBe('USD');
    expect(result.outstanding).toEqual({ amount: 3600, count: 8 });
    expect(result.overdue).toMatchObject({ amount: 3300, count: 6 }); // everything except the two that are not late
    expect(result.aging).toEqual([
      { key: 'current', amount: 300, count: 2 },
      { key: '1-30', amount: 700, count: 2 },
      { key: '31-60', amount: 1100, count: 2 },
      { key: '61+', amount: 1500, count: 2 },
    ]);
    // the four buckets add up to what is outstanding
    expect(result.aging.reduce((total, bucket) => total + bucket.amount, 0)).toBe(result.outstanding.amount);
  });

  it('the oldest overdue invoice is the one that has waited longest, with its client and its days', async () => {
    const acme = await createClient(alex, 'Acme');
    const globex = await createClient(alex, 'Globex');
    await unpaid(alex, acme, 300, -12);
    const oldest = await unpaid(alex, globex, 450.5, -40);
    await unpaid(alex, acme, 100, -3);

    const { overdue } = await receivables.summary(alex.id, { now: NOW });

    expect(overdue.count).toBe(3);
    expect(overdue.oldest).toEqual({ invoiceId: oldest._id, number: oldest.number, clientId: globex._id, clientName: 'Globex', days: 40, amount: 450.5 });
  });

  it('nothing is overdue when everything is current: no oldest invoice', async () => {
    const acme = await createClient(alex, 'Acme');
    await unpaid(alex, acme, 250, 0);
    await unpaid(alex, acme, 250, 14);

    const result = await receivables.summary(alex.id, { now: NOW });

    expect(result.outstanding).toEqual({ amount: 500, count: 2 });
    expect(result.overdue).toEqual({ amount: 0, count: 0, oldest: null });
  });

  it('a paid invoice never counts as outstanding or overdue, and neither does a draft', async () => {
    const acme = await createClient(alex, 'Acme');
    await paidInvoice(alex, acme, 999, at('2026-02-01T10:00:00'), at('2026-03-05T10:00:00'), { dueDate: dueIn(-30) }); // long past its due date, but paid
    await makeInvoice(alex, acme, { status: 'draft', total: 555, subtotal: 555, dueDate: dueIn(-50) }); // never sent
    await unpaid(alex, acme, 120, -2);

    const result = await receivables.summary(alex.id, { now: NOW });

    expect(result.outstanding).toEqual({ amount: 120, count: 1 });
    expect(result.overdue).toMatchObject({ amount: 120, count: 1 });
    expect(result.aging.find((bucket) => bucket.key === '31-60')).toEqual({ key: '31-60', amount: 0, count: 0 });
    expect(result.paidThisMonth).toEqual({ amount: 999, count: 1 });
  });

  it('a user with nothing gets zeros, four empty buckets and no average', async () => {
    const result = await receivables.summary(alex.id, { now: NOW });

    expect(result.outstanding).toEqual({ amount: 0, count: 0 });
    expect(result.overdue).toEqual({ amount: 0, count: 0, oldest: null });
    expect(result.paidThisMonth).toEqual({ amount: 0, count: 0 });
    expect(result.avgDaysToPay).toEqual({ days: null, count: 0, windowDays: 90 });
    expect(result.aging.map((bucket) => [bucket.key, bucket.amount, bucket.count])).toEqual([
      ['current', 0, 0],
      ['1-30', 0, 0],
      ['31-60', 0, 0],
      ['61+', 0, 0],
    ]);
  });

  it('adds up money to two decimals', async () => {
    const acme = await createClient(alex, 'Acme');
    await unpaid(alex, acme, 0.1, -2);
    await unpaid(alex, acme, 0.2, -2);
    await unpaid(alex, acme, 1344.75, 9);

    const result = await receivables.summary(alex.id, { now: NOW });

    expect(result.outstanding.amount).toBe(1345.05); // not 1345.0500000000002
    expect(result.overdue.amount).toBe(0.3); // not 0.30000000000000004
  });
});

describe('summary: paid this month and the average days to get paid', () => {
  it('paid this month counts what was paid since the 1st, in the owner\'s own time zone', async () => {
    const acme = await createClient(alex, 'Acme');
    const sent = at('2026-02-10T10:00:00');
    await paidInvoice(alex, acme, 100, sent, at('2026-03-02T10:00:00')); // March
    await paidInvoice(alex, acme, 200, sent, at('2026-03-17T23:00:00')); // March
    await paidInvoice(alex, acme, 400, sent, at('2026-03-01T00:30:00')); // 00:30 on the 1st in India (but 28 Feb in UTC): March
    await paidInvoice(alex, acme, 800, sent, at('2026-02-28T22:00:00')); // February in India
    await paidInvoice(alex, acme, 1600, sent, at('2026-02-10T12:00:00')); // February

    const { paidThisMonth } = await receivables.summary(alex.id, { now: NOW });

    expect(paidThisMonth).toEqual({ amount: 700, count: 3 });
  });

  it('the average days to get paid goes from sent to paid, over the last 90 days only', async () => {
    const acme = await createClient(alex, 'Acme');
    await paidInvoice(alex, acme, 100, at('2026-02-20T10:00:00'), at('2026-03-02T09:00:00')); // 10 days
    await paidInvoice(alex, acme, 100, at('2026-02-25T22:00:00'), at('2026-03-09T01:00:00')); // 12 calendar days (late evening to early morning)
    await paidInvoice(alex, acme, 100, at('2025-11-01T10:00:00'), at('2025-12-01T10:00:00')); // 30 days, but paid 107 days ago: not in the window

    const { avgDaysToPay } = await receivables.summary(alex.id, { now: NOW });

    expect(avgDaysToPay).toEqual({ days: 11, count: 2, windowDays: 90 });
  });

  it('the 90 day window: an invoice paid a minute inside it counts, one paid a minute outside it does not', async () => {
    const acme = await createClient(alex, 'Acme');
    const ninety = NOW.minus({ days: 90 });
    await paidInvoice(alex, acme, 100, ninety.minus({ days: 6 }).toJSDate(), ninety.plus({ minutes: 1 }).toJSDate()); // 6 days, just inside
    await paidInvoice(alex, acme, 100, ninety.minus({ days: 40 }).toJSDate(), ninety.minus({ minutes: 1 }).toJSDate()); // 40 days, just outside

    const { avgDaysToPay } = await receivables.summary(alex.id, { now: NOW });

    expect(avgDaysToPay).toMatchObject({ days: 6, count: 1 });
  });

  it('the average has one decimal', async () => {
    const acme = await createClient(alex, 'Acme');
    await paidInvoice(alex, acme, 100, at('2026-02-20T10:00:00'), at('2026-03-01T10:00:00')); // 9 days
    await paidInvoice(alex, acme, 100, at('2026-02-20T10:00:00'), at('2026-03-02T10:00:00')); // 10 days
    await paidInvoice(alex, acme, 100, at('2026-02-20T10:00:00'), at('2026-03-04T10:00:00')); // 12 days

    expect((await receivables.summary(alex.id, { now: NOW })).avgDaysToPay.days).toBe(10.3); // 31 / 3
  });

  it('an invoice that was marked paid without being sent counts from the day it was issued', async () => {
    const acme = await createClient(alex, 'Acme');
    await makeInvoice(alex, acme, { status: 'paid', issuedAt: at('2026-03-10T10:00:00'), sentAt: null, paidAt: at('2026-03-14T10:00:00') });

    expect((await receivables.summary(alex.id, { now: NOW })).avgDaysToPay).toMatchObject({ days: 4, count: 1 });
  });
});

describe('summary: a day is the owner\'s day', () => {
  it('the same invoice is one day overdue in New York but only due today in India', async () => {
    const newYorker = await createUser('Nina', 'America/New_York');
    // 18 March 2026, 04:30 UTC: 10:00 in India, but 00:30 in New York (summer time)
    const moment = DateTime.fromISO('2026-03-18T04:30:00Z');
    // due at 02:00 UTC on the 18th: still the night of the 17th in New York, already 07:30 on the 18th in India
    const dueDate = at('2026-03-18T02:00:00Z', 'utc');
    const indian = await createClient(alex, 'Acme');
    const american = await createClient(newYorker, 'Acme');
    await unpaid(alex, indian, 500, 0, { dueDate });
    await unpaid(newYorker, american, 500, 0, { dueDate });

    const inIndia = await receivables.summary(alex.id, { now: moment });
    const inNewYork = await receivables.summary(newYorker.id, { now: moment });

    expect(inIndia.overdue).toMatchObject({ count: 0, amount: 0 });
    expect(inIndia.aging[0]).toEqual({ key: 'current', amount: 500, count: 1 });
    expect(inNewYork.overdue).toMatchObject({ count: 1, amount: 500 });
    expect(inNewYork.aging[1]).toEqual({ key: '1-30', amount: 500, count: 1 });
  });
});

// ---------- the clients ----------

describe('byClient', () => {
  it('has one row per client, with the numbers of that client only', async () => {
    const acme = await createClient(alex, 'Acme');
    const globex = await createClient(alex, 'Globex');
    await createClient(alex, 'Initech'); // no invoices at all

    await paidInvoice(alex, acme, 1000, at('2026-02-20T10:00:00'), at('2026-03-02T10:00:00')); //  10 days
    await paidInvoice(alex, acme, 500, at('2026-02-25T10:00:00'), at('2026-03-09T10:00:00')); //    12 days
    await unpaid(alex, acme, 300, -12); // overdue
    await unpaid(alex, acme, 200, 6); //   not due yet
    await makeInvoice(alex, acme, { status: 'draft', total: 999, subtotal: 999, dueDate: dueIn(-40) }); // a draft is not invoiced yet
    await unpaid(alex, globex, 75.25, -3);

    const rows = await receivables.byClient(alex.id, { now: NOW });

    expect(rows).toHaveLength(3);
    expect(rowOf(rows, 'Acme')).toEqual({
      client: { _id: acme._id, name: 'Acme', email: 'acme@client.example', company: 'Acme Inc' },
      invoicedTotal: 2000,
      paidTotal: 1500,
      outstanding: 500,
      overdueAmount: 300,
      overdueCount: 1,
      oldestOverdueDays: 12,
      lastPaymentAt: at('2026-03-09T10:00:00'),
      avgDaysToPay: 11,
      unbilledAmount: 0,
    });
    expect(rowOf(rows, 'Globex')).toMatchObject({ invoicedTotal: 75.25, paidTotal: 0, outstanding: 75.25, overdueAmount: 75.25, overdueCount: 1, oldestOverdueDays: 3, lastPaymentAt: null, avgDaysToPay: null });
    expect(rowOf(rows, 'Initech')).toMatchObject({ invoicedTotal: 0, paidTotal: 0, outstanding: 0, overdueAmount: 0, overdueCount: 0, oldestOverdueDays: 0, lastPaymentAt: null, avgDaysToPay: null, unbilledAmount: 0 });
  });

  it('a client whose invoices are all paid owes nothing, however old they are', async () => {
    const acme = await createClient(alex, 'Acme');
    await paidInvoice(alex, acme, 640, at('2025-12-01T10:00:00'), at('2025-12-20T10:00:00'), { dueDate: dueIn(-90) });

    const [row] = await receivables.byClient(alex.id, { now: NOW });

    expect(row).toMatchObject({ invoicedTotal: 640, paidTotal: 640, outstanding: 0, overdueAmount: 0, overdueCount: 0, oldestOverdueDays: 0 });
    expect(row.lastPaymentAt).toEqual(at('2025-12-20T10:00:00'));
    expect(row.avgDaysToPay).toBe(19); // the per-client average covers every payment, not only the last 90 days
  });

  it('sorts by overdue amount, then by outstanding, then by name', async () => {
    const [zed, initech, acme, globex, umbra, beta] = await Promise.all(['Zed', 'Initech', 'Acme', 'Globex', 'Umbra', 'Beta'].map((name) => createClient(alex, name)));
    await unpaid(alex, zed, 500, -4); //     overdue 500
    await unpaid(alex, zed, 200, 10); //     + 200 not due: outstanding 700
    await unpaid(alex, initech, 500, -9); // overdue 500, outstanding 500
    await unpaid(alex, acme, 300, -1); //    overdue 300
    await unpaid(alex, globex, 900, 20); //  nothing overdue, outstanding 900
    expect([umbra, beta]).toHaveLength(2); // nothing at all

    const rows = await receivables.byClient(alex.id, { now: NOW });

    expect(rows.map((row) => row.client.name)).toEqual(['Zed', 'Initech', 'Acme', 'Globex', 'Beta', 'Umbra']);
  });

  it('works out the unbilled amount from billable entries that are on no invoice, at each project\'s rate', async () => {
    const acme = await createClient(alex, 'Acme');
    const globex = await createClient(alex, 'Globex');
    const website = await createProject(alex, acme, 'Website', 50);
    const app = await createProject(alex, acme, 'Mobile app', 80);
    const brand = await createProject(alex, globex, 'Brand', 100);
    const billedOn = await unpaid(alex, acme, 100, 5);

    await addEntry(alex, website, { seconds: 2 * 3600 }); //   2 h at 50 = 100
    await addEntry(alex, app, { seconds: 1800 }); //           30 min at 80 = 40
    await addEntry(alex, website, { seconds: 420 }); //        7 min at 50 = 5.83
    await addEntry(alex, website, { seconds: 3 * 3600, billable: false }); // not billable: left out
    await addEntry(alex, website, { seconds: 5 * 3600, invoiceId: billedOn._id }); // already on an invoice: left out
    await addEntry(alex, app, { running: true }); // the running timer is not finished: left out
    await addEntry(alex, brand, { seconds: 3600 }); // 1 h at 100 = 100, for the other client

    const rows = await receivables.byClient(alex.id, { now: NOW });

    expect(rowOf(rows, 'Acme').unbilledAmount).toBe(145.83);
    expect(rowOf(rows, 'Globex').unbilledAmount).toBe(100);
  });

  it('only counts the user\'s own entries and projects', async () => {
    const acme = await createClient(alex, 'Acme');
    const theirs = await createClient(sam, 'Acme'); // same name, somebody else's client
    await addEntry(alex, await createProject(alex, acme, 'Website', 50), { seconds: 3600 });
    await addEntry(sam, await createProject(sam, theirs, 'Website', 500), { seconds: 3600 });

    const rows = await receivables.byClient(alex.id, { now: NOW });

    expect(rows).toHaveLength(1);
    expect(rows[0].unbilledAmount).toBe(50);
  });
});

// ---------- one client ----------

describe('clientDetail', () => {
  it('has the same numbers as the clients list, the invoices with their display status, and the last 5 payments', async () => {
    const acme = await createClient(alex, 'Acme');
    await createClient(alex, 'Globex');
    const project = await createProject(alex, acme, 'Website', 50);
    await addEntry(alex, project, { start: '2026-03-03T10:00:00', seconds: 3600 });
    await addEntry(alex, project, { start: '2026-03-12T15:00:00', seconds: 7200 });

    // six payments: the last five are listed, newest first
    for (let day = 1; day <= 6; day++) {
      await paidInvoice(alex, acme, day * 100, at(`2026-02-0${day}T10:00:00`), at(`2026-03-0${day}T12:00:00`), { issuedAt: at(`2026-02-0${day}T10:00:00`) });
    }
    const late = await unpaid(alex, acme, 300, -12, { issuedAt: at('2026-02-27T10:00:00') });
    const ahead = await unpaid(alex, acme, 200, 6, { issuedAt: at('2026-03-10T10:00:00') });
    const draft = await makeInvoice(alex, acme, { status: 'draft', total: 90, subtotal: 90, issuedAt: at('2026-03-16T10:00:00') });

    const detail = await receivables.clientDetail(alex.id, acme._id, { now: NOW });
    const row = rowOf(await receivables.byClient(alex.id, { now: NOW }), 'Acme');

    expect(detail.client.name).toBe('Acme');
    const { client, ...numbers } = row;
    expect(client.name).toBe('Acme');
    expect(detail.metrics).toEqual(numbers); // the same numbers as on the clients page
    expect(detail.metrics).toMatchObject({ invoicedTotal: 2600, paidTotal: 2100, outstanding: 500, overdueAmount: 300, overdueCount: 1, oldestOverdueDays: 12, unbilledAmount: 150 });

    // all invoices, newest first, with the status the user sees
    expect(detail.invoices.map((invoice) => [invoice._id, invoice.displayStatus, invoice.daysOverdue]).slice(0, 3)).toEqual([
      [draft._id, 'draft', 0],
      [ahead._id, 'sent', 0],
      [late._id, 'overdue', 12],
    ]);
    expect(detail.invoices).toHaveLength(9);
    expect(detail.invoices[0].lineItems).toBeUndefined(); // the list does not carry the lines
    expect(detail.invoices.every((invoice) => invoice.publicToken === undefined)).toBe(true);

    expect(detail.lastPayments.map((payment) => [payment.number, payment.amount, payment.paidAt])).toEqual(
      [6, 5, 4, 3, 2].map((day) => [expect.stringMatching(/^INV-/), day * 100, at(`2026-03-0${day}T12:00:00`)])
    );
  });

  it('says what is not billed yet and for which days, so "Invoice unbilled time" can fill the period in', async () => {
    const acme = await createClient(alex, 'Acme');
    const project = await createProject(alex, acme, 'Website', 40);
    await addEntry(alex, project, { start: '2026-03-03T23:50:00', seconds: 600 }); //  3 March in India
    await addEntry(alex, project, { start: '2026-03-12T15:00:00', seconds: 7200 });
    await addEntry(alex, project, { start: '2026-03-01T10:00:00', seconds: 3600, billable: false }); // not billable: does not stretch the period
    await addEntry(alex, project, { start: '2026-03-15T09:00:00', running: true }); // a timer still running: not finished, so not part of it

    const { unbilled } = await receivables.clientDetail(alex.id, acme._id, { now: NOW });

    expect(unbilled).toEqual({ amount: 86.67, seconds: 7800, entries: 2, from: '2026-03-03', to: '2026-03-12' });
  });

  it('a client with nothing yet has zeros, no invoices and no unbilled time', async () => {
    const acme = await createClient(alex, 'Acme');

    const detail = await receivables.clientDetail(alex.id, acme._id, { now: NOW });

    expect(detail.invoices).toEqual([]);
    expect(detail.lastPayments).toEqual([]);
    expect(detail.unbilled).toEqual({ amount: 0, seconds: 0, entries: 0, from: null, to: null });
    expect(detail.metrics).toMatchObject({ invoicedTotal: 0, outstanding: 0, overdueAmount: 0, lastPaymentAt: null, avgDaysToPay: null, unbilledAmount: 0 });
  });

  it('answers 404 for a client that does not exist and for somebody else\'s client', async () => {
    const theirs = await createClient(sam, 'Acme');

    await expect(receivables.clientDetail(alex.id, new mongoose.Types.ObjectId(), { now: NOW })).rejects.toMatchObject({ status: 404, message: 'Client not found' });
    await expect(receivables.clientDetail(alex.id, theirs._id, { now: NOW })).rejects.toMatchObject({ status: 404, message: 'Client not found' });
  });
});

// ---------- privacy ----------

describe('user A never sees the numbers of user B', () => {
  it('summary, clients and unbilled time only cover the logged-in user', async () => {
    const mine = await createClient(alex, 'Acme');
    const theirs = await createClient(sam, 'Secret Corp');
    await unpaid(alex, mine, 100, -2);
    await paidInvoice(alex, mine, 50, at('2026-03-01T10:00:00'), at('2026-03-05T10:00:00'));
    await unpaid(sam, theirs, 7000.55, -90); // a big, very late invoice
    await paidInvoice(sam, theirs, 3000.45, at('2026-03-01T10:00:00'), at('2026-03-15T10:00:00'));
    await addEntry(sam, await createProject(sam, theirs, 'Secret', 200), { seconds: 36000 });

    const summary = await receivables.summary(alex.id, { now: NOW });
    const rows = await receivables.byClient(alex.id, { now: NOW });

    expect(summary.outstanding).toEqual({ amount: 100, count: 1 });
    expect(summary.overdue).toMatchObject({ amount: 100, count: 1, oldest: expect.objectContaining({ clientName: 'Acme', days: 2 }) });
    expect(summary.paidThisMonth).toEqual({ amount: 50, count: 1 });
    expect(summary.aging[3]).toEqual({ key: '61+', amount: 0, count: 0 });
    expect(rows.map((row) => row.client.name)).toEqual(['Acme']);
    expect(JSON.stringify([summary, rows])).not.toMatch(/Secret|7000\.55|3000\.45/); // (amounts with cents: they can't turn up inside an id)

    // and the other way round
    const theirSummary = await receivables.summary(sam.id, { now: NOW });
    expect(theirSummary.outstanding).toEqual({ amount: 7000.55, count: 1 });
    expect((await receivables.byClient(sam.id, { now: NOW }))[0].unbilledAmount).toBe(2000); // 10 h at 200
  });
});

// ---------- the routes ----------

describe('GET /api/receivables/summary', () => {
  it('needs a login', async () => {
    expect((await api('/api/receivables/summary')).status).toBe(401);
    expect((await api('/api/receivables/clients')).status).toBe(401);
  });

  it('returns { summary } for the logged-in user', async () => {
    const acme = await createClient(alex, 'Acme');
    const theirs = await createClient(sam, 'Other');
    await unpaid(alex, acme, 1344.75, -12, { dueDate: dueFromToday(-12) });
    await unpaid(sam, theirs, 5000, -12, { dueDate: dueFromToday(-12) });

    const res = await api('/api/receivables/summary', alex.token);

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      currency: 'USD',
      outstanding: { amount: 1344.75, count: 1 },
      overdue: { amount: 1344.75, count: 1, oldest: { clientName: 'Acme', days: 12, amount: 1344.75 } },
      paidThisMonth: { amount: 0, count: 0 },
      avgDaysToPay: { days: null, count: 0 },
    });
    expect(res.body.summary.aging).toHaveLength(4);
    expect(res.body.summary.aging[1]).toEqual({ key: '1-30', amount: 1344.75, count: 1 });
    expect(Object.keys(res.body.summary.overdue.oldest).sort()).toEqual(['amount', 'clientId', 'clientName', 'days', 'invoiceId', 'number']);
  });
});

describe('GET /api/receivables/clients', () => {
  it('returns { clients } sorted with the most overdue first', async () => {
    const calm = await createClient(alex, 'Calm Co');
    const late = await createClient(alex, 'Late Ltd');
    await unpaid(alex, calm, 900, 10, { dueDate: dueFromToday(10) });
    await unpaid(alex, late, 100, -4, { dueDate: dueFromToday(-4) });

    const res = await api('/api/receivables/clients', alex.token);

    expect(res.status).toBe(200);
    expect(res.body.clients.map((row) => row.client.name)).toEqual(['Late Ltd', 'Calm Co']);
    expect(res.body.clients[0]).toMatchObject({ outstanding: 100, overdueAmount: 100, overdueCount: 1, oldestOverdueDays: 4 });
  });
});

describe('GET /api/clients/:id/overview', () => {
  it('returns the client, the numbers, the invoices and the last payments', async () => {
    const acme = await createClient(alex, 'Acme');
    await unpaid(alex, acme, 300, -5, { dueDate: dueFromToday(-5) });
    await paidInvoice(alex, acme, 120, at('2026-03-01T10:00:00'), at('2026-03-05T10:00:00'));

    const res = await api(`/api/clients/${acme._id}/overview`, alex.token);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['client', 'invoices', 'lastPayments', 'metrics', 'unbilled']);
    expect(res.body.client).toMatchObject({ name: 'Acme', email: 'acme@client.example' });
    expect(res.body.metrics).toMatchObject({ outstanding: 300, overdueAmount: 300, oldestOverdueDays: 5, paidTotal: 120 });
    expect(res.body.invoices.map((invoice) => invoice.displayStatus).sort()).toEqual(['overdue', 'paid']);
    expect(res.body.lastPayments).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain('publicToken');
  });

  it('needs a login', async () => {
    const acme = await createClient(alex, 'Acme');
    expect((await api(`/api/clients/${acme._id}/overview`)).status).toBe(401);
  });

  it('is 404 for a client that does not exist and for another user\'s client (the same answer for both)', async () => {
    const theirs = await createClient(sam, 'Secret Corp');
    await unpaid(sam, theirs, 7000.55, -90);

    const other = await api(`/api/clients/${theirs._id}/overview`, alex.token);
    const missing = await api(`/api/clients/${new mongoose.Types.ObjectId()}/overview`, alex.token);

    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(other.body).toEqual(missing.body);
    expect(other.body).toEqual({ message: 'Client not found' });
  });

  it('is 400 for an id that is not an id', async () => {
    const res = await api('/api/clients/not-an-id/overview', alex.token);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid id');
  });
});
