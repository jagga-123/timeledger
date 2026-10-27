// Starts the real backend (src/server.js) against a throwaway in-memory MongoDB and keeps running.
// Run from the backend dir. Uses its own port so it can never collide with (or silently talk to) a
// developer's own `npm run dev`, and never touches the Atlas DB from .env.
// The database is a one-node replica set because invoices use MongoDB transactions.
import net from 'node:net';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const PORT = process.env.E2E_BACKEND_PORT || '5100';
const FRONTEND_URL = process.env.E2E_FRONTEND_URL || 'http://localhost:5273';

// refuse to start if something is already listening on the port
const busy = await new Promise((resolve) => {
  const socket = net.createConnection({ port: Number(PORT), host: '127.0.0.1' });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});
if (busy) {
  console.error(`REFUSING TO START: port ${PORT} is already in use`);
  process.exit(1);
}

const require = createRequire(process.cwd() + '/package.json');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGODB_URI = mongod.getUri('timeledger-e2e'); // set before server.js loads dotenv, which never overrides it
process.env.PORT = PORT;
process.env.FRONTEND_URL = FRONTEND_URL;
process.env.JWT_SECRET = 'e2e-secret';
process.env.JWT_EXPIRES_IN = '1h';

// Let test scripts reach the throwaway database (e.g. to mark an entry as billed, which no API can do yet)
if (process.env.E2E_MONGO_URI_FILE) {
  (await import('node:fs')).writeFileSync(process.env.E2E_MONGO_URI_FILE, process.env.MONGODB_URI);
}

await import(pathToFileURL(process.cwd() + '/src/server.js').href);
console.log(`E2E backend ready on port ${PORT} (in-memory MongoDB replica set)`);

process.on('SIGTERM', async () => { await mongod.stop(); process.exit(0); });
