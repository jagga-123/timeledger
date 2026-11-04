// A small "label + big number" card, e.g. <SummaryCard label="Total hours" value="8h 45m" />
// note: an optional line below the number (noteTone "danger" makes it red)
export default function SummaryCard({ label, value, note, noteTone }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold text-slate-900">{value}</p>
      {note && <p className={`mt-1 text-xs font-medium ${noteTone === 'danger' ? 'text-red-600' : 'text-slate-500'}`}>{note}</p>}
    </div>
  );
}
