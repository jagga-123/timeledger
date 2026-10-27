import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Project from '../models/Project.js';
import TimeEntry from '../models/TimeEntry.js';
import generateToken from '../utils/generateToken.js';

const ALREADY_RUNNING = 'A timer is already running. Stop it first.';

let mongod;
let alice; // { token, id, projectId, otherProjectId }
let bruno;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // Build the indexes first: the "one running timer per user" rule is a unique index
  await Promise.all([User.init(), Client.init(), Project.init(), TimeEntry.init()]);
});

beforeEach(async () => {
  alice = await createUserWithProjects('alice');
  bruno = await createUserWithProjects('bruno');
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

// A user with one client and two projects
const createUserWithProjects = async (name) => {
  // Created directly (no bcrypt) so the suite stays fast; the token is a normal login token
  const user = await User.create({ name, email: `${name}@example.com`, passwordHash: 'not-used' });
  const token = generateToken(user);

  const client = await Client.create({ userId: user._id, name: `${name}'s client` });
  const [project, otherProject] = await Project.create([
    { userId: user._id, clientId: client._id, name: 'Website', hourlyRate: 50, color: '#10B981' },
    { userId: user._id, clientId: client._id, name: 'Mobile app', hourlyRate: 60 },
  ]);

  return {
    token,
    id: user._id,
    clientId: String(client._id),
    projectId: String(project._id),
    otherProjectId: String(otherProject._id),
  };
};

const startTimer = (user, body = {}) =>
  api('post', '/api/timer/start', user.token, { projectId: user.projectId, ...body });
const stopTimer = (user) => api('post', '/api/timer/stop', user.token);
const runningCount = (user) => TimeEntry.countDocuments({ userId: user.id, endedAt: null });

// ---------- starting ----------

describe('POST /api/timer/start and GET /api/timer', () => {
  it('sets startedAt from the server clock (ignoring any time the client sends) and GET returns it', async () => {
    const before = Date.now();
    const res = await startTimer(alice, {
      description: 'Homepage',
      billable: false,
      startedAt: '2000-01-01T00:00:00.000Z', // must be ignored
    });
    const after = Date.now();

    expect(res.status).toBe(201);
    const { timer, serverTime } = res.body;
    const startedAt = Date.parse(timer.startedAt);
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(startedAt).toBeLessThanOrEqual(after);
    expect(timer).toMatchObject({
      description: 'Homepage',
      billable: false,
      endedAt: null,
      durationSeconds: 0,
      source: 'timer',
      invoiceId: null,
      projectId: alice.projectId,
      clientId: alice.clientId, // copied from the project
      project: { name: 'Website', color: '#10B981' },
      client: { name: "alice's client" },
    });
    expect(Date.parse(serverTime)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(serverTime)).toBeLessThanOrEqual(after);

    const got = await api('get', '/api/timer', alice.token);
    expect(got.status).toBe(200);
    expect(got.body.timer.startedAt).toBe(timer.startedAt);
    expect(got.body.timer._id).toBe(timer._id);
    expect(got.body.timer.project.name).toBe('Website');
    expect(typeof got.body.serverTime).toBe('string');
  });

  it('returns { timer: null, serverTime } when nothing is running', async () => {
    const res = await api('get', '/api/timer', alice.token);
    expect(res.status).toBe(200);
    expect(res.body.timer).toBeNull();
    expect(Number.isNaN(Date.parse(res.body.serverTime))).toBe(false);
  });

  it('defaults to billable with an empty description', async () => {
    const res = await startTimer(alice);
    expect(res.body.timer).toMatchObject({ billable: true, description: '' });
  });

  it('returns 409 when a timer is already running', async () => {
    expect((await startTimer(alice)).status).toBe(201);

    const second = await startTimer(alice, { projectId: alice.otherProjectId });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ message: ALREADY_RUNNING });
    expect(await runningCount(alice)).toBe(1);
  });

  it('lets exactly one of two simultaneous start requests win', async () => {
    const results = await Promise.all([
      startTimer(alice, { projectId: alice.projectId }),
      startTimer(alice, { projectId: alice.otherProjectId }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(loser.body.message).toBe(ALREADY_RUNNING);
    expect(await runningCount(alice)).toBe(1);
  });

  it('still allows only one when many requests arrive at once', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => startTimer(alice)));

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await runningCount(alice)).toBe(1);
  });

  it('allows different users to run timers at the same time', async () => {
    const [a, b] = await Promise.all([startTimer(alice), startTimer(bruno)]);
    expect([a.status, b.status]).toEqual([201, 201]);
  });

  it("rejects another user's project with 400 'Project not found'", async () => {
    const res = await startTimer(alice, { projectId: bruno.projectId });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Project not found');
    expect(await runningCount(alice)).toBe(0);
  });

  it('rejects an archived project and a project that does not exist', async () => {
    await Project.updateOne({ _id: alice.projectId }, { archived: true });

    const archived = await startTimer(alice);
    expect(archived.status).toBe(400);
    expect(archived.body.message).toBe('Project not found');

    const missing = await startTimer(alice, { projectId: new mongoose.Types.ObjectId().toString() });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toBe('Project not found');
  });

  it('validates the body', async () => {
    const noProject = await api('post', '/api/timer/start', alice.token, {});
    expect(noProject.status).toBe(400);
    expect(noProject.body.errors).toEqual([{ path: 'projectId', message: 'Project is required' }]);

    const tooLong = await startTimer(alice, { description: 'x'.repeat(201) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.errors).toEqual([
      { path: 'description', message: 'Description must be at most 200 characters' },
    ]);
  });
});

// ---------- the database guarantee ----------

describe('one running timer per user is enforced by the database', () => {
  it('has a partial unique index on userId for entries with endedAt: null', async () => {
    const indexes = await TimeEntry.collection.indexes();
    const index = indexes.find((i) => i.unique && i.key.userId === 1 && Object.keys(i.key).length === 1);

    expect(index).toBeDefined();
    expect(index.partialFilterExpression).toEqual({ endedAt: null });
  });

  it('rejects a second running entry even when the service is bypassed', async () => {
    const base = { userId: alice.id, projectId: alice.projectId, clientId: alice.clientId, startedAt: new Date() };

    await TimeEntry.create(base);
    await expect(TimeEntry.create(base)).rejects.toMatchObject({ code: 11000 });

    // finished entries don't count, and other users are unaffected
    await expect(TimeEntry.create({ ...base, endedAt: new Date() })).resolves.toBeDefined();
    await expect(TimeEntry.create({ ...base, endedAt: new Date() })).resolves.toBeDefined();
    await expect(TimeEntry.create({ ...base, userId: bruno.id })).resolves.toBeDefined();
  });
});

// ---------- stopping ----------

describe('POST /api/timer/stop', () => {
  it('calculates durationSeconds from startedAt and endedAt', async () => {
    const started = await startTimer(alice);
    // pretend the timer started a little over 2 minutes ago
    await TimeEntry.updateOne({ _id: started.body.timer._id }, { startedAt: new Date(Date.now() - 125_400) });

    const res = await stopTimer(alice);
    expect(res.status).toBe(200);

    const { entry } = res.body;
    const expected = Math.floor((Date.parse(entry.endedAt) - Date.parse(entry.startedAt)) / 1000);
    expect(entry.durationSeconds).toBe(expected);
    expect(entry.durationSeconds).toBeGreaterThanOrEqual(125);
    expect(entry.durationSeconds).toBeLessThanOrEqual(126);
    expect(entry.project.name).toBe('Website');
    expect(typeof res.body.serverTime).toBe('string');

    // saved, and nothing is running any more
    const saved = await TimeEntry.findById(entry._id);
    expect(saved.endedAt).toBeInstanceOf(Date);
    expect(saved.durationSeconds).toBe(expected);
    expect((await api('get', '/api/timer', alice.token)).body.timer).toBeNull();
  });

  it('keeps very short entries (duration can be 0)', async () => {
    await startTimer(alice);
    const res = await stopTimer(alice);

    expect(res.status).toBe(200);
    expect(res.body.entry.durationSeconds).toBeLessThanOrEqual(1);
    expect(await TimeEntry.countDocuments({ userId: alice.id, endedAt: { $ne: null } })).toBe(1);
  });

  it("returns 404 'No timer is running' when nothing is running", async () => {
    const res = await stopTimer(alice);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('No timer is running');
  });

  it('lets only one of two simultaneous stop requests succeed', async () => {
    await startTimer(alice);

    const results = await Promise.all([stopTimer(alice), stopTimer(alice)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
    expect(await TimeEntry.countDocuments({ userId: alice.id })).toBe(1);
  });

  it('lets the user start a new timer after stopping', async () => {
    await startTimer(alice);
    await stopTimer(alice);

    expect((await startTimer(alice, { projectId: alice.otherProjectId })).status).toBe(201);
    expect(await TimeEntry.countDocuments({ userId: alice.id })).toBe(2);
    expect(await runningCount(alice)).toBe(1);
  });
});

// ---------- editing the running timer ----------

describe('PATCH /api/timer', () => {
  it('updates description and billable of the running timer', async () => {
    const started = await startTimer(alice);

    const res = await api('patch', '/api/timer', alice.token, { description: ' Fix navbar ', billable: false });
    expect(res.status).toBe(200);
    expect(res.body.timer).toMatchObject({ description: 'Fix navbar', billable: false });
    expect(res.body.timer.startedAt).toBe(started.body.timer.startedAt); // never changes
    expect(typeof res.body.serverTime).toBe('string');
  });

  it('can move the running timer to another of my projects (clientId follows)', async () => {
    await startTimer(alice);
    const res = await api('patch', '/api/timer', alice.token, { projectId: alice.otherProjectId });

    expect(res.status).toBe(200);
    expect(res.body.timer.project.name).toBe('Mobile app');
    expect(res.body.timer.clientId).toBe(alice.clientId);
  });

  it("rejects another user's project, bad input, and an empty patch is harmless", async () => {
    await startTimer(alice);

    const foreign = await api('patch', '/api/timer', alice.token, { projectId: bruno.projectId });
    expect(foreign.status).toBe(400);
    expect(foreign.body.message).toBe('Project not found');

    const tooLong = await api('patch', '/api/timer', alice.token, { description: 'x'.repeat(201) });
    expect(tooLong.status).toBe(400);

    const empty = await api('patch', '/api/timer', alice.token, {});
    expect(empty.status).toBe(200);
  });

  it('returns 404 when no timer is running and never edits a stopped entry', async () => {
    const none = await api('patch', '/api/timer', alice.token, { description: 'x' });
    expect(none.status).toBe(404);

    const started = await startTimer(alice, { description: 'original' });
    await stopTimer(alice);
    const afterStop = await api('patch', '/api/timer', alice.token, { description: 'changed' });
    expect(afterStop.status).toBe(404);
    expect((await TimeEntry.findById(started.body.timer._id)).description).toBe('original');
  });
});

// ---------- privacy and auth ----------

describe("users can't touch each other's timers", () => {
  it("user A cannot see, stop or edit user B's timer", async () => {
    await startTimer(bruno, { description: 'secret' });

    const seen = await api('get', '/api/timer', alice.token);
    expect(seen.body.timer).toBeNull();

    expect((await stopTimer(alice)).status).toBe(404);
    expect((await api('patch', '/api/timer', alice.token, { description: 'hacked' })).status).toBe(404);

    // Bruno's timer is untouched and still running
    const bruno$ = await api('get', '/api/timer', bruno.token);
    expect(bruno$.body.timer).toMatchObject({ description: 'secret', endedAt: null });
  });

  it('requires authentication', async () => {
    for (const [method, url] of [
      ['get', '/api/timer'],
      ['post', '/api/timer/start'],
      ['post', '/api/timer/stop'],
      ['patch', '/api/timer'],
      ['get', '/api/entries'],
    ]) {
      expect((await api(method, url, null, {})).status).toBe(401);
    }
  });
});

// ---------- entries list (for the dashboard's "Today") ----------

describe('GET /api/entries', () => {
  const makeEntry = (user, startedAt, extra = {}) =>
    TimeEntry.create({
      userId: user.id,
      projectId: user.projectId,
      clientId: user.clientId,
      startedAt,
      endedAt: new Date(startedAt.getTime() + 60_000),
      durationSeconds: 60,
      ...extra,
    });

  it('lists only my stopped entries inside the range, newest first, with project and client names', async () => {
    const day = new Date('2026-03-10T09:00:00Z');
    await makeEntry(alice, new Date('2026-03-10T09:00:00Z'), { description: 'morning' });
    await makeEntry(alice, new Date('2026-03-10T14:00:00Z'), { description: 'afternoon' });
    await makeEntry(alice, new Date('2026-03-09T09:00:00Z'), { description: 'yesterday' });
    await makeEntry(bruno, day, { description: "bruno's" });
    await startTimer(alice); // running: must not be listed

    const res = await api(
      'get',
      '/api/entries?from=2026-03-10T00:00:00.000Z&to=2026-03-11T00:00:00.000Z',
      alice.token
    );

    expect(res.status).toBe(200);
    expect(res.body.entries.map((e) => e.description)).toEqual(['afternoon', 'morning']);
    expect(res.body.entries[0]).toMatchObject({
      durationSeconds: 60,
      project: { name: 'Website', color: '#10B981' },
      client: { name: "alice's client" },
    });
  });

  it('rejects a malformed date', async () => {
    const res = await api('get', '/api/entries?from=yesterday', alice.token);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ path: 'from', message: 'from must be a valid date' }]);
  });
});
