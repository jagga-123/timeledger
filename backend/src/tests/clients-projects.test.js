import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Project from '../models/Project.js';
import TimeEntry from '../models/TimeEntry.js';

let mongod;
let tokenA;
let tokenB;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([User.init(), Client.init(), Project.init()]); // build the unique indexes
});

beforeEach(async () => {
  tokenA = await registerUser('alice');
  tokenB = await registerUser('bruno');
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

const registerUser = async (name) => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name, email: `${name}@example.com`, password: 'Passw0rd!' });
  return res.body.token;
};

const api = (method, url, token, body) => {
  const req = request(app)[method](url);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
};

const createClient = async (token, body = { name: 'Acme Corp' }) =>
  (await api('post', '/api/clients', token, body)).body.client;

const createProject = async (token, clientId, body = {}) =>
  api('post', '/api/projects', token, { name: 'Website redesign', clientId, hourlyRate: 45, ...body });

describe('creating clients and projects', () => {
  it('creates a client and a project, and lists them with projectCount and client name', async () => {
    const clientRes = await api('post', '/api/clients', tokenA, {
      name: '  Acme Corp ',
      email: 'Billing@Acme.com',
      company: 'Acme Inc',
    });
    expect(clientRes.status).toBe(201);
    expect(clientRes.body.client).toMatchObject({
      name: 'Acme Corp',
      email: 'billing@acme.com',
      company: 'Acme Inc',
      archived: false,
    });

    const clientId = clientRes.body.client._id;
    const projectRes = await createProject(tokenA, clientId, { hourlyRate: 45.678 });
    expect(projectRes.status).toBe(201);
    expect(projectRes.body.project).toMatchObject({
      name: 'Website redesign',
      clientId,
      hourlyRate: 45.68, // rounded to 2 decimals
      color: '#4F46E5', // default
      archived: false,
      client: { _id: clientId, name: 'Acme Corp' },
    });
    expect(projectRes.body.project.__v).toBeUndefined();

    const clients = (await api('get', '/api/clients', tokenA)).body.clients;
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ name: 'Acme Corp', projectCount: 1 });

    const projects = (await api('get', '/api/projects', tokenA)).body.projects;
    expect(projects).toHaveLength(1);
    expect(projects[0].client.name).toBe('Acme Corp');
  });

  it('filters projects by clientId', async () => {
    const acme = await createClient(tokenA, { name: 'Acme' });
    const globex = await createClient(tokenA, { name: 'Globex' });
    await createProject(tokenA, acme._id, { name: 'Alpha' });
    await createProject(tokenA, globex._id, { name: 'Beta' });

    const res = await api('get', `/api/projects?clientId=${globex._id}`, tokenA);
    expect(res.status).toBe(200);
    expect(res.body.projects.map((p) => p.name)).toEqual(['Beta']);

    const bad = await api('get', '/api/projects?clientId=nope', tokenA);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('Invalid id');
  });

  it('allows the same project name under different clients but not under the same client', async () => {
    const acme = await createClient(tokenA, { name: 'Acme' });
    const globex = await createClient(tokenA, { name: 'Globex' });

    expect((await createProject(tokenA, acme._id)).status).toBe(201);
    expect((await createProject(tokenA, globex._id)).status).toBe(201);

    const dup = await createProject(tokenA, acme._id, { name: 'website REDESIGN' });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe('This client already has a project with this name');
  });
});

describe('duplicate client names', () => {
  it('returns 409 for a duplicate name (case-insensitive) for the same user', async () => {
    await createClient(tokenA, { name: 'Acme Corp' });
    const res = await api('post', '/api/clients', tokenA, { name: 'acme corp' });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('You already have a client with this name');
  });

  it('allows another user to use the same name', async () => {
    await createClient(tokenA, { name: 'Acme Corp' });
    const res = await api('post', '/api/clients', tokenB, { name: 'Acme Corp' });
    expect(res.status).toBe(201);
  });

  it('returns 409 when renaming a client to an existing name', async () => {
    await createClient(tokenA, { name: 'Acme' });
    const globex = await createClient(tokenA, { name: 'Globex' });

    const res = await api('patch', `/api/clients/${globex._id}`, tokenA, { name: 'Acme' });
    expect(res.status).toBe(409);
  });
});

describe('data isolation between users', () => {
  it("user A cannot see, edit or delete user B's client", async () => {
    const bClient = await createClient(tokenB, { name: 'Bruno Client' });

    const list = await api('get', '/api/clients', tokenA);
    expect(list.body.clients).toEqual([]);

    const patch = await api('patch', `/api/clients/${bClient._id}`, tokenA, { name: 'Hacked' });
    expect(patch.status).toBe(404);

    const del = await api('delete', `/api/clients/${bClient._id}`, tokenA);
    expect(del.status).toBe(404);

    // untouched for the real owner
    const bList = await api('get', '/api/clients', tokenB);
    expect(bList.body.clients[0].name).toBe('Bruno Client');
  });

  it("user A cannot see, edit or delete user B's project", async () => {
    const bClient = await createClient(tokenB, { name: 'Bruno Client' });
    const bProject = (await createProject(tokenB, bClient._id)).body.project;

    expect((await api('get', '/api/projects', tokenA)).body.projects).toEqual([]);
    expect((await api('patch', `/api/projects/${bProject._id}`, tokenA, { name: 'Hacked' })).status).toBe(404);
    expect((await api('delete', `/api/projects/${bProject._id}`, tokenA)).status).toBe(404);
  });

  it("rejects a project that uses another user's clientId with 400", async () => {
    const bClient = await createClient(tokenB, { name: 'Bruno Client' });

    const res = await createProject(tokenA, bClient._id);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Client not found');

    // same check when moving an existing project
    const aClient = await createClient(tokenA, { name: 'Acme' });
    const project = (await createProject(tokenA, aClient._id)).body.project;
    const move = await api('patch', `/api/projects/${project._id}`, tokenA, { clientId: bClient._id });
    expect(move.status).toBe(400);
    expect(move.body.message).toBe('Client not found');
  });
});

describe('deleting', () => {
  it('returns 409 when deleting a client that still has projects, then succeeds once they are gone', async () => {
    const client = await createClient(tokenA);
    const project = (await createProject(tokenA, client._id)).body.project;

    const blocked = await api('delete', `/api/clients/${client._id}`, tokenA);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toBe("Delete or move this client's projects first");

    expect((await api('delete', `/api/projects/${project._id}`, tokenA)).status).toBe(204);
    expect((await api('delete', `/api/clients/${client._id}`, tokenA)).status).toBe(204);
    expect((await api('get', '/api/clients', tokenA)).body.clients).toEqual([]);
  });

  it('returns 409 when deleting a project that has time entries', async () => {
    const client = await createClient(tokenA);
    const project = (await createProject(tokenA, client._id)).body.project;
    const alice = await User.findOne({ email: 'alice@example.com' });
    await TimeEntry.create({
      userId: alice._id,
      projectId: project._id,
      clientId: client._id,
      startedAt: new Date('2026-03-10T09:00:00Z'),
      endedAt: new Date('2026-03-10T10:00:00Z'),
      durationSeconds: 3600,
    });

    const res = await api('delete', `/api/projects/${project._id}`, tokenA);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('This project has time entries. Delete them first.');
    expect(await Project.countDocuments()).toBe(1);

    await TimeEntry.deleteMany({});
    expect((await api('delete', `/api/projects/${project._id}`, tokenA)).status).toBe(204);
  });
});

describe('moving a project to another client', () => {
  it("moves the project's unbilled entries along, but not entries that are already on an invoice", async () => {
    const acme = await createClient(tokenA, { name: 'Acme' });
    const globex = await createClient(tokenA, { name: 'Globex' });
    const project = (await createProject(tokenA, acme._id)).body.project;
    const alice = await User.findOne({ email: 'alice@example.com' });

    const entry = (extra) => ({
      userId: alice._id,
      projectId: project._id,
      clientId: acme._id,
      startedAt: new Date('2026-03-10T09:00:00Z'),
      endedAt: new Date('2026-03-10T10:00:00Z'),
      durationSeconds: 3600,
      ...extra,
    });
    const unbilled = await TimeEntry.create(entry());
    const billed = await TimeEntry.create(entry({ invoiceId: new mongoose.Types.ObjectId() }));

    const res = await api('patch', `/api/projects/${project._id}`, tokenA, { clientId: globex._id });
    expect(res.status).toBe(200);

    expect(String((await TimeEntry.findById(unbilled._id)).clientId)).toBe(globex._id);
    expect(String((await TimeEntry.findById(billed._id)).clientId)).toBe(acme._id);

    // renaming alone doesn't touch entries
    await api('patch', `/api/projects/${project._id}`, tokenA, { name: 'Renamed' });
    expect(String((await TimeEntry.findById(unbilled._id)).clientId)).toBe(globex._id);
  });
});

describe('validation', () => {
  it('rejects invalid hourlyRate values with a field error', async () => {
    const client = await createClient(tokenA);

    const cases = [
      [{ hourlyRate: -1 }, 'Hourly rate cannot be negative'],
      [{ hourlyRate: 10001 }, 'Hourly rate cannot be more than 10000'],
      [{ hourlyRate: 'abc' }, 'Hourly rate must be a number'],
      [{ hourlyRate: undefined }, 'Hourly rate is required'],
    ];

    for (const [override, message] of cases) {
      const res = await createProject(tokenA, client._id, override);
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([{ path: 'hourlyRate', message }]);
    }
    expect(await Project.countDocuments()).toBe(0);
  });

  it('accepts the boundary rates 0 and 10000', async () => {
    const client = await createClient(tokenA);
    expect((await createProject(tokenA, client._id, { name: 'Free', hourlyRate: 0 })).status).toBe(201);
    expect((await createProject(tokenA, client._id, { name: 'Max', hourlyRate: 10000 })).status).toBe(201);
  });

  it('validates client and project fields', async () => {
    const badClient = await api('post', '/api/clients', tokenA, { name: 'A', email: 'nope' });
    expect(badClient.status).toBe(400);
    expect(badClient.body.errors.map((e) => e.path).sort()).toEqual(['email', 'name']);

    const client = await createClient(tokenA);
    const badProject = await createProject(tokenA, client._id, { name: 'x', color: 'red' });
    expect(badProject.status).toBe(400);
    expect(badProject.body.errors.map((e) => e.path).sort()).toEqual(['color', 'name']);

    const noClient = await api('post', '/api/projects', tokenA, { name: 'Valid name', hourlyRate: 10 });
    expect(noClient.status).toBe(400);
    expect(noClient.body.errors).toEqual([{ path: 'clientId', message: 'Client is required' }]);
  });

  it('lets a client email be cleared with an empty string', async () => {
    const client = await createClient(tokenA, { name: 'Acme', email: 'a@acme.com' });
    const res = await api('patch', `/api/clients/${client._id}`, tokenA, { email: '' });
    expect(res.status).toBe(200);
    expect(res.body.client.email).toBe('');
  });

  it('returns 400 "Invalid id" for malformed ids', async () => {
    for (const url of ['/api/clients/not-an-id', '/api/projects/123']) {
      const patch = await api('patch', url, tokenA, { name: 'Whatever' });
      expect(patch.status).toBe(400);
      expect(patch.body.message).toBe('Invalid id');

      const del = await api('delete', url, tokenA);
      expect(del.status).toBe(400);
    }
  });

  it('requires authentication', async () => {
    for (const [method, url] of [
      ['get', '/api/clients'],
      ['post', '/api/clients'],
      ['get', '/api/projects'],
      ['post', '/api/projects'],
    ]) {
      expect((await api(method, url, null, { name: 'x' })).status).toBe(401);
    }
  });
});
