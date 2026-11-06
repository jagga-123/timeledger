import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { formatCurrency, plural } from '../utils/format';
import { todayKey } from '../utils/time';

const STORAGE_KEY = 'timeledger.overdueBannerDismissedOn';

// Storage can be missing or refuse to write (private windows, blocked site data): the banner then simply comes back
const readDismissedDay = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};
const writeDismissedDay = (day) => {
  try {
    localStorage.setItem(STORAGE_KEY, day);
  } catch {
    // nothing to do: it is hidden for this visit
  }
};

// The red alert at the top of the dashboard while anything is overdue. Dismissing it hides it for the rest of the day.
export default function OverdueBanner({ overdue, currency, timeZone }) {
  const today = todayKey(timeZone);
  const [dismissedDay, setDismissedDay] = useState(readDismissedDay);

  if (!overdue || overdue.count === 0 || dismissedDay === today) return null;

  const { oldest } = overdue;
  const dismiss = () => {
    writeDismissedDay(today);
    setDismissedDay(today);
  };

  return (
    <section
      aria-label="Overdue invoices"
      data-testid="overdue-banner"
      className="mb-6 flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-600" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold text-red-900" data-testid="overdue-banner-title">
            {plural(overdue.count, 'invoice')} overdue · {formatCurrency(overdue.amount, currency)}
          </p>
          {oldest && (
            <p className="mt-0.5 text-sm text-red-800" data-testid="overdue-banner-oldest">
              Oldest: {oldest.clientName}, {plural(oldest.days, 'day')}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Link
          to="/invoices?status=overdue"
          className="inline-flex flex-1 items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:ring-offset-2 sm:flex-none"
        >
          View overdue
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss until tomorrow"
          title="Dismiss until tomorrow"
          className="rounded-lg p-2 text-red-700 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500/40"
        >
          <X size={18} />
        </button>
      </div>
    </section>
  );
}
