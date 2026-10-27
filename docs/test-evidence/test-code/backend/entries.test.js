import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Project from '../models/Project.js';
import TimeEntry from '../models/TimeEntry.js';
import generateToken from '../utils/generateToken.js';

const BILLED_MESSAGE = "This entry is on an invoice and can't be changed";
const HOUR = 3600 * 1000;

let mongod;
let alice; // { token, id, clientId, projectId (Website, $50/h), client2Id, project2Id (Mobile, $60/h) }
let bruno;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([User.init(), Client.init(), Project.init(), TimeEntry.init()]);
});

beforeEach(async () => {
  alice = await createUser('alice');
  bruno = await createUser('bruno');
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

const api = (method, url, token, body) => {
  const req = request(app)[method](url);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
};

// A user with two clients, each with one project (rates 50 and 60 per hour)
const createUser = async (name) => {
  const user = await User.create({ name, email: `${name}@example.com`, passwordHash: 'not-used' });
  const [client, client2] = await Client.create([
    { userId: user._id, name: `${name}'s client` },
    { userId: user._id, name: `${name}'s other client` },
  ]);
  const [project, project2] = await Project.create([
    { userId: user._id, clientId: client._id, name: 'Website', hourlyRate: 50, color: '#10B981' },
    { userId: user._id, clientId: client2._id, name: 'Mobile app', hourlyRate: 60, color: '#F59E0B' },
  ]);

  return {
    token: generateToken(user),
    id: user._id,
    clientId: String(client._id),
    projectId: String(project._id),
    client2Id: String(client2._id),
    project2Id: String(project2._id),
  };
};

// 2.5 hours on a day in the past
const body = (user, overrides = {}) => ({
  projectId: user.projectId,
  startedAt: '2026-03-10T09:00:00.000Z',
  endedAt: '2026-03-10T11:30:00.000Z',
  ...overrides,
});

const createEntry = (user, overrides) => api('post', '/api/entries', user.token, body(user, overrides));

// Insert straight into the database (to set things the API doesn't allow, like invoiceId or a running timer)
const insertEntry = (user, { start, seconds, projectId, clientId, ...rest }) =>
  TimeEntry.create({
    userId: user.id,
    projectId: projectId ?? user.projectId,
    clientId: clientId ?? user.clientId,
    startedAt: new Date(start),
    endedAt: new Date(new Date(start).getTime() + seconds * 1000),
    durationSeconds: seconds,
    ...rest,
  });

// ---------- creating ----------

describe('POST /api/entries', () => {
  it('creates a manual entry with the right duration and the project\'s client', async () => {
    const res = await createEntry(alice, { description: '  Wireframes ', billable: false });

    expect(res.status).toBe(201);
    expect(res.body.entry).toMatchObject({
      source: 'manual',
      description: 'Wireframes',
      billable: false,
      durationSeconds: 9000, // 2.5 hours
      projectId: alice.projectId,
      clientId: alice.clientId, // copied from the project
      invoiceId: null,
      startedAt: '2026-03-10T09:00:00.000Z',
      endedAt: '2026-03-10T11:30:00.000Z',
      project: { name: 'Website', color: '#10B981', hourlyRate: 50 },
      client: { name: "alice's client" },
    });
    expect(res.body.entry.__v).toBeUndefined();

    const saved = await TimeEntry.findById(res.body.entry._id);
    expect(saved.userId.toString()).toBe(String(alice.id));
  });

  it('is billable by default, copies the client of whichever project is chosen, and stores UTC', async () => {
    const res = await createEntry(alice, {
      projectId: alice.project2Id,
      // the same moments as 09:00Z-11:30Z, written with an offset
      startedAt: '2026-03-10T14:30:00+05:30',
      endedAt: '2026-03-10T17:00:00+05:30',
    });

    expect(res.status).toBe(201);
    expect(res.body.entry).toMatchObject({
      billable: true,
      description: '',
      clientId: alice.client2Id,
      startedAt: '2026-03-10T09:00:00.000Z',
      endedAt: '2026-03-10T11:30:00.000Z',
      durationSeconds: 9000,
    });
  });

  describe('time rules', () => {
    const expectEndTimeError = (res, message) => {
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([{ path: 'endedAt', message }]);
    };

    it('rejects an end before the start, and a zero-length entry', async () => {
      const before = await createEntry(alice, { startedAt: '2026-03-10T11:00:00Z', endedAt: '2026-03-10T10:00:00Z' });
      expectEndTimeError(before, 'End time must be after the start time');

      const same = await createEntry(alice, { startedAt: '2026-03-10T10:00:00Z', endedAt: '2026-03-10T10:00:00Z' });
      expectEndTimeError(same, 'End time must be after the start time');
      expect(await TimeEntry.countDocuments()).toBe(0);
    });

    it('rejects an entry longer than 24 hours but accepts exactly 24 hours', async () => {
      const tooLong = await createEntry(alice, { startedAt: '2026-03-10T00:00:00Z', endedAt: '2026-03-11T00:00:01Z' });
      expectEndTimeError(tooLong, "An entry can't be longer than 24 hours");

      const exactly = await createEntry(alice, { startedAt: '2026-03-10T00:00:00Z', endedAt: '2026-03-11T00:00:00Z' });
      expect(exactly.status).toBe(201);
      expect(exactly.body.entry.durationSeconds).toBe(86400);
    });

    it('rejects an end time in the future, with 1 minute of clock difference allowed', async () => {
      const now = Date.now();
      const future = await createEntry(alice, {
        startedAt: new Date(now - HOUR).toISOString(),
        endedAt: new Date(now + 10 * 60 * 1000).toISOString(),
      });
      expectEndTimeError(future, "End time can't be in the future");

      const almostNow = await createEntry(alice, {
        startedAt: new Date(now - HOUR).toISOString(),
        endedAt: new Date(now + 30 * 1000).toISOString(), // 30 seconds ahead: device clock slightly fast
      });
      expect(almostNow.status).toBe(201);
    });
  });

  it('validates required fields, date formats and field lengths', async () => {
    const empty = await api('post', '/api/entries', alice.token, {});
    expect(empty.status).toBe(400);
    expect(empty.body.errors).toEqual(
      expect.arrayContaining([
        { path: 'projectId', message: 'Project is required' },
        { path: 'startedAt', message: 'Start time is required' },
        { path: 'endedAt', message: 'End time is required' },
      ])
    );

    const badDate = await createEntry(alice, { startedAt: 'yesterday', endedAt: '2026-03-10' });
    expect(badDate.status).toBe(400);
    expect(badDate.body.errors).toEqual(
      expect.arrayContaining([
        { path: 'startedAt', message: 'Start time must be a valid date and time' },
        { path: 'endedAt', message: 'End time must be a valid date and time' },
      ])
    );

    const longText = await createEntry(alice, { description: 'x'.repeat(201), billable: 'yes' });
    expect(longText.status).toBe(400);
    expect(longText.body.errors.map((e) => e.path).sort()).toEqual(['billable', 'description']);
  });

  it("rejects another user's project and an archived project", async () => {
    const foreign = await createEntry(alice, { projectId: bruno.projectId });
    expect(foreign.status).toBe(400);
    expect(foreign.body.errors).toEqual([{ path: 'projectId', message: 'Project not found' }]);

    await Project.updateOne({ _id: alice.projectId }, { archived: true });
    const archived = await createEntry(alice);
    expect(archived.status).toBe(400);
    expect(archived.body.message).toBe('Project not found');
    expect(await TimeEntry.countDocuments()).toBe(0);
  });
});

// ---------- editing ----------

describe('PATCH /api/entries/:id', () => {
  const makeEntry = async (user = alice) => (await createEntry(user)).body.entry;
  const patch = (user, id, data) => api('patch', `/api/entries/${id}`, user.token, data);

  it('recalculates the duration when the times change', async () => {
    const entry = await makeEntry();
    const res = await patch(alice, entry._id, { endedAt: '2026-03-10T10:00:00Z' });

    expect(res.status).toBe(200);
    expect(res.body.entry).toMatchObject({ durationSeconds: 3600, endedAt: '2026-03-10T10:00:00.000Z' });
    expect(res.body.entry.startedAt).toBe('2026-03-10T09:00:00.000Z'); // untouched
  });

  it('checks the new time against the existing one when only one time is sent', async () => {
    const entry = await makeEntry(); // 09:00 - 11:30
    const res = await patch(alice, entry._id, { startedAt: '2026-03-10T12:00:00Z' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ path: 'endedAt', message: 'End time must be after the start time' }]);
    expect((await TimeEntry.findById(entry._id)).durationSeconds).toBe(9000);
  });

  it("copies the new project's client when the project changes", async () => {
    const entry = await makeEntry();
    const res = await patch(alice, entry._id, { projectId: alice.project2Id });

    expect(res.status).toBe(200);
    expect(res.body.entry).toMatchObject({
      projectId: alice.project2Id,
      clientId: alice.client2Id,
      project: { name: 'Mobile app' },
      client: { name: "alice's other client" },
    });
  });

  it('can change just the description and billable flag, leaving the times alone', async () => {
    const entry = await makeEntry();
    const res = await patch(alice, entry._id, { description: 'Edited', billable: false });

    expect(res.status).toBe(200);
    expect(res.body.entry).toMatchObject({ description: 'Edited', billable: false, durationSeconds: 9000 });
  });

  it("rejects another user's project, and edits stopped timer entries like any other", async () => {
    const entry = await makeEntry();
    const foreign = await patch(alice, entry._id, { projectId: bruno.projectId });
    expect(foreign.status).toBe(400);
    expect(foreign.body.errors).toEqual([{ path: 'projectId', message: 'Project not found' }]);

    const fromTimer = await insertEntry(alice, { start: '2026-03-09T09:00:00Z', seconds: 600, source: 'timer' });
    const edited = await patch(alice, fromTimer._id, { description: 'Fixed the label' });
    expect(edited.status).toBe(200);
    expect(edited.body.entry).toMatchObject({ source: 'timer', description: 'Fixed the label' });
  });

  it('returns 409 for a billed entry and leaves it unchanged', async () => {
    const billed = await insertEntry(alice, {
      start: '2026-03-10T09:00:00Z',
      seconds: 3600,
      description: 'original',
      invoiceId: new mongoose.Types.ObjectId(),
    });

    const res = await patch(alice, billed._id, { description: 'changed', billable: false });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: BILLED_MESSAGE });

    const after = await TimeEntry.findById(billed._id);
    expect(after.description).toBe('original');
    expect(after.billable).toBe(true);
  });

  it('returns 409 "Stop the timer first" for the running timer', async () => {
    const running = await TimeEntry.create({
      userId: alice.id,
      projectId: alice.projectId,
      clientId: alice.clientId,
      startedAt: new Date(),
      description: 'running',
    });

    const res = await patch(alice, running._id, { description: 'changed' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: 'Stop the timer first' });
    expect((await TimeEntry.findById(running._id)).description).toBe('running');
  });

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    const unknown = await patch(alice, new mongoose.Types.ObjectId().toString(), { description: 'x' });
    expect(unknown.status).toBe(404);

    const malformed = await patch(alice, 'not-an-id', { description: 'x' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.message).toBe('Invalid id');
  });
});

// ---------- deleting ----------

describe('DELETE /api/entries/:id', () => {
  it('deletes an entry', async () => {
    const entry = (await createEntry(alice)).body.entry;

    expect((await api('delete', `/api/entries/${entry._id}`, alice.token)).status).toBe(204);
    expect(await TimeEntry.countDocuments()).toBe(0);
    expect((await api('delete', `/api/entries/${entry._id}`, alice.token)).status).toBe(404);
  });

  it('returns 409 for a billed entry', async () => {
    const billed = await insertEntry(alice, {
      start: '2026-03-10T09:00:00Z',
      seconds: 3600,
      invoiceId: new mongoose.Types.ObjectId(),
    });

    const res = await api('delete', `/api/entries/${billed._id}`, alice.token);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(BILLED_MESSAGE);
    expect(await TimeEntry.countDocuments()).toBe(1);
  });

  it('returns 409 "Stop the timer first" for the running timer', async () => {
    const running = await TimeEntry.create({
      userId: alice.id,
      projectId: alice.projectId,
      clientId: alice.clientId,
      startedAt: new Date(),
    });

    const res = await api('delete', `/api/entries/${running._id}`, alice.token);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Stop the timer first');
    expect(await TimeEntry.countDocuments()).toBe(1);
  });
});

// ---------- privacy and auth ----------

describe("users can't touch each other's entries", () => {
  it("user A cannot see, edit or delete user B's entries (404)", async () => {
    const brunoEntry = (await createEntry(bruno, { description: 'secret' })).body.entry;

    const list = await api('get', '/api/entries', alice.token);
    expect(list.body.entries).toEqual([]);
    expect(list.body.totals.totalSeconds).toBe(0);

    const edit = await api('patch', `/api/entries/${brunoEntry._id}`, alice.token, { description: 'hacked' });
    expect(edit.status).toBe(404);

    const del = await api('delete', `/api/entries/${brunoEntry._id}`, alice.token);
    expect(del.status).toBe(404);

    // Bruno's entry is untouched
    const stillThere = await TimeEntry.findById(brunoEntry._id);
    expect(stillThere.description).toBe('secret');
  });

  it("user A cannot create an entry on user B's project", async () => {
    const res = await createEntry(alice, { projectId: bruno.projectId });
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    for (const [method, url] of [
      ['get', '/api/entries'],
      ['post', '/api/entries'],
      ['patch', `/api/entries/${new mongoose.Types.ObjectId()}`],
      ['delete', `/api/entries/${new mongoose.Types.ObjectId()}`],
    ]) {
      expect((await api(method, url, null, {})).status).toBe(401);
    }
  });
});

// ---------- listing, filters and totals ----------

describe('GET /api/entries', () => {
  // five finished entries plus a running timer
  //  e1 Website  $50  billable   2h        unbilled   10 Mar
  //  e2 Website  $50  billable   30m       unbilled   11 Mar
  //  e3 Mobile   $60  billable   1000s      unbilled   12 Mar
  //  e4 Website  $50  non-billable 1h      unbilled   13 Mar
  //  e5 Website  $50  billable   1h        BILLED     09 Mar
  beforeEach(async () => {
    await insertEntry(alice, { start: '2026-03-10T09:00:00Z', seconds: 7200, description: 'e1' });
    await insertEntry(alice, { start: '2026-03-11T09:00:00Z', seconds: 1800, description: 'e2' });
    await insertEntry(alice, {
      start: '2026-03-12T09:00:00Z',
      seconds: 1000,
      description: 'e3',
      projectId: alice.project2Id,
      clientId: alice.client2Id,
    });
    await insertEntry(alice, { start: '2026-03-13T09:00:00Z', seconds: 3600, description: 'e4', billable: false });
    await insertEntry(alice, {
      start: '2026-03-09T09:00:00Z',
      seconds: 3600,
      description: 'e5',
      invoiceId: new mongoose.Types.ObjectId(),
    });
    await TimeEntry.create({ userId: alice.id, projectId: alice.projectId, clientId: alice.clientId, startedAt: new Date() });
    await insertEntry(bruno, { start: '2026-03-10T09:00:00Z', seconds: 7200, description: "bruno's" });
  });

  const list = (query = '') => api('get', `/api/entries${query}`, alice.token);
  const names = (res) => res.body.entries.map((e) => e.description);

  it('lists finished entries newest first, without the running timer or other users\' entries', async () => {
    const res = await list();

    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['e4', 'e3', 'e2', 'e1', 'e5']);
    expect(res.body.entries[0]).toMatchObject({
      project: { name: 'Website', color: '#10B981', hourlyRate: 50 },
      client: { name: "alice's client" },
    });
  });

  it('calculates totals, including the billable amount from each project rate', async () => {
    const { totals } = (await list()).body;

    // 7200 + 1800 + 1000 + 3600 + 3600
    expect(totals.totalSeconds).toBe(17200);
    // everything except the non-billable e4: 7200 + 1800 + 1000 + 3600
    expect(totals.billableSeconds).toBe(13600);
    // 2h x 50 + 0.5h x 50 + (1000/3600)h x 60 + 1h x 50 = 100 + 25 + 16.6667 + 50 = 191.6667
    expect(totals.billableAmount).toBe(191.67);
    // the same without the billed e5: 100 + 25 + 16.6667
    expect(totals.unbilledAmount).toBe(141.67);
  });

  it('filters by billable', async () => {
    const billable = await list('?billable=true');
    expect(names(billable)).toEqual(['e3', 'e2', 'e1', 'e5']);
    expect(billable.body.totals).toMatchObject({ totalSeconds: 13600, billableSeconds: 13600, billableAmount: 191.67 });

    const nonBillable = await list('?billable=false');
    expect(names(nonBillable)).toEqual(['e4']);
    expect(nonBillable.body.totals).toMatchObject({ totalSeconds: 3600, billableSeconds: 0, billableAmount: 0 });
  });

  it('filters by status (unbilled, billed, all)', async () => {
    expect(names(await list('?status=unbilled'))).toEqual(['e4', 'e3', 'e2', 'e1']);
    expect(names(await list('?status=billed'))).toEqual(['e5']);
    expect(names(await list('?status=all'))).toEqual(['e4', 'e3', 'e2', 'e1', 'e5']);

    const unbilled = (await list('?status=unbilled')).body.totals;
    expect(unbilled.billableAmount).toBe(141.67);
    expect(unbilled.unbilledAmount).toBe(141.67);

    const billed = (await list('?status=billed')).body.totals;
    expect(billed).toMatchObject({ totalSeconds: 3600, billableAmount: 50, unbilledAmount: 0 });
  });

  it('combines filters and filters by client, project and date range', async () => {
    expect(names(await list('?billable=true&status=unbilled'))).toEqual(['e3', 'e2', 'e1']);
    expect(names(await list(`?clientId=${alice.client2Id}`))).toEqual(['e3']);
    expect(names(await list(`?projectId=${alice.projectId}`))).toEqual(['e4', 'e2', 'e1', 'e5']);
    expect(
      names(await list('?from=2026-03-10T00:00:00Z&to=2026-03-12T00:00:00Z')) // [from, to)
    ).toEqual(['e2', 'e1']);
  });

  it('rejects invalid filters', async () => {
    const cases = [
      ['?status=pending', 'status', 'status must be all, unbilled or billed'],
      ['?billable=maybe', 'billable', 'billable must be true or false'],
      ['?clientId=abc', 'clientId', 'clientId is not a valid id'],
      ['?projectId=abc', 'projectId', 'projectId is not a valid id'],
      ['?from=yesterday', 'from', 'from must be a valid date'],
      ['?to=never', 'to', 'to must be a valid date'],
    ];
    for (const [query, path, message] of cases) {
      const res = await list(query);
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([{ path, message }]);
    }
  });
});
