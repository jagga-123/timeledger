import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Project from '../models/Project.js';
import TimeEntry from '../models/TimeEntry.js';
import Invoice from '../models/Invoice.js';
import Counter from '../models/Counter.js';
import * as invoiceService from '../services/invoice.service.js';
import { DEMO_USER, assertSeedAllowed, seedDemo } from '../services/seed.service.js';

const ZONE = 'Asia/Kolkata';
// A Wednesday afternoon in the past: the same "today" every time the tests run, so the data is the same too
const NOW = DateTime.fromISO('2026-03-18T16:00:00', { zone: ZONE });

let replSet;

// The seed creates its invoices with the real invoice service, which uses transactions: a replica set
beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60_000 }] });
  await mongoose.connect(replSet.getUri());
  await Promise.all([User.init(), Client.init(), Project.init(), TimeEntry.init(), Invoice.init(), Counter.init()]);
}, 120_000);

afterEach(async () => {
  await Promise.all([User, Client, Project, TimeEntry, Invoice, Counter].map((model) => model.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
}, 60_000);

const countAll = async () => ({
  users: await User.countDocuments(),
  clients: await Client.countDocuments(),
  projects: await Project.countDocuments(),
  entries: await TimeEntry.countDocuments(),
  invoices: await Invoice.countDocuments(),
  counters: await Counter.countDocuments(),
});

const localDay = (date) => DateTime.fromJSDate(date, { zone: ZONE }).toFormat('yyyy-MM-dd');

describe('seed', () => {
  it('can be run again and again: same counts, same invoices, and the data looks like the brief', async () => {
    const first = await seedDemo({ now: NOW });
    const countsAfterFirst = await countAll();
    const demoId = (await User.findOne({ email: DEMO_USER.email }))._id;

    const second = await seedDemo({ now: NOW });
    expect(await countAll()).toEqual(countsAfterFirst);
    expect(second).toEqual(first);
    expect((await User.findOne({ email: DEMO_USER.email }))._id).toEqual(demoId); // the same user, reset

    expect(countsAfterFirst).toMatchObject({ users: 1, clients: 3, projects: 4, invoices: 2, counters: 1 });
    expect((await Counter.findOne({ userId: demoId })).seq).toBe(2); // numbers start again at INV-0001 after a re-seed

    // the user
    const user = await User.findOne({ email: DEMO_USER.email });
    expect(user).toMatchObject({ name: 'Alex Morgan', timezone: 'Asia/Kolkata', currency: 'USD' });
    expect(await bcrypt.compare('Demo@1234', user.passwordHash)).toBe(true);

    // clients and project rates
    const projects = await Project.find({ userId: demoId }).populate('client', 'name');
    expect(projects.map((p) => `${p.client.name} / ${p.name} / ${p.hourlyRate}`).sort()).toEqual([
      'Acme Corp / Mobile app / 60',
      'Acme Corp / Website redesign / 45',
      'Globex Ltd / Brand identity / 80',
      'Initech / API integration / 55',
    ]);

    // entries: weekdays only, 2-4 a day (today only has what already finished), 30 minutes to 3 hours, none running or in the future
    const entries = await TimeEntry.find({ userId: demoId }).sort({ startedAt: 1 });
    expect(entries.length).toBeGreaterThan(40);
    expect(entries.every((e) => e.endedAt && e.endedAt <= NOW.toJSDate())).toBe(true);
    expect(entries.filter((e) => e.endedAt === null)).toHaveLength(0);

    const crossing = entries.filter((e) => localDay(e.startedAt) !== localDay(e.endedAt));
    expect(crossing).toHaveLength(1);

    const perDay = new Map();
    for (const e of entries) {
      const day = localDay(e.startedAt);
      if (!crossing.includes(e)) perDay.set(day, (perDay.get(day) ?? 0) + 1); // the late-night release comes on top of a normal day

      expect(DateTime.fromJSDate(e.startedAt, { zone: ZONE }).weekday).toBeLessThanOrEqual(5);
      expect(e.durationSeconds).toBeGreaterThanOrEqual(30 * 60);
      expect(e.durationSeconds).toBeLessThanOrEqual(3 * 3600);
    }
    for (const [day, count] of perDay) {
      if (day === '2026-03-18') continue; // "today" only has what finished before 16:00
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(4);
    }
    expect(perDay.has('2026-02-16')).toBe(true); // four weeks of data: it starts on Monday 16 February
    expect(entries.some((e) => !e.billable)).toBe(true);
    expect(entries.filter((e) => e.billable).length).toBeGreaterThan(entries.length / 2);

    // invoices: Globex paid (4 weeks ago), Acme sent (3 to 2 weeks ago), created by the real service
    const invoices = await Invoice.find({ userId: demoId }).sort({ number: 1 });
    expect(invoices.map((i) => [i.number, i.client.name, i.status, i.periodStart, i.periodEnd])).toEqual([
      ['INV-0001', 'Globex Ltd', 'paid', '2026-02-16', '2026-02-22'],
      ['INV-0002', 'Acme Corp', 'sent', '2026-02-23', '2026-03-08'],
    ]);
    for (const invoice of invoices) {
      const claimed = entries.filter((e) => String(e.invoiceId) === String(invoice._id));
      expect(claimed.map((e) => String(e._id)).sort()).toEqual(invoice.entryIds.map(String).sort());
      expect(claimed.length).toBeGreaterThan(0);
      expect(claimed.every((e) => e.billable)).toBe(true);
      expect(invoice.issuedAt <= NOW.toJSDate()).toBe(true);
    }

    // the last two weeks (from Monday 9 March) are left unbilled, so a reviewer can invoice them
    const billed = entries.filter((e) => e.invoiceId);
    expect(billed.every((e) => localDay(e.startedAt) < '2026-03-09')).toBe(true);
    const recent = entries.filter((e) => localDay(e.startedAt) >= '2026-03-09' && e.billable);
    expect(recent.length).toBeGreaterThan(5);
    expect(recent.every((e) => e.invoiceId === null)).toBe(true);
    expect(first.unbilled.entries).toBeGreaterThanOrEqual(recent.length);
  }, 60_000);

  it("does not delete or change another user's data", async () => {
    // Someone else with a client that has the same name, entries (one of them a running timer) and an invoice
    const other = await User.create({ name: 'Sam', email: 'sam@example.com', passwordHash: 'not-used', timezone: ZONE });
    const client = await Client.create({ userId: other._id, name: 'Acme Corp' });
    const project = await Project.create({ userId: other._id, clientId: client._id, name: 'Website redesign', hourlyRate: 70 });
    const entry = (startedAt, endedAt) => ({
      userId: other._id,
      projectId: project._id,
      clientId: client._id,
      description: "Sam's work",
      startedAt: new Date(startedAt),
      endedAt: endedAt ? new Date(endedAt) : null,
      durationSeconds: endedAt ? (new Date(endedAt) - new Date(startedAt)) / 1000 : 0,
    });
    await TimeEntry.create([
      entry('2026-03-02T04:30:00Z', '2026-03-02T05:30:00Z'),
      entry('2026-03-03T04:30:00Z', '2026-03-03T05:30:00Z'),
      entry('2026-03-10T04:30:00Z', null),
    ]);
    await invoiceService.create(other._id, { clientId: client._id, from: '2026-03-02', to: '2026-03-02' });

    const snapshot = async () => ({
      user: await User.findById(other._id).lean(),
      clients: await Client.find({ userId: other._id }).lean(),
      projects: await Project.find({ userId: other._id }).lean(),
      entries: await TimeEntry.find({ userId: other._id }).sort({ startedAt: 1 }).lean(),
      invoices: await Invoice.find({ userId: other._id }).lean(),
      counters: await Counter.find({ userId: other._id }).lean(),
    });
    const before = await snapshot();
    expect(before.entries).toHaveLength(3);
    expect(before.invoices).toHaveLength(1);

    await seedDemo({ now: NOW });
    await seedDemo({ now: NOW });

    expect(await snapshot()).toEqual(before); // every document is exactly as it was

    // and the demo user got their own data next to it
    const demo = await User.findOne({ email: DEMO_USER.email });
    expect(await Client.countDocuments({ userId: demo._id })).toBe(3);
    expect(await Client.countDocuments()).toBe(4);
    expect(await Invoice.countDocuments({ userId: demo._id })).toBe(2);
  }, 60_000);

  it('refuses to run in production unless SEED_ALLOW=true', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'production' })).toThrow(/SEED_ALLOW=true/);
    expect(() => assertSeedAllowed({ NODE_ENV: 'production', SEED_ALLOW: 'yes' })).toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: 'production', SEED_ALLOW: 'true' })).not.toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertSeedAllowed({})).not.toThrow();
  });
});
