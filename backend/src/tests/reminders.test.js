import mongoose from 'mongoose';
import request from 'supertest';
import { jest } from '@jest/globals';
import { DateTime } from 'luxon';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Invoice from '../models/Invoice.js';
import ReminderLog from '../models/ReminderLog.js';
import generateToken from '../utils/generateToken.js';
import { EmailError, clearSentEmails, getSentEmails, setEmailProvider } from '../services/email.service.js';
import { MAX_ATTEMPTS, findDue, run } from '../services/reminder.service.js';
import { reminderWording, renderReminderEmail } from '../services/emailTemplates.js';

const APP = 'https://app.example.test';
const SECRET = 'a-long-random-secret-for-the-tests-0123456789';
const LINK = 'https://rzp.io/l/alex-morgan';
const DAY = 24 * 60 * 60 * 1000;
const savedEnv = { ...process.env };

let mongod;
let alex; // Asia/Kolkata, client billing@acme.com
let bruno; // another user

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.APP_URL = APP;

  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongod.getUri());
  await Promise.all([User.init(), Client.init(), Invoice.init(), ReminderLog.init()]);
});

beforeEach(async () => {
  clearSentEmails();
  alex = await createUser('Alex Morgan', { clientEmail: 'billing@acme.com' });
  bruno = await createUser('Bruno', { clientEmail: 'finance@other.com' });
});

afterEach(async () => {
  jest.restoreAllMocks();
  setEmailProvider(null);
  process.env = { ...savedEnv, JWT_SECRET: 'test-secret', JWT_EXPIRES_IN: '1h', APP_URL: APP };
  await Promise.all([User, Client, Invoice, ReminderLog].map((model) => model.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ---------- helpers ----------

const createUser = async (name, { timezone = 'Asia/Kolkata', clientEmail = '', reminders, payment } = {}) => {
  const user = await User.create({
    name,
    email: `${name.split(' ')[0].toLowerCase()}@example.com`,
    passwordHash: 'not-used',
    timezone,
    ...(reminders && { reminders }),
    ...(payment && { payment }),
  });
  const client = await Client.create({ userId: user._id, name: 'Acme', email: clientEmail || undefined, company: 'Acme Inc' });
  return { id: user._id, name, email: user.email, timezone, token: generateToken(user), clientId: client._id, clientEmail };
};

// 12:00 on a calendar day in a time zone
const at = (zone, date, time = '12:00') => DateTime.fromISO(`${date}T${time}`, { zone }).toJSDate();
// "now" as it is on a calendar day in a time zone (the job is given a fixed now, so the tests don't depend on the clock)
const nowOn = (zone, date, time = '09:00') => DateTime.fromISO(`${date}T${time}`, { zone });

let sequence = 0;
// A sent, unpaid invoice. By default it was sent 20 days before it is due, so no reminder falls on the day it was sent.
const makeInvoice = (user, due, overrides = {}) => {
  const dueDate = typeof due === 'string' ? at(user.timezone, due) : due;
  return Invoice.create({
    userId: user.id,
    clientId: user.clientId,
    number: `INV-${String(++sequence).padStart(4, '0')}`,
    periodStart: '2026-02-01',
    periodEnd: '2026-02-28',
    timezone: user.timezone,
    status: 'sent',
    issuedAt: new Date(dueDate.getTime() - 21 * DAY),
    sentAt: new Date(dueDate.getTime() - 20 * DAY),
    dueDate,
    client: { name: 'Acme', email: user.clientEmail, company: 'Acme Inc' },
    from: { name: user.name, email: user.email },
    lineItems: [{ projectId: new mongoose.Types.ObjectId(), projectName: 'Website', hourlyRate: 50, rawSeconds: 7200, billedSeconds: 7200, hours: 2, amount: 100 }],
    entryIds: [new mongoose.Types.ObjectId()],
    subtotal: 100,
    total: 100,
    currency: 'USD',
    ...overrides,
  });
};

const setReminders = (user, fields) =>
  User.updateOne({ _id: user.id }, { $set: Object.fromEntries(Object.entries(fields).map(([key, value]) => [`reminders.${key}`, value])) });

const api = (method, url, token, body) => {
  const req = request(app)[method](url);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
};
const logsOf = (invoice) => ReminderLog.find({ invoiceId: invoice._id }).sort({ createdAt: 1 });
const emails = () => getSentEmails();

// ---------- which reminder goes out on which day ----------

describe('the schedule (3 days before, on the due date, 7 and 14 days after)', () => {
  it('before_due: sent 3 days before the due date, with the right words, link and recipient', async () => {
    const invoice = await makeInvoice(alex, '2026-03-13');

    expect(await run(nowOn(alex.timezone, '2026-03-09'))).toEqual({ checked: 1, sent: 0, skipped: 0, failed: 0 }); // the day before: not yet
    expect(await run(nowOn(alex.timezone, '2026-03-10'))).toEqual({ checked: 1, sent: 1, skipped: 0, failed: 0 });

    const [email, ...others] = emails();
    expect(others).toHaveLength(0);
    expect(email.to).toEqual(['billing@acme.com']);
    expect(email.subject).toBe(`Reminder: ${invoice.number} is due in 3 days`);
    expect(email.replyTo).toEqual({ email: 'alex@example.com', name: 'Alex Morgan' });
    expect(email.fromName).toBe('Alex Morgan via TimeLedger');

    const token = (await Invoice.findById(invoice._id)).publicToken; // made for the reminder if it was missing
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(email.html).toContain(`href="${APP}/i/${token}"`);
    expect(email.text).toContain(`${APP}/i/${token}`);

    const [log] = await logsOf(invoice);
    expect(log).toMatchObject({ kind: 'before_due', offsetDays: 3, status: 'sent', to: 'billing@acme.com', attempts: 1 });
    expect(log.sentAt).toEqual(nowOn(alex.timezone, '2026-03-10').toJSDate());
    expect((await Invoice.findById(invoice._id)).lastReminderAt).toEqual(log.sentAt);
  });

  it('on_due: sent on the due date', async () => {
    const invoice = await makeInvoice(alex, '2026-03-13');
    await run(nowOn(alex.timezone, '2026-03-13'));

    expect(emails().map((e) => e.subject)).toEqual([`${invoice.number} is due today`]);
    expect(await logsOf(invoice)).toMatchObject([{ kind: 'on_due', offsetDays: 0, status: 'sent' }]);
  });

  it('overdue: sent 7 days and 14 days after the due date, and not on the days in between', async () => {
    const invoice = await makeInvoice(alex, '2026-03-13');

    for (const day of ['2026-03-14', '2026-03-17', '2026-03-19']) {
      // on_due was the 13th: on the 14th it is sent a day late (see the catch-up tests); the 17th and 19th have nothing
      await run(nowOn(alex.timezone, day));
    }
    const early = emails().map((e) => e.subject);
    expect(early).toEqual([`${invoice.number} is 1 day overdue`]); // on_due, a day late (see the catch-up tests)

    clearSentEmails();
    await run(nowOn(alex.timezone, '2026-03-20'));
    expect(emails().map((e) => e.subject)).toEqual([`${invoice.number} is 7 days overdue`]);

    clearSentEmails();
    await run(nowOn(alex.timezone, '2026-03-27'));
    expect(emails().map((e) => e.subject)).toEqual([`${invoice.number} is 14 days overdue`]);

    expect((await logsOf(invoice)).map((l) => [l.kind, l.offsetDays])).toEqual([
      ['on_due', 0],
      ['overdue', 7],
      ['overdue', 14],
    ]);

    clearSentEmails();
    await run(nowOn(alex.timezone, '2026-04-20')); // long after: nothing is left
    expect(emails()).toHaveLength(0);
  });

  it("follows the owner's own settings: 5 days before, no due-date reminder, 2 and 30 days after", async () => {
    await setReminders(alex, { beforeDueDays: 5, onDueDate: false, afterDueDays: [30, 2] });
    const invoice = await makeInvoice(alex, '2026-03-13');

    for (const day of ['2026-03-08', '2026-03-13', '2026-03-15', '2026-04-12']) await run(nowOn(alex.timezone, day));
    expect((await logsOf(invoice)).map((l) => [l.kind, l.offsetDays])).toEqual([
      ['before_due', 5],
      ['overdue', 2],
      ['overdue', 30],
    ]);
    expect(emails().map((e) => e.subject)).toEqual([`Reminder: ${invoice.number} is due in 5 days`, `${invoice.number} is 2 days overdue`, `${invoice.number} is 30 days overdue`]);
  });

  it('a day is counted in the OWNER\'s time zone: Kolkata and New York near midnight UTC', async () => {
    // Both invoices are due at 2026-03-11 08:00 UTC: that is 13:30 on 11 March in Kolkata and 04:00 on 11 March in New York.
    const dueInstant = new Date('2026-03-11T08:00:00Z');
    const nick = await createUser('Nick', { timezone: 'America/New_York', clientEmail: 'ap@ny-client.com' });
    for (const user of [alex, nick]) await setReminders(user, { beforeDueDays: 1 });
    const inKolkata = await makeInvoice(alex, dueInstant);
    const inNewYork = await makeInvoice(nick, dueInstant);

    // 20:00 UTC on 10 March: already 11 March (01:30) in Kolkata, still 10 March (16:00) in New York
    const now = DateTime.fromISO('2026-03-10T20:00:00Z', { zone: 'utc' });
    expect(await run(now)).toMatchObject({ checked: 2, sent: 2 });

    // Kolkata: it is the due date, so "due today" (the day-before reminder is older and is not sent as well)
    expect(await logsOf(inKolkata)).toMatchObject([{ kind: 'on_due' }]);
    // New York: it is the day before, so "due in 1 day"
    expect(await logsOf(inNewYork)).toMatchObject([{ kind: 'before_due', offsetDays: 1 }]);
    expect(emails().find((e) => e.to[0] === 'ap@ny-client.com').subject).toBe(`Reminder: ${inNewYork.number} is due in 1 day`);
    expect(emails().find((e) => e.to[0] === 'billing@acme.com').subject).toBe(`${inKolkata.number} is due today`);
  });

  it('the same instant is a different day for each owner: 03:30 UTC is already 10 March in Kolkata but still 9 March in New York', async () => {
    const dueInstant = new Date('2026-03-13T08:00:00Z'); // 13 March in both zones
    const nick = await createUser('Nick', { timezone: 'America/New_York', clientEmail: 'ap@ny-client.com' });
    await makeInvoice(alex, dueInstant);
    await makeInvoice(nick, dueInstant);

    const now = DateTime.fromISO('2026-03-10T03:30:00Z', { zone: 'utc' }); // before_due is 10 March
    expect(await run(now)).toMatchObject({ checked: 2, sent: 1 });
    expect(emails().map((e) => e.to[0])).toEqual(['billing@acme.com']); // Kolkata only

    // New York turns 10 March at 04:00 UTC (daylight saving time since 8 March), so at 05:00 UTC its reminder is due too
    clearSentEmails();
    expect(await run(DateTime.fromISO('2026-03-10T05:00:00Z', { zone: 'utc' }))).toMatchObject({ sent: 1 });
    expect(emails().map((e) => e.to[0])).toEqual(['ap@ny-client.com']);
  });
});

// ---------- never twice ----------

describe('a reminder is never sent twice', () => {
  it('running the job twice (and again) sends it once', async () => {
    const invoice = await makeInvoice(alex, '2026-03-13');
    const now = nowOn(alex.timezone, '2026-03-10');

    expect(await run(now)).toMatchObject({ sent: 1 });
    expect(await run(now)).toMatchObject({ sent: 0, failed: 0 });
    expect(await run(nowOn(alex.timezone, '2026-03-10', '23:00'))).toMatchObject({ sent: 0 }); // later the same day
    expect(await run(nowOn(alex.timezone, '2026-03-11'))).toMatchObject({ sent: 0 }); // the catch-up window must not repeat it

    expect(emails()).toHaveLength(1);
    expect(await logsOf(invoice)).toHaveLength(1);
  });

  it('two runs at the same moment (Promise.all) send it once, and so do five', async () => {
    const invoice = await makeInvoice(alex, '2026-03-13');
    const now = nowOn(alex.timezone, '2026-03-10');

    const two = await Promise.all([run(now), run(now)]);
    expect(two.reduce((total, r) => total + r.sent, 0)).toBe(1);
    expect(two.reduce((total, r) => total + r.skipped, 0)).toBe(1); // the one that lost the race

    const later = nowOn(alex.timezone, '2026-03-13'); // the next reminder, now with five at once
    const five = await Promise.all(Array.from({ length: 5 }, () => run(later)));
    expect(five.reduce((total, r) => total + r.sent, 0)).toBe(1);

    expect(emails()).toHaveLength(2);
    expect(await logsOf(invoice)).toHaveLength(2);
  });

  it('the database itself refuses a second row for the same reminder; manual reminders are not limited', async () => {
    const invoice = await makeInvoice(alex, '2026-03-13');
    const row = { invoiceId: invoice._id, userId: alex.id, kind: 'overdue', offsetDays: 7, to: 'billing@acme.com' };

    await ReminderLog.create(row);
    await expect(ReminderLog.create(row)).rejects.toMatchObject({ code: 11000 });
    await ReminderLog.create({ ...row, offsetDays: 14 }); // another offset is another reminder
    await ReminderLog.create({ ...row, kind: 'on_due', offsetDays: 0 });

    const manual = { invoiceId: invoice._id, userId: alex.id, kind: 'manual', to: 'billing@acme.com' };
    await ReminderLog.create(manual);
    await ReminderLog.create(manual);
    expect(await ReminderLog.countDocuments({ invoiceId: invoice._id, kind: 'manual' })).toBe(2);
  });
});

// ---------- nothing is sent when it should not be ----------

describe('nothing is sent for ...', () => {
  const NOW = () => nowOn(alex.timezone, '2026-03-10'); // before_due of an invoice due on 13 March

  it('a paid invoice, a draft, a paused invoice', async () => {
    await makeInvoice(alex, '2026-03-13', { status: 'paid', paidAt: new Date() });
    await makeInvoice(alex, '2026-03-13', { status: 'draft', sentAt: null });
    await makeInvoice(alex, '2026-03-13', { remindersPaused: true });

    expect(await run(NOW())).toEqual({ checked: 0, sent: 0, skipped: 0, failed: 0 }); // paid, draft and paused are not even looked at
    expect(emails()).toHaveLength(0);
    expect(await ReminderLog.countDocuments()).toBe(0);
  });

  it('a client with no e-mail address', async () => {
    const noEmail = await createUser('Nina', { clientEmail: '' });
    await makeInvoice(noEmail, '2026-03-13');

    expect(await run(NOW())).toEqual({ checked: 1, sent: 0, skipped: 1, failed: 0 });
    expect(emails()).toHaveLength(0);
  });

  it("an owner who switched reminders off, or has no reminder turned on at all", async () => {
    const off = await createUser('Olga', { clientEmail: 'ap@olga-client.com', reminders: { enabled: false } });
    const nothing = await createUser('Nora', { clientEmail: 'ap@nora-client.com', reminders: { enabled: true, beforeDueDays: 0, onDueDate: false, afterDueDays: [] } });
    await makeInvoice(off, '2026-03-13');
    await makeInvoice(nothing, '2026-03-13');

    expect(await run(NOW())).toMatchObject({ checked: 2, sent: 0, skipped: 1 }); // only Olga's invoice is "skipped"; Nora has no day at all
    expect(emails()).toHaveLength(0);
  });

  it('an invoice that was sent on the very day a reminder would go out (the client just got it)', async () => {
    const sameDay = await makeInvoice(alex, '2026-03-13', { sentAt: at(alex.timezone, '2026-03-10', '08:00') }); // sent on the 10th, before_due is the 10th
    expect(await run(NOW())).toMatchObject({ sent: 0 });
    await Invoice.updateOne({ _id: sameDay._id }, { status: 'paid', paidAt: new Date() }); // out of the way for the next part

    // sent again later that day: still nothing; the next reminder (the due date) is fine
    const resent = await makeInvoice(alex, '2026-03-14', { sentAt: at(alex.timezone, '2026-03-01'), lastSentAt: at(alex.timezone, '2026-03-11', '10:00') });
    expect(await run(nowOn(alex.timezone, '2026-03-11'))).toMatchObject({ sent: 0 }); // before_due of the 14th is the 11th = the day it was re-sent
    expect(await run(nowOn(alex.timezone, '2026-03-14'))).toMatchObject({ sent: 1 });
    expect(emails().map((e) => e.subject)).toEqual([`${resent.number} is due today`]);
  });

  it('an invoice whose reminder day is far away', async () => {
    await makeInvoice(alex, '2026-04-30');
    expect(await run(NOW())).toMatchObject({ checked: 0, sent: 0 });
  });

  it('an owner whose reminder was just sent by hand (not 2 in one day)', async () => {
    const invoice = await makeInvoice(alex, '2026-03-13');
    await ReminderLog.create({ invoiceId: invoice._id, userId: alex.id, kind: 'manual', to: 'billing@acme.com', status: 'sent', sentAt: new Date() });

    expect(await run(nowOn(alex.timezone, '2026-03-10'))).toMatchObject({ sent: 0, skipped: 1 });
    expect(emails()).toHaveLength(0);
  });

  it('an invoice that is paid or paused after the job looked at it (nothing is sent, nothing is left claimed)', async () => {
    const invoice = await makeInvoice(alex, '2026-03-13');
    const { due } = await findDue(nowOn(alex.timezone, '2026-03-10'));
    expect(due).toHaveLength(1);

    await Invoice.updateOne({ _id: invoice._id }, { status: 'paid', paidAt: new Date() });
    expect(await run(nowOn(alex.timezone, '2026-03-10'))).toMatchObject({ sent: 0 });
    expect(emails()).toHaveLength(0);
    expect(await ReminderLog.countDocuments()).toBe(0);
  });
});

// ---------- catching up ----------

describe('catch-up when the job did not run on the day (the server was asleep)', () => {
  it('a missed reminder is still sent up to 2 days late, with the words for today ("1 day overdue")', async () => {
    const invoice = await makeInvoice(alex, '2026-03-13');

    expect(await run(nowOn(alex.timezone, '2026-03-14'))).toMatchObject({ sent: 1 }); // on_due was yesterday
    expect(emails().map((e) => e.subject)).toEqual([`${invoice.number} is 1 day overdue`]);
    expect(await logsOf(invoice)).toMatchObject([{ kind: 'on_due', offsetDays: 0 }]);

    const second = await makeInvoice(alex, '2026-03-13');
    clearSentEmails();
    expect(await run(nowOn(alex.timezone, '2026-03-15'))).toMatchObject({ sent: 1 }); // 2 days late, still fine (the first invoice had its on_due already)
    expect(emails().map((e) => e.subject)).toEqual([`${second.number} is 2 days overdue`]);
  });

  it('nothing older than 2 days is sent', async () => {
    await makeInvoice(alex, '2026-03-13');
    expect(await run(nowOn(alex.timezone, '2026-03-16'))).toMatchObject({ sent: 0 }); // on_due is 3 days old, overdue 7 is not due yet
    expect(await run(nowOn(alex.timezone, '2026-03-18'))).toMatchObject({ sent: 0 });
    expect(emails()).toHaveLength(0);
  });

  it('only the LATEST missed reminder is sent, never a burst of old ones', async () => {
    await setReminders(alex, { beforeDueDays: 3, onDueDate: true, afterDueDays: [1] });
    const invoice = await makeInvoice(alex, '2026-03-13'); // before_due 10th, on_due 13th, overdue 1 on the 14th

    // the server slept through the 13th: on the 14th both on_due (1 day old) and overdue+1 (today) are due
    expect(await run(nowOn(alex.timezone, '2026-03-14'))).toMatchObject({ sent: 1 });
    expect(emails().map((e) => e.subject)).toEqual([`${invoice.number} is 1 day overdue`]);
    expect(await logsOf(invoice)).toMatchObject([{ kind: 'overdue', offsetDays: 1 }]);

    // the day after, the older on_due (2 days old) must NOT be sent now that a later one went out
    expect(await run(nowOn(alex.timezone, '2026-03-15'))).toMatchObject({ sent: 0 });
    expect(emails()).toHaveLength(1);
    expect(await logsOf(invoice)).toHaveLength(1);
  });

  it('does not send a reminder for a day before the invoice was sent, however late the job is', async () => {
    const invoice = await makeInvoice(alex, '2026-03-13', { sentAt: at(alex.timezone, '2026-03-11') }); // sent on the 11th: before_due (10th) is already past
    expect(await run(nowOn(alex.timezone, '2026-03-11'))).toMatchObject({ sent: 0 });
    expect(await run(nowOn(alex.timezone, '2026-03-12'))).toMatchObject({ sent: 0 });
    expect(await run(nowOn(alex.timezone, '2026-03-13'))).toMatchObject({ sent: 1 });
    expect(emails().map((e) => e.subject)).toEqual([`${invoice.number} is due today`]);
  });
});

// ---------- failures ----------

describe('when the e-mail provider fails', () => {
  const broken = (message = 'Brevo answered 401: key not found') => ({ name: 'broken', send: async () => { throw new EmailError(message); } });

  it('the log says "failed", the invoice is unchanged, and nothing was sent', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const invoice = await makeInvoice(alex, '2026-03-13');
    const before = (await Invoice.findById(invoice._id)).toObject();
    setEmailProvider(broken());

    expect(await run(nowOn(alex.timezone, '2026-03-10'))).toEqual({ checked: 1, sent: 0, skipped: 0, failed: 1 });

    const [log] = await logsOf(invoice);
    expect(log).toMatchObject({ kind: 'before_due', offsetDays: 3, status: 'failed', attempts: 1, error: 'Brevo answered 401: key not found' });
    expect(log.sentAt).toBeUndefined();

    const after = (await Invoice.findById(invoice._id)).toObject();
    expect(after.status).toBe('sent');
    expect(after.lastReminderAt).toBeNull();
    expect({ ...after, publicToken: undefined, updatedAt: undefined }).toEqual({ ...before, publicToken: undefined, updatedAt: undefined });
    expect(emails()).toHaveLength(0);
  });

  it('a failed reminder is tried again by the next run, and then sent exactly once', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const invoice = await makeInvoice(alex, '2026-03-13');
    setEmailProvider(broken());
    await run(nowOn(alex.timezone, '2026-03-10'));

    setEmailProvider(null); // the provider works again
    expect(await run(nowOn(alex.timezone, '2026-03-10', '10:00'))).toMatchObject({ sent: 1, failed: 0 });
    expect(await run(nowOn(alex.timezone, '2026-03-10', '11:00'))).toMatchObject({ sent: 0 });

    expect(emails()).toHaveLength(1);
    expect(await logsOf(invoice)).toMatchObject([{ status: 'sent', attempts: 2, error: '' }]);
  });

  it(`gives up after ${MAX_ATTEMPTS} attempts (the row stays "failed")`, async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const invoice = await makeInvoice(alex, '2026-03-13');
    setEmailProvider(broken());

    for (let hour = 9; hour < 14; hour++) await run(nowOn(alex.timezone, '2026-03-10', `${String(hour).padStart(2, '0')}:00`));
    expect(await logsOf(invoice)).toMatchObject([{ status: 'failed', attempts: MAX_ATTEMPTS }]);
    expect(emails()).toHaveLength(0);
  });

  it('one failure does not stop the others in the same run', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const first = await makeInvoice(alex, '2026-03-13');
    await makeInvoice(bruno, '2026-03-13');
    let calls = 0;
    setEmailProvider({ name: 'flaky', send: async (email) => { if (calls++ === 0) throw new EmailError('down'); getSentEmails().push({ ...email, to: [email.to] }); } });

    expect(await run(nowOn('Asia/Kolkata', '2026-03-10'))).toMatchObject({ checked: 2, sent: 1, failed: 1 });
    expect(await ReminderLog.countDocuments({ status: 'failed' })).toBe(1);
    expect(await ReminderLog.countDocuments({ status: 'sent' })).toBe(1);
    expect(first).toBeTruthy();
  });
});

// ---------- the cron endpoint ----------

describe('POST /api/cron/reminders', () => {
  const call = (secret) => {
    const req = request(app).post('/api/cron/reminders');
    return secret === undefined ? req : req.set('X-Cron-Secret', secret);
  };

  it('answers 401 without the secret and with a wrong one (also a different length), and runs nothing', async () => {
    process.env.CRON_SECRET = SECRET;
    await makeInvoice(alex, DateTime.now().setZone('Asia/Kolkata').plus({ days: 3 }).toJSDate());

    for (const bad of [undefined, '', 'wrong', SECRET.slice(0, -1), `${SECRET}x`, SECRET.toUpperCase(), 'a'.repeat(5000)]) {
      const res = await call(bad);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Invalid cron secret' });
    }
    expect(emails()).toHaveLength(0);
    expect(await ReminderLog.countDocuments()).toBe(0);
  });

  it('with the right secret it runs the job and returns { checked, sent, skipped, failed }', async () => {
    process.env.CRON_SECRET = SECRET;
    const invoice = await makeInvoice(alex, DateTime.now().setZone('Asia/Kolkata').plus({ days: 3 }).toJSDate()); // before_due is today
    await makeInvoice(alex, DateTime.now().setZone('Asia/Kolkata').plus({ days: 30 }).toJSDate()); // nothing yet

    const res = await call(SECRET);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ checked: 1, sent: 1, skipped: 0, failed: 0 });
    expect(new Date(res.body.ranAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(emails().map((e) => e.subject)).toEqual([`Reminder: ${invoice.number} is due in 3 days`]);

    // calling it again (an hourly scheduler does) changes nothing
    expect((await call(SECRET)).body).toMatchObject({ sent: 0 });
    expect(emails()).toHaveLength(1);
  });

  it('is not open when the secret is missing on the server, too short, or still the placeholder (503, even with a matching header)', async () => {
    for (const secret of [undefined, '', 'short', 'replace-with-a-long-random-string-for-the-scheduler']) {
      if (secret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = secret;

      for (const header of [undefined, '', secret ?? '']) {
        const res = await call(header);
        expect(res.status).toBe(503);
      }
    }
    expect(emails()).toHaveLength(0);
  });

  it('needs POST, and needs no login', async () => {
    process.env.CRON_SECRET = SECRET;
    expect((await request(app).get('/api/cron/reminders').set('X-Cron-Secret', SECRET)).status).toBe(404);
    expect((await call(SECRET)).status).toBe(200); // no Authorization header was sent
  });
});

// ---------- "Send reminder now" ----------

describe('POST /api/invoices/:id/reminders/send-now', () => {
  const sendNow = (user, invoice) => api('post', `/api/invoices/${invoice._id}/reminders/send-now`, user.token);
  const dueIn = (days) => DateTime.now().setZone('Asia/Kolkata').plus({ days }).toJSDate();

  it('sends a reminder at once, once: the second time within 24 hours is 429', async () => {
    const invoice = await makeInvoice(alex, dueIn(5));

    const first = await sendNow(alex, invoice);
    expect(first.status).toBe(200);
    expect(first.body.sentTo).toBe('billing@acme.com');
    expect(first.body.reminder).toMatchObject({ kind: 'manual', status: 'sent', to: 'billing@acme.com', offsetDays: null });
    expect(emails().map((e) => e.subject)).toEqual([`Reminder: ${invoice.number} is due in 5 days`]);
    expect(await logsOf(invoice)).toMatchObject([{ kind: 'manual', status: 'sent' }]);
    expect((await Invoice.findById(invoice._id)).lastReminderAt).toBeInstanceOf(Date);

    const second = await sendNow(alex, invoice);
    expect(second.status).toBe(429);
    expect(second.body.message).toBe('You already sent a reminder in the last 24 hours');
    expect(emails()).toHaveLength(1);
    expect(await ReminderLog.countDocuments()).toBe(1);
  });

  it('can be sent again once 24 hours have passed (and not before)', async () => {
    const invoice = await makeInvoice(alex, dueIn(5));
    await sendNow(alex, invoice);

    await Invoice.updateOne({ _id: invoice._id }, { lastReminderAt: new Date(Date.now() - 23 * 60 * 60 * 1000) });
    expect((await sendNow(alex, invoice)).status).toBe(429);

    await Invoice.updateOne({ _id: invoice._id }, { lastReminderAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    expect((await sendNow(alex, invoice)).status).toBe(200);
    expect(emails()).toHaveLength(2);
    expect(await ReminderLog.countDocuments({ kind: 'manual' })).toBe(2);
  });

  it('two clicks at the same moment send one e-mail', async () => {
    const invoice = await makeInvoice(alex, dueIn(5));

    const results = await Promise.all([sendNow(alex, invoice), sendNow(alex, invoice), sendNow(alex, invoice)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 429, 429]);
    expect(emails()).toHaveLength(1);
  });

  it('an automatic reminder counts too: no manual one within 24 hours of it', async () => {
    const invoice = await makeInvoice(alex, dueIn(3));
    await run(); // before_due is today
    expect(emails()).toHaveLength(1);

    expect((await sendNow(alex, invoice)).status).toBe(429);
    expect(emails()).toHaveLength(1);
  });

  it('words follow the day: due today, overdue', async () => {
    const today = await makeInvoice(alex, dueIn(0));
    const late = await makeInvoice(alex, dueIn(-9));
    await sendNow(alex, today);
    await Invoice.updateOne({ _id: today._id }, { lastReminderAt: null });
    await sendNow(alex, late);

    expect(emails().map((e) => e.subject)).toEqual([`${today.number} is due today`, `${late.number} is 9 days overdue`]);
  });

  it('when the provider fails: 502, and the 24 hours are given back so it can be tried again', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const invoice = await makeInvoice(alex, dueIn(5));
    setEmailProvider({ name: 'broken', send: async () => { throw new EmailError('Brevo answered 401'); } });

    const failed = await sendNow(alex, invoice);
    expect(failed.status).toBe(502);
    expect(failed.body.message).toBe("Couldn't send the email. Try again.");
    expect((await Invoice.findById(invoice._id)).lastReminderAt).toBeNull();
    expect(await logsOf(invoice)).toMatchObject([{ kind: 'manual', status: 'failed' }]);

    setEmailProvider(null);
    expect((await sendNow(alex, invoice)).status).toBe(200);
    expect(emails()).toHaveLength(1);
  });

  it('a paid invoice and a draft are refused (409), and a client without an e-mail is 400', async () => {
    const paid = await makeInvoice(alex, dueIn(5), { status: 'paid', paidAt: new Date() });
    const draft = await makeInvoice(alex, dueIn(5), { status: 'draft', sentAt: null });
    expect((await sendNow(alex, paid)).body.message).toBe('This invoice is already paid');
    expect((await sendNow(alex, draft)).status).toBe(409);

    const nina = await createUser('Nina', { clientEmail: '' });
    const noEmail = await makeInvoice(nina, dueIn(5));
    const res = await sendNow(nina, noEmail);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Add the client's email first");
    expect(emails()).toHaveLength(0);
  });

  it("is private: user B can't send, read or pause user A's reminders (404), and a login is needed", async () => {
    const invoice = await makeInvoice(alex, dueIn(5));

    expect((await sendNow(bruno, invoice)).status).toBe(404);
    expect((await api('get', `/api/invoices/${invoice._id}/reminders`, bruno.token)).status).toBe(404);
    expect((await api('patch', `/api/invoices/${invoice._id}/reminders`, bruno.token, { paused: true })).status).toBe(404);
    expect(emails()).toHaveLength(0);
    expect((await Invoice.findById(invoice._id)).remindersPaused).toBe(false);

    expect((await api('post', `/api/invoices/${invoice._id}/reminders/send-now`)).status).toBe(401);
    expect((await api('get', `/api/invoices/${invoice._id}/reminders`)).status).toBe(401);
    expect((await sendNow(alex, { _id: new mongoose.Types.ObjectId() })).status).toBe(404);
    expect((await api('post', '/api/invoices/not-an-id/reminders/send-now', alex.token)).status).toBe(400);
  });
});

// ---------- pausing and the history ----------

describe('pausing, and what the invoice page shows', () => {
  const dueIn = (days) => DateTime.now().setZone('Asia/Kolkata').plus({ days }).toJSDate();
  const reminders = async (user, invoice) => (await api('get', `/api/invoices/${invoice._id}/reminders`, user.token)).body;

  it('PATCH { paused } pauses and resumes the automatic reminders of one invoice', async () => {
    const invoice = await makeInvoice(alex, '2026-03-13');
    const other = await makeInvoice(alex, '2026-03-13');

    const paused = await api('patch', `/api/invoices/${invoice._id}/reminders`, alex.token, { paused: true });
    expect(paused.status).toBe(200);
    expect(paused.body.invoice).toMatchObject({ remindersPaused: true, status: 'sent', displayStatus: 'overdue' });
    expect(paused.body.invoice.lineItems).toBeUndefined();

    expect(await run(nowOn(alex.timezone, '2026-03-10'))).toMatchObject({ checked: 1, sent: 1 }); // only the other invoice
    expect((await logsOf(invoice)).length).toBe(0);
    expect((await logsOf(other)).length).toBe(1);

    await api('patch', `/api/invoices/${invoice._id}/reminders`, alex.token, { paused: false });
    expect(await run(nowOn(alex.timezone, '2026-03-10'))).toMatchObject({ sent: 1 });
  });

  it('refuses anything but true or false', async () => {
    const invoice = await makeInvoice(alex, '2026-03-13');
    for (const body of [{}, { paused: 'yes' }, { paused: 1 }, { paused: null }]) {
      const res = await api('patch', `/api/invoices/${invoice._id}/reminders`, alex.token, body);
      expect(res.status).toBe(400);
      expect(res.body.errors[0].path).toBe('paused');
    }
  });

  it('GET /reminders has the history (newest first, failures included) and the next reminder', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const invoice = await makeInvoice(alex, dueIn(10));

    let page = await reminders(alex, invoice);
    expect(page).toMatchObject({ paused: false, enabled: true, status: 'sent', reason: null, history: [], lastReminderAt: null });
    expect(page.next).toMatchObject({ kind: 'before_due', offsetDays: 3, daysFromNow: 7, daysUntilDue: 3 });
    expect(page.next.date).toBe(DateTime.now().setZone('Asia/Kolkata').plus({ days: 7 }).toISODate());

    setEmailProvider({ name: 'broken', send: async () => { throw new EmailError('Brevo answered 401'); } });
    await api('post', `/api/invoices/${invoice._id}/reminders/send-now`, alex.token); // fails: logged as failed
    setEmailProvider(null);
    await api('post', `/api/invoices/${invoice._id}/reminders/send-now`, alex.token); // works

    page = await reminders(alex, invoice);
    expect(page.history.map((h) => [h.kind, h.status])).toEqual([['manual', 'sent'], ['manual', 'failed']]);
    expect(page.history[0]).toMatchObject({ to: 'billing@acme.com', offsetDays: null, error: '' });
    expect(page.history[1].error).toContain('Brevo answered 401');
    expect(page.lastReminderAt).not.toBeNull();
  });

  it('"next" skips what was already sent, and says why there is none', async () => {
    const invoice = await makeInvoice(alex, dueIn(3)); // before_due is today
    await run();
    let page = await reminders(alex, invoice);
    expect(page.next).toMatchObject({ kind: 'on_due', offsetDays: 0, daysFromNow: 3, daysUntilDue: 0 });

    // paid, draft, paused, off, no e-mail, nothing left
    await Invoice.updateOne({ _id: invoice._id }, { status: 'paid', paidAt: new Date() });
    expect(await reminders(alex, invoice)).toMatchObject({ next: null, reason: 'paid' });

    const draft = await makeInvoice(alex, dueIn(5), { status: 'draft', sentAt: null });
    expect(await reminders(alex, draft)).toMatchObject({ next: null, reason: 'draft' });

    const paused = await makeInvoice(alex, dueIn(5), { remindersPaused: true });
    expect(await reminders(alex, paused)).toMatchObject({ next: null, reason: 'paused', paused: true });

    const long = await makeInvoice(alex, dueIn(-100));
    expect(await reminders(alex, long)).toMatchObject({ next: null, reason: 'none_left' });

    await setReminders(alex, { enabled: false });
    const open = await makeInvoice(alex, dueIn(5));
    expect(await reminders(alex, open)).toMatchObject({ next: null, reason: 'disabled', enabled: false });

    const nina = await createUser('Nina', { clientEmail: '' });
    const noEmail = await makeInvoice(nina, dueIn(5));
    expect(await reminders(nina, noEmail)).toMatchObject({ next: null, reason: 'no_email' });
  });
});

// ---------- the reminder settings (PATCH /api/auth/me) ----------

describe('reminder settings', () => {
  const patch = (reminders) => api('patch', '/api/auth/me', alex.token, { reminders });
  const saved = async () => (await User.findById(alex.id).lean()).reminders;

  it('a user starts with: on, 3 days before, on the due date, 7 and 14 days after', async () => {
    const me = await api('get', '/api/auth/me', alex.token);
    expect(me.body.user.reminders).toEqual({ enabled: true, beforeDueDays: 3, onDueDate: true, afterDueDays: [7, 14] });
  });

  it('saves any of them, changes only what is sent, and sorts the days after the due date', async () => {
    const res = await patch({ beforeDueDays: 5, afterDueDays: [30, 7] });
    expect(res.status).toBe(200);
    expect(res.body.user.reminders).toEqual({ enabled: true, beforeDueDays: 5, onDueDate: true, afterDueDays: [7, 30] });

    await patch({ enabled: false });
    await patch({ onDueDate: false, beforeDueDays: 0, afterDueDays: [] });
    expect(await saved()).toEqual({ enabled: false, beforeDueDays: 0, onDueDate: false, afterDueDays: [] });
  });

  it('beforeDueDays is a whole number from 0 (off) to 14', async () => {
    for (const beforeDueDays of [-1, 15, 2.5, '3', null, 100]) {
      const res = await patch({ beforeDueDays });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].path).toBe('reminders.beforeDueDays');
    }
    for (const beforeDueDays of [0, 1, 14]) expect((await patch({ beforeDueDays })).status).toBe(200);
  });

  it('afterDueDays: 1 to 60 each, at most 3, no repeats', async () => {
    const refuse = async (afterDueDays, message) => {
      const res = await patch({ afterDueDays });
      expect(res.status).toBe(400);
      expect(res.body.errors.some((e) => e.path.startsWith('reminders.afterDueDays') && (!message || e.message === message))).toBe(true);
    };
    await refuse([0], 'Days after the due date must be between 1 and 60');
    await refuse([61], 'Days after the due date must be between 1 and 60');
    await refuse([1.5]);
    await refuse(['7']);
    await refuse([1, 2, 3, 4], 'At most 3 reminders after the due date');
    await refuse([7, 7], 'Each day can only be used once');
    await refuse('7,14');

    expect((await patch({ afterDueDays: [1, 30, 60] })).status).toBe(200);
    expect((await patch({ afterDueDays: [] })).status).toBe(200);
  });

  it('enabled and onDueDate must be true or false; an empty group is refused; nothing is saved when one field is wrong', async () => {
    expect((await patch({ enabled: 'yes' })).status).toBe(400);
    expect((await patch({ onDueDate: 1 })).status).toBe(400);
    const empty = await patch({});
    expect(empty.status).toBe(400);
    expect(empty.body.errors).toEqual([{ path: 'reminders', message: 'Send at least one reminder setting' }]);

    const mixed = await patch({ enabled: false, beforeDueDays: 99 });
    expect(mixed.status).toBe(400);
    expect(await saved()).toEqual({ enabled: true, beforeDueDays: 3, onDueDate: true, afterDueDays: [7, 14] });
  });

  it('users saved before reminders existed get the defaults (nothing is missing in the job)', async () => {
    await User.collection.updateOne({ _id: alex.id }, { $unset: { reminders: '' } });
    const invoice = await makeInvoice(alex, '2026-03-13');

    expect(await run(nowOn(alex.timezone, '2026-03-10'))).toMatchObject({ sent: 1 });
    expect(await logsOf(invoice)).toMatchObject([{ kind: 'before_due', offsetDays: 3 }]);
    expect((await api('get', '/api/auth/me', alex.token)).body.user.reminders).toEqual({ enabled: true, beforeDueDays: 3, onDueDate: true, afterDueDays: [7, 14] });
  });
});

// ---------- the reminder e-mail ----------

describe('the reminder e-mail', () => {
  const sample = (overrides = {}) => ({
    number: 'INV-0003',
    total: 602.25,
    currency: 'USD',
    dueDate: new Date('2026-11-18T10:00:00Z'),
    timezone: 'Asia/Kolkata',
    client: { name: 'Acme Corp' },
    ...overrides,
  });
  const render = (daysUntilDue, extra = {}) => renderReminderEmail({ invoice: sample(), fromName: 'Alex Morgan', shareUrl: `${APP}/i/tok`, daysUntilDue, ...extra });

  it('has a different subject for each situation (singular and plural)', () => {
    expect(reminderWording('INV-0003', 3).subject).toBe('Reminder: INV-0003 is due in 3 days');
    expect(reminderWording('INV-0003', 1).subject).toBe('Reminder: INV-0003 is due in 1 day');
    expect(reminderWording('INV-0003', 0).subject).toBe('INV-0003 is due today');
    expect(reminderWording('INV-0003', -1).subject).toBe('INV-0003 is 1 day overdue');
    expect(reminderWording('INV-0003', -7).subject).toBe('INV-0003 is 7 days overdue');
  });

  it('is friendly, has the amount, the due date, the freelancer and a View invoice button, in HTML and in text', () => {
    const { subject, html, text } = render(3);
    expect(subject).toBe('Reminder: INV-0003 is due in 3 days');
    for (const part of [html, text]) {
      expect(part).toContain('Hi Acme Corp,');
      expect(part).toContain('friendly reminder');
      expect(part).toContain('Alex Morgan');
      expect(part).toContain('$602.25');
      expect(part).toContain('18 Nov 2026');
      expect(part).toContain(`${APP}/i/tok`);
    }
    expect(html).toContain('>View invoice<');
    expect(html).toContain(`href="${APP}/i/tok"`);
    expect(text).toContain('View the invoice:');
  });

  it('an overdue one says how long, and that a payment already made can be ignored', () => {
    const { html, text } = render(-7);
    expect(text).toContain('7 days overdue');
    expect(text).toContain('If you have already paid, thank you');
    expect(html).toContain('7 days overdue');
  });

  it('shows "Pay now" only when the owner has a payment link, and the UPI ID and bank details below it', () => {
    const none = render(3, { payment: { link: '', upiId: '', bankDetails: '' } });
    expect(none.html).not.toContain('Pay now');
    expect(none.text).not.toContain('Pay now');

    const onlyUpi = render(3, { payment: { link: '', upiId: 'alex@okhdfcbank', bankDetails: '' } });
    expect(onlyUpi.html).not.toContain('Pay now');
    expect(onlyUpi.html).toContain('UPI ID: <strong>alex@okhdfcbank</strong>');

    const full = render(3, { payment: { link: LINK, upiId: 'alex@okhdfcbank', bankDetails: 'HDFC Bank\nA/C 123' } });
    expect(full.html).toContain(`href="${LINK}"`);
    expect(full.html).toContain('>Pay now<');
    expect(full.html.indexOf('UPI ID:')).toBeGreaterThan(full.html.indexOf('>Pay now<'));
    expect(full.text).toContain(`Pay now:\n${LINK}`);
    expect(full.text).toContain('Bank details:\nHDFC Bank\nA/C 123');
  });

  it("escapes what people typed (the client's name, the freelancer's name, the bank details)", () => {
    const { html, text } = renderReminderEmail({
      invoice: sample({ client: { name: '<b>Acme</b> & Co' } }),
      fromName: 'Alex <img src=x>',
      shareUrl: `${APP}/i/tok`,
      daysUntilDue: 3,
      payment: { link: '', upiId: '', bankDetails: '<script>alert(1)</script>' },
    });
    expect(html).not.toContain('<b>Acme</b>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;Acme&lt;/b&gt; &amp; Co');
    expect(text).toContain('<b>Acme</b> & Co');
  });

  it('when the job sends it, "Pay now" follows the owner\'s current payment link', async () => {
    const owner = await createUser('Pia', { clientEmail: 'ap@pia-client.com', payment: { link: LINK, upiId: 'pia@okaxis', bankDetails: '' } });
    const invoice = await makeInvoice(owner, '2026-03-13');
    await run(nowOn(owner.timezone, '2026-03-10'));

    expect(emails()[0].html).toContain(`href="${LINK}"`);
    expect(emails()[0].html).toContain('>Pay now<');

    clearSentEmails();
    await User.updateOne({ _id: owner.id }, { 'payment.link': '' });
    await run(nowOn(owner.timezone, '2026-03-13'));
    expect(emails()[0].subject).toBe(`${invoice.number} is due today`);
    expect(emails()[0].html).not.toContain('Pay now');
    expect(emails()[0].html).toContain('UPI ID: <strong>pia@okaxis</strong>');
  });
});
