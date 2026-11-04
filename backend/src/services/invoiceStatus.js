import { DateTime } from 'luxon';
import User from '../models/User.js';
import { usableZone } from '../utils/timezone.js';

// "Overdue" is worked out every time, never stored: an invoice that was SENT and whose due date is before today
// in the user's own time zone. Due today is not overdue yet; a draft or a paid invoice is never overdue.

export const userZone = async (userId) => usableZone((await User.findById(userId).select('timezone'))?.timezone);

export const startOfToday = (zone, now = DateTime.now()) => now.setZone(zone).startOf('day');

export const overdueDays = (invoice, zone, now) => {
  if (invoice.status !== 'sent') return 0;

  const today = startOfToday(zone, now);
  const due = DateTime.fromJSDate(invoice.dueDate, { zone }).startOf('day');
  return due < today ? Math.round(today.diff(due, 'days').days) : 0;
};

// An invoice (document or plain object) as a plain object with displayStatus (draft | sent | overdue | paid) and daysOverdue
export const withDisplayStatus = (invoice, zone, now) => {
  const plain = typeof invoice.toJSON === 'function' ? invoice.toJSON() : { ...invoice };
  const daysOverdue = overdueDays(plain, zone, now);
  return { ...plain, displayStatus: daysOverdue > 0 ? 'overdue' : plain.status, daysOverdue };
};
