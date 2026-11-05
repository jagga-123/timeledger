import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Bell, Send } from 'lucide-react';
import Badge from './Badge';
import Button from './Button';
import Switch from './Switch';
import { pauseInvoiceReminders, sendReminderNow } from '../api/invoices';
import { getErrorMessage } from '../utils/errors';
import { dueWording, reminderKindLabel } from '../utils/reminders';
import { formatDate, formatDateRange } from '../utils/time';

const HISTORY_TONE = { sent: 'success', failed: 'danger', sending: 'warning' };
const HISTORY_LABEL = { sent: 'Sent', failed: 'Failed', sending: 'Sending' };

// The "Payment reminders" part of the invoice page: what comes next, the history, pause and "Send reminder now".
// reminders: the answer of GET /invoices/:id/reminders (null while it loads).
export default function InvoiceReminders({ invoice, reminders, onReload, onInvoiceChange }) {
  const [busy, setBusy] = useState(null); // 'pause' | 'send'

  const sent = invoice.status === 'sent'; // reminders only make sense for an invoice that was sent and is not paid

  const togglePause = async () => {
    setBusy('pause');
    try {
      const updated = await pauseInvoiceReminders(invoice._id, !reminders.paused);
      onInvoiceChange(updated);
      toast.success(updated.remindersPaused ? 'Reminders paused for this invoice' : 'Reminders resumed');
      await onReload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remindNow = async () => {
    setBusy('send');
    try {
      const { sentTo } = await sendReminderNow(invoice._id);
      toast.success(`Reminder sent to ${sentTo}`);
      await onReload();
    } catch (err) {
      toast.error(getErrorMessage(err)); // for example "You already sent a reminder in the last 24 hours"
      await onReload();
    } finally {
      setBusy(null);
    }
  };

  const nextLine = () => {
    if (!reminders) return 'Loading reminders...';

    const { next, reason } = reminders;
    if (next) {
      const when = next.daysFromNow === 0 ? 'today' : formatDateRange(next.date, next.date);
      return `Next reminder: ${when}, ${dueWording(next.daysUntilDue)}`;
    }
    return {
      paid: 'This invoice is paid, so there are no more reminders.',
      draft: 'Reminders start once the invoice has been sent.',
      paused: 'Reminders are paused for this invoice.',
      disabled: 'Automatic reminders are switched off in Settings.',
      no_email: "Add the client's email to send reminders.",
      none_left: 'No more reminders are scheduled.',
    }[reason];
  };

  return (
    <div className="border-t border-slate-200 pt-4" data-testid="reminders">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Bell size={16} className="text-primary" />
          Payment reminders
        </p>

        {sent && reminders && (
          <div className="flex flex-wrap items-center gap-3">
            <Switch checked={reminders.paused} onChange={togglePause} disabled={busy !== null} label="Pause reminders" />
            <Button variant="secondary" onClick={remindNow} loading={busy === 'send'} disabled={busy !== null}>
              <Send size={16} />
              Send reminder now
            </Button>
          </div>
        )}
      </div>

      <p className="mt-2 text-sm text-slate-600" data-testid="next-reminder">
        {nextLine()}
        {reminders?.reason === 'disabled' && (
          <>
            {' '}
            <Link to="/settings" className="font-medium text-primary hover:underline">
              Open Settings
            </Link>
          </>
        )}
      </p>

      {reminders?.history.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm" aria-label="Reminder history" data-testid="reminder-history">
          {reminders.history.map((item) => (
            <li key={item._id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2" data-status={item.status}>
              <div className="min-w-0">
                <p className="font-medium text-slate-800">{reminderKindLabel(item)}</p>
                <p className="break-words text-xs text-slate-500">
                  {formatDate(item.at, invoice.timezone)} · to {item.to}
                </p>
                {item.status === 'failed' && item.error && <p className="break-words text-xs text-red-600">{item.error}</p>}
              </div>
              <Badge tone={HISTORY_TONE[item.status]}>{HISTORY_LABEL[item.status]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
