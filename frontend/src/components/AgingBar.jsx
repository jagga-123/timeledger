import { formatCurrency, plural } from '../utils/format';

// How late the unpaid invoices are. "Current" is not due yet (or due today); the rest is days overdue.
const BUCKETS = [
  { key: 'current', label: 'Current', color: 'bg-emerald-500' },
  { key: '1-30', label: '1–30 days', color: 'bg-amber-400' },
  { key: '31-60', label: '31–60 days', color: 'bg-orange-500' },
  { key: '61+', label: '61+ days', color: 'bg-red-600' },
];

// One stacked bar (each part as wide as its amount) with the amounts in a legend below it.
// aging: [{ key, amount, count }] in the order of BUCKETS, as the server sends it
export default function AgingBar({ aging, currency }) {
  const byKey = Object.fromEntries(aging.map((bucket) => [bucket.key, bucket]));
  const parts = BUCKETS.map((bucket) => ({ ...bucket, amount: byKey[bucket.key]?.amount ?? 0, count: byKey[bucket.key]?.count ?? 0 }));
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  const description = parts.map((part) => `${part.label} ${formatCurrency(part.amount, currency)}`).join(', ');

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5" data-testid="aging">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-slate-700">Unpaid invoices by age</h3>
        <p className="font-mono text-sm text-slate-500">{formatCurrency(total, currency)}</p>
      </div>

      <div
        role="img"
        aria-label={total > 0 ? `Unpaid invoices by age: ${description}` : 'Nothing unpaid'}
        className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100"
        data-testid="aging-bar"
      >
        {parts
          .filter((part) => part.amount > 0)
          .map((part) => (
            <div
              key={part.key}
              data-part={part.key}
              title={`${part.label}: ${formatCurrency(part.amount, currency)}`}
              style={{ flexGrow: part.amount, flexBasis: 0 }}
              className={`${part.color} min-w-1`}
            />
          ))}
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {parts.map((part) => (
          <li key={part.key} data-bucket={part.key} className="min-w-0">
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${part.color}`} aria-hidden="true" />
              {part.label}
            </p>
            <p className="mt-0.5 truncate font-mono text-sm font-semibold text-slate-900">{formatCurrency(part.amount, currency)}</p>
            <p className="text-xs text-slate-500">{plural(part.count, 'invoice')}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
