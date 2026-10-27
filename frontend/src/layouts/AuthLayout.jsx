import { Clock } from 'lucide-react';

// Centered card shared by the login and register pages
export default function AuthLayout({ title, subtitle, children }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-primary">
          <Clock size={32} />
          <span className="text-2xl font-bold">TimeLedger</span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-slate-500">{subtitle}</p>
          {children}
        </div>
      </div>
    </main>
  );
}
