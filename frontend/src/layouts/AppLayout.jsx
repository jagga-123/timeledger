import { NavLink, Outlet } from 'react-router-dom';
import {
  CalendarDays,
  Clock,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Timer,
  Users,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/time-entries', label: 'Time Entries', shortLabel: 'Entries', icon: Timer },
  { to: '/timesheet', label: 'Timesheet', icon: CalendarDays },
  { to: '/invoices', label: 'Invoices', icon: FileText },
];

function Logo() {
  return (
    <div className="flex items-center gap-2 text-lg font-bold text-white">
      <Clock size={24} />
      TimeLedger
    </div>
  );
}

// Desktop: fixed sidebar. Mobile: top bar + bottom tab bar.
export default function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-sidebar md:flex">
        <div className="px-6 py-6">
          <Logo />
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-indigo-800 text-white'
                    : 'text-indigo-200 hover:bg-indigo-900 hover:text-white'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3 border-t border-white/10 px-4 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-800 text-sm font-semibold text-white">
            {user.name[0].toUpperCase()}
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">{user.name}</p>
          <button
            type="button"
            onClick={logout}
            aria-label="Log out"
            title="Log out"
            className="rounded-lg p-2 text-indigo-200 transition hover:bg-indigo-900 hover:text-white"
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between bg-sidebar px-4 py-3 md:hidden">
        <Logo />
        <button
          type="button"
          onClick={logout}
          aria-label="Log out"
          title="Log out"
          className="rounded-lg p-2 text-indigo-200 transition hover:bg-indigo-900 hover:text-white"
        >
          <LogOut size={20} />
        </button>
      </header>

      <main className="md:pl-64">
        <div className="mx-auto max-w-5xl px-4 py-6 pb-24 sm:px-6 md:px-8 md:py-8 md:pb-8">
          <Outlet />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-slate-200 bg-white md:hidden">
        {navItems.map(({ to, label, shortLabel, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 px-1 py-2 text-[10px] font-medium ${
                isActive ? 'text-primary' : 'text-slate-500'
              }`
            }
          >
            <Icon size={20} />
            <span className="max-w-full truncate">{shortLabel || label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
