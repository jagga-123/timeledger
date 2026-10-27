import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock, Lock, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/PageHeader';
import SummaryCard from '../components/SummaryCard';
import PageLoader from '../components/PageLoader';
import EmptyState from '../components/EmptyState';
import Button from '../components/Button';
import Badge from '../components/Badge';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import EntryFormModal from '../components/EntryFormModal';
import { useAuth } from '../hooks/useAuth';
import { getClients } from '../api/clients';
import { getProjects } from '../api/projects';
import { getEntries, deleteEntry } from '../api/entries';
import { getErrorMessage } from '../utils/errors';
import {
  customRange,
  dateKeyInZone,
  formatCurrency,
  formatDayHeading,
  formatDuration,
  presetRange,
  timeOfDayInZone,
} from '../utils/time';

const DEFAULT_FILTERS = {
  preset: 'this-week', // this-week | last-week | this-month | custom
  overlap: false, // match entries that merely touch the date range (set by timesheet links)
  from: '', // custom range, "YYYY-MM-DD"
  to: '',
  clientId: '',
  projectId: '',
  billable: 'all', // all | billable | non-billable
  status: 'all', // all | unbilled | billed
};

// The page can be opened with filters already set, e.g. from the Timesheet:
// /time-entries?projectId=<id>&from=2026-03-10&to=2026-03-10 (also clientId, billable, status).
// Only used for the starting filters; unknown or malformed values are ignored.
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const filtersFromUrl = (params) => {
  const filters = { ...DEFAULT_FILTERS };

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  if (DATE_KEY.test(from) || DATE_KEY.test(to)) {
    filters.preset = 'custom';
    filters.from = DATE_KEY.test(from) ? from : '';
    filters.to = DATE_KEY.test(to) ? to : '';
    // From the timesheet: an entry that crosses midnight belongs to both of its days
    filters.overlap = params.get('overlap') === '1';
  }
  for (const name of ['clientId', 'projectId']) {
    if (OBJECT_ID.test(params.get(name) ?? '')) filters[name] = params.get(name);
  }
  if (['billable', 'non-billable'].includes(params.get('billable'))) filters.billable = params.get('billable');
  if (['unbilled', 'billed'].includes(params.get('status'))) filters.status = params.get('status');

  return filters;
};

const SELECT_CLASS =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20';

function Filter({ label, htmlFor, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}

function EntryBadge({ entry }) {
  if (entry.invoiceId) return <Badge tone="primary">Billed</Badge>;
  return entry.billable ? <Badge tone="success">Billable</Badge> : <Badge>Non-billable</Badge>;
}

export default function TimeEntries() {
  const { user } = useAuth();
  const timeZone = user.timezone;

  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => filtersFromUrl(searchParams));
  const [filtersOpen, setFiltersOpen] = useState(false); // phones only
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState(null);
  const [data, setData] = useState(null); // { entries, totals }; null until the first load
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState({ open: false, entry: null }); // entry = null means "add"
  const [entryToDelete, setEntryToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    Promise.all([getClients(), getProjects()])
      .then(([clientList, projectList]) => {
        setClients(clientList);
        setProjects(projectList);
      })
      .catch((err) => {
        toast.error(getErrorMessage(err));
        setProjects([]);
      });
  }, []);

  // The query for the current filters. Dates are turned into moments in the user's time zone.
  const query = useMemo(() => {
    const range =
      filters.preset === 'custom'
        ? customRange(filters.from, filters.to, timeZone)
        : presetRange(filters.preset, timeZone);

    return {
      from: range.from?.toISOString(),
      to: range.to?.toISOString(),
      clientId: filters.clientId || undefined,
      projectId: filters.projectId || undefined,
      overlap: filters.overlap ? 'true' : undefined,
      billable: { all: undefined, billable: 'true', 'non-billable': 'false' }[filters.billable],
      status: filters.status === 'all' ? undefined : filters.status,
    };
  }, [filters, timeZone]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getEntries(query)
      .then((result) => !cancelled && setData(result))
      .catch((err) => !cancelled && toast.error(getErrorMessage(err)))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [query, reloadKey]);

  const setFilter = (name, value) => {
    setFilters((current) => {
      const next = { ...current, [name]: value };
      if (name === 'clientId') next.projectId = ''; // the old project may belong to another client
      if (['preset', 'from', 'to'].includes(name)) next.overlap = false; // a date range chosen here matches by start day
      return next;
    });
  };

  const projectOptions = (projects ?? []).filter(
    (project) => !filters.clientId || project.clientId === filters.clientId
  );

  // Filters other than the date range, which always has a value
  const activeFilterCount = ['clientId', 'projectId'].filter((name) => filters[name]).length +
    (filters.billable !== 'all' ? 1 : 0) +
    (filters.status !== 'all' ? 1 : 0);

  const reload = () => setReloadKey((key) => key + 1);
  const openForm = (entry = null) => setForm({ open: true, entry });
  const closeForm = () => setForm({ open: false, entry: null });

  const handleSaved = () => {
    closeForm();
    reload();
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteEntry(entryToDelete._id);
      toast.success('Entry deleted');
      reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDeleting(false);
      setEntryToDelete(null);
    }
  };

  // Entries arrive newest first; group them by the day they started (in the user's time zone)
  const days = useMemo(() => {
    const byDay = new Map();
    for (const entry of data?.entries ?? []) {
      const key = dateKeyInZone(new Date(entry.startedAt), timeZone);
      if (!byDay.has(key)) byDay.set(key, { key, entries: [], seconds: 0 });
      const day = byDay.get(key);
      day.entries.push(entry);
      day.seconds += entry.durationSeconds;
    }
    return [...byDay.values()];
  }, [data, timeZone]);

  const addButton = (
    <Button onClick={() => openForm()}>
      <Plus size={16} />
      Add entry
    </Button>
  );

  // Keeps the date range (and how it matches), resets everything else
  const clearFilters = () =>
    setFilters((current) => ({
      ...DEFAULT_FILTERS,
      preset: current.preset,
      from: current.from,
      to: current.to,
      overlap: current.overlap,
    }));

  const renderEntries = () => {
    if (days.length === 0) {
      return activeFilterCount > 0 ? (
        <EmptyState
          icon={Clock}
          title="No entries match these filters"
          description="Try a different date range, or clear the filters."
          action={
            <Button variant="secondary" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={Clock}
          title="No time entries yet"
          description="Nothing tracked in this period. Add an entry by hand, or start the timer on the dashboard."
          action={addButton}
        />
      );
    }

    return (
      <div className="space-y-6">
        {days.map((day) => (
          <section key={day.key} aria-label={formatDayHeading(day.key, timeZone)}>
            <div className="mb-2 flex items-baseline justify-between gap-4 px-1">
              <h2 className="text-sm font-semibold text-slate-900">{formatDayHeading(day.key, timeZone)}</h2>
              <p className="font-mono text-sm font-medium text-slate-600">{formatDuration(day.seconds)}</p>
            </div>

            <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {day.entries.map((entry) => {
                const start = new Date(entry.startedAt);
                const end = new Date(entry.endedAt);
                const endsLater = dateKeyInZone(end, timeZone) !== day.key;

                return (
                  <li key={entry._id} className="flex items-start gap-3 px-4 py-3 sm:px-6">
                    <span
                      className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: entry.project?.color }}
                      aria-hidden="true"
                    />

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">
                        {entry.project?.name}
                        <span className="font-normal text-slate-500"> · {entry.client?.name}</span>
                      </p>
                      <p className="truncate text-sm text-slate-500">{entry.description || 'No description'}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono text-xs text-slate-500">
                          {timeOfDayInZone(start, timeZone)}–{timeOfDayInZone(end, timeZone)}
                          {endsLater && ' (+1 day)'}
                        </span>
                        <EntryBadge entry={entry} />
                      </div>
                    </div>

                    <p className="shrink-0 pt-0.5 font-mono text-sm font-medium text-slate-900">
                      {formatDuration(entry.durationSeconds)}
                    </p>

                    <div className="flex w-[4.5rem] shrink-0 items-center justify-end">
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
                        <>
                          <IconButton icon={Pencil} label="Edit entry" onClick={() => openForm(entry)} />
                          <IconButton icon={Trash2} label="Delete entry" danger onClick={() => setEntryToDelete(entry)} />
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    );
  };

  return (
    <>
      <PageHeader title="Time entries" description="Everything you've tracked, by hand or with the timer." action={addButton} />

      {/* Filters: always visible from tablet width up, behind a button on phones */}
      <div className="mb-4 md:hidden">
        <Button variant="secondary" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen}>
          <SlidersHorizontal size={16} />
          Filters
          {activeFilterCount > 0 && <Badge tone="primary">{activeFilterCount}</Badge>}
        </Button>
      </div>

      <div
        className={`${filtersOpen ? 'grid' : 'hidden'} mb-6 grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid md:grid-cols-3 lg:grid-cols-6`}
        role="group"
        aria-label="Filters"
      >
        <Filter label="Date range" htmlFor="filter-preset">
          <select id="filter-preset" value={filters.preset} onChange={(e) => setFilter('preset', e.target.value)} className={SELECT_CLASS}>
            <option value="this-week">This week</option>
            <option value="last-week">Last week</option>
            <option value="this-month">This month</option>
            <option value="custom">Custom range</option>
          </select>
        </Filter>

        {filters.preset === 'custom' && (
          <>
            <Filter label="From" htmlFor="filter-from">
              <input id="filter-from" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} className={SELECT_CLASS} />
            </Filter>
            <Filter label="To" htmlFor="filter-to">
              <input id="filter-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} className={SELECT_CLASS} />
            </Filter>
          </>
        )}

        <Filter label="Client" htmlFor="filter-client">
          <select id="filter-client" value={filters.clientId} onChange={(e) => setFilter('clientId', e.target.value)} className={SELECT_CLASS}>
            <option value="">All clients</option>
            {clients.map((client) => (
              <option key={client._id} value={client._id}>
                {client.name}
              </option>
            ))}
          </select>
        </Filter>

        <Filter label="Project" htmlFor="filter-project">
          <select id="filter-project" value={filters.projectId} onChange={(e) => setFilter('projectId', e.target.value)} className={SELECT_CLASS}>
            <option value="">All projects</option>
            {projectOptions.map((project) => (
              <option key={project._id} value={project._id}>
                {project.name}
              </option>
            ))}
          </select>
        </Filter>

        <Filter label="Billable" htmlFor="filter-billable">
          <select id="filter-billable" value={filters.billable} onChange={(e) => setFilter('billable', e.target.value)} className={SELECT_CLASS}>
            <option value="all">All</option>
            <option value="billable">Billable</option>
            <option value="non-billable">Non-billable</option>
          </select>
        </Filter>

        <Filter label="Status" htmlFor="filter-status">
          <select id="filter-status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={SELECT_CLASS}>
            <option value="all">All</option>
            <option value="unbilled">Unbilled</option>
            <option value="billed">Billed</option>
          </select>
        </Filter>
      </div>

      {data === null ? (
        <PageLoader compact />
      ) : (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={loading}>
          <div className="mb-6 grid gap-3 sm:grid-cols-3" data-testid="summary">
            <SummaryCard label="Total hours" value={formatDuration(data.totals.totalSeconds)} />
            <SummaryCard label="Billable hours" value={formatDuration(data.totals.billableSeconds)} />
            <SummaryCard label="Unbilled amount" value={formatCurrency(data.totals.unbilledAmount, user.currency)} />
          </div>

          {renderEntries()}
        </div>
      )}

      {form.open && (
        <EntryFormModal entry={form.entry} projects={projects ?? undefined} onClose={closeForm} onSaved={handleSaved} />
      )}

      {entryToDelete && (
        <ConfirmDialog
          title="Delete time entry?"
          message={`${entryToDelete.project?.name} · ${formatDuration(entryToDelete.durationSeconds)} will be permanently deleted. This can't be undone.`}
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setEntryToDelete(null)}
        />
      )}
    </>
  );
}
