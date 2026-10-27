const pad = (n) => String(n).padStart(2, '0');

// formatElapsed(5025) -> "01:23:45"
export const formatElapsed = (totalSeconds) => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
};

// Calendar date, hour, ... of a moment as seen in a time zone
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

// The moment when the calendar day year-month-day starts in a time zone
const startOfZonedDay = (year, month, day, timeZone) => {
  const wallMidnight = Date.UTC(year, month - 1, day);
  // Offsets can change on that day (daylight saving), so look the offset up twice
  const firstGuess = wallMidnight - zoneOffsetMs(new Date(wallMidnight), timeZone);
  return new Date(wallMidnight - zoneOffsetMs(new Date(firstGuess), timeZone));
};

// [from, to) covering the calendar day that contains `now` in the given time zone
export const dayRangeInZone = (timeZone, now = new Date()) => {
  const { year, month, day } = zoneParts(now, timeZone);
  return {
    from: startOfZonedDay(year, month, day, timeZone),
    to: startOfZonedDay(year, month, day + 1, timeZone),
  };
};
