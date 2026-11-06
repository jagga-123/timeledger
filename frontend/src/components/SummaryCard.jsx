const VALUE_TONES = {
  danger: 'text-red-600',
  success: 'text-emerald-600',
};

// A small "label + big number" card, e.g. <SummaryCard label="Total hours" value="8h 45m" />
// note: an optional line below the number (noteTone "danger" makes it red)
// tone: "danger" (red) or "success" (emerald) colours the number itself
export default function SummaryCard({ label, value, note, noteTone, tone, testId }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid={testId}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-semibold ${VALUE_TONES[tone] ?? 'text-slate-900'}`}>{value}</p>
      {note && <p className={`mt-1 text-xs font-medium ${noteTone === 'danger' ? 'text-red-600' : 'text-slate-500'}`}>{note}</p>}
    </div>
  );
}
