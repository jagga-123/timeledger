import TimeEntry from '../models/TimeEntry.js';
import { HttpError } from '../utils/httpError.js';
import { roundToCents } from '../utils/money.js';
import { findUsableProject } from './projectLookup.js';

// Time entries that were typed in by hand (source "manual") or recorded by the timer ("timer").
// Everything is stored in UTC; the frontend sends full ISO timestamps.

const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const FUTURE_SLACK_MS = 60 * 1000; // allow 1 minute of clock difference between device and server

const withDetails = (query) =>
  query.populate('project', 'name color hourlyRate').populate('client', 'name');

const secondsBetween = (startedAt, endedAt) => Math.floor((endedAt - startedAt) / 1000);

// The rules for an entry's times; the problem is reported on the End time field
const assertValidTimes = (startedAt, endedAt) => {
  let problem = null;
  if (!(endedAt > startedAt)) {
    problem = 'End time must be after the start time';
  } else if (endedAt - startedAt > MAX_DURATION_MS) {
    problem = "An entry can't be longer than 24 hours";
  } else if (endedAt.getTime() > Date.now() + FUTURE_SLACK_MS) {
    problem = "End time can't be in the future";
  }

  if (problem) {
    throw new HttpError(400, 'Validation failed', [{ path: 'endedAt', message: problem }]);
  }
};

// Finds one of my entries that may be edited or deleted here
const findEditable = async (userId, id) => {
  const entry = await TimeEntry.findOne({ _id: id, userId });
  if (!entry) {
    throw new HttpError(404, 'Entry not found');
  }
  if (!entry.endedAt) {
    throw new HttpError(409, 'Stop the timer first'); // the running timer is managed by /api/timer
  }
  if (entry.invoiceId) {
    throw new HttpError(409, "This entry is on an invoice and can't be changed");
  }
  return entry;
};

// Same conditions as findEditable, but checked by the database in the same step as the write
const editableFilter = (userId, id) => ({ _id: id, userId, invoiceId: null, endedAt: { $ne: null } });

const calculateTotals = (entries) => {
  let totalSeconds = 0;
  let billableSeconds = 0;
  let billableAmount = 0;
  let unbilledAmount = 0;

  for (const entry of entries) {
    totalSeconds += entry.durationSeconds;
    if (!entry.billable) continue;

    billableSeconds += entry.durationSeconds;
    const amount = (entry.durationSeconds / 3600) * (entry.project?.hourlyRate ?? 0);
    billableAmount += amount;
    if (!entry.invoiceId) unbilledAmount += amount;
  }

  return {
    totalSeconds,
    billableSeconds,
    billableAmount: roundToCents(billableAmount), // billable entries, billed or not
    unbilledAmount: roundToCents(unbilledAmount), // billable entries that are not on an invoice yet
  };
};

// Stopped entries (the running timer is excluded), newest first, plus totals for the same entries.
// from/to normally match the day an entry STARTED. With overlap, they match every entry that touches
// the range, including one that started before `from` or runs past `to` (used by the timesheet cells,
// where an entry that crosses midnight has time in both days).
export const list = async (userId, { from, to, clientId, projectId, billable, status = 'all', overlap = false }) => {
  const filter = { userId, endedAt: { $ne: null } };

  if (from || to) {
    if (overlap) {
      if (to) filter.startedAt = { $lt: to };
      if (from) filter.endedAt = { $ne: null, $gt: from };
    } else {
      filter.startedAt = {};
      if (from) filter.startedAt.$gte = from;
      if (to) filter.startedAt.$lt = to;
    }
  }
  if (clientId) filter.clientId = clientId;
  if (projectId) filter.projectId = projectId;
  if (billable !== undefined) filter.billable = billable;
  if (status === 'unbilled') filter.invoiceId = null;
  if (status === 'billed') filter.invoiceId = { $ne: null };

  const entries = await withDetails(TimeEntry.find(filter).sort({ startedAt: -1 }));
  return { entries, totals: calculateTotals(entries) };
};

export const create = async (userId, { projectId, description, billable, startedAt, endedAt }) => {
  assertValidTimes(startedAt, endedAt);
  const project = await findUsableProject(userId, projectId);

  const entry = await TimeEntry.create({
    userId,
    projectId: project._id,
    clientId: project.clientId, // copied so invoice queries don't need to look at the project
    description,
    billable,
    startedAt,
    endedAt,
    durationSeconds: secondsBetween(startedAt, endedAt),
    source: 'manual',
  });

  return withDetails(TimeEntry.findById(entry._id));
};

export const update = async (userId, id, { projectId, description, billable, startedAt, endedAt }) => {
  const entry = await findEditable(userId, id);
  const changes = {};

  if (startedAt || endedAt) {
    // Check the final pair of times, even when only one of them was sent
    const nextStartedAt = startedAt ?? entry.startedAt;
    const nextEndedAt = endedAt ?? entry.endedAt;
    assertValidTimes(nextStartedAt, nextEndedAt);
    changes.startedAt = nextStartedAt;
    changes.endedAt = nextEndedAt;
    changes.durationSeconds = secondsBetween(nextStartedAt, nextEndedAt);
  }
  if (projectId !== undefined) {
    const project = await findUsableProject(userId, projectId);
    changes.projectId = project._id;
    changes.clientId = project.clientId;
  }
  if (description !== undefined) changes.description = description;
  if (billable !== undefined) changes.billable = billable;

  const updated = await withDetails(
    TimeEntry.findOneAndUpdate(
      editableFilter(userId, id),
      { $set: changes },
      { returnDocument: 'after', runValidators: true }
    )
  );

  if (!updated) {
    // It was invoiced or deleted between the check above and the write: report the real reason
    await findEditable(userId, id);
    throw new HttpError(409, "This entry can't be changed right now");
  }
  return updated;
};

export const remove = async (userId, id) => {
  await findEditable(userId, id);

  const { deletedCount } = await TimeEntry.deleteOne(editableFilter(userId, id));
  if (!deletedCount) {
    await findEditable(userId, id);
    throw new HttpError(409, "This entry can't be deleted right now");
  }
};
