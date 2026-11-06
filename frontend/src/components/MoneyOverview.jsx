import SummaryCard from './SummaryCard';
import AgingBar from './AgingBar';
import { formatCurrency, plural } from '../utils/format';

const formatDays = (days) => (days === null ? '—' : `${Number.isInteger(days) ? days : days.toFixed(1)} ${days === 1 ? 'day' : 'days'}`);

// The "Money" part of the dashboard: four cards and the aging bar. summary is null while it is still loading.
export default function MoneyOverview({ summary }) {
  const currency = summary?.currency ?? 'USD';
  const money = (amount) => (summary ? formatCurrency(amount, currency) : '—');

  const overdue = summary?.overdue;
  const paid = summary?.paidThisMonth;
  const average = summary?.avgDaysToPay;

  return (
    <section aria-labelledby="money-heading" className="mt-8" data-testid="money">
      <h2 id="money-heading" className="mb-3 text-lg font-semibold text-slate-900">
        Money
      </h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          testId="money-outstanding"
          label="Outstanding"
          value={money(summary?.outstanding.amount ?? 0)}
          note={summary ? plural(summary.outstanding.count, 'unpaid invoice') : undefined}
        />
        <SummaryCard
          testId="money-overdue"
          label="Overdue"
          tone={overdue?.count > 0 ? 'danger' : undefined}
          value={money(overdue?.amount ?? 0)}
          note={overdue ? (overdue.count > 0 ? `${plural(overdue.count, 'invoice')} · oldest ${plural(overdue.oldest.days, 'day')}` : 'Nothing is late') : undefined}
          noteTone={overdue?.count > 0 ? 'danger' : undefined}
        />
        <SummaryCard
          testId="money-paid"
          label="Paid this month"
          tone={paid?.amount > 0 ? 'success' : undefined}
          value={money(paid?.amount ?? 0)}
          note={paid ? plural(paid.count, 'invoice') : undefined}
        />
        <SummaryCard
          testId="money-average"
          label="Avg. days to get paid"
          value={average ? formatDays(average.days) : '—'}
          note={average ? (average.count > 0 ? `last ${average.windowDays} days · ${plural(average.count, 'invoice')}` : `no payments in the last ${average.windowDays} days`) : undefined}
        />
      </div>

      <div className="mt-3">{summary && <AgingBar aging={summary.aging} currency={currency} />}</div>
    </section>
  );
}
