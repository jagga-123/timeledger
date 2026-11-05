import { DateTime } from 'luxon';
import Client from '../models/Client.js';
import Invoice from '../models/Invoice.js';
import ReminderLog from '../models/ReminderLog.js';
import User from '../models/User.js';
import { HttpError } from '../utils/httpError.js';
import { shareUrlFor } from '../utils/appUrl.js';
import { usableZone } from '../utils/timezone.js';
import { sendEmail } from './email.service.js';
import { renderReminderEmail } from './emailTemplates.js';
import { ensureShareToken } from './invoiceShare.service.js';
import { userZone, withDisplayStatus } from './invoiceStatus.js';

// Automatic payment reminders for invoices that were SENT and are not paid.
//
// Nothing here runs by itself: an external scheduler (a GitHub Action) calls POST /api/cron/reminders every hour,
// which is safe because every reminder is CLAIMED in ReminderLog (a unique row) before its e-mail goes out.
//
// For each invoice, in its OWNER's time zone, the schedule is:
//   before_due  the due date minus beforeDueDays      on_due  the due date      overdue  the due date plus each of afterDueDays
// A reminder is due on its day. If the job did not run that day (the server was asleep), a missed reminder is still
// sent for up to CATCH_UP_DAYS days, but only the LATEST one that is due, never a burst of old ones.
// A reminder is never scheduled for the day the invoice was (re)sent or earlier: the client has just seen it.

export const CATCH_UP_DAYS = 2;
export const MAX_ATTEMPTS = 3; // a reminder whose e-mail failed is tried again by the next runs, this many times in all
const MANUAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const asDateTime = (now) => (DateTime.isDateTime(now) ? now : DateTime.fromJSDate(now ?? new Date()));
const daysBetween = (from, to) => Math.round(to.diff(from, 'days').days);
const MAIL_ERROR = "Couldn't send the email. Try again.";

// The owner's settings, with the defaults for anybody who never changed them (also for users saved before reminders existed)
export const reminderSettings = (user) => {
  const reminders = user?.reminders ?? {};
  return {
    enabled: reminders.enabled ?? true,
    beforeDueDays: reminders.beforeDueDays ?? 3,
    onDueDate: reminders.onDueDate ?? true,
    afterDueDays: reminders.afterDueDays ?? [7, 14],
  };
};

// Every reminder this invoice would get, with its day in the owner's time zone, earliest first
const schedule = (invoice, settings, zone) => {
  const dueDay = DateTime.fromJSDate(invoice.dueDate, { zone }).startOf('day');
  const list = [];
  if (settings.beforeDueDays > 0) list.push({ kind: 'before_due', offsetDays: settings.beforeDueDays, date: dueDay.minus({ days: settings.beforeDueDays }) });
  if (settings.onDueDate) list.push({ kind: 'on_due', offsetDays: 0, date: dueDay });
  for (const days of settings.afterDueDays) list.push({ kind: 'overdue', offsetDays: days, date: dueDay.plus({ days }) });

  const sentDay = DateTime.fromJSDate(invoice.lastSentAt ?? invoice.sentAt ?? invoice.issuedAt, { zone }).startOf('day');
  return { dueDay, items: list.filter((item) => item.date > sentDay).sort((a, b) => a.date.toMillis() - b.date.toMillis()) };
};

// The one reminder to send today: the latest one whose day has come, if it is at most CATCH_UP_DAYS days old
const reminderForToday = (invoice, settings, zone, today) => {
  const { dueDay, items } = schedule(invoice, settings, zone);
  const eligible = items.filter((item) => item.date <= today && daysBetween(item.date, today) <= CATCH_UP_DAYS);
  const latest = eligible.at(-1);
  return latest ? { ...latest, daysUntilDue: daysBetween(today, dueDay) } : null;
};

// ----- finding what is due -----

// { checked, skipped, due }: the invoices looked at, how many were left out (reminders off, no client e-mail, a reminder
// was just sent by hand), and the reminders that are due now. Nothing is sent or changed.
export const findDue = async (nowInput = DateTime.now()) => {
  const now = asDateTime(nowInput);

  // Only invoices whose due date is near enough to have a reminder today (the margins cover time zones)
  const invoices = await Invoice.find({
    status: 'sent',
    remindersPaused: { $ne: true },
    dueDate: { $gte: now.minus({ days: 60 + CATCH_UP_DAYS + 2 }).toJSDate(), $lte: now.plus({ days: 14 + CATCH_UP_DAYS + 2 }).toJSDate() },
  }).lean();

  const [users, clients, recentManual] = await Promise.all([
    User.find({ _id: { $in: [...new Set(invoices.map((i) => String(i.userId)))] } }).select('name email timezone reminders payment').lean(),
    Client.find({ _id: { $in: invoices.map((i) => i.clientId) } }).select('email').lean(),
    // a reminder the owner has just sent by hand counts: don't follow it with an automatic one within a day
    ReminderLog.find({ invoiceId: { $in: invoices.map((i) => i._id) }, kind: 'manual', status: { $ne: 'failed' }, createdAt: { $gte: new Date(now.toMillis() - MANUAL_COOLDOWN_MS) } }).select('invoiceId').lean(),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const clientById = new Map(clients.map((c) => [String(c._id), c]));
  const justReminded = new Set(recentManual.map((log) => String(log.invoiceId)));

  const due = [];
  let skipped = 0;
  for (const invoice of invoices) {
    const user = userById.get(String(invoice.userId));
    const settings = reminderSettings(user);
    const to = clientById.get(String(invoice.clientId))?.email || invoice.client?.email;
    if (!user || !settings.enabled || !to || justReminded.has(String(invoice._id))) {
      skipped++;
      continue;
    }

    const zone = usableZone(user.timezone);
    const reminder = reminderForToday(invoice, settings, zone, now.setZone(zone).startOf('day'));
    if (reminder) due.push({ invoice, user, to, ...reminder });
  }
  return { checked: invoices.length, skipped, due };
};

// ----- sending -----

// Takes the reminder for itself. Only ONE insert of the same (invoice, kind, offsetDays) can ever succeed, so of two
// runs at the same moment only one gets it. A reminder that FAILED earlier may be taken again (a few times); one that
// was sent, or is being sent right now, never.
const claim = async ({ invoice, kind, offsetDays, to }) => {
  const reminder = { invoiceId: invoice._id, userId: invoice.userId, kind, offsetDays };
  try {
    return await ReminderLog.create({ ...reminder, to, status: 'sending', attempts: 1 });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  return ReminderLog.findOneAndUpdate(
    { ...reminder, status: 'failed', attempts: { $lt: MAX_ATTEMPTS } },
    { $set: { status: 'sending', to, error: '' }, $inc: { attempts: 1 } },
    { returnDocument: 'after' }
  );
};

// The e-mail itself, then the log row says what happened. A failure is recorded and the invoice is left alone.
const deliver = async ({ log, invoice, user, to, daysUntilDue, sentAt }) => {
  try {
    const shareUrl = shareUrlFor(await ensureShareToken(invoice.userId, invoice._id));
    const { subject, html, text } = renderReminderEmail({ invoice, fromName: user.name, shareUrl, payment: user.payment, daysUntilDue });
    await sendEmail({
      to,
      subject,
      html,
      text,
      replyTo: { email: user.email, name: user.name }, // the client's reply goes to the freelancer
      fromName: `${user.name} via ${process.env.EMAIL_FROM_NAME || 'TimeLedger'}`,
    });
  } catch (err) {
    console.error(`Reminder for ${invoice.number} failed: ${err.message}`);
    await ReminderLog.updateOne({ _id: log._id }, { $set: { status: 'failed', error: String(err.message).slice(0, 300) } });
    return 'failed';
  }

  await ReminderLog.updateOne({ _id: log._id }, { $set: { status: 'sent', sentAt } });
  await Invoice.updateOne({ _id: invoice._id }, { $max: { lastReminderAt: sentAt } });
  return 'sent';
};

const sendScheduled = async (item, now) => {
  const log = await claim(item);
  if (!log) return 'skipped'; // already sent (or being sent) by another run

  // The invoice may have been paid or paused in the seconds since it was looked at: then nothing was sent, so drop the claim
  const stillOpen = await Invoice.exists({ _id: item.invoice._id, status: 'sent', remindersPaused: { $ne: true } });
  if (!stillOpen) {
    await ReminderLog.deleteOne({ _id: log._id });
    return 'skipped';
  }
  return deliver({ log, ...item, sentAt: now.toJSDate() });
};

// The whole job: { checked, sent, skipped, failed }. Safe to call as often as you like (every hour is fine).
export const run = async (nowInput = DateTime.now()) => {
  const now = asDateTime(nowInput);
  const { checked, skipped, due } = await findDue(now);

  const totals = { checked, sent: 0, skipped, failed: 0 };
  for (const item of due) {
    totals[await sendScheduled(item, now)] += 1; // one after the other, so the e-mail provider is not hammered
  }
  return totals;
};

// ----- "Send reminder now" -----

// Any number of times over the weeks, but at most one reminder per invoice per 24 hours (an automatic one counts).
// The 24 hours are taken on the invoice itself in one atomic update, so two clicks at the same moment send one e-mail.
export const sendNow = async (userId, id) => {
  const invoice = await Invoice.findOne({ _id: id, userId });
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  if (invoice.status === 'paid') throw new HttpError(409, 'This invoice is already paid');
  if (invoice.status === 'draft') throw new HttpError(409, 'Send the invoice first, then you can remind the client');

  const [user, client] = await Promise.all([User.findById(userId).select('name email timezone payment'), Client.findOne({ _id: invoice.clientId, userId }).select('email')]);
  const to = client?.email || invoice.client.email;
  if (!to) throw new HttpError(400, "Add the client's email first", [{ path: 'to', message: "Add the client's email first" }]);

  const now = new Date();
  const taken = await Invoice.findOneAndUpdate(
    { _id: id, userId, status: 'sent', $or: [{ lastReminderAt: null }, { lastReminderAt: { $lt: new Date(now.getTime() - MANUAL_COOLDOWN_MS) } }] },
    { $set: { lastReminderAt: now } },
    { returnDocument: 'before' }
  ).select('lastReminderAt');
  if (!taken) {
    const current = await Invoice.findOne({ _id: id, userId }).select('status');
    throw current?.status === 'paid' ? new HttpError(409, 'This invoice is already paid') : new HttpError(429, 'You already sent a reminder in the last 24 hours');
  }

  const log = await ReminderLog.create({ invoiceId: invoice._id, userId, kind: 'manual', to, status: 'sending', attempts: 1 });
  const zone = usableZone(user.timezone);
  const today = DateTime.fromJSDate(now, { zone }).startOf('day');
  const daysUntilDue = daysBetween(today, DateTime.fromJSDate(invoice.dueDate, { zone }).startOf('day'));

  const outcome = await deliver({ log, invoice, user, to, daysUntilDue, sentAt: now });
  if (outcome === 'failed') {
    // nothing went out, so the 24 hours are given back and the owner can try again
    await Invoice.updateOne({ _id: id, lastReminderAt: now }, { $set: { lastReminderAt: taken.lastReminderAt } });
    throw new HttpError(502, MAIL_ERROR);
  }
  return { sentTo: to, reminder: historyItem(await ReminderLog.findById(log._id)) };
};

// ----- what the invoice page shows -----

const historyItem = (log) => ({
  _id: log._id,
  kind: log.kind,
  offsetDays: log.offsetDays ?? null,
  status: log.status,
  to: log.to,
  at: log.sentAt ?? log.createdAt,
  error: log.status === 'failed' ? log.error : '',
});

export const getReminders = async (userId, id) => {
  const invoice = await Invoice.findOne({ _id: id, userId }).select('-lineItems -entryIds');
  if (!invoice) throw new HttpError(404, 'Invoice not found');

  const [user, client, logs] = await Promise.all([
    User.findById(userId).select('timezone reminders').lean(),
    Client.findOne({ _id: invoice.clientId, userId }).select('email').lean(),
    ReminderLog.find({ invoiceId: invoice._id, userId }).sort({ createdAt: -1 }).limit(50),
  ]);
  const settings = reminderSettings(user);
  const zone = usableZone(user?.timezone);
  const hasEmail = Boolean(client?.email || invoice.client.email);

  // Why there is no next reminder, or when it is
  let reason = null;
  if (invoice.status === 'paid') reason = 'paid';
  else if (invoice.status === 'draft') reason = 'draft';
  else if (invoice.remindersPaused) reason = 'paused';
  else if (!settings.enabled) reason = 'disabled';
  else if (!hasEmail) reason = 'no_email';

  let next = null;
  if (!reason) {
    const today = DateTime.now().setZone(zone).startOf('day');
    const done = new Set(logs.filter((log) => log.status !== 'failed' && log.offsetDays != null).map((log) => `${log.kind}:${log.offsetDays}`));
    const { dueDay, items } = schedule(invoice, settings, zone);
    const upcoming = items.find((item) => item.date >= today && !done.has(`${item.kind}:${item.offsetDays}`));
    if (upcoming) {
      next = {
        kind: upcoming.kind,
        offsetDays: upcoming.offsetDays,
        date: upcoming.date.toISODate(),
        daysFromNow: daysBetween(today, upcoming.date),
        daysUntilDue: daysBetween(upcoming.date, dueDay), // 3 = due in 3 days, 0 = on the due date, -7 = 7 days overdue
      };
    } else {
      reason = 'none_left';
    }
  }

  return {
    paused: Boolean(invoice.remindersPaused),
    enabled: settings.enabled,
    status: invoice.status,
    lastReminderAt: invoice.lastReminderAt,
    next,
    reason,
    history: logs.map(historyItem),
  };
};

// ----- pausing -----

export const setPaused = async (userId, id, paused) => {
  const invoice = await Invoice.findOneAndUpdate({ _id: id, userId }, { $set: { remindersPaused: paused } }, { returnDocument: 'after' }).select('-lineItems -entryIds');
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  return withDisplayStatus(invoice, await userZone(userId));
};
