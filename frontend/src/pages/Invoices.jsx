import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/PageHeader';
import PageLoader from '../components/PageLoader';
import EmptyState from '../components/EmptyState';
import SummaryCard from '../components/SummaryCard';
import Button from '../components/Button';
import InvoiceStatusBadge from '../components/InvoiceStatusBadge';
import InvoiceCreateModal from '../components/InvoiceCreateModal';
import { useAuth } from '../hooks/useAuth';
import { getInvoices } from '../api/invoices';
import { getErrorMessage } from '../utils/errors';
import { formatCurrency, formatDate, formatDateRange } from '../utils/time';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent' },
  { id: 'paid', label: 'Paid' },
];

export default function Invoices() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState(null); // null = loading
  const [status, setStatus] = useState('all');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    getInvoices()
      .then(setInvoices)
      .catch((err) => {
        toast.error(getErrorMessage(err));
        setInvoices([]);
      });
  }, []);

  const addButton = (
    <Button onClick={() => setCreating(true)}>
      <Plus size={16} />
      New invoice
    </Button>
  );

  // The cards always cover every invoice; the filter only changes the list
  const sum = (list) => list.reduce((total, invoice) => total + invoice.total, 0);
  const outstanding = sum((invoices ?? []).filter((invoice) => invoice.status !== 'paid'));
  const paid = sum((invoices ?? []).filter((invoice) => invoice.status === 'paid'));
  const visible = (invoices ?? []).filter((invoice) => status === 'all' || invoice.status === status);

  const renderList = () => {
    if (invoices.length === 0) {
      return (
        <EmptyState
          icon={FileText}
          title="Create your first invoice"
          description="Pick a client and a period, and TimeLedger bills the unbilled, billable time for you."
          action={addButton}
        />
      );
    }

    if (visible.length === 0) {
      return (
        <EmptyState
          icon={FileText}
          title={`No ${status} invoices`}
          description="Try another filter."
          action={
            <Button variant="secondary" onClick={() => setStatus('all')}>
              Show all
            </Button>
          }
        />
      );
    }

    return (
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {visible.map((invoice) => (
          <li key={invoice._id}>
            <Link
              to={`/invoices/${invoice._id}`}
              className="flex flex-col gap-2 px-4 py-4 transition hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-slate-900">{invoice.number}</span>
                  <span className="truncate text-slate-700">{invoice.client.name}</span>
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {formatDateRange(invoice.periodStart, invoice.periodEnd)} · issued {formatDate(invoice.issuedAt, invoice.timezone)}
                </p>
              </div>
              <div className="flex items-center justify-between gap-4 sm:justify-end">
                <p className="font-mono font-semibold text-slate-900">{formatCurrency(invoice.total, invoice.currency)}</p>
                <InvoiceStatusBadge status={invoice.status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <>
      <PageHeader title="Invoices" description="Bill your unbilled time to a client." action={addButton} />

      {invoices === null ? (
        <PageLoader compact />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3" data-testid="summary">
            <SummaryCard label="Outstanding" value={formatCurrency(outstanding, user.currency)} />
            <SummaryCard label="Paid" value={formatCurrency(paid, user.currency)} />
            <SummaryCard label="Invoices" value={String(invoices.length)} />
          </div>

          {invoices.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
              {FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={status === filter.id}
                  onClick={() => setStatus(filter.id)}
                  className={`rounded-full border px-3 py-1 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                    status === filter.id
                      ? 'border-primary bg-indigo-50 text-primary'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          )}

          {renderList()}
        </>
      )}

      {creating && <InvoiceCreateModal onClose={() => setCreating(false)} />}
    </>
  );
}
