import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, FileText, Printer, Send, CheckCircle2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import PageLoader from '../components/PageLoader';
import EmptyState from '../components/EmptyState';
import Button from '../components/Button';
import ConfirmDialog from '../components/ConfirmDialog';
import InvoiceStatusBadge from '../components/InvoiceStatusBadge';
import { getInvoice, updateInvoiceStatus, deleteInvoice } from '../api/invoices';
import { getErrorMessage } from '../utils/errors';
import { formatCurrency, formatDate, formatDateRange, formatDuration } from '../utils/time';

const LABEL = 'text-xs font-semibold uppercase tracking-wide text-slate-500';

// The invoice itself: a white "paper" card that is also what gets printed or saved as a PDF.
// Everything around it (sidebar, bars, the action buttons, the entry list) is hidden when printing.
export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null); // { invoice, entries }
  const [notFound, setNotFound] = useState(false);
  const [changing, setChanging] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setNotFound(false);

    getInvoice(id)
      .then((result) => !cancelled && setData(result))
      .catch((err) => {
        if (cancelled) return;
        if ([400, 404].includes(err.response?.status)) {
          setNotFound(true);
        } else {
          toast.error(getErrorMessage(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (notFound) {
    return (
      <EmptyState
        icon={FileText}
        title="Invoice not found"
        description="It may have been deleted, or it belongs to another account."
        action={<Button onClick={() => navigate('/invoices')}>Back to invoices</Button>}
      />
    );
  }
  if (!data) return <PageLoader compact />;

  const { invoice, entries } = data;
  const money = (amount) => formatCurrency(amount, invoice.currency);
  const date = (value) => formatDate(value, invoice.timezone);
  const canDelete = invoice.status === 'draft';

  const changeStatus = async (status) => {
    setChanging(true);
    try {
      const updated = await updateInvoiceStatus(invoice._id, status);
      // the response has the new status and dates but not the lines, so merge it into what we have
      setData((current) => ({ ...current, invoice: { ...current.invoice, ...updated } }));
      toast.success(status === 'sent' ? 'Marked as sent' : 'Marked as paid');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setChanging(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteInvoice(invoice._id);
      toast.success(`Invoice ${invoice.number} deleted`);
      navigate('/invoices');
    } catch (err) {
      toast.error(getErrorMessage(err));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <>
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center gap-2 print:hidden" data-testid="invoice-actions">
        <Button variant="secondary" onClick={() => navigate('/invoices')}>
          <ArrowLeft size={16} />
          Back
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer size={16} />
          Print / Save as PDF
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {invoice.status === 'draft' && (
            <Button onClick={() => changeStatus('sent')} loading={changing}>
              <Send size={16} />
              Mark as sent
            </Button>
          )}
          {invoice.status !== 'paid' && (
            <Button variant={invoice.status === 'sent' ? 'primary' : 'secondary'} onClick={() => changeStatus('paid')} disabled={changing}>
              <CheckCircle2 size={16} />
              Mark as paid
            </Button>
          )}
          {canDelete && (
            <Button variant="secondary" onClick={() => setConfirmingDelete(true)} disabled={changing}>
              <Trash2 size={16} />
              Delete
            </Button>
          )}
        </div>
      </div>

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
              <InvoiceStatusBadge status={invoice.status} />
            </div>
          </div>
        </header>

        <section className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className={LABEL}>From</h2>
            <p className="mt-1 font-semibold">{invoice.from.name}</p>
            <p className="text-sm text-slate-600">{invoice.from.email}</p>
          </div>
          <div>
            <h2 className={LABEL}>Bill to</h2>
            <p className="mt-1 font-semibold">{invoice.client.name}</p>
            {invoice.client.company && <p className="text-sm text-slate-600">{invoice.client.company}</p>}
            {invoice.client.email && <p className="text-sm text-slate-600">{invoice.client.email}</p>}
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
            {invoice.lineItems.map((line) => (
              <tr key={line.projectId} className="break-inside-avoid border-b border-slate-200">
                <td className="py-3 pr-4 font-medium">{line.projectName}</td>
                <td className="py-3 text-right font-mono">{line.hours.toFixed(2)}</td>
                <td className="py-3 text-right font-mono">{money(line.hourlyRate)}</td>
                <td className="py-3 text-right font-mono font-medium">{money(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="mt-8 divide-y divide-slate-200 border-y border-slate-200 sm:hidden" data-testid="line-items-stacked">
          {invoice.lineItems.map((line) => (
            <li key={line.projectId} className="py-3">
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

      <details className="mx-auto mt-6 max-w-3xl rounded-xl border border-slate-200 bg-white print:hidden" data-testid="entries-included">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900 sm:px-6">
          Time entries included ({entries.length})
        </summary>
        <ul className="divide-y divide-slate-200 border-t border-slate-200">
          {entries.map((entry) => (
            <li key={entry._id} className="flex items-center gap-3 px-4 py-3 text-sm sm:px-6">
              <span className="w-24 shrink-0 text-slate-500">{date(entry.startedAt)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-900">{entry.projectName}</span>
                <span className="block truncate text-slate-500">{entry.description || 'No description'}</span>
              </span>
              <span className="shrink-0 font-mono text-slate-900">
                {formatDuration(entry.durationSeconds)}
                {invoice.roundingMinutes > 0 && entry.billedSeconds !== entry.durationSeconds && (
                  <span className="text-slate-500"> → {formatDuration(entry.billedSeconds)}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete invoice?"
          message={`${invoice.number} will be deleted and its ${entries.length} time ${entries.length === 1 ? 'entry becomes' : 'entries become'} unbilled again, so you can invoice them later.`}
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  );
}
