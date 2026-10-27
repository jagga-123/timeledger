import api from './axios';

// weekStart is a Monday as "YYYY-MM-DD"; leave it out for the current week.
// Returns { weekStart, weekEnd, timezone, days, rows, dayTotals, weekTotalSeconds, billableSeconds, billableAmount }.
export const getTimesheet = async (weekStart) =>
  (await api.get('/timesheet', { params: weekStart ? { weekStart } : {} })).data;
