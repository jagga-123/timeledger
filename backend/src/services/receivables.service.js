import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import Client from '../models/Client.js';
import Invoice from '../models/Invoice.js';
import Project from '../models/Project.js';
import TimeEntry from '../models/TimeEntry.js';
import User from '../models/User.js';
import { HttpError } from '../utils/httpError.js';
import { roundToCents } from '../utils/money.js';
import { usableZone } from '../utils/timezone.js';
import { overdueDays, withDisplayStatus } from './invoiceStatus.js';

// "Who owes me what". Everything here is worked out from the user's own invoices and entries each time (nothing is stored),
// in the user's own time zone, so "overdue", "this month" and "days to pay" agree with what the rest of the app shows.
//
// Only invoices that were sent or paid count: a draft has not been asked for yet. "Outstanding" is every sent invoice that
// is not paid (overdue ones included); "overdue" is the part of it that is past its due date (due today is NOT overdue).

export const PAID_WINDOW_DAYS = 90; // the average days to get paid looks at invoices paid in the last 90 days
const RECENT_PAYMENTS = 5;

// Where an unpaid invoice goes in the aging breakdown, by how many days it is overdue
export const AGING_KEYS = ['current', '1-30', '31-60', '61+'];
export const agingKey = (daysOverdue) => {
  if (daysOverdue <= 0) return 'current'; // not due yet, or due today
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  return '61+';
};

const owner = async (userId) => {
  const user = await User.findById(userId).select('timezone currency');
  return { zone: usableZone(user?.timezone), currency: user?.currency ?? 'USD' };
};

const sumTotals = (invoices) => roundToCents(invoices.reduce((total, invoice) => total + invoice.total, 0));
const oneDecimal = (value) => Math.round(value * 10) / 10;

// Whole days from when it was sent (when it was issued, for an invoice that was marked paid without being sent) to when it was paid,
// counted on the calendar in the owner's time zone
const daysToPay = (invoice, zone) => {
  const from = DateTime.fromJSDate(invoice.sentAt ?? invoice.issuedAt, { zone }).startOf('day');
  const to = DateTime.fromJSDate(invoice.paidAt, { zone }).startOf('day');
  return Math.max(0, Math.round(to.diff(from, 'days').days));
};

const averageDaysToPay = (paidInvoices, zone) =>
  paidInvoices.length === 0 ? null : oneDecimal(paidInvoices.reduce((total, invoice) => total + daysToPay(invoice, zone), 0) / paidInvoices.length);

// The invoices that count: sent and paid ones of this user, as plain objects with only what the numbers need
const loadInvoices = (userId, extra = {}) =>
  Invoice.find({ userId, status: { $in: ['sent', 'paid'] }, ...extra })
    .select('clientId number status total dueDate issuedAt sentAt paidAt client.name')
    .lean();

// ----- the numbers of one client (or of a list of invoices) -----

const invoiceMetrics = (invoices, zone, now) => {
  const sent = invoices.filter((invoice) => invoice.status === 'sent');
  const paid = invoices.filter((invoice) => invoice.status === 'paid');
  const overdue = sent.map((invoice) => ({ invoice, days: overdueDays(invoice, zone, now) })).filter(({ days }) => days > 0);
  const payments = paid.filter((invoice) => invoice.paidAt);

  return {
    invoicedTotal: sumTotals(invoices),
    paidTotal: sumTotals(paid),
    outstanding: sumTotals(sent),
    overdueAmount: sumTotals(overdue.map(({ invoice }) => invoice)),
    overdueCount: overdue.length,
    oldestOverdueDays: Math.max(0, ...overdue.map(({ days }) => days)),
    lastPaymentAt: payments.length > 0 ? new Date(Math.max(...payments.map((invoice) => invoice.paidAt.getTime()))) : null,
    avgDaysToPay: averageDaysToPay(payments, zone),
  };
};

// Billable, finished entries that are not on any invoice yet, worked out per client at their project's rate:
// { [clientId]: { amount, seconds, entries, from, to } } where from/to are the first and last day (YYYY-MM-DD, the owner's zone)
const unbilledByClient = async (userId, zone, clientId = null) => {
  const match = { userId: new mongoose.Types.ObjectId(userId), billable: true, invoiceId: null, endedAt: { $ne: null } };
  if (clientId) match.clientId = new mongoose.Types.ObjectId(clientId);

  const rows = await TimeEntry.aggregate([
    { $match: match },
    {
      $group: {
        _id: { clientId: '$clientId', projectId: '$projectId' },
        seconds: { $sum: '$durationSeconds' },
        entries: { $sum: 1 },
        first: { $min: '$startedAt' },
        last: { $max: '$startedAt' },
      },
    },
  ]);

  const projects = await Project.find({ userId, _id: { $in: rows.map((row) => row._id.projectId) } }).select('hourlyRate');
  const rateOf = new Map(projects.map((project) => [String(project._id), project.hourlyRate]));

  const unbilled = {};
  for (const row of rows) {
    const key = String(row._id.clientId);
    const entry = (unbilled[key] ??= { amount: 0, seconds: 0, entries: 0, first: row.first, last: row.last });
    entry.amount += (row.seconds / 3600) * (rateOf.get(String(row._id.projectId)) ?? 0);
    entry.seconds += row.seconds;
    entry.entries += row.entries;
    if (row.first < entry.first) entry.first = row.first;
    if (row.last > entry.last) entry.last = row.last;
  }

  return Object.fromEntries(
    Object.entries(unbilled).map(([key, { amount, seconds, entries, first, last }]) => [
      key,
      {
        amount: roundToCents(amount),
        seconds,
        entries,
        from: DateTime.fromJSDate(first, { zone }).toISODate(),
        to: DateTime.fromJSDate(last, { zone }).toISODate(),
      },
    ])
  );
};

const NO_UNBILLED = Object.freeze({ amount: 0, seconds: 0, entries: 0, from: null, to: null });

// ----- the dashboard -----

export const summary = async (userId, { now = DateTime.now() } = {}) => {
  const { zone, currency } = await owner(userId);
  const invoices = await loadInvoices(userId);
  const local = now.setZone(zone);

  const sent = invoices.filter((invoice) => invoice.status === 'sent');
  const paid = invoices.filter((invoice) => invoice.status === 'paid' && invoice.paidAt);

  // every unpaid invoice, with how late it is
  const unpaid = sent.map((invoice) => ({ invoice, days: overdueDays(invoice, zone, now) }));
  const overdue = unpaid.filter(({ days }) => days > 0);

  const aging = AGING_KEYS.map((key) => {
    const inBucket = unpaid.filter(({ days }) => agingKey(days) === key).map(({ invoice }) => invoice);
    return { key, amount: sumTotals(inBucket), count: inBucket.length };
  });

  // the one that has waited longest (on a tie: the earlier due date, then the lower number)
  const oldest = [...overdue].sort((a, b) => b.days - a.days || a.invoice.dueDate - b.invoice.dueDate || a.invoice.number.localeCompare(b.invoice.number))[0];

  const monthStart = local.startOf('month').toJSDate();
  const monthEnd = local.startOf('month').plus({ months: 1 }).toJSDate();
  const paidThisMonth = paid.filter((invoice) => invoice.paidAt >= monthStart && invoice.paidAt < monthEnd);

  const windowStart = now.minus({ days: PAID_WINDOW_DAYS }).toJSDate();
  const paidInWindow = paid.filter((invoice) => invoice.paidAt >= windowStart && invoice.paidAt <= now.toJSDate());

  return {
    currency,
    asOf: now.toUTC().toISO(),
    outstanding: { amount: sumTotals(sent), count: sent.length },
    overdue: {
      amount: sumTotals(overdue.map(({ invoice }) => invoice)),
      count: overdue.length,
      oldest: oldest
        ? {
            invoiceId: oldest.invoice._id,
            number: oldest.invoice.number,
            clientId: oldest.invoice.clientId,
            clientName: oldest.invoice.client?.name ?? '',
            days: oldest.days,
            amount: oldest.invoice.total,
          }
        : null,
    },
    paidThisMonth: { amount: sumTotals(paidThisMonth), count: paidThisMonth.length },
    avgDaysToPay: { days: averageDaysToPay(paidInWindow, zone), count: paidInWindow.length, windowDays: PAID_WINDOW_DAYS },
    aging,
  };
};

// ----- the clients page -----

const byOverdueThenOutstanding = (a, b) =>
  b.overdueAmount - a.overdueAmount || b.outstanding - a.outstanding || a.client.name.localeCompare(b.client.name, 'en', { sensitivity: 'base' });

export const byClient = async (userId, { now = DateTime.now() } = {}) => {
  const { zone } = await owner(userId);
  const [clients, invoices, unbilled] = await Promise.all([
    Client.find({ userId }).select('name email company').lean(),
    loadInvoices(userId),
    unbilledByClient(userId, zone),
  ]);

  const invoicesOf = new Map();
  for (const invoice of invoices) {
    const key = String(invoice.clientId);
    if (!invoicesOf.has(key)) invoicesOf.set(key, []);
    invoicesOf.get(key).push(invoice);
  }

  return clients
    .map((client) => ({
      client: { _id: client._id, name: client.name, email: client.email ?? '', company: client.company ?? '' },
      ...invoiceMetrics(invoicesOf.get(String(client._id)) ?? [], zone, now),
      unbilledAmount: (unbilled[String(client._id)] ?? NO_UNBILLED).amount,
    }))
    .sort(byOverdueThenOutstanding);
};

// ----- one client -----

export const clientDetail = async (userId, clientId, { now = DateTime.now() } = {}) => {
  // someone else's client looks exactly like a missing one
  const client = await Client.findOne({ _id: clientId, userId }).select('-__v');
  if (!client) throw new HttpError(404, 'Client not found');

  const { zone } = await owner(userId);
  const [documents, unbilledAll] = await Promise.all([
    Invoice.find({ userId, clientId }).select('-lineItems -entryIds').sort({ issuedAt: -1, number: -1 }),
    unbilledByClient(userId, zone, clientId),
  ]);

  const invoices = documents.map((invoice) => withDisplayStatus(invoice, zone, now)); // with displayStatus and daysOverdue
  const unbilled = unbilledAll[String(client._id)] ?? NO_UNBILLED;

  const lastPayments = invoices
    .filter((invoice) => invoice.status === 'paid' && invoice.paidAt)
    .sort((a, b) => b.paidAt - a.paidAt)
    .slice(0, RECENT_PAYMENTS)
    .map((invoice) => ({ invoiceId: invoice._id, number: invoice.number, amount: invoice.total, paidAt: invoice.paidAt }));

  return {
    client,
    metrics: { ...invoiceMetrics(invoices.filter((invoice) => invoice.status !== 'draft'), zone, now), unbilledAmount: unbilled.amount },
    unbilled,
    invoices,
    lastPayments,
  };
};
