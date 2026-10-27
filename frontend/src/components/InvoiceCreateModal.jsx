import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Modal from './Modal';
import FormField from './FormField';
import Button from './Button';
import PageLoader from './PageLoader';
import { useAuth } from '../hooks/useAuth';
import { getClients } from '../api/clients';
import { previewInvoice, createInvoice } from '../api/invoices';
import { getErrorMessage } from '../utils/errors';
import { formatCurrency, formatDateRange, quickRangeKeys, todayKey } from '../utils/time';

const QUICK_PICKS = [
  { id: 'last-week', label: 'Last week' },
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'custom', label: 'Custom' },
];

// Pick a client and a period, see exactly what would be billed, then create the invoice.
// Render it only while it should be open.
export default function InvoiceCreateModal({ onClose }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const timeZone = user.timezone;
  const today = todayKey(timeZone);

  const [clients, setClients] = useState(null);
  const [form, setForm] = useState(() => ({
    clientId: '',
    preset: 'this-month',
    ...quickRangeKeys('this-month', timeZone),
    notes: '',
  }));
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewKey, setPreviewKey] = useState(0); // bump to look again (e.g. after someone else billed the time)
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    getClients()
      .then(setClients)
      .catch((err) => {
        toast.error(getErrorMessage(err));
        setClients([]);
      });
  }, []);

  // The preview follows the client and the dates (it waits a moment while someone is still typing)
  useEffect(() => {
    setPreview(null);
    setPreviewError('');
    if (!form.clientId || !form.from || !form.to) {
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      previewInvoice({ clientId: form.clientId, from: form.from, to: form.to })
        .then((result) => !cancelled && setPreview(result))
        .catch((err) => !cancelled && setPreviewError(getErrorMessage(err)))
        .finally(() => !cancelled && setPreviewLoading(false));
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.clientId, form.from, form.to, previewKey]);

  const choosePreset = (id) => {
    const range = quickRangeKeys(id, timeZone);
    setForm((current) => ({ ...current, preset: id, ...(range ?? {}) }));
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    // typing a date means the range is custom now
    setForm((current) => ({ ...current, [name]: value, ...(name === 'from' || name === 'to' ? { preset: 'custom' } : {}) }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!preview || submitting) return;
    toast.dismiss();
    setSubmitting(true);

    try {
      const invoice = await createInvoice({ clientId: form.clientId, from: form.from, to: form.to, notes: form.notes });
      toast.success(`Invoice ${invoice.number} created`);
      navigate(`/invoices/${invoice._id}`);
    } catch (err) {
      // e.g. the same time was billed in another tab a moment ago: say so and look again
      toast.error(getErrorMessage(err));
      setPreviewKey((key) => key + 1);
      setSubmitting(false);
    }
  };

  if (clients === null) {
    return (
      <Modal title="New invoice" onClose={onClose} size="lg">
        <PageLoader compact />
      </Modal>
    );
  }

  const canCreate = Boolean(preview) && !previewLoading && !submitting;

  return (
    <Modal title="New invoice" onClose={onClose} size="lg">
      {clients.length === 0 ? (
        <p className="text-sm text-slate-600">Add a client and track some billable time first, then you can invoice it here.</p>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <FormField as="select" label="Client" name="clientId" value={form.clientId} onChange={handleChange} error={errors.clientId}>
            <option value="">Select a client</option>
            {clients.map((client) => (
              <option key={client._id} value={client._id}>
                {client.name}
              </option>
            ))}
          </FormField>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Period</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Quick date ranges">
              {QUICK_PICKS.map((pick) => (
                <button
                  key={pick.id}
                  type="button"
                  aria-pressed={form.preset === pick.id}
                  onClick={() => choosePreset(pick.id)}
                  className={`rounded-full border px-3 py-1 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                    form.preset === pick.id
                      ? 'border-primary bg-indigo-50 text-primary'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {pick.label}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <FormField label="From" name="from" type="date" max={form.to || today} value={form.from} onChange={handleChange} />
              <FormField label="To" name="to" type="date" min={form.from || undefined} max={today} value={form.to} onChange={handleChange} />
            </div>
            <p className="mt-1 text-xs text-slate-500">Both days are included. Days follow your time zone ({timeZone}).</p>
          </div>

          <FormField
            as="textarea"
            label="Notes (optional)"
            name="notes"
            rows={3}
            maxLength={500}
            placeholder="Payment details, thank-you note..."
            value={form.notes}
            onChange={handleChange}
          />

          <section aria-label="Preview" aria-live="polite" className="rounded-xl border border-slate-200 bg-slate-50 p-4" data-testid="invoice-preview">
            {!form.clientId ? (
              <p className="text-sm text-slate-500">Pick a client to see what will be billed.</p>
            ) : previewLoading ? (
              <p className="text-sm text-slate-500">Checking unbilled time...</p>
            ) : previewError ? (
              <p className="text-sm font-medium text-red-600" role="alert">
                {previewError}
              </p>
            ) : preview ? (
              <>
                <ul className="divide-y divide-slate-200">
                  {preview.lineItems.map((line) => (
                    <li key={line.projectId} className="flex items-start justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{line.projectName}</p>
                        <p className="font-mono text-xs text-slate-500">
                          {line.hours.toFixed(2)} h × {formatCurrency(line.hourlyRate, preview.currency)}
                        </p>
                      </div>
                      <p className="shrink-0 font-mono font-medium text-slate-900">{formatCurrency(line.amount, preview.currency)}</p>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center justify-between border-t border-slate-300 pt-3">
                  <p className="text-sm text-slate-600">
                    {preview.entryCount} {preview.entryCount === 1 ? 'entry' : 'entries'} · {formatDateRange(form.from, form.to)}
                  </p>
                  <p className="font-mono text-lg font-semibold text-slate-900" data-testid="preview-total">
                    {formatCurrency(preview.total, preview.currency)}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">Choose the dates to see what will be billed.</p>
            )}
          </section>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canCreate} loading={submitting}>
              Create invoice
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
