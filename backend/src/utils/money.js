// Rounds a money amount to 2 decimals (non-numbers are returned untouched so validation can reject them)
export const roundToCents = (amount) =>
  typeof amount === 'number' ? Math.round((amount + Number.EPSILON) * 100) / 100 : amount;
