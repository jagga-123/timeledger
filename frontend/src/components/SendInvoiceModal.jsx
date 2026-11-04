import { useState } from 'react';
import toast from 'react-hot-toast';
import { Send } from 'lucide-react';
import Modal from './Modal';
import FormField from './FormField';
import Button from './Button';
import { sendInvoice } from '../api/invoices';
import { handleFormError } from '../utils/errors';
import { formatCurrency, formatDate } from '../utils/time';

// "a@x.com, b@y.com" -> ['a@x.com', 'b@y.com']
const parseAddresses = (text) => text.split(/[\s,;]+/).filter(Boolean);

// Email the invoice to the client. Render it only while it should be open.
// onSent(result) gets the server's { invoice, sentTo, shareUrl }.
export default function SendInvoiceModal({ invoice, onClose, onSent }) {
  const resending = Boolean(invoice.sentAt);
  const [form, setForm] = useState({ to: invoice.defaultRecipient ?? '', cc: '', message: '' });
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    toast.dismiss();
    setErrors({});
    setSending(true);

    try {
      const result = await sendInvoice(invoice._id, {
        to: form.to.trim() || undefined,
        cc: parseAddresses(form.cc),
        message: form.message.trim() || undefined,
      });
      toast.success(`Invoice sent to ${result.sentTo}`);
      onSent(result);
    } catch (err) {
      // 400s go under their fields (the server's cc errors are named cc.0, cc.1, ...); a 502 or 409 is a toast and the form stays
      handleFormError(err, (fieldErrors) => {
        const cc = Object.entries(fieldErrors).find(([path]) => path === 'cc' || path.startsWith('cc.'))?.[1];
        setErrors({ ...fieldErrors, ...(cc && { cc }) });
      });
      setSending(false);
    }
  };

  return (
    <Modal title={resending ? 'Resend invoice' : 'Send invoice'} onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <FormField
          label="To"
          name="to"
          type="email"
          autoComplete="off"
          autoFocus={!form.to}
          placeholder="client@company.com"
          value={form.to}
          onChange={handleChange}
          error={errors.to}
        />
        <FormField
          label="CC (optional)"
          name="cc"
          type="text"
          autoComplete="off"
          placeholder="Separate several addresses with commas"
          value={form.cc}
          onChange={handleChange}
          error={errors.cc}
        />
        <FormField
          as="textarea"
          label="Personal message (optional)"
          name="message"
          rows={4}
          maxLength={1000}
          placeholder="Hi, here is the invoice for last month. Thank you!"
          value={form.message}
          onChange={handleChange}
          error={errors.message}
        />

        <section aria-label="Email preview" className="rounded-xl border border-slate-200 bg-slate-50 p-4" data-testid="email-preview">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subject</p>
          <p className="mt-1 break-words font-medium text-slate-900" data-testid="email-subject">
            Invoice {invoice.number} from {invoice.from.name}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            The email shows the total ({formatCurrency(invoice.total, invoice.currency)}), the due date ({formatDate(invoice.dueDate, invoice.timezone)}) and a{' '}
            <span className="font-medium text-slate-700">View invoice</span> button. Your client opens it without logging in, and replies go to you ({invoice.from.email}).
          </p>
        </section>

        {resending && invoice.sentTo && (
          <p className="text-xs text-slate-500">
            Last sent to {invoice.sentTo} on {formatDate(invoice.lastSentAt ?? invoice.sentAt, invoice.timezone)}. Sending again only sends another email.
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button type="submit" loading={sending}>
            <Send size={16} />
            {resending ? 'Resend invoice' : 'Send invoice'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
