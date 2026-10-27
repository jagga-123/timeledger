import { Clock, LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

// Placeholder: the real dashboard comes in a later step
export default function Dashboard() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen">
      <header className="bg-sidebar text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 font-bold">
            <Clock size={22} />
            TimeLedger
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition hover:bg-white/10"
          >
            <LogOut size={16} />
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-slate-600">Welcome, {user.name}</p>
      </main>
    </div>
  );
}
