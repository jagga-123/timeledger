// Runs the real `npm run seed` command (node src/seed.js) against a throwaway in-memory replica set.
// Never touches the Atlas database from backend/.env: MONGODB_URI is overridden in the child's environment.
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
import { writeFileSync } from 'node:fs';

const BACKEND = 'C:/Users/sande/OneDrive/Desktop/timeledger/backend';
const OUT = process.argv[2];
const require = createRequire(BACKEND + '/package.json');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
const uri = replSet.getUri('timeledger-seed-demo');
const log = [];
const say = (line = '') => { console.log(line); log.push(line); };

// async on purpose: a blocking spawnSync would stop this process from reading the in-memory mongod's output, and mongod then stalls
const seed = async (label, extraEnv = {}) => {
  let code = 0, out = '', err = '';
  try {
    ({ stdout: out, stderr: err } = await run('node', ['src/seed.js'], { cwd: BACKEND, env: { ...process.env, MONGODB_URI: uri, ...extraEnv }, timeout: 90000 }));
  } catch (e) {
    code = e.code ?? 1; out = e.stdout ?? ''; err = e.stderr ?? '';
  }
  say(`$ ${label}   (exit code ${code})`);
  say((out + err).trimEnd());
  say();
  return { code, out };
};

const first = await seed('npm run seed');
const second = await seed('npm run seed   (again)');
say(`Second run printed exactly the same summary: ${first.out === second.out}`);
say();
await seed('NODE_ENV=production npm run seed', { NODE_ENV: 'production' });
await seed('NODE_ENV=production SEED_ALLOW=true npm run seed', { NODE_ENV: 'production', SEED_ALLOW: 'true' });

await replSet.stop();
if (OUT) writeFileSync(OUT, log.join('\n') + '\n');
