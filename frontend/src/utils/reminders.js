// Helpers for the payment reminder settings and what the invoice page shows about them

export const DAYS_BEFORE_OPTIONS = [0, 1, 2, 3, 5, 7, 10, 14]; // 0 = no reminder before the due date
export const AFTER_DAY_CHOICES = [7, 14, 30];

const days = (count) => `${count} ${count === 1 ? 'day' : 'days'}`;

// 7 -> "7", [7, 14] -> "7 and 14", [7, 14, 30] -> "7, 14 and 30"
const numbers = (list) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

// "Clients get reminders 3 days before, on the due date, and 7 and 14 days after."
export const reminderSummary = ({ enabled, beforeDueDays, onDueDate, afterDueDays }) => {
  if (!enabled) return 'Automatic reminders are off.';

  const parts = [];
  if (beforeDueDays > 0) parts.push(`${days(beforeDueDays)} before`);
  if (onDueDate) parts.push('on the due date');
  if (afterDueDays.length > 0) parts.push(`${numbers(afterDueDays)} ${afterDueDays.length === 1 && afterDueDays[0] === 1 ? 'day' : 'days'} after`);

  if (parts.length === 0) return 'No reminders are scheduled.';
  const sentence = parts.length === 1 ? parts[0] : parts.length === 2 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
  return `Clients get reminders ${sentence}.`;
};

// One line of the reminder history
export const reminderKindLabel = ({ kind, offsetDays }) => {
  if (kind === 'before_due') return `${days(offsetDays)} before the due date`;
  if (kind === 'on_due') return 'On the due date';
  if (kind === 'overdue') return `${days(offsetDays)} after the due date`;
  return 'Sent by you';
};

// How the due date relates to a reminder: 3 -> "due in 3 days", 0 -> "on the due date", -7 -> "7 days overdue"
export const dueWording = (daysUntilDue) => (daysUntilDue > 0 ? `due in ${days(daysUntilDue)}` : daysUntilDue === 0 ? 'on the due date' : `${days(-daysUntilDue)} overdue`);
