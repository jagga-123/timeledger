import { readFileSync, readdirSync } from 'node:fs';
import { isLocalDatabase } from '../services/seed.service.js';

// What the repository says about configuration: .env.example lists every setting the backend reads, with placeholders only,
// and the real .env files are never committed.
const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
// KEY=value lines; a commented-out "# KEY=value" counts as listed too (SEED_ALLOW is shown that way on purpose)
const parse = (text) => {
  const listed = new Set();
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    listed.add(match[2]);
    if (!match[1]) values[match[2]] = match[3];
  }
  return { listed, values };
};

const SETTINGS = [
  'PORT', 'NODE_ENV', 'MONGODB_URI', 'JWT_SECRET', 'JWT_EXPIRES_IN', 'FRONTEND_URL', 'APP_URL', 'EMAIL_PROVIDER',
  'BREVO_API_KEY', 'EMAIL_FROM', 'EMAIL_FROM_NAME', 'CRON_SECRET', 'DEMO_EMAIL', 'DNS_SERVERS',
];

// every .js file of the backend's source, without the tests
const sourceFiles = (dir = new URL('../', import.meta.url)) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return entry.name === 'tests' ? [] : sourceFiles(new URL(`${entry.name}/`, dir));
    return entry.name.endsWith('.js') ? [new URL(entry.name, dir)] : [];
  });

describe('backend/.env.example', () => {
  const example = parse(read('../../.env.example'));

  it('lists every setting that was asked for', () => {
    expect([...example.listed]).toEqual(expect.arrayContaining(SETTINGS));
  });

  it('lists every setting the backend code reads from the environment (so a new one can not be forgotten)', () => {
    const used = new Set();
    for (const file of sourceFiles()) {
      for (const [, name] of readFileSync(file, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) used.add(name);
    }

    expect(used.size).toBeGreaterThan(10);
    expect([...used].filter((name) => !example.listed.has(name))).toEqual([]);
  });

  it('has placeholders only: no real key, password or token', () => {
    const { values } = example;
    for (const key of ['JWT_SECRET', 'BREVO_API_KEY', 'CRON_SECRET']) expect([key, values[key]]).toEqual([key, expect.stringMatching(/^replace-with/)]);
    expect(values.EMAIL_FROM).toMatch(/^replace-with|@example\.com$/);
    // the database is a local one with no user name or password in it
    expect(isLocalDatabase(values.MONGODB_URI)).toBe(true);
    expect(values.MONGODB_URI).not.toContain('@');
    // and nothing in the whole file has the shape of a real secret
    const text = read('../../.env.example');
    expect(text).not.toMatch(/mongodb(\+srv)?:\/\/[^\s:@/]+:[^\s@]+@|xkeysib-|sk_live_|-----BEGIN|eyJ[A-Za-z0-9_-]{10,}\./);
  });

  it('is set up for local development: console e-mail, no keys, the demo e-mail, a local frontend', () => {
    const { values } = example;
    expect(values).toMatchObject({ NODE_ENV: 'development', EMAIL_PROVIDER: 'console', DEMO_EMAIL: 'demo@timeledger.app', FRONTEND_URL: 'http://localhost:5173', PORT: '5000' });
    expect(values.DNS_SERVERS).toBe('');
  });
});

describe('frontend/.env.example', () => {
  it('lists the API address and keeps the demo login hint off by default', () => {
    const { values } = parse(read('../../../frontend/.env.example'));
    expect(values.VITE_API_URL).toBe('http://localhost:5000/api');
    expect(values.VITE_SHOW_DEMO).toBe('false');
  });
});

describe('git', () => {
  it('ignores every .env file, so a real one is never committed', () => {
    const ignored = read('../../../.gitignore').split(/\r?\n/).map((line) => line.trim());
    expect(ignored).toContain('.env');
  });
});
