import { useState } from 'react';
import toast from 'react-hot-toast';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';
import Switch from '../components/Switch';
import Button from '../components/Button';
import { useAuth } from '../hooks/useAuth';
import { handleFormError } from '../utils/errors';

const ROUNDING_MINUTES = 15;

export default function Settings() {
  const { user, updateProfile } = useAuth();
  const savedRounding = user.roundingMinutes === ROUNDING_MINUTES;

  const [name, setName] = useState(user.name);
  const [rounding, setRounding] = useState(savedRounding);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const changed = name.trim() !== user.name || rounding !== savedRounding;

  const handleSubmit = async (e) => {
    e.preventDefault();
    toast.dismiss();
    setErrors({});
    setSaving(true);

    try {
      const saved = await updateProfile({ name, roundingMinutes: rounding ? ROUNDING_MINUTES : 0 });
      setName(saved.name); // the server trims the name
      toast.success('Settings saved');
    } catch (err) {
      handleFormError(err, setErrors);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Settings" description="Your name, your time zone and how time is billed." />

      <form onSubmit={handleSubmit} noValidate className="max-w-xl space-y-6 rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <FormField
          label="Name"
          name="name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setErrors({ ...errors, name: undefined });
          }}
          error={errors.name}
        />

        <div>
          <label htmlFor="timezone" className="mb-1 block text-sm font-medium text-slate-700">
            Time zone
          </label>
          <input
            id="timezone"
            type="text"
            readOnly
            value={user.timezone}
            className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 outline-none"
          />
          <p className="mt-1 text-xs text-slate-500">
            Detected from this device and kept up to date by itself. Days, weeks and invoice periods follow it.
          </p>
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">Invoices</p>
          <Switch checked={rounding} onChange={setRounding} label={`Round each entry up to ${ROUNDING_MINUTES} minutes`} />
          <p className="mt-1 text-xs text-slate-500">
            Your tracked time never changes. When you create an invoice, each entry is billed in blocks of {ROUNDING_MINUTES} minutes
            (7 min becomes {ROUNDING_MINUTES} min, 22 min becomes 30 min). Invoices you have already created are not affected.
          </p>
        </div>

        <div className="flex justify-end">
          <Button type="submit" loading={saving} disabled={!changed}>
            Save changes
          </Button>
        </div>
      </form>
    </>
  );
}
