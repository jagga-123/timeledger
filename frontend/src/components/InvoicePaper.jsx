import { Clock } from 'lucide-react';
import InvoiceStatusBadge from './InvoiceStatusBadge';
import { formatCurrency, formatDate, formatDateRange } from '../utils/time';

const LABEL = 'text-xs font-semibold uppercase tracking-wide text-slate-500';

// The invoice itself: a white "paper" card that is also what gets printed or saved as a PDF. Used by the owner's
// invoice page and by the public page a client opens from an email, so both look exactly the same.
// invoice: the owner's invoice or the public one (same field names; displayStatus and daysOverdue are optional).
export default function InvoicePaper({ invoice }) {
  const money = (amount) => formatCurrency(amount, invoice.currency);
  const date = (value) => formatDate(value, invoice.timezone);

  return (
    <article
      className="invoice-paper mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
      aria-label={`Invoice ${invoice.number}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-center gap-2 text-primary">
          <Clock size={28} />
          <span className="text-xl font-bold">TimeLedger</span>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tracking-widest">INVOICE</p>
          <p className="font-mono text-lg" data-testid="invoice-number">
            {invoice.number}
          </p>
          <div className="mt-1 flex justify-end" data-testid="invoice-status">
            <InvoiceStatusBadge status={invoice.displayStatus ?? invoice.status} daysOverdue={invoice.daysOverdue} />
          </div>
        </div>
      </header>

      <section className="mt-8 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className={LABEL}>From</h2>
          <p className="mt-1 font-semibold">{invoice.from.name}</p>
          <p className="break-words text-sm text-slate-600">{invoice.from.email}</p>
        </div>
        <div>
          <h2 className={LABEL}>Bill to</h2>
          <p className="mt-1 font-semibold">{invoice.client.name}</p>
          {invoice.client.company && <p className="text-sm text-slate-600">{invoice.client.company}</p>}
          {invoice.client.email && <p className="break-words text-sm text-slate-600">{invoice.client.email}</p>}
        </div>
      </section>

      <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-slate-200 py-4 text-sm sm:grid-cols-3">
        <div>
          <dt className={LABEL}>Issue date</dt>
          <dd className="mt-1">{date(invoice.issuedAt)}</dd>
        </div>
        <div>
          <dt className={LABEL}>Due date</dt>
          <dd className="mt-1">{date(invoice.dueDate)}</dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className={LABEL}>Period</dt>
          <dd className="mt-1">{formatDateRange(invoice.periodStart, invoice.periodEnd)}</dd>
        </div>
        {invoice.sentAt && (
          <div>
            <dt className={LABEL}>Sent</dt>
            <dd className="mt-1">{date(invoice.sentAt)}</dd>
          </div>
        )}
        {invoice.paidAt && (
          <div>
            <dt className={LABEL}>Paid</dt>
            <dd className="mt-1">{date(invoice.paidAt)}</dd>
          </div>
        )}
      </dl>

      {/* Line items: a table from tablet width up, stacked rows on a phone */}
      <table className="mt-8 hidden w-full text-sm sm:table" data-testid="line-items-table">
        <thead>
          <tr className="border-b-2 border-slate-900 text-left">
            <th className={`${LABEL} pb-2`}>Project</th>
            <th className={`${LABEL} pb-2 text-right`}>Hours</th>
            <th className={`${LABEL} pb-2 text-right`}>Rate</th>
            <th className={`${LABEL} pb-2 text-right`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lineItems.map((line, index) => (
            <tr key={line.projectId ?? index} className="break-inside-avoid border-b border-slate-200">
              <td className="py-3 pr-4 font-medium">{line.projectName}</td>
              <td className="py-3 text-right font-mono">{line.hours.toFixed(2)}</td>
              <td className="py-3 text-right font-mono">{money(line.hourlyRate)}</td>
              <td className="py-3 text-right font-mono font-medium">{money(line.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-8 divide-y divide-slate-200 border-y border-slate-200 sm:hidden" data-testid="line-items-stacked">
        {invoice.lineItems.map((line, index) => (
          <li key={line.projectId ?? index} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 font-medium">{line.projectName}</p>
              <p className="shrink-0 font-mono font-medium">{money(line.amount)}</p>
            </div>
            <p className="mt-0.5 font-mono text-xs text-slate-500">
              {line.hours.toFixed(2)} h × {money(line.hourlyRate)}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-4 ml-auto max-w-xs space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-600">Subtotal</span>
          <span className="font-mono">{money(invoice.subtotal)}</span>
        </div>
        <div className="flex items-center justify-between border-t-2 border-slate-900 pt-2 text-lg font-bold">
          <span>Total</span>
          <span className="font-mono" data-testid="invoice-total">
            {money(invoice.total)}
          </span>
        </div>
      </div>

      {invoice.roundingMinutes > 0 && (
        <p className="mt-6 text-xs text-slate-500" data-testid="rounding-note">
          Rounded up to {invoice.roundingMinutes} min per entry
        </p>
      )}

      {invoice.notes && (
        <section className="mt-10 break-inside-avoid">
          <h2 className={LABEL}>Notes</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{invoice.notes}</p>
        </section>
      )}
    </article>
  );
}
