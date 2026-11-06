// formatCurrency(45, 'USD') -> "$45.00"
export const formatCurrency = (amount, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

// plural(1, 'invoice') -> "1 invoice", plural(2, 'invoice') -> "2 invoices"
export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
