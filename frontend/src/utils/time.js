export { formatCurrency } from './format.js';

const pad = (n) => String(n).padStart(2, '0');

// formatClock(5025) -> "01:23:45"
export const formatClock = (totalSeconds) => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
};

// formatDuration(8100) -> "2h 15m", formatDuration(7200) -> "2h", formatDuration(2700) -> "45m", formatDuration(42) -> "42s"
export const formatDuration = (totalSeconds) => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
};

// ---------------------------------------------------------------------------
// Time zones. Everything is stored in UTC; these helpers show and build times in the user's time zone.
// ---------------------------------------------------------------------------

// Calendar date and clock time of a moment as seen in a time zone
const zoneParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
};

// How far ahead of UTC a time zone is at a given moment, in ms (Asia/Kolkata -> 19800000)
const zoneOffsetMs = (date, timeZone) => {
  const p = zoneParts(date, timeZone);
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallClockAsUtc - Math.floor(date.getTime() / 1000) * 1000;
};

// The moment when the wall clock in a time zone shows year-month-day hour:minute.
// Day and month may be out of range (day 0, month 13...): Date.UTC rolls them over.
const zonedToDate = (year, month, day, hour, minute, timeZone) => {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  // The offset can change on that day (daylight saving), so look it up twice
  const firstGuess = wallClock - zoneOffsetMs(new Date(wallClock), timeZone);
  return new Date(wallClock - zoneOffsetMs(new Date(firstGuess), timeZone));
};

const parseDateKey = (dateKey) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return { year, month, day };
};

// "2026-03-10" for a moment, as seen in a time zone
export const dateKeyInZone = (date, timeZone) => {
  const { year, month, day } = zoneParts(date, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
};

// "09:30" for a moment, as seen in a time zone (24-hour clock)
export const timeOfDayInZone = (date, timeZone) => {
  const { hour, minute } = zoneParts(date, timeZone);
  return `${pad(hour)}:${pad(minute)}`;
};

// addDays("2026-03-31", 1) -> "2026-04-01"
export const addDaysToDateKey = (dateKey, days) => {
  const { year, month, day } = parseDateKey(dateKey);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
};

// The moment for a date ("2026-03-10") and a time ("09:30") typed in a time zone
export const dateTimeInZone = (dateKey, time, timeZone) => {
  const { year, month, day } = parseDateKey(dateKey);
  const [hour, minute] = time.split(':').map(Number);
  return zonedToDate(year, month, day, hour, minute, timeZone);
};

// "Today", "Yesterday" or "Tue 10 Mar 2026" for a date key
export const formatDayHeading = (dateKey, timeZone, now = new Date()) => {
  const today = dateKeyInZone(now, timeZone);
  const { year, month, day } = parseDateKey(dateKey);
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', // the date is built at noon UTC, so no zone can shift it to another day
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));

  if (dateKey === today) return `Today · ${text}`;
  if (dateKey === addDaysToDateKey(today, -1)) return `Yesterday · ${text}`;
  return text;
};

// [from, to) covering the calendar day that contains `now` in the given time zone
export const dayRangeInZone = (timeZone, now = new Date()) => {
  const { year, month, day } = zoneParts(now, timeZone);
  return {
    from: zonedToDate(year, month, day, 0, 0, timeZone),
    to: zonedToDate(year, month, day + 1, 0, 0, timeZone),
  };
};

// [from, to) for "this-week" / "last-week" (weeks start on Monday) or "this-month"
export const presetRange = (preset, timeZone, now = new Date()) => {
  const { year, month, day } = zoneParts(now, timeZone);

  if (preset === 'this-month') {
    return { from: zonedToDate(year, month, 1, 0, 0, timeZone), to: zonedToDate(year, month + 1, 1, 0, 0, timeZone) };
  }

  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  const monday = day - ((weekday + 6) % 7);
  const weekStart = preset === 'last-week' ? monday - 7 : monday;
  return {
    from: zonedToDate(year, month, weekStart, 0, 0, timeZone),
    to: zonedToDate(year, month, weekStart + 7, 0, 0, timeZone),
  };
};

// From two date inputs ("2026-03-01", "2026-03-31"); both days are included. Either may be empty.
export const customRange = (fromKey, toKey, timeZone) => ({
  from: fromKey ? dateTimeInZone(fromKey, '00:00', timeZone) : undefined,
  to: toKey ? dateTimeInZone(addDaysToDateKey(toKey, 1), '00:00', timeZone) : undefined,
});

// Browsers and servers may use different names for the same zone ("Asia/Calcutta" and "Asia/Kolkata")
export const isSameTimeZone = (a, b) => {
  try {
    const canonical = (zone) => new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
    return canonical(a) === canonical(b);
  } catch {
    return false;
  }
};
