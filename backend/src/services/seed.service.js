import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import Client from '../models/Client.js';
import Counter from '../models/Counter.js';
import Invoice from '../models/Invoice.js';
import Project from '../models/Project.js';
import TimeEntry from '../models/TimeEntry.js';
import User from '../models/User.js';
import { roundToCents } from '../utils/money.js';
import * as invoiceService from './invoice.service.js';

// Demo data for reviewers: one user, three clients, about four weeks of time entries and two invoices.
// Running it again wipes and recreates ONLY this user's data; nobody else's data is ever touched.

export const DEMO_USER = Object.freeze({
  name: 'Alex Morgan',
  email: 'demo@timeledger.app',
  password: 'Demo@1234',
  timezone: 'Asia/Kolkata',
  currency: 'USD',
});

const CLIENTS = [
  { key: 'acme', name: 'Acme Corp', company: 'Acme Corporation', email: 'accounts@acme.example' },
  { key: 'globex', name: 'Globex Ltd', company: 'Globex Limited', email: 'billing@globex.example' },
  { key: 'initech', name: 'Initech', company: 'Initech Inc.', email: 'finance@initech.example' },
];

const PROJECTS = [
  {
    key: 'website',
    client: 'acme',
    name: 'Website redesign',
    hourlyRate: 45,
    color: '#4F46E5',
    tasks: ['Homepage hero section', 'Responsive navigation', 'Pricing page layout', 'Contact form validation', 'Blog template', 'Accessibility fixes', 'Footer and legal pages', 'Cross-browser testing', 'Performance tuning'],
  },
  {
    key: 'mobile',
    client: 'acme',
    name: 'Mobile app',
    hourlyRate: 60,
    color: '#10B981',
    tasks: ['Login screen', 'Push notifications', 'Offline sync', 'Profile settings screen', 'Bug fixes', 'Onboarding flow', 'Dark mode support', 'Crash reporting setup', 'App store assets'],
  },
  {
    key: 'brand',
    client: 'globex',
    name: 'Brand identity',
    hourlyRate: 80,
    color: '#F59E0B',
    tasks: ['Logo concepts', 'Colour palette', 'Typography system', 'Brand guidelines draft', 'Business card layout', 'Social media templates', 'Presentation template', 'Logo revisions'],
  },
  {
    key: 'api',
    client: 'initech',
    name: 'API integration',
    hourlyRate: 55,
    color: '#0EA5E9',
    tasks: ['OAuth integration', 'Webhook handler', 'Rate limit handling', 'Data mapping', 'API documentation', 'Sandbox testing', 'Error handling', 'Retry logic', 'Bug fixes'],
  },
];

const NON_BILLABLE_TASKS = ['Client call', 'Weekly sync call', 'Admin and invoicing', 'Scoping a new feature'];

// Minutes, from 30 minutes to 3 hours. Not all of them are on a quarter hour, so the 15 minute
// rounding rule has something to round when a reviewer tries it.
const DURATIONS = [32, 38, 45, 52, 67, 75, 95, 110, 128, 150, 172];

const WEEKS_BACK = 4; // entries start on the Monday four weeks before this week's Monday
const dateKey = (dateTime) => dateTime.toFormat('yyyy-MM-dd');

// Same numbers every time for the same seed, so the demo data (and the tests) don't change between runs
const randomGenerator = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const assertSeedAllowed = (env = process.env) => {
  if (env.NODE_ENV === 'production' && env.SEED_ALLOW !== 'true') {
    throw new Error('Refusing to seed: NODE_ENV is "production". Set SEED_ALLOW=true if you really mean it.');
  }
};

// ----- time entries -----

// Weekdays from four weeks ago up to now: 2-4 entries a day, never in the future, plus one that crosses midnight
const buildEntries = ({ now, userId, projectByKey }) => {
  const today = now.startOf('day');
  const thisMonday = today.minus({ days: today.weekday - 1 });
  const weekStart = (weeksAgo) => thisMonday.minus({ weeks: weeksAgo });
  const entries = [];

  const add = (project, description, billable, start, minutes, rng) => {
    const end = start.plus({ minutes });
    entries.push({
      userId,
      projectId: project._id,
      clientId: project.clientId,
      description,
      billable,
      startedAt: start.toJSDate(),
      endedAt: end.toJSDate(),
      durationSeconds: minutes * 60,
      source: rng() < 0.7 ? 'timer' : 'manual',
    });
    return end;
  };

  for (let weeksAgo = WEEKS_BACK; weeksAgo >= 0; weeksAgo--) {
    // Acme only becomes a client in the second week, so the oldest week is Globex and Initech work
    const projectKeys = weeksAgo === WEEKS_BACK ? ['brand', 'brand', 'api'] : ['website', 'website', 'mobile', 'mobile', 'brand', 'api'];

    for (let day = 0; day < 5; day++) {
      const date = weekStart(weeksAgo).plus({ days: day });
      if (date > today) continue;

      const rng = randomGenerator(weeksAgo * 10 + day + 1);
      let cursor = date.set({ hour: 9 }).plus({ minutes: Math.floor(rng() * 4) * 15 });
      const used = new Set();
      const count = 2 + Math.floor(rng() * 3);

      for (let slot = 0; slot < count; slot++) {
        const project = projectByKey[slot === 0 && weeksAgo === WEEKS_BACK ? 'brand' : projectKeys[Math.floor(rng() * projectKeys.length)]];
        const minutes = DURATIONS[Math.floor(rng() * DURATIONS.length)];
        const billable = rng() >= 0.1;

        let description;
        const pool = billable ? project.tasks : NON_BILLABLE_TASKS;
        for (let tries = 0; tries < pool.length; tries++) {
          description = pool[Math.floor(rng() * pool.length)];
          if (!used.has(description)) break;
        }
        used.add(description);

        // Today only gets what has already finished
        if (cursor.plus({ minutes }) > now.minus({ minutes: 5 })) break;

        cursor = add(project, description, billable, cursor, minutes, rng).plus({ minutes: slot === 1 ? 45 : 10 + Math.floor(rng() * 4) * 5 });
      }
    }
  }

  // One entry that crosses midnight: a late-night release on Wednesday last week, 23:15 to 01:00
  const lateStart = weekStart(1).plus({ days: 2 }).set({ hour: 23, minute: 15 });
  add(projectByKey.mobile, 'Production release (late-night deploy)', true, lateStart, 105, randomGenerator(99));

  return entries;
};

// ----- invoices -----

// Invoices are created by the real invoice service (so their entries are claimed exactly like in the app).
// Only the dates are then set to when such an invoice would realistically have been issued and paid.
const createInvoice = async ({ userId, clientId, from, to, notes, statuses, paidAfterDays }) => {
  const invoice = await invoiceService.create(userId, { clientId, from: dateKey(from), to: dateKey(to), notes });
  for (const status of statuses) {
    await invoiceService.updateStatus(userId, invoice._id, status);
  }

  const issuedAt = to.plus({ days: 1 }).set({ hour: 10 }); // the morning after the period ends
  await Invoice.updateOne(
    { _id: invoice._id },
    {
      $set: {
        issuedAt: issuedAt.toJSDate(),
        dueDate: issuedAt.plus({ days: 14 }).toJSDate(),
        sentAt: statuses.includes('sent') ? issuedAt.plus({ minutes: 30 }).toJSDate() : null,
        paidAt: statuses.includes('paid') ? issuedAt.plus({ days: paidAfterDays, hours: 5 }).toJSDate() : null,
      },
    }
  );
  return invoice._id;
};

// ----- the whole thing -----

export const seedDemo = async ({ now = DateTime.now() } = {}) => {
  const zone = DEMO_USER.timezone;
  const today = now.setZone(zone);

  // The user is kept (same id, so a logged-in demo session survives a re-seed) but reset to a known state
  const passwordHash = await bcrypt.hash(DEMO_USER.password, 10);
  const user = await User.findOneAndUpdate(
    { email: DEMO_USER.email },
    { $set: { name: DEMO_USER.name, passwordHash, timezone: zone, currency: DEMO_USER.currency } },
    { upsert: true, returnDocument: 'after' }
  );
  const userId = user._id;

  // Only this user's data is removed
  const own = { userId };
  await Promise.all([
    TimeEntry.deleteMany(own),
    Invoice.deleteMany(own),
    Counter.deleteMany(own),
    Project.deleteMany(own),
    Client.deleteMany(own),
  ]);

  const clients = await Client.create(CLIENTS.map(({ name, company, email }) => ({ userId, name, company, email })));
  const clientByKey = Object.fromEntries(CLIENTS.map((client, index) => [client.key, clients[index]]));

  const projects = await Project.create(
    PROJECTS.map(({ client, name, hourlyRate, color }) => ({ userId, clientId: clientByKey[client]._id, name, hourlyRate, color }))
  );
  const projectByKey = Object.fromEntries(
    PROJECTS.map((project, index) => [project.key, { _id: projects[index]._id, clientId: projects[index].clientId, tasks: project.tasks }])
  );

  await TimeEntry.insertMany(buildEntries({ now: today, userId, projectByKey }));

  // Globex: the week four weeks ago, paid. Acme: three and two weeks ago, sent. The last two weeks stay unbilled.
  const thisMonday = today.startOf('day').minus({ days: today.weekday - 1 });
  const weekStart = (weeksAgo) => thisMonday.minus({ weeks: weeksAgo });
  await createInvoice({
    userId,
    clientId: clientByKey.globex._id,
    from: weekStart(4),
    to: weekStart(4).plus({ days: 6 }),
    notes: 'Thank you for your business. Payment by bank transfer within 14 days.',
    statuses: ['sent', 'paid'],
    paidAfterDays: 9,
  });
  await createInvoice({
    userId,
    clientId: clientByKey.acme._id,
    from: weekStart(3),
    to: weekStart(2).plus({ days: 6 }),
    notes: 'Thank you for your business. Payment by bank transfer within 14 days.',
    statuses: ['sent'],
  });

  return summarize({ user, zone });
};

// What now exists for the demo user (read back from the database, so it is what a reviewer will really see)
const summarize = async ({ user, zone }) => {
  const userId = user._id;
  const [entries, projects, invoices] = await Promise.all([
    TimeEntry.find({ userId }).sort({ startedAt: 1 }),
    Project.find({ userId }),
    Invoice.find({ userId }).sort({ number: 1 }),
  ]);
  const rateByProject = new Map(projects.map((project) => [String(project._id), project.hourlyRate]));

  const sum = (list) => list.reduce((total, entry) => total + entry.durationSeconds, 0);
  const billable = entries.filter((entry) => entry.billable);
  const unbilled = billable.filter((entry) => !entry.invoiceId);

  return {
    user: { id: String(user._id), name: user.name, email: user.email, timezone: zone, currency: user.currency },
    clients: await Client.countDocuments({ userId }),
    projects: projects.length,
    entries: {
      total: entries.length,
      billable: billable.length,
      nonBillable: entries.length - billable.length,
      trackedSeconds: sum(entries),
      from: dateKey(DateTime.fromJSDate(entries[0].startedAt, { zone })),
      to: dateKey(DateTime.fromJSDate(entries.at(-1).startedAt, { zone })),
    },
    invoices: invoices.map((invoice) => ({
      number: invoice.number,
      client: invoice.client.name,
      status: invoice.status,
      period: `${invoice.periodStart} to ${invoice.periodEnd}`,
      entryCount: invoice.entryIds.length,
      total: invoice.total,
    })),
    unbilled: {
      entries: unbilled.length,
      seconds: sum(unbilled),
      amount: roundToCents(unbilled.reduce((total, entry) => total + (entry.durationSeconds / 3600) * rateByProject.get(String(entry.projectId)), 0)),
    },
  };
};

// ----- for the command line -----

const hoursAndMinutes = (seconds) => `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`;
const money = (amount, currency) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

export const formatSummary = (summary) => {
  const { user, entries, invoices, unbilled } = summary;
  return [
    `Demo data created for ${user.name} (${user.email}, ${user.timezone}, ${user.currency})`,
    `  Clients:   ${summary.clients}`,
    `  Projects:  ${summary.projects}`,
    `  Entries:   ${entries.total} from ${entries.from} to ${entries.to} (${entries.billable} billable, ${entries.nonBillable} non-billable, ${hoursAndMinutes(entries.trackedSeconds)} tracked)`,
    '  Invoices:',
    ...invoices.map((invoice) => `    ${invoice.number}  ${invoice.client}  ${invoice.period}  ${money(invoice.total, user.currency)}  ${invoice.status.toUpperCase()}  (${invoice.entryCount} entries)`),
    `  Unbilled:  ${unbilled.entries} billable entries, ${hoursAndMinutes(unbilled.seconds)}, ${money(unbilled.amount, user.currency)} ready to invoice`,
    '  Running timer: none',
    '',
    `Log in with ${user.email} / ${DEMO_USER.password}`,
  ].join('\n');
};
