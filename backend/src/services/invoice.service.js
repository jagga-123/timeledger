import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import Client from '../models/Client.js';
import Counter from '../models/Counter.js';
import Invoice from '../models/Invoice.js';
import Project from '../models/Project.js';
import TimeEntry from '../models/TimeEntry.js';
import User from '../models/User.js';
import { HttpError } from '../utils/httpError.js';
import { roundToCents } from '../utils/money.js';
import { roundUp } from '../utils/rounding.js';
import { usableZone } from '../utils/timezone.js';

// Invoices bill unbilled, billable time for one client and one date range.
//
// THE RULE: an entry can never be on two invoices, not even when two requests arrive at the same moment.
// create() therefore CLAIMS entries first: one updateMany that only matches entries whose invoiceId is
// still null and sets it to the new invoice's id. MongoDB applies that to each entry exactly once, so a
// second request simply cannot match an entry that is already claimed. Everything (claim, invoice number,
// invoice document) runs in one transaction, so it is all or nothing.

const DUE_DAYS = 14;
const MAX_RANGE_DAYS = 366;

const nothingToBill = () => new HttpError(400, 'No unbilled billable time for this client in this period');
const fieldError = (path, message) => new HttpError(400, message, [{ path, message }]);

// Transactions only exist on a replica set (MongoDB Atlas is one). A plain local mongod isn't.
const inTransaction = async (work) => {
  try {
    return await mongoose.connection.transaction(work);
  } catch (err) {
    if (/replica set member or mongos/.test(err?.message ?? '')) {
      throw new HttpError(
        503,
        'Invoices need MongoDB transactions. MongoDB Atlas supports them; a local MongoDB must run as a replica set.'
      );
    }
    throw err;
  }
};

// Checks the request and turns the two dates into [start, end) in the user's own time zone
const prepare = async (userId, { clientId, from, to }) => {
  const user = await User.findById(userId).select('name email timezone currency roundingMinutes');
  const zone = usableZone(user.timezone);

  const client = await Client.findOne({ _id: clientId, userId });
  if (!client) {
    throw fieldError('clientId', 'Client not found');
  }

  const first = DateTime.fromISO(from, { zone }).startOf('day');
  const last = DateTime.fromISO(to, { zone }).startOf('day');
  if (last < first) {
    throw fieldError('to', 'The end date must not be before the start date');
  }
  if (last.diff(first, 'days').days + 1 > MAX_RANGE_DAYS) {
    throw fieldError('to', `A period can be at most ${MAX_RANGE_DAYS} days`);
  }
  if (last > DateTime.now().setZone(zone).startOf('day')) {
    throw fieldError('to', "The end date can't be after today");
  }

  // Both dates are included: from 00:00 on the first day up to (not including) 00:00 the day after the last.
  // plus({ days }) keeps this right across daylight saving changes.
  // The rounding rule is the one the user has switched on right now; the invoice remembers it
  return { user, zone, client, roundingMinutes: user.roundingMinutes ?? 0, start: first, end: last.plus({ days: 1 }) };
};

// Which entries an invoice for this client and period would take
const billableFilter = (userId, clientId, start, end) => ({
  userId,
  clientId,
  billable: true,
  invoiceId: null,
  endedAt: { $ne: null }, // a running timer is never billed
  startedAt: { $gte: start.toJSDate(), $lt: end.toJSDate() },
});

// One line per project, with amounts rounded to cents. With rounding on, every ENTRY is first rounded up
// (7 min and 22 min become 15 + 30 = 45 min); the entries themselves keep their real duration.
const buildLineItems = async (entries, { roundingMinutes = 0, session } = {}) => {
  const projectIds = [...new Set(entries.map((entry) => String(entry.projectId)))];
  const projects = await Project.find({ _id: { $in: projectIds } }).session(session ?? null);
  const projectById = new Map(projects.map((project) => [String(project._id), project]));

  const secondsByProject = new Map();
  for (const entry of entries) {
    const key = String(entry.projectId);
    const totals = secondsByProject.get(key) ?? { rawSeconds: 0, billedSeconds: 0 };
    totals.rawSeconds += entry.durationSeconds;
    totals.billedSeconds += roundUp(entry.durationSeconds, roundingMinutes);
    secondsByProject.set(key, totals);
  }

  const lineItems = [...secondsByProject].map(([projectId, { rawSeconds, billedSeconds }]) => {
    const project = projectById.get(projectId);
    return {
      projectId: project._id,
      projectName: project.name,
      hourlyRate: project.hourlyRate,
      rawSeconds,
      billedSeconds,
      hours: roundToCents(billedSeconds / 3600),
      amount: roundToCents((billedSeconds / 3600) * project.hourlyRate),
    };
  });
  lineItems.sort((a, b) => a.projectName.localeCompare(b.projectName));

  // The invoice total is the sum of its (already rounded) lines, so the lines always add up to it
  const total = roundToCents(lineItems.reduce((sum, line) => sum + line.amount, 0));
  return { lineItems, total, projectById };
};

// The entries as shown on a preview or an invoice page (durationSeconds is what was tracked, billedSeconds what is billed)
const describeEntries = (entries, projectById, roundingMinutes = 0) =>
  entries
    .slice()
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((entry) => ({
      _id: entry._id,
      projectId: entry.projectId,
      projectName: projectById.get(String(entry.projectId))?.name ?? '',
      description: entry.description,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      durationSeconds: entry.durationSeconds,
      billedSeconds: roundUp(entry.durationSeconds, roundingMinutes),
    }));

// ----- preview: what an invoice would contain, without saving anything -----

export const preview = async (userId, { clientId, from, to }) => {
  const { user, zone, client, roundingMinutes, start, end } = await prepare(userId, { clientId, from, to });

  const entries = await TimeEntry.find(billableFilter(userId, clientId, start, end));
  if (entries.length === 0) {
    throw nothingToBill();
  }

  const { lineItems, total, projectById } = await buildLineItems(entries, { roundingMinutes });
  return {
    client: { _id: client._id, name: client.name, email: client.email ?? '', company: client.company ?? '' },
    from,
    to,
    timezone: zone,
    currency: user.currency,
    roundingMinutes,
    lineItems,
    subtotal: total,
    total,
    entryCount: entries.length,
    entries: describeEntries(entries, projectById, roundingMinutes),
  };
};

// ----- create -----

export const create = async (userId, { clientId, from, to, notes }) => {
  const { user, zone, client, roundingMinutes, start, end } = await prepare(userId, { clientId, from, to });

  return inTransaction(async (session) => {
    // The work below can run more than once (MongoDB retries a transaction that hit a write conflict),
    // so everything it needs is created inside.
    const invoiceId = new mongoose.Types.ObjectId();

    // a) + b) Claim the entries. The filter needs invoiceId: null, so each entry can be claimed only once;
    //    a request running at the same moment waits on the same entries and then finds them already claimed.
    const claim = await TimeEntry.updateMany(
      billableFilter(userId, clientId, start, end),
      { $set: { invoiceId } },
      { session }
    );

    // d) Nothing claimed: nothing to bill (the transaction ends without changing anything)
    if (claim.modifiedCount === 0) {
      throw nothingToBill();
    }

    // c) Read back ONLY what this request claimed, and build the invoice from exactly that
    const entries = await TimeEntry.find({ userId, invoiceId }).session(session);
    const { lineItems, total } = await buildLineItems(entries, { roundingMinutes, session });

    const counter = await Counter.findOneAndUpdate(
      { userId, name: 'invoice' },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after', session }
    );

    const issuedAt = DateTime.now().setZone(zone);

    // e) Save the invoice under the id the entries point to. If this (or anything above) throws, the
    //    transaction is rolled back, which releases the claimed entries again and gives the number back.
    const [invoice] = await Invoice.create(
      [
        {
          _id: invoiceId,
          userId,
          clientId,
          number: `INV-${String(counter.seq).padStart(4, '0')}`,
          periodStart: from,
          periodEnd: to,
          timezone: zone,
          issuedAt: issuedAt.toJSDate(),
          dueDate: issuedAt.plus({ days: DUE_DAYS }).toJSDate(),
          client: { name: client.name, email: client.email ?? '', company: client.company ?? '' },
          from: { name: user.name, email: user.email },
          lineItems,
          entryIds: entries.map((entry) => entry._id),
          subtotal: total,
          total,
          currency: user.currency,
          roundingMinutes,
          notes,
        },
      ],
      { session }
    );

    return invoice;
  });
};

// ----- reading -----

export const list = (userId, { status, clientId }) => {
  const filter = { userId };
  if (status) filter.status = status;
  if (clientId) filter.clientId = clientId;

  // The list doesn't need the lines and entries of every invoice
  return Invoice.find(filter).select('-lineItems -entryIds').sort({ issuedAt: -1, number: -1 });
};

export const getOne = async (userId, id) => {
  const invoice = await Invoice.findOne({ _id: id, userId });
  if (!invoice) {
    throw new HttpError(404, 'Invoice not found');
  }

  const entries = await TimeEntry.find({ _id: { $in: invoice.entryIds }, userId });
  const projectById = new Map(
    (await Project.find({ _id: { $in: entries.map((entry) => entry.projectId) } })).map((project) => [String(project._id), project])
  );

  // Entries on an invoice are locked, so working the billed time out again gives what was billed
  return { invoice, entries: describeEntries(entries, projectById, invoice.roundingMinutes ?? 0) };
};

// ----- status -----

// target status -> the statuses it may be reached from
const ALLOWED_FROM = { sent: ['draft'], paid: ['draft', 'sent'] };

export const updateStatus = async (userId, id, status) => {
  const allowedFrom = ALLOWED_FROM[status] ?? [];
  const changes = { status };
  if (status === 'sent') changes.sentAt = new Date();
  if (status === 'paid') changes.paidAt = new Date();

  // One atomic update that only matches an invoice in an allowed status
  const invoice = await Invoice.findOneAndUpdate(
    { _id: id, userId, status: { $in: allowedFrom } },
    { $set: changes },
    { returnDocument: 'after' }
  ).select('-lineItems -entryIds');
  if (invoice) return invoice;

  const current = await Invoice.findOne({ _id: id, userId }).select('status');
  if (!current) {
    throw new HttpError(404, 'Invoice not found');
  }
  throw new HttpError(409, `Can't change status from ${current.status} to ${status}`);
};

// ----- delete -----

export const remove = async (userId, id) => {
  await inTransaction(async (session) => {
    const invoice = await Invoice.findOneAndDelete({ _id: id, userId, status: 'draft' }, { session });

    if (!invoice) {
      const exists = await Invoice.exists({ _id: id, userId }).session(session);
      throw exists ? new HttpError(409, 'Only draft invoices can be deleted') : new HttpError(404, 'Invoice not found');
    }

    // Give the entries back so they can be invoiced again (the invoice number is not reused)
    await TimeEntry.updateMany({ userId, invoiceId: invoice._id }, { $set: { invoiceId: null } }, { session });
  });
};
