import { useEffect, useState } from 'react';
import { Lock, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/PageHeader';
import PageLoader from '../components/PageLoader';
import TimerCard from '../components/TimerCard';
import IconButton from '../components/IconButton';
import EntryFormModal from '../components/EntryFormModal';
import { useAuth } from '../hooks/useAuth';
import { useTimer } from '../hooks/useTimer';
import { getEntries } from '../api/entries';
import { getErrorMessage } from '../utils/errors';
import { dayRangeInZone, formatClock } from '../utils/time';

export default function Dashboard() {
  const { user } = useAuth();
  const { stoppedCount } = useTimer();
  const [entries, setEntries] = useState(null); // null = loading
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

  const totalSeconds = (entries ?? []).reduce((sum, entry) => sum + entry.durationSeconds, 0);

  return (
    <>
      <PageHeader title="Dashboard" description={`Welcome, ${user.name}`} />

      <TimerCard />

      <section className="mt-8" aria-labelledby="today-heading">
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
