// The common UPI handles: the part after the @ of a UPI ID (alex@okhdfcbank). They are only used for a soft warning when somebody
// types a handle that is not in this list (a typo such as @okhdfcnk): the ID is still saved, because a new or rare handle is possible.
// This is the one place the list lives. Add a handle here and the warning stops mentioning it.
export const UPI_HANDLES = Object.freeze([
  'okhdfcbank',
  'okicici',
  'oksbi',
  'okaxis',
  'ybl',
  'ibl',
  'axl',
  'paytm',
  'upi',
  'apl',
  'yapl',
  'fbl',
  'idfcbank',
  'kotak',
  'hdfcbank',
  'icici',
  'sbi',
  'axisbank',
  'pnb',
  'barodampay',
  'freecharge',
  'jupiteraxis',
  'waaxis',
  'wahdfcbank',
  'waicici',
  'wasbi',
  'ikwik',
  'slc',
  'airtel',
  'postbank',
]);

const KNOWN = new Set(UPI_HANDLES);

// The handle of a UPI ID in lower case ("Alex@OkHDFCbank" -> "okhdfcbank"), or '' when there is no name before the @ or what
// follows it can't be a handle (the server explains those mistakes itself, so they are not warned about twice)
export const upiHandleOf = (upiId) => {
  const text = typeof upiId === 'string' ? upiId.trim().toLowerCase() : '';
  const at = text.lastIndexOf('@');
  if (at < 1) return '';

  const handle = text.slice(at + 1);
  return /^[a-z][a-z0-9.]{1,63}$/.test(handle) ? handle : '';
};

// How many edits turn one text into the other: an inserted, missing or different letter, or two letters swapped, each count 1
const distance = (a, b) => {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
};

const firstDifferenceIsLower = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

// The known handle that is closest to this one, or null when none is close enough to be a believable typo
// (about one wrong letter in every three: "okhdfcnk" is 2 away from "okhdfcbank", "mycompany" is not close to anything)
export const closestUpiHandle = (handle) => {
  const text = String(handle ?? '').toLowerCase();
  const allowed = Math.max(1, Math.floor(text.length / 3));

  let best = null;
  for (const known of UPI_HANDLES) {
    const away = distance(text, known);
    if (away > allowed) continue;
    // nearest first; on a tie the one that starts with the same letter, then the one of the same length, then the first in the list
    const rank = [away, known[0] === text[0] ? 0 : 1, Math.abs(known.length - text.length)];
    if (!best || firstDifferenceIsLower(rank, best.rank)) best = { known, rank };
  }
  return best ? best.known : null;
};

// null when the ID is fine (or has no handle to look at), otherwise { handle, suggestion } with suggestion possibly null
export const checkUpiHandle = (upiId) => {
  const handle = upiHandleOf(upiId);
  if (!handle || KNOWN.has(handle)) return null;
  return { handle, suggestion: closestUpiHandle(handle) };
};

// The amber text under the field, or '' when there is nothing to warn about
export const upiHandleWarning = (upiId) => {
  const check = checkUpiHandle(upiId);
  if (!check) return '';
  return `We don't recognise "@${check.handle}". Double-check your UPI ID${check.suggestion ? ` — did you mean @${check.suggestion}?` : '.'}`;
};
