// An on/off toggle with a label, e.g. <Switch checked={billable} onChange={setBillable} label="Billable" />
export default function Switch({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 rounded-lg py-1 text-sm font-medium text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
    >
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : ''
          }`}
        />
      </span>
      {label}
    </button>
  );
}
