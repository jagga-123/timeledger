// Rounds a duration UP to whole blocks of `minutes`, e.g. with 15: 1 s -> 15 min, 15 min -> 15 min,
// 15 min 1 s -> 30 min. 0 minutes means no rounding. An empty (0 s) entry stays 0.
// Only used when billing: the entry's real duration is never changed.
export const roundUp = (seconds, minutes) => {
  if (!(seconds > 0)) return 0;
  if (!(minutes > 0)) return seconds;

  const block = minutes * 60;
  return Math.ceil(seconds / block) * block;
};
