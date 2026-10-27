import mongoose from 'mongoose';
import request from 'supertest';
import { DateTime } from 'luxon';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Project from '../models/Project.js';
import TimeEntry from '../models/TimeEntry.js';
import generateToken from '../utils/generateToken.js';
import { splitIntoDays } from '../services/timesheet.service.js';

const HOUR = 3600;

let mongod;
let priya; // India (UTC+5:30), 3 projects
let bruno; // someone else, also in India

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([User.init(), Client.init(), Project.init(), TimeEntry.init()]);
});

beforeEach(async () => {
  priya = await createUser('priya', 'Asia/Kolkata');
  bruno = await createUser('bruno', 'Asia/Kolkata');
});

afterEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Client.deleteMany({}),
    Project.deleteMany({}),
    TimeEntry.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ---------- helpers ----------

// A user with two clients: Acme (projects Website $50 and App $60) and Zeta (project Brand $80)
const createUser = async (name, timezone) => {
  const user = await User.create({ name, email: `${name}@example.com`, passwordHash: 'not-used', timezone });
  const [acme, zeta] = await Client.create([
    { userId: user._id, name: 'Acme' },
    { userId: user._id, name: 'Zeta' },
  ]);
  // created out of alphabetical order on purpose: the timesheet must sort them
  const [website, brand, appProject] = await Project.create([
    { userId: user._id, clientId: acme._id, name: 'Website', hourlyRate: 50, color: '#10B981' },
    { userId: user._id, clientId: zeta._id, name: 'Brand', hourlyRate: 80, color: '#F59E0B' },
    { userId: user._id, clientId: acme._id, name: 'App', hourlyRate: 60, color: '#4F46E5' },
  ]);

  return {
    id: user._id,
    token: generateToken(user),
    website: String(website._id),
    brand: String(brand._id),
    app: String(appProject._id),
    acmeId: String(acme._id),
  };
};

// Wall-clock time in India, e.g. ist('2026-03-09', '09:00')
const ist = (date, time) => new Date(`${date}T${time}:00+05:30`);

// Stores a finished entry the way the app would (duration = whole seconds between start and end)
const addEntry = (user, projectId, startedAt, endedAt, extra = {}) =>
  TimeEntry.create({
    userId: user.id,
    projectId,
    clientId: user.acmeId,
    startedAt,
    endedAt,
    durationSeconds: Math.floor((endedAt - startedAt) / 1000),
    ...extra,
  });

const getWeek = (user, weekStart) =>
  request(app)
    .get('/api/timesheet' + (weekStart ? `?weekStart=${weekStart}` : ''))
    .set('Authorization', `Bearer ${user.token}`);

const rowFor = (body, projectName) => body.rows.find((row) => row.project.name === projectName);

const WEEK = '2026-03-09'; // a Monday

// ---------- the day columns ----------

describe('GET /api/timesheet: days and rows', () => {
  it('puts entries on the right day columns, with 7 labelled days and rows sorted by client then project', async () => {
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '11:00')); // Mon 2h
    await addEntry(priya, priya.website, ist('2026-03-11', '10:00'), ist('2026-03-11', '10:30')); // Wed 30m
    await addEntry(priya, priya.app, ist('2026-03-15', '20:00'), ist('2026-03-15', '22:00')); // Sun 2h
    await addEntry(priya, priya.brand, ist('2026-03-13', '14:00'), ist('2026-03-13', '15:00')); // Fri 1h

    const res = await getWeek(priya, WEEK);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ weekStart: '2026-03-09', weekEnd: '2026-03-15', timezone: 'Asia/Kolkata' });

    expect(res.body.days).toEqual([
      { date: '2026-03-09', label: 'Mon 9' },
      { date: '2026-03-10', label: 'Tue 10' },
      { date: '2026-03-11', label: 'Wed 11' },
      { date: '2026-03-12', label: 'Thu 12' },
      { date: '2026-03-13', label: 'Fri 13' },
      { date: '2026-03-14', label: 'Sat 14' },
      { date: '2026-03-15', label: 'Sun 15' },
    ]);

    // Acme / App, Acme / Website, Zeta / Brand
    expect(res.body.rows.map((r) => `${r.client.name} / ${r.project.name}`)).toEqual([
      'Acme / App',
      'Acme / Website',
      'Zeta / Brand',
    ]);
    expect(rowFor(res.body, 'App').seconds).toEqual([0, 0, 0, 0, 0, 0, 2 * HOUR]);
    expect(rowFor(res.body, 'Website').seconds).toEqual([2 * HOUR, 0, 0.5 * HOUR, 0, 0, 0, 0]);
    expect(rowFor(res.body, 'Brand').seconds).toEqual([0, 0, 0, 0, HOUR, 0, 0]);

    expect(rowFor(res.body, 'Website')).toMatchObject({
      project: { name: 'Website', color: '#10B981', hourlyRate: 50, _id: priya.website },
      client: { name: 'Acme', _id: priya.acmeId },
      totalSeconds: 2.5 * HOUR,
    });
  });

  it('only lists projects that have time that week and returns zeros for an empty week', async () => {
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '10:00'));

    const busy = await getWeek(priya, WEEK);
    expect(busy.body.rows.map((r) => r.project.name)).toEqual(['Website']); // App and Brand have no time

    const empty = await getWeek(priya, '2026-03-16');
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({
      rows: [],
      dayTotals: [0, 0, 0, 0, 0, 0, 0],
      weekTotalSeconds: 0,
      billableSeconds: 0,
      billableAmount: 0,
    });
    expect(empty.body.days).toHaveLength(7);
  });

  it('defaults to the current week in the user\'s own time zone', async () => {
    const res = await getWeek(priya);
    const expected = DateTime.now().setZone('Asia/Kolkata').startOf('week').toISODate();

    expect(res.status).toBe(200);
    expect(res.body.weekStart).toBe(expected);
    expect(DateTime.fromISO(res.body.weekStart).weekday).toBe(1);
  });
});

// ---------- midnight, edges and the running timer ----------

describe('entries across midnight and at the edges of the week', () => {
  it('splits an entry that crosses midnight between the two days', async () => {
    await addEntry(priya, priya.website, ist('2026-03-10', '23:00'), ist('2026-03-11', '01:00')); // Tue 23:00 - Wed 01:00

    const { body } = await getWeek(priya, WEEK);
    expect(rowFor(body, 'Website').seconds).toEqual([0, HOUR, HOUR, 0, 0, 0, 0]);
    expect(rowFor(body, 'Website').totalSeconds).toBe(2 * HOUR);
    expect(body.dayTotals).toEqual([0, HOUR, HOUR, 0, 0, 0, 0]);
  });

  it('clips entries to the edges of the week and ignores entries outside it', async () => {
    // started Sunday night before the week: only the part after Monday 00:00 counts
    await addEntry(priya, priya.website, ist('2026-03-08', '23:00'), ist('2026-03-09', '01:00'));
    // starts on the last Sunday, runs into the next week: only the part before Monday 00:00 counts
    await addEntry(priya, priya.app, ist('2026-03-15', '23:00'), ist('2026-03-16', '01:00'));
    // completely outside: the week before, the week after, ended exactly when the week starts, started exactly when it ends
    await addEntry(priya, priya.brand, ist('2026-03-02', '09:00'), ist('2026-03-02', '17:00'));
    await addEntry(priya, priya.brand, ist('2026-03-17', '09:00'), ist('2026-03-17', '17:00'));
    await addEntry(priya, priya.brand, ist('2026-03-08', '22:00'), ist('2026-03-09', '00:00'));
    await addEntry(priya, priya.brand, ist('2026-03-16', '00:00'), ist('2026-03-16', '02:00'));

    const { body } = await getWeek(priya, WEEK);
    expect(body.rows.map((r) => r.project.name)).toEqual(['App', 'Website']); // Brand is entirely outside
    expect(rowFor(body, 'Website').seconds).toEqual([HOUR, 0, 0, 0, 0, 0, 0]);
    expect(rowFor(body, 'App').seconds).toEqual([0, 0, 0, 0, 0, 0, HOUR]);
    expect(body.weekTotalSeconds).toBe(2 * HOUR);
  });

  it('leaves out the running timer', async () => {
    await TimeEntry.create({
      userId: priya.id,
      projectId: priya.website,
      clientId: priya.acmeId,
      startedAt: new Date(),
    });

    const thisWeek = await getWeek(priya);
    expect(thisWeek.body.rows).toEqual([]);
    expect(thisWeek.body.weekTotalSeconds).toBe(0);
  });

  it('counts whole seconds, so the days add up to exactly the entry\'s durationSeconds', async () => {
    // A timer entry with milliseconds that starts 0.6 s before midnight (Tuesday 23:59:59.4 India time)
    const startedAt = new Date('2026-03-10T18:29:59.400Z');
    const endedAt = new Date(startedAt.getTime() + 3600 * 1000 + 600); // 3600.6 s later
    const entry = await addEntry(priya, priya.website, startedAt, endedAt);
    expect(entry.durationSeconds).toBe(3600);

    const { body } = await getWeek(priya, WEEK);
    const { seconds, totalSeconds } = rowFor(body, 'Website');
    expect(totalSeconds).toBe(3600); // not 3599.4 or 3600.6
    expect(seconds.every(Number.isInteger)).toBe(true);
    expect(seconds[1]).toBe(1); // 1 second before midnight (23:59:59 - 00:00:00)
    expect(seconds[2]).toBe(3599);
  });
});

// ---------- time zones ----------

describe('days are counted in the user\'s time zone', () => {
  it('the same UTC entries land on different days for India and New York', async () => {
    const nick = await createUser('nick', 'America/New_York'); // UTC-4 in March 2026 (daylight saving)

    // 20:00-21:00 UTC on Tuesday 10 March: 01:30 Wed in India, 16:00 Tue in New York
    // 03:00-04:00 UTC on Tuesday 10 March: 08:30 Tue in India, 23:00 Mon in New York
    for (const user of [priya, nick]) {
      await addEntry(user, user.website, new Date('2026-03-10T20:00:00Z'), new Date('2026-03-10T21:00:00Z'));
      await addEntry(user, user.website, new Date('2026-03-10T03:00:00Z'), new Date('2026-03-10T04:00:00Z'));
    }

    const india = await getWeek(priya, WEEK);
    expect(india.body.timezone).toBe('Asia/Kolkata');
    expect(rowFor(india.body, 'Website').seconds).toEqual([0, HOUR, HOUR, 0, 0, 0, 0]);

    const newYork = await getWeek(nick, WEEK);
    expect(newYork.body.timezone).toBe('America/New_York');
    expect(rowFor(newYork.body, 'Website').seconds).toEqual([HOUR, HOUR, 0, 0, 0, 0, 0]);
  });

  it('uses each user\'s own zone even when two users look at the same week', async () => {
    const nick = await createUser('nick', 'America/New_York');
    await addEntry(priya, priya.website, new Date('2026-03-10T20:00:00Z'), new Date('2026-03-10T21:00:00Z'));
    await addEntry(nick, nick.website, new Date('2026-03-10T20:00:00Z'), new Date('2026-03-10T21:00:00Z'));

    const [a, b] = await Promise.all([getWeek(priya, WEEK), getWeek(nick, WEEK)]);
    expect(rowFor(a.body, 'Website').seconds).not.toEqual(rowFor(b.body, 'Website').seconds);
  });
});

describe('daylight saving weeks (America/New_York)', () => {
  let nick;
  beforeEach(async () => {
    nick = await createUser('nick', 'America/New_York');
  });

  it('the week DST starts (2 March 2026): Sunday 8 March is 23 hours long', async () => {
    // exactly 24 hours from Sunday 00:00 EST to Monday 00:00 EDT + 1h... but Sunday only has 23 of them
    await addEntry(nick, nick.website, new Date('2026-03-08T05:00:00Z'), new Date('2026-03-09T05:00:00Z'));

    const { body } = await getWeek(nick, '2026-03-02');
    expect(body.days.map((d) => d.date)).toEqual([
      '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08',
    ]);
    expect(rowFor(body, 'Website').seconds).toEqual([0, 0, 0, 0, 0, 0, 23 * HOUR]); // not 24
    expect(body.weekTotalSeconds).toBe(23 * HOUR);

    // the remaining hour is Monday 00:00-01:00 EDT, in the next week
    const next = await getWeek(nick, '2026-03-09');
    expect(rowFor(next.body, 'Website').seconds).toEqual([HOUR, 0, 0, 0, 0, 0, 0]);
  });

  it('the week DST ends (26 October 2026): Sunday 1 November is 25 hours long', async () => {
    // a full Sunday: 00:00 EDT (04:00Z) to Monday 00:00 EST (05:00Z) is 25 hours
    await addEntry(nick, nick.website, new Date('2026-11-01T04:00:00Z'), new Date('2026-11-02T05:00:00Z'));

    const { body } = await getWeek(nick, '2026-10-26');
    expect(body.days[6].date).toBe('2026-11-01');
    expect(rowFor(body, 'Website').seconds).toEqual([0, 0, 0, 0, 0, 0, 25 * HOUR]);

    // nothing spills into the next week
    const next = await getWeek(nick, '2026-11-02');
    expect(next.body.rows).toEqual([]);
  });

  it('a normal week after the change (9 March 2026): days start at 04:00 UTC', async () => {
    // 03:59-04:01 UTC: one minute on Sunday 8 March (outside this week), one minute on Monday 9 March
    await addEntry(nick, nick.website, new Date('2026-03-09T03:59:00Z'), new Date('2026-03-09T04:01:00Z'));

    const { body } = await getWeek(nick, WEEK);
    expect(rowFor(body, 'Website').seconds).toEqual([60, 0, 0, 0, 0, 0, 0]);
    expect(body.weekTotalSeconds).toBe(60);
  });
});

// ---------- totals ----------

describe('totals', () => {
  it('calculates dayTotals, weekTotalSeconds, billableSeconds and billableAmount', async () => {
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '11:00')); // Mon 2h  billable  $50
    await addEntry(priya, priya.app, ist('2026-03-09', '12:00'), ist('2026-03-09', '13:00')); // Mon 1h  billable  $60
    await addEntry(priya, priya.website, ist('2026-03-11', '10:00'), ist('2026-03-11', '10:30'), { billable: false }); // Wed 30m  not billable
    await addEntry(priya, priya.brand, ist('2026-03-12', '09:00'), ist('2026-03-12', '09:20')); // Thu 20m  billable  $80

    const { body } = await getWeek(priya, WEEK);

    expect(body.dayTotals).toEqual([3 * HOUR, 0, 0.5 * HOUR, 20 * 60, 0, 0, 0]);
    expect(body.weekTotalSeconds).toBe(3 * HOUR + 0.5 * HOUR + 20 * 60); // 5400 + 5400... = 3h50m
    expect(body.weekTotalSeconds).toBe(13800);
    expect(body.billableSeconds).toBe(3 * HOUR + 20 * 60); // everything except the non-billable half hour
    // 2h x 50 + 1h x 60 + (20 min = 1/3 h) x 80 = 100 + 60 + 26.6667 = 186.6667
    expect(body.billableAmount).toBe(186.67);

    expect(rowFor(body, 'Website')).toMatchObject({ totalSeconds: 2.5 * HOUR, billableSeconds: 2 * HOUR });
    expect(rowFor(body, 'App')).toMatchObject({ totalSeconds: HOUR, billableSeconds: HOUR });
  });

  it('billed entries still count towards the week', async () => {
    await addEntry(priya, priya.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '10:00'), {
      invoiceId: new mongoose.Types.ObjectId(),
    });
    const { body } = await getWeek(priya, WEEK);
    expect(body.weekTotalSeconds).toBe(HOUR);
    expect(body.billableAmount).toBe(50);
  });
});

// ---------- validation and privacy ----------

describe('validation and privacy', () => {
  it('rejects a weekStart that is not a Monday', async () => {
    for (const notMonday of ['2026-03-10', '2026-03-15', '2026-03-14']) {
      const res = await getWeek(priya, notMonday);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Week must start on a Monday');
      expect(res.body.errors).toEqual([{ path: 'weekStart', message: 'Week must start on a Monday' }]);
    }
  });

  it('rejects a weekStart that is not a date', async () => {
    for (const bad of ['banana', '2026-3-9', '2026-02-30', '09-03-2026']) {
      const res = await getWeek(priya, bad);
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([{ path: 'weekStart', message: 'weekStart must be a date like 2026-03-09' }]);
    }
  });

  it('never shows another user\'s entries', async () => {
    await addEntry(bruno, bruno.website, ist('2026-03-09', '09:00'), ist('2026-03-09', '17:00'));

    const mine = await getWeek(priya, WEEK);
    expect(mine.body.rows).toEqual([]);
    expect(mine.body.weekTotalSeconds).toBe(0);

    const his = await getWeek(bruno, WEEK);
    expect(his.body.weekTotalSeconds).toBe(8 * HOUR);
  });

  it('requires a login', async () => {
    const res = await request(app).get('/api/timesheet');
    expect(res.status).toBe(401);
  });
});

// ---------- the pure day-splitting function ----------

describe('splitIntoDays', () => {
  // seven days starting Monday 2026-03-09 00:00 UTC, plus the end of Sunday
  const DAY = 24 * 3600 * 1000;
  const boundaries = Array.from({ length: 8 }, (_, i) => Date.UTC(2026, 2, 9) + i * DAY);
  const at = (day, hour, minute = 0) => Date.UTC(2026, 2, 9 + day, hour, minute); // day 0 = Monday
  const entry = (start, end) => ({ startedAt: start, durationSeconds: (end - start) / 1000 });

  it('puts an entry that stays inside one day in that day', () => {
    expect(splitIntoDays(entry(at(2, 9), at(2, 11)), boundaries)).toEqual([0, 0, 7200, 0, 0, 0, 0]);
  });

  it('splits an entry that crosses midnight', () => {
    expect(splitIntoDays(entry(at(0, 23), at(1, 1)), boundaries)).toEqual([3600, 3600, 0, 0, 0, 0, 0]);
  });

  it('spreads a very long entry over every day it touches', () => {
    // Monday 22:00 to Wednesday 24:00 is 50 hours
    expect(splitIntoDays(entry(at(0, 22), at(3, 0)), boundaries)).toEqual([2 * 3600, 24 * 3600, 24 * 3600, 0, 0, 0, 0]);
  });

  it('clips the parts before the week starts and after it ends', () => {
    expect(splitIntoDays(entry(at(-1, 23), at(0, 1)), boundaries)).toEqual([3600, 0, 0, 0, 0, 0, 0]);
    expect(splitIntoDays(entry(at(6, 23), at(7, 1)), boundaries)).toEqual([0, 0, 0, 0, 0, 0, 3600]);
  });

  it('returns zeros for an entry outside the week or touching it only at an edge', () => {
    expect(splitIntoDays(entry(at(-3, 9), at(-3, 10)), boundaries)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(splitIntoDays(entry(at(8, 9), at(8, 10)), boundaries)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(splitIntoDays(entry(at(-1, 22), at(0, 0)), boundaries)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(splitIntoDays(entry(at(7, 0), at(7, 2)), boundaries)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('accepts Date objects as well as timestamps, and always returns 7 numbers', () => {
    const result = splitIntoDays({ startedAt: new Date(at(4, 9)), durationSeconds: 1800 }, boundaries.map((b) => new Date(b)));
    expect(result).toHaveLength(7);
    expect(result[4]).toBe(1800);
  });
});
