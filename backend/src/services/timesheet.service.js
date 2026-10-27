import { DateTime } from 'luxon';
import TimeEntry from '../models/TimeEntry.js';
import User from '../models/User.js';
import { HttpError } from '../utils/httpError.js';
import { roundToCents } from '../utils/money.js';

// The weekly timesheet: hours per project per day, Monday to Sunday.
// Days are counted in the USER's saved time zone, never the server's, and every day is built with
// calendar arithmetic (plus({ days })), so a daylight saving day is correctly 23 or 25 hours long.

const toMillis = (value) => (typeof value === 'number' ? value : value.valueOf());

// Splits one entry across the days it touches.
// `dayBoundaries` holds the 8 moments where the 7 days start and end (the 8th is the end of the week).
// Returns the seconds the entry has in each of the 7 days. Anything outside the week is clipped away.
//
// The entry is measured in whole seconds, from its start (cut to the second) for its durationSeconds,
// so the days always add up to exactly the entry's own duration and match the Time entries page.
export const splitIntoDays = (entry, dayBoundaries) => {
  const start = Math.floor(toMillis(entry.startedAt) / 1000) * 1000;
  const end = start + entry.durationSeconds * 1000;

  return dayBoundaries.slice(0, -1).map((dayStart, index) => {
    const overlap = Math.min(end, toMillis(dayBoundaries[index + 1])) - Math.max(start, toMillis(dayStart));
    return Math.max(0, overlap) / 1000;
  });
};

const sum = (numbers) => numbers.reduce((total, n) => total + n, 0);

export const getWeek = async (userId, { weekStart } = {}) => {
  const user = await User.findById(userId).select('timezone');
  // A saved zone that luxon doesn't know would make every date invalid; UTC is a safe fallback
  const zone = DateTime.local().setZone(user.timezone).isValid ? user.timezone : 'UTC';

  let first;
  if (weekStart) {
    first = DateTime.fromISO(weekStart, { zone }).startOf('day');
    if (!first.isValid || first.weekday !== 1) {
      throw new HttpError(400, 'Week must start on a Monday', [
        { path: 'weekStart', message: 'Week must start on a Monday' },
      ]);
    }
  } else {
    first = DateTime.now().setZone(zone).startOf('week'); // luxon weeks start on Monday
  }

  // 8 boundaries: the start of each of the 7 days, then the end of Sunday
  const boundaries = Array.from({ length: 8 }, (_, index) => first.plus({ days: index }));
  const boundaryMillis = boundaries.map((boundary) => boundary.toMillis());

  const days = boundaries.slice(0, 7).map((day) => ({
    date: day.toISODate(),
    label: day.setLocale('en').toFormat('ccc d'), // "Mon 9"
  }));

  // Finished entries that overlap the week. The running timer (endedAt: null) is left out.
  const entries = await TimeEntry.find({
    userId,
    endedAt: { $ne: null, $gt: boundaries[0].toJSDate() },
    startedAt: { $lt: boundaries[7].toJSDate() },
  })
    .populate({
      path: 'project',
      select: 'name color hourlyRate clientId',
      populate: { path: 'client', select: 'name' },
    });

  const rowsByProject = new Map();
  for (const entry of entries) {
    const { project } = entry;
    if (!project) continue;

    const seconds = splitIntoDays(entry, boundaryMillis);
    const inWeek = sum(seconds);
    if (inWeek === 0) continue;

    const key = String(project._id);
    if (!rowsByProject.has(key)) {
      rowsByProject.set(key, {
        project: { _id: project._id, name: project.name, color: project.color, hourlyRate: project.hourlyRate },
        client: { _id: project.client?._id, name: project.client?.name ?? '' },
        seconds: Array(7).fill(0),
        totalSeconds: 0,
        billableSeconds: 0,
      });
    }

    const row = rowsByProject.get(key);
    seconds.forEach((value, index) => {
      row.seconds[index] += value;
    });
    row.totalSeconds += inWeek;
    if (entry.billable) row.billableSeconds += inWeek;
  }

  // By client name, then project name
  const rows = [...rowsByProject.values()].sort(
    (a, b) => a.client.name.localeCompare(b.client.name) || a.project.name.localeCompare(b.project.name)
  );

  const dayTotals = days.map((_, index) => sum(rows.map((row) => row.seconds[index])));
  const billableAmount = sum(rows.map((row) => (row.billableSeconds / 3600) * row.project.hourlyRate));

  return {
    weekStart: days[0].date,
    weekEnd: days[6].date, // the Sunday (included)
    timezone: zone,
    days,
    rows,
    dayTotals,
    weekTotalSeconds: sum(dayTotals),
    billableSeconds: sum(rows.map((row) => row.billableSeconds)),
    billableAmount: roundToCents(billableAmount),
  };
};
