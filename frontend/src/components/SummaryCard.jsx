// A small "label + big number" card, e.g. <SummaryCard label="Total hours" value="8h 45m" />
export default function SummaryCard({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
