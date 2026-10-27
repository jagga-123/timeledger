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
