import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, ensureIndexes } from './config/db.js';
import { assertSeedAllowed, formatSummary, seedDemo } from './services/seed.service.js';

// npm run seed: creates (or resets) the demo user and her data. See services/seed.service.js.
const run = async () => {
  try {
    assertSeedAllowed(); // before touching any database
    await connectDB();
    await ensureIndexes();
    console.log(formatSummary(await seedDemo()));
  } catch (err) {
    console.error(`Seed failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
