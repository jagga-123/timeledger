import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FileText, Link2, Printer, RefreshCw, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import PageLoader from '../components/PageLoader';
import EmptyState from '../components/EmptyState';
import Button from '../components/Button';
import ConfirmDialog from '../components/ConfirmDialog';
import InvoicePaper from '../components/InvoicePaper';
import InvoiceTimeline from '../components/InvoiceTimeline';
import SendInvoiceModal from '../components/SendInvoiceModal';
import { getInvoice, updateInvoiceStatus, deleteInvoice, getShareLink, regenerateShareLink } from '../api/invoices';
import { getErrorMessage } from '../utils/errors';
import { formatDate, formatDuration } from '../utils/time';

// Puts text on the clipboard. The Clipboard API only exists on secure pages, so fall back to the old way.
const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement('textarea');
    box.value = text;
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    const copied = document.execCommand('copy');
    box.remove();
    return copied;
  }
};

// The owner's page for one invoice: what happened to it so far, what can be done with it, and the invoice itself
// (a white "paper" card that is also what gets printed or saved as a PDF). Everything else is hidden when printing.
export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null); // { invoice, entries }
  const [notFound, setNotFound] = useState(false);
  const [changing, setChanging] = useState(false);
  const [sending, setSending] = useState(false); // the Send invoice modal is open
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingNewLink, setConfirmingNewLink] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);

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
  const canDelete = invoice.status === 'draft';
  const mergeInvoice = (changes) => setData((current) => ({ ...current, invoice: { ...current.invoice, ...changes } }));

  const changeStatus = async (status) => {
    setChanging(true);
    try {
      // the response has the new status and dates but not the lines, so merge it into what we have
      mergeInvoice(await updateInvoiceStatus(invoice._id, status));
      toast.success(status === 'sent' ? 'Marked as sent' : 'Marked as paid');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setChanging(false);
    }
  };

  const handleSent = ({ invoice: updated, shareUrl }) => {
    mergeInvoice({ ...updated, shareUrl });
    setSending(false);
  };

  const copyShareLink = async () => {
    setLinkBusy(true);
    try {
      const url = invoice.shareUrl ?? (await getShareLink(invoice._id));
      if (!invoice.shareUrl) mergeInvoice({ shareUrl: url });
      if (await copyText(url)) toast.success('Share link copied');
      else toast.error('Could not copy it. Select the link in the box and copy it.');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLinkBusy(false);
    }
  };

  const makeNewLink = async () => {
    setLinkBusy(true);
    try {
      const url = await regenerateShareLink(invoice._id);
      mergeInvoice({ shareUrl: url, viewedAt: null }); // the new link has not been opened yet
      toast.success('New link made. The old one no longer works.');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLinkBusy(false);
      setConfirmingNewLink(false);
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
          {invoice.status !== 'paid' && (
            <Button onClick={() => setSending(true)} disabled={changing}>
              <Send size={16} />
              {invoice.sentAt ? 'Resend invoice' : 'Send invoice'}
            </Button>
          )}
          {invoice.status === 'draft' && (
            <Button variant="secondary" onClick={() => changeStatus('sent')} loading={changing} title="I sent it myself, outside TimeLedger">
              Mark as sent
            </Button>
          )}
          {invoice.status !== 'paid' && (
            <Button variant="secondary" onClick={() => changeStatus('paid')} disabled={changing}>
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

      <section aria-label="History and sharing" className="mx-auto mb-6 max-w-3xl space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 print:hidden" data-testid="invoice-activity">
        <InvoiceTimeline invoice={invoice} />

        <div className="border-t border-slate-200 pt-4" data-testid="share-link">
          <p className="text-sm font-semibold text-slate-900">Share link</p>
          <p className="mt-0.5 text-xs text-slate-500">Anyone with the link can see this invoice without logging in.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            {invoice.shareUrl && (
              <input
                readOnly
                aria-label="Share link"
                value={invoice.shareUrl}
                onFocus={(e) => e.target.select()}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 outline-none"
              />
            )}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={copyShareLink} loading={linkBusy && !confirmingNewLink}>
                <Link2 size={16} />
                Copy share link
              </Button>
              {invoice.shareUrl && (
                <Button variant="secondary" onClick={() => setConfirmingNewLink(true)} disabled={linkBusy}>
                  <RefreshCw size={16} />
                  Regenerate link
                </Button>
              )}
            </div>
          </div>
          {!invoice.shareUrl && <p className="mt-2 text-xs text-slate-500">There is no link yet. It is made when you send the invoice, or when you copy it here.</p>}
        </div>
      </section>

      <InvoicePaper invoice={invoice} />

      <details className="mx-auto mt-6 max-w-3xl rounded-xl border border-slate-200 bg-white print:hidden" data-testid="entries-included">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900 sm:px-6">
          Time entries included ({entries.length})
        </summary>
        <ul className="divide-y divide-slate-200 border-t border-slate-200">
          {entries.map((entry) => (
            <li key={entry._id} className="flex items-center gap-3 px-4 py-3 text-sm sm:px-6">
              <span className="w-24 shrink-0 text-slate-500">{formatDate(entry.startedAt, invoice.timezone)}</span>
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

      {sending && <SendInvoiceModal invoice={invoice} onClose={() => setSending(false)} onSent={handleSent} />}

      {confirmingNewLink && (
        <ConfirmDialog
          title="Regenerate the share link?"
          message="The current link stops working at once. Anyone you sent it to will need the new one."
          confirmLabel="Regenerate"
          loading={linkBusy}
          onConfirm={makeNewLink}
          onCancel={() => setConfirmingNewLink(false)}
        />
      )}

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
