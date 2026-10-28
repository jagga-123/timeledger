import { NavLink, Outlet } from 'react-router-dom';
import {
  CalendarDays,
  Clock,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Settings as SettingsIcon,
  Timer,
  Users,
} from 'lucide-react';
import MiniTimer from '../components/MiniTimer';
import { useAuth } from '../hooks/useAuth';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/time-entries', label: 'Time Entries', shortLabel: 'Entries', icon: Timer },
  { to: '/timesheet', label: 'Timesheet', icon: CalendarDays },
  { to: '/invoices', label: 'Invoices', icon: FileText },
];

// Not in the phone's bottom bar (it has no room for a seventh tab); there it is a gear in the top bar
const settingsItem = { to: '/settings', label: 'Settings', icon: SettingsIcon };

// compact: a little smaller on phones, so the top bar still fits a running timer, Settings and Log out
function Logo({ compact = false }) {
  return (
    <div className={`flex items-center gap-2 font-bold text-white ${compact ? 'text-base sm:text-lg' : 'text-lg'}`}>
      <Clock size={24} className={compact ? 'h-5 w-5 sm:h-6 sm:w-6' : undefined} />
      TimeLedger
    </div>
  );
}

// Desktop: fixed sidebar. Mobile: top bar + bottom tab bar.
export default function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-sidebar md:flex print:hidden">
        <div className="px-6 py-6">
          <Logo />
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {[...navItems, settingsItem].map(({ to, label, icon: Icon, end }) => (
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

        <div className="px-3 pb-3 empty:hidden">
          <MiniTimer />
        </div>

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

      <header className="sticky top-0 z-30 flex items-center justify-between bg-sidebar px-4 py-3 md:hidden print:hidden">
        <Logo compact />
        <div className="flex items-center">
          <MiniTimer />
          <NavLink
            to="/settings"
            aria-label="Settings"
            title="Settings"
            className={({ isActive }) =>
              `rounded-lg p-2 transition hover:bg-indigo-900 hover:text-white ${isActive ? 'bg-indigo-800 text-white' : 'text-indigo-200'}`
            }
          >
            <SettingsIcon size={20} />
          </NavLink>
          <button
            type="button"
            onClick={logout}
            aria-label="Log out"
            title="Log out"
            className="rounded-lg p-2 text-indigo-200 transition hover:bg-indigo-900 hover:text-white"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="md:pl-64 print:pl-0">
        <div className="mx-auto max-w-5xl px-4 py-6 pb-24 sm:px-6 md:px-8 md:py-8 md:pb-8 print:max-w-none print:p-0">
          <Outlet />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-slate-200 bg-white md:hidden print:hidden">
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
