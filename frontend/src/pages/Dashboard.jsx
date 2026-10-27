import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Lock, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/PageHeader';
import PageLoader from '../components/PageLoader';
import TimerCard from '../components/TimerCard';
import IconButton from '../components/IconButton';
import EntryFormModal from '../components/EntryFormModal';
import { useAuth } from '../hooks/useAuth';
import { useTimer } from '../hooks/useTimer';
import { getEntries } from '../api/entries';
import { getTimesheet } from '../api/timesheet';
import { getErrorMessage } from '../utils/errors';
import { dayRangeInZone, formatClock, formatDuration, formatWeekRange } from '../utils/time';

export default function Dashboard() {
  const { user } = useAuth();
  const { stoppedCount } = useTimer();
  const [entries, setEntries] = useState(null); // null = loading
  const [week, setWeek] = useState(null); // this week's timesheet, null = loading
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(null); // the entry open in the edit modal

  // Today's finished entries; reloads whenever a timer stops (here or on another device) or an entry is edited
  useEffect(() => {
    let cancelled = false;
    const { from, to } = dayRangeInZone(user.timezone);

    getEntries({ from: from.toISOString(), to: to.toISOString() })
      .then(({ entries: list }) => !cancelled && setEntries(list))
      .catch((err) => {
        if (cancelled) return;
        toast.error(getErrorMessage(err));
        setEntries([]);
      });

    return () => {
      cancelled = true;
    };
  }, [user.timezone, stoppedCount, reloadKey]);

  // The "This week" card follows the same triggers
  useEffect(() => {
    let cancelled = false;

    getTimesheet()
      .then((result) => !cancelled && setWeek(result))
      .catch(() => {
        // the card keeps showing a dash; the Today list already reports connection problems
      });

    return () => {
      cancelled = true;
    };
  }, [user.timezone, stoppedCount, reloadKey]);

  const totalSeconds = (entries ?? []).reduce((sum, entry) => sum + entry.durationSeconds, 0);

  return (
    <>
      <PageHeader title="Dashboard" description={`Welcome, ${user.name}`} />

      <TimerCard />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="week-heading" className="lg:order-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 id="week-heading" className="text-sm font-medium text-slate-500">
              This week
            </h2>
            <p className="mt-1 font-mono text-3xl font-semibold text-slate-900" data-testid="week-total">
              {week ? formatDuration(week.weekTotalSeconds) : '—'}
            </p>
            {week && <p className="mt-1 text-xs text-slate-500">{formatWeekRange(week.weekStart, week.weekEnd)}</p>}
            <Link
              to="/timesheet"
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              View timesheet
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section aria-labelledby="today-heading" className="lg:order-1 lg:col-span-2">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 id="today-heading" className="text-lg font-semibold text-slate-900">
              Today
            </h2>
            {entries?.length > 0 && (
              <p className="text-sm text-slate-500">
                Total <span className="font-mono font-medium text-slate-900">{formatClock(totalSeconds)}</span>
              </p>
            )}
          </div>

          {entries === null ? (
            <PageLoader compact />
          ) : entries.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
              Nothing tracked yet today. Stopped timers will show up here.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {entries.map((entry) => (
                <li key={entry._id} className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: entry.project?.color }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">
                      {entry.project?.name}
                      <span className="font-normal text-slate-500"> · {entry.client?.name}</span>
                    </p>
                    <p className="truncate text-sm text-slate-500">{entry.description || 'No description'}</p>
                  </div>
                  <p className="shrink-0 font-mono text-sm font-medium text-slate-900">
                    {formatClock(entry.durationSeconds)}
                  </p>
                  <div className="flex w-9 shrink-0 justify-end">
                    {entry.invoiceId ? (
                      <span
                        className="p-2 text-slate-400"
                        title="This entry is on an invoice and can't be changed"
                        role="img"
                        aria-label="Billed: this entry is on an invoice and can't be changed"
                      >
                        <Lock size={18} />
                      </span>
                    ) : (
                      <IconButton icon={Pencil} label="Edit entry" onClick={() => setEditing(entry)} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {editing && (
        <EntryFormModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReloadKey((key) => key + 1);
          }}
        />
      )}
    </>
  );
}
