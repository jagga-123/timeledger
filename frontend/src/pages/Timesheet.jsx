import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/PageHeader';
import PageLoader from '../components/PageLoader';
import EmptyState from '../components/EmptyState';
import SummaryCard from '../components/SummaryCard';
import Button from '../components/Button';
import Badge from '../components/Badge';
import { useAuth } from '../hooks/useAuth';
import { getTimesheet } from '../api/timesheet';
import { getErrorMessage } from '../utils/errors';
import {
  addDaysToDateKey,
  currentWeekKey,
  dateKeyInZone,
  formatCurrency,
  formatDuration,
  formatWeekRange,
  isMondayKey,
} from '../utils/time';

// Clicking a cell opens Time entries for that project and that day. overlap=1 also lists an entry that
// started the evening before but has time in this day, so the list always explains the cell.
const entriesLink = (projectId, date) =>
  `/time-entries?projectId=${projectId}&from=${date}&to=${date}&overlap=1`;

const isWeekend = (index) => index >= 5; // Saturday, Sunday

export default function Timesheet() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const timeZone = user.timezone;

  const thisWeek = currentWeekKey(timeZone);
  const todayKey = dateKeyInZone(new Date(), timeZone);

  // The selected week lives in the URL (?week=2026-03-09). Without it, or when it isn't a Monday or
  // is in the future, the current week is shown.
  const requested = searchParams.get('week');
  const week = requested && isMondayKey(requested) && requested <= thisWeek ? requested : thisWeek;

  useEffect(() => {
    if (requested && requested !== week) setSearchParams({ week }, { replace: true }); // repair a bad link
  }, [requested, week, setSearchParams]);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getTimesheet(week)
      .then((result) => !cancelled && setData(result))
      .catch((err) => !cancelled && toast.error(getErrorMessage(err)))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [week, timeZone]);

  const goToWeek = (key) => setSearchParams({ week: key });

  const navigator = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center rounded-lg border border-slate-300 bg-white">
        <button
          type="button"
          onClick={() => goToWeek(addDaysToDateKey(week, -7))}
          aria-label="Previous week"
          className="rounded-l-lg p-2 text-slate-600 transition hover:bg-slate-50"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="min-w-36 px-2 text-center text-sm font-medium text-slate-900" data-testid="week-label" aria-live="polite">
          {formatWeekRange(week, addDaysToDateKey(week, 6))}
        </span>
        <button
          type="button"
          onClick={() => goToWeek(addDaysToDateKey(week, 7))}
          disabled={week >= thisWeek}
          aria-label="Next week"
          className="rounded-r-lg p-2 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <Button variant="secondary" onClick={() => goToWeek(thisWeek)} disabled={week === thisWeek}>
        This week
      </Button>
    </div>
  );

  const renderGrid = () => {
    const { days, rows, dayTotals } = data;

    return (
      <>
        {/* Desktop: a grid with a row per project and a column per day */}
        <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white lg:block">
          <table className="w-full table-fixed text-sm" data-testid="timesheet-grid">
            <thead>
              <tr className="border-b border-slate-200">
                <th scope="col" className="w-52 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Project
                </th>
                {days.map((day, index) => (
                  <th
                    key={day.date}
                    scope="col"
                    data-today={day.date === todayKey}
                    className={`px-1 py-3 text-center text-xs font-semibold ${
                      day.date === todayKey
                        ? 'bg-indigo-50 text-primary'
                        : isWeekend(index)
                          ? 'bg-slate-50 text-slate-400'
                          : 'text-slate-600'
                    }`}
                  >
                    {day.label}
                  </th>
                ))}
                <th scope="col" className="w-24 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Total
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.project._id}>
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: row.project.color }}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{row.project.name}</p>
                        <p className="truncate text-xs text-slate-500">{row.client.name}</p>
                      </div>
                    </div>
                  </th>

                  {row.seconds.map((seconds, index) => {
                    const day = days[index];
                    return (
                      <td
                        key={day.date}
                        className={`px-1 py-3 text-center ${
                          day.date === todayKey ? 'bg-indigo-50' : isWeekend(index) ? 'bg-slate-50' : ''
                        }`}
                      >
                        {seconds > 0 ? (
                          <Link
                            to={entriesLink(row.project._id, day.date)}
                            title={`Show ${row.project.name} entries for ${day.label}`}
                            className="rounded px-1 font-mono text-slate-900 hover:bg-white hover:text-primary hover:underline"
                          >
                            {formatDuration(seconds)}
                          </Link>
                        ) : (
                          <span className="text-slate-300" aria-label="no time">
                            —
                          </span>
                        )}
                      </td>
                    );
                  })}

                  <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                    {formatDuration(row.totalSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr className="border-t border-slate-200 font-semibold">
                <th scope="row" className="px-4 py-3 text-left text-slate-900">
                  Daily total
                </th>
                {dayTotals.map((seconds, index) => (
                  <td
                    key={days[index].date}
                    className={`px-1 py-3 text-center font-mono ${
                      days[index].date === todayKey ? 'bg-indigo-50' : isWeekend(index) ? 'bg-slate-50' : ''
                    }`}
                  >
                    {seconds > 0 ? formatDuration(seconds) : <span className="font-normal text-slate-300">—</span>}
                  </td>
                ))}
                <td className="px-4 py-3 text-right font-mono text-slate-900">{formatDuration(data.weekTotalSeconds)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Phones and tablets: one card per day */}
        <ul className="space-y-3 lg:hidden" data-testid="timesheet-days">
          {days.map((day, index) => {
            const projectsThatDay = rows.filter((row) => row.seconds[index] > 0);
            const isToday = day.date === todayKey;

            return (
              <li
                key={day.date}
                data-today={isToday}
                className={`rounded-xl border p-4 ${
                  isToday ? 'border-primary/40 bg-indigo-50' : isWeekend(index) ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className={`flex items-center gap-2 font-semibold ${isWeekend(index) && !isToday ? 'text-slate-500' : 'text-slate-900'}`}>
                    {day.label}
                    {isToday && <Badge tone="primary">Today</Badge>}
                  </h3>
                  <p className="font-mono text-sm font-semibold text-slate-900">
                    {dayTotals[index] > 0 ? formatDuration(dayTotals[index]) : <span className="font-normal text-slate-300">—</span>}
                  </p>
                </div>

                {projectsThatDay.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-400">No time tracked</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {projectsThatDay.map((row) => (
                      <li key={row.project._id}>
                        <Link
                          to={entriesLink(row.project._id, day.date)}
                          className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-white"
                        >
                          <span
                            className="h-3 w-3 shrink-0 rounded-full"
                            style={{ backgroundColor: row.project.color }}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-900">{row.project.name}</span>
                            <span className="block truncate text-xs text-slate-500">{row.client.name}</span>
                          </span>
                          <span className="shrink-0 font-mono text-sm text-slate-900">{formatDuration(row.seconds[index])}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </>
    );
  };

  return (
    <>
      <PageHeader
        title="Timesheet"
        description={`Times shown in ${data?.timezone ?? timeZone}`}
        action={navigator}
      />

      {data === null ? (
        <PageLoader compact />
      ) : (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={loading}>
          {data.rows.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No time tracked this week"
              description="Hours you track with the timer or add by hand show up here, per project and day."
              action={<Button onClick={() => navigate('/')}>Go to Dashboard</Button>}
            />
          ) : (
            <>
              <div className="mb-6 grid gap-3 sm:grid-cols-3" data-testid="summary">
                <SummaryCard label="Total hours" value={formatDuration(data.weekTotalSeconds)} />
                <SummaryCard label="Billable hours" value={formatDuration(data.billableSeconds)} />
                <SummaryCard label="Billable amount" value={formatCurrency(data.billableAmount, user.currency)} />
              </div>
              {renderGrid()}
            </>
          )}
        </div>
      )}
    </>
  );
}
