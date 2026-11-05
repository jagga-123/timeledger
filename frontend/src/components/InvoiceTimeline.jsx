import { Check } from 'lucide-react';
import { formatDate, formatDateRange } from '../utils/time';

// Created -> Sent (when, to whom) -> Reminder sent -> Viewed -> Paid, for the owner's invoice page
// reminders: the answer of GET /invoices/:id/reminders (null while it loads)
export default function InvoiceTimeline({ invoice, reminders = null }) {
  const date = (value) => formatDate(value, invoice.timezone);
  const resent = invoice.lastSentAt && invoice.sentAt && new Date(invoice.lastSentAt) - new Date(invoice.sentAt) > 60 * 1000;
  const sent = Boolean(invoice.sentAt);
  const remindersSent = reminders ? reminders.history.filter((item) => item.status === 'sent').length : 0;
  const lastReminder = reminders?.lastReminderAt ?? invoice.lastReminderAt;

  const steps = [
    { id: 'created', label: 'Created', done: true, when: date(invoice.issuedAt) },
    {
      id: 'sent',
      label: 'Sent',
      done: sent,
      when: sent ? date(invoice.sentAt) : 'Not sent yet',
      detail: sent && invoice.sentTo ? `to ${invoice.sentTo}` : '',
      more: resent ? `Sent again ${date(invoice.lastSentAt)}` : '',
      alert: invoice.displayStatus === 'overdue' ? `${invoice.daysOverdue} ${invoice.daysOverdue === 1 ? 'day' : 'days'} overdue` : '',
    },
    {
      id: 'reminder',
      label: 'Reminder sent',
      done: remindersSent > 0,
      when: remindersSent > 0 ? date(lastReminder) : reminders?.next ? `Next: ${formatDateRange(reminders.next.date, reminders.next.date)}` : '—',
      detail: remindersSent > 0 ? `${remindersSent} ${remindersSent === 1 ? 'reminder' : 'reminders'} so far` : '',
    },
    { id: 'viewed', label: 'Viewed', done: Boolean(invoice.viewedAt), when: invoice.viewedAt ? date(invoice.viewedAt) : sent ? 'Not opened yet' : '—' },
    { id: 'paid', label: 'Paid', done: Boolean(invoice.paidAt), when: invoice.paidAt ? date(invoice.paidAt) : '—' },
  ];

  return (
    <ol className="flex flex-col sm:flex-row" aria-label="Invoice history" data-testid="invoice-timeline">
      {steps.map((step, index) => (
        <li
          key={step.id}
          data-step={step.id}
          data-done={step.done}
          className="flex gap-3 pb-5 last:pb-0 sm:flex-1 sm:flex-col sm:gap-2 sm:pb-0"
        >
          <div className="flex flex-col items-center sm:w-full sm:flex-row">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                step.done ? 'bg-primary text-white' : 'border-2 border-slate-300 bg-white'
              }`}
              aria-hidden="true"
            >
              {step.done && <Check size={14} strokeWidth={3} />}
            </span>
            {index < steps.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200 sm:mx-2 sm:mt-0 sm:h-px sm:w-auto" aria-hidden="true" />}
          </div>
          <div className="min-w-0 pr-2">
            <p className={`text-sm font-semibold ${step.done ? 'text-slate-900' : 'text-slate-400'}`}>{step.label}</p>
            <p className={`text-sm ${step.done ? 'text-slate-600' : 'text-slate-400'}`}>{step.when}</p>
            {step.detail && <p className="break-words text-xs text-slate-500">{step.detail}</p>}
            {step.more && <p className="text-xs text-slate-500">{step.more}</p>}
            {step.alert && <p className="text-xs font-medium text-red-600">{step.alert}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
