import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import User from '../models/User.js';

const validUser = { name: 'Asha Rao', email: 'asha@example.com', password: 'Passw0rd!' };

let mongod;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await User.init(); // make sure the unique email index exists
});

afterEach(async () => {
  await User.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const register = (body = validUser) => request(app).post('/api/auth/register').send(body);

describe('POST /api/auth/register', () => {
  it('creates a user and returns { user, token } without the password hash', async () => {
    const res = await register();

    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({
      name: 'Asha Rao',
      email: 'asha@example.com',
      timezone: 'Asia/Kolkata',
      currency: 'USD',
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.__v).toBeUndefined();

    const saved = await User.findOne({ email: 'asha@example.com' });
    expect(saved.passwordHash).not.toBe(validUser.password);
  });

  it('returns 409 for a duplicate email (case-insensitive)', async () => {
    await register();
    const res = await register({ ...validUser, email: 'ASHA@example.com' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: 'Email is already registered' });
  });

  it('returns 400 with field-wise errors for invalid input', async () => {
    const res = await register({ name: 'A', email: 'not-an-email', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    const fields = res.body.errors.map((e) => e.path).sort();
    expect(fields).toEqual(['email', 'name', 'password']);
  });
});

describe('POST /api/auth/login', () => {
  it('returns { user, token } for correct credentials', async () => {
    await register();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user.email).toBe(validUser.email);
  });

  it('returns 401 for a wrong password', async () => {
    await register();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Invalid email or password' });
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.message).toBeDefined();
  });

  it('returns 401 for an invalid token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt');

    expect(res.status).toBe(401);
  });

  it('returns the current user with a valid token', async () => {
    const { body } = await register();
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(validUser.email);
    expect(res.body.user.passwordHash).toBeUndefined();
  });
});

describe('PATCH /api/auth/me (time zone)', () => {
  const setTimezone = (token, timezone) =>
    request(app).patch('/api/auth/me').set('Authorization', `Bearer ${token}`).send({ timezone });

  it('saves a valid time zone, including names Intl.supportedValuesOf leaves out', async () => {
    const { body } = await register();
    expect(body.user.timezone).toBe('Asia/Kolkata'); // the default

    for (const timezone of ['America/New_York', 'Asia/Kolkata', 'Asia/Calcutta', 'UTC', 'Europe/London']) {
      const res = await setTimezone(body.token, timezone);
      expect(res.status).toBe(200);
      expect(res.body.user.timezone).toBe(timezone);
      expect(res.body.user.passwordHash).toBeUndefined();
    }

    const saved = await User.findOne({ email: validUser.email });
    expect(saved.timezone).toBe('Europe/London');
  });

  it('rejects an unknown time zone and a missing value', async () => {
    const { body } = await register();

    for (const timezone of ['Mars/Olympus_Mons', 'India', '+05:30', '']) {
      const res = await setTimezone(body.token, timezone);
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([{ path: 'timezone', message: 'Unknown time zone' }]);
    }

    const missing = await request(app).patch('/api/auth/me').set('Authorization', `Bearer ${body.token}`).send({});
    expect(missing.status).toBe(400);
    expect(missing.body.errors).toEqual([{ path: '', message: 'Send at least one of name, timezone or roundingMinutes' }]);

    expect((await User.findOne({ email: validUser.email })).timezone).toBe('Asia/Kolkata');
  });

  it('requires a token', async () => {
    const res = await request(app).patch('/api/auth/me').send({ timezone: 'UTC' });
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/auth/me (name and rounding rule)', () => {
  const patchMe = (token, body) => request(app).patch('/api/auth/me').set('Authorization', `Bearer ${token}`).send(body);

  it('has rounding off by default and saves 15 and 0', async () => {
    const { body } = await register();
    expect(body.user.roundingMinutes).toBe(0);

    const on = await patchMe(body.token, { roundingMinutes: 15 });
    expect(on.status).toBe(200);
    expect(on.body.user.roundingMinutes).toBe(15);
    expect((await User.findOne({ email: validUser.email })).roundingMinutes).toBe(15);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${body.token}`);
    expect(me.body.user.roundingMinutes).toBe(15);

    const off = await patchMe(body.token, { roundingMinutes: 0 });
    expect(off.body.user.roundingMinutes).toBe(0);
  });

  it('rejects any other rounding value', async () => {
    const { body } = await register();

    for (const roundingMinutes of [10, 30, -15, 15.5, '15', null, true]) {
      const res = await patchMe(body.token, { roundingMinutes });
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([{ path: 'roundingMinutes', message: 'Rounding must be 0 (off) or 15 minutes' }]);
    }
    expect((await User.findOne({ email: validUser.email })).roundingMinutes).toBe(0);
  });

  it('changes the name (trimmed) with the same rules as when registering', async () => {
    const { body } = await register();

    const ok = await patchMe(body.token, { name: '  Asha R. Rao  ' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.name).toBe('Asha R. Rao');

    const short = await patchMe(body.token, { name: 'A' });
    expect(short.body.errors).toEqual([{ path: 'name', message: 'Name must be at least 2 characters' }]);
    const long = await patchMe(body.token, { name: 'x'.repeat(51) });
    expect(long.body.errors).toEqual([{ path: 'name', message: 'Name must be at most 50 characters' }]);

    expect((await User.findOne({ email: validUser.email })).name).toBe('Asha R. Rao');
  });

  it('changes several things at once, needs at least one, and ignores everything else', async () => {
    const { body } = await register();

    const several = await patchMe(body.token, { name: 'New Name', timezone: 'Europe/London', roundingMinutes: 15 });
    expect(several.status).toBe(200);
    expect(several.body.user).toMatchObject({ name: 'New Name', timezone: 'Europe/London', roundingMinutes: 15 });

    const nothing = await patchMe(body.token, {});
    expect(nothing.status).toBe(400);
    expect(nothing.body.errors).toEqual([{ path: '', message: 'Send at least one of name, timezone or roundingMinutes' }]);

    // fields that are not meant to be changed here are dropped, not saved
    const sneaky = await patchMe(body.token, { name: 'Still Me', email: 'hacker@example.com', passwordHash: 'x', currency: 'EUR' });
    expect(sneaky.status).toBe(200);
    const saved = await User.findOne({ name: 'Still Me' });
    expect(saved).toMatchObject({ email: validUser.email, currency: 'USD' });
    expect(saved.passwordHash).not.toBe('x');
  });
});
