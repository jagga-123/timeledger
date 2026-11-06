import { useState } from 'react';
import toast from 'react-hot-toast';
import { CreditCard } from 'lucide-react';
import FormField from './FormField';
import Button from './Button';
import { useAuth } from '../hooks/useAuth';
import { handleFormError } from '../utils/errors';
import { upiHandleWarning } from '../utils/upiHandles';

const fromUser = (user) => ({ link: user.payment?.link ?? '', upiId: user.payment?.upiId ?? '', bankDetails: user.payment?.bankDetails ?? '' });

// Settings: how the client can pay. All optional. Shown on invoice e-mails, reminders and the public invoice page.
export default function PaymentSettings() {
  const { user, updateProfile } = useAuth();
  const saved = fromUser(user);
  const [form, setForm] = useState(saved);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [typingUpi, setTypingUpi] = useState(false); // the amber note waits until the person has finished typing the UPI ID

  const changed = Object.keys(form).some((field) => form[field].trim() !== saved[field]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    if (name === 'upiId') setTypingUpi(true);
  };

  // Leaving the UPI ID field: show it the way it will be saved (no spaces around it, lower case) and look at its handle
  const handleUpiBlur = () => {
    setForm((current) => ({ ...current, upiId: current.upiId.trim().toLowerCase() }));
    setTypingUpi(false);
  };

  // A handle we don't know (@okhdfcnk) is only a warning: it is saved all the same
  const upiWarning = typingUpi || errors.upiId ? '' : upiHandleWarning(form.upiId);

  const handleSubmit = async (e) => {
    e.preventDefault();
    toast.dismiss();
    setErrors({});
    setSaving(true);

    try {
      const updated = await updateProfile({ payment: form });
      setForm(fromUser(updated)); // the server trims the text
      toast.success('Payment details saved');
    } catch (err) {
      // the server names the fields payment.link, payment.upiId and payment.bankDetails
      handleFormError(err, (fieldErrors) =>
        setErrors(Object.fromEntries(Object.entries(fieldErrors).map(([path, message]) => [path.replace(/^payment\./, ''), message])))
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 sm:p-6" data-testid="payment-settings">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <CreditCard size={18} className="text-primary" />
          Payment details
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          All optional. With a payment link, your invoice e-mails, reminders and the invoice page your client opens get a <span className="font-medium text-slate-700">Pay now</span> button; the UPI ID and bank details are shown below it.
        </p>
      </div>

      <FormField
        label="Payment link"
        name="link"
        type="url"
        autoComplete="off"
        placeholder="https://rzp.io/l/yourname"
        value={form.link}
        onChange={handleChange}
        error={errors.link}
      />
      <p className="-mt-3 text-xs text-slate-500">A Stripe, PayPal or Razorpay payment link. It must start with https://.</p>

      <FormField
        label="UPI ID"
        name="upiId"
        type="text"
        autoComplete="off"
        placeholder="yourname@okhdfcbank"
        value={form.upiId}
        onChange={handleChange}
        onBlur={handleUpiBlur}
        error={errors.upiId}
        warning={upiWarning}
      />

      <FormField
        as="textarea"
        label="Bank details"
        name="bankDetails"
        rows={4}
        maxLength={500}
        placeholder={'Account name, bank, account number, IFSC / SWIFT'}
        value={form.bankDetails}
        onChange={handleChange}
        error={errors.bankDetails}
      />

      <div className="flex justify-end">
        <Button type="submit" loading={saving} disabled={!changed}>
          Save payment details
        </Button>
      </div>
    </form>
  );
}
