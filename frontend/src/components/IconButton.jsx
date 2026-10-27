export default function IconButton({ icon: Icon, label, danger = false, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`rounded-lg p-2 text-slate-400 transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${
        danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-slate-100 hover:text-slate-700'
      }`}
      {...props}
    >
      <Icon size={18} />
    </button>
  );
}
