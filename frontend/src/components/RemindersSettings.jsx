import { useState } from 'react';
import toast from 'react-hot-toast';
import { Bell } from 'lucide-react';
import FormField from './FormField';
import Switch from './Switch';
import Button from './Button';
import { useAuth } from '../hooks/useAuth';
import { handleFormError } from '../utils/errors';
import { AFTER_DAY_CHOICES, DAYS_BEFORE_OPTIONS, reminderSummary } from '../utils/reminders';

const fromUser = (user) => ({
  enabled: user.reminders?.enabled ?? true,
  beforeDueDays: user.reminders?.beforeDueDays ?? 3,
  onDueDate: user.reminders?.onDueDate ?? true,
  afterDueDays: [...(user.reminders?.afterDueDays ?? [7, 14])].sort((a, b) => a - b),
});

// Settings: when the client is reminded about an invoice that was sent and is not paid yet
export default function RemindersSettings() {
  const { user, updateProfile } = useAuth();
  const saved = fromUser(user);
  const [form, setForm] = useState(saved);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const changed = JSON.stringify(form) !== JSON.stringify(saved);
  const change = (fields) => {
    setForm((current) => ({ ...current, ...fields }));
    setErrors({});
  };

  // 7, 14 and 30 to pick from (and anything else that was saved through the API, so nothing is hidden)
  const choices = [...new Set([...AFTER_DAY_CHOICES, ...form.afterDueDays])].sort((a, b) => a - b);
  const toggleDay = (day) =>
    change({ afterDueDays: form.afterDueDays.includes(day) ? form.afterDueDays.filter((d) => d !== day) : [...form.afterDueDays, day].sort((a, b) => a - b) });

  const handleSubmit = async (e) => {
    e.preventDefault();
    toast.dismiss();
    setErrors({});
    setSaving(true);

    try {
      await updateProfile({ reminders: form });
      toast.success('Reminder settings saved');
    } catch (err) {
      handleFormError(err, setErrors);
    } finally {
      setSaving(false);
    }
  };

  const problem = Object.values(errors)[0];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 sm:p-6" data-testid="reminders-settings">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Bell size={18} className="text-primary" />
          Payment reminders
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          TimeLedger e-mails your client about an invoice you have sent and that is not paid yet. You can pause the reminders of one invoice on its page.
        </p>
      </div>

      <Switch checked={form.enabled} onChange={(enabled) => change({ enabled })} label="Send payment reminders automatically" />

      <div className={`space-y-5 ${form.enabled ? '' : 'pointer-events-none opacity-50'}`} aria-disabled={!form.enabled}>
        <FormField
          as="select"
          label="Before the due date"
          name="beforeDueDays"
          value={form.beforeDueDays}
          disabled={!form.enabled}
          onChange={(e) => change({ beforeDueDays: Number(e.target.value) })}
        >
          {DAYS_BEFORE_OPTIONS.map((count) => (
            <option key={count} value={count}>
              {count === 0 ? 'No reminder before the due date' : `Remind ${count} ${count === 1 ? 'day' : 'days'} before`}
            </option>
          ))}
        </FormField>

        <Switch checked={form.onDueDate} onChange={(onDueDate) => change({ onDueDate })} disabled={!form.enabled} label="On the due date" />

        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">After the due date</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Days after the due date">
            {choices.map((day) => {
              const on = form.afterDueDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  disabled={!form.enabled || (!on && form.afterDueDays.length >= 3)}
                  onClick={() => toggleDay(day)}
                  className={`rounded-full border px-3 py-1 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 ${
                    on ? 'border-primary bg-indigo-50 text-primary' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {day} days
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-slate-500">Pick up to 3. Each one is sent once, on that day after the due date.</p>
        </div>
      </div>

      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="reminder-summary" aria-live="polite">
        {reminderSummary(form)}
      </p>

      {problem && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {problem}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" loading={saving} disabled={!changed}>
          Save reminders
        </Button>
      </div>
    </form>
  );
}
