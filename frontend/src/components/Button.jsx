import { Loader2 } from 'lucide-react';

export default function Button({ loading = false, disabled, children, ...props }) {
  return (
    <button
      disabled={loading || disabled}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
      {...props}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}
