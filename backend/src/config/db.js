import dns from 'node:dns';
import mongoose from 'mongoose';

const DEFAULT_DNS_SERVERS = ['8.8.8.8', '1.1.1.1'];

// On some Windows setups Node's resolver can't look up the SRV record behind
// mongodb+srv:// URIs ("querySrv ECONNREFUSED"). Use public DNS servers instead.
// Override with DNS_SERVERS=ip1,ip2 (comma-separated).
const setDnsServers = () => {
  const configured = (process.env.DNS_SERVERS || '')
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);

  dns.setServers(configured.length > 0 ? configured : DEFAULT_DNS_SERVERS);
};

// Build every model's indexes before the server accepts requests. The "one running timer per user"
// rule is a unique index, so we must be sure it exists (and fail loudly at startup if it can't be built).
export const ensureIndexes = () =>
  Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));

export const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not defined');
  }

  setDnsServers();

  // Fail fast (instead of Mongoose's 30s default) when MongoDB isn't reachable
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log(`MongoDB connected: ${mongoose.connection.host}`);
};
