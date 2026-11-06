import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Plus, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/PageHeader';
import PageLoader from '../components/PageLoader';
import EmptyState from '../components/EmptyState';
import SummaryCard from '../components/SummaryCard';
import Button from '../components/Button';
import InvoiceStatusBadge from '../components/InvoiceStatusBadge';
import InvoiceCreateModal from '../components/InvoiceCreateModal';
import { useAuth } from '../hooks/useAuth';
import { getClientOverview } from '../api/receivables';
import { getErrorMessage } from '../utils/errors';
import { formatCurrency, plural } from '../utils/format';
import { formatDate, formatDateRange, formatDuration } from '../utils/time';

const BackLink = () => (
  <Link to="/clients" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-slate-700">
    <ArrowLeft size={16} />
    Clients
  </Link>
);

// One client: what they owe, their invoices and their last payments
export default function ClientDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [state, setState] = useState({ status: 'loading' }); // loading | ready | missing | error
  const [creating, setCreating] = useState(null); // the props of the New invoice modal while it is open

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    getClientOverview(id)
      .then((overview) => !cancelled && setState({ status: 'ready', overview }))
      .catch((err) => {
        if (cancelled) return;
        if ([400, 404].includes(err.response?.status)) {
          setState({ status: 'missing' });
        } else {
          toast.error(getErrorMessage(err));
          setState({ status: 'error' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.status === 'loading') return <PageLoader compact />;

  if (state.status !== 'ready') {
    return (
      <>
        <BackLink />
        <EmptyState
          icon={Users}
          title={state.status === 'missing' ? 'Client not found' : "Couldn't load this client"}
          description={state.status === 'missing' ? 'It may have been deleted, or it is not yours.' : 'Check your connection and try again.'}
          action={
            <Link to="/clients" className="font-medium text-primary hover:underline">
              Back to clients
            </Link>
          }
        />
      </>
    );
  }

  const { client, metrics, unbilled, invoices, lastPayments } = state.overview;
  const money = (amount) => formatCurrency(amount, user.currency);
  const contact = [client.company, client.email].filter(Boolean).join(' · ');
  const unpaidCount = invoices.filter((invoice) => invoice.status === 'sent').length;

  const paidNote = [
    metrics.lastPaymentAt ? `Last payment ${formatDate(metrics.lastPaymentAt, user.timezone)}` : 'No payments yet',
    metrics.avgDaysToPay !== null ? `pays in ${plural(metrics.avgDaysToPay, 'day')} on average` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <BackLink />
      <PageHeader
        title={client.name}
        description={contact || 'No contact details yet'}
        action={
          <div className="flex flex-wrap gap-2">
            {unbilled.amount > 0 && (
              <Button variant="secondary" onClick={() => setCreating({ initialClientId: client._id, initialRange: { from: unbilled.from, to: unbilled.to } })}>
                Invoice unbilled time
              </Button>
            )}
            <Button onClick={() => setCreating({ initialClientId: client._id })}>
              <Plus size={16} />
              New invoice
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="client-metrics">
        <SummaryCard testId="metric-outstanding" label="Outstanding" value={money(metrics.outstanding)} note={plural(unpaidCount, 'unpaid invoice')} />
        <SummaryCard
          testId="metric-overdue"
          label="Overdue"
          tone={metrics.overdueCount > 0 ? 'danger' : undefined}
          value={money(metrics.overdueAmount)}
          note={metrics.overdueCount > 0 ? `${plural(metrics.overdueCount, 'invoice')} · oldest ${plural(metrics.oldestOverdueDays, 'day')}` : 'Nothing is late'}
          noteTone={metrics.overdueCount > 0 ? 'danger' : undefined}
        />
        <SummaryCard
          testId="metric-unbilled"
          label="Unbilled"
          value={money(metrics.unbilledAmount)}
          note={unbilled.entries > 0 ? `${formatDuration(unbilled.seconds)} in ${unbilled.entries === 1 ? '1 entry' : `${unbilled.entries} entries`}` : 'Nothing to bill yet'}
        />
        <SummaryCard testId="metric-paid" label="Paid" tone={metrics.paidTotal > 0 ? 'success' : undefined} value={money(metrics.paidTotal)} note={paidNote} />
      </div>

      <h2 className="mb-3 text-lg font-semibold text-slate-900">Invoices</h2>
      {invoices.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No invoices yet"
          description={unbilled.amount > 0 ? 'There is unbilled time for this client: invoice it with the button above.' : 'Track some billable time for this client, then invoice it.'}
        />
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="client-invoices">
          {invoices.map((invoice) => (
            <li key={invoice._id}>
              <Link
                to={`/invoices/${invoice._id}`}
                className="flex flex-col gap-2 px-4 py-4 transition hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono font-semibold text-slate-900">{invoice.number}</p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {formatDateRange(invoice.periodStart, invoice.periodEnd)} · issued {formatDate(invoice.issuedAt, invoice.timezone)}
                    {invoice.status === 'sent' && ` · due ${formatDate(invoice.dueDate, invoice.timezone)}`}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <p className="font-mono font-semibold text-slate-900">{formatCurrency(invoice.total, invoice.currency)}</p>
                  <InvoiceStatusBadge status={invoice.displayStatus} daysOverdue={invoice.daysOverdue} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {lastPayments.length > 0 && (
        <section className="mt-8" aria-labelledby="payments-heading">
          <h2 id="payments-heading" className="mb-3 text-lg font-semibold text-slate-900">
            Last payments
          </h2>
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="client-payments">
            {lastPayments.map((payment) => (
              <li key={payment.invoiceId} className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
                <div className="min-w-0">
                  <Link to={`/invoices/${payment.invoiceId}`} className="font-mono text-sm font-semibold text-slate-900 hover:underline">
                    {payment.number}
                  </Link>
                  <p className="text-xs text-slate-500">Paid {formatDate(payment.paidAt, user.timezone)}</p>
                </div>
                <p className="font-mono text-sm font-semibold text-emerald-600">{money(payment.amount)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {creating && <InvoiceCreateModal {...creating} onClose={() => setCreating(null)} />}
    </>
  );
}
