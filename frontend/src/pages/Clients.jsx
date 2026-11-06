import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Mail, Pencil, Plus, Trash2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/PageHeader';
import PageLoader from '../components/PageLoader';
import EmptyState from '../components/EmptyState';
import Button from '../components/Button';
import Badge from '../components/Badge';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import ClientFormModal from '../components/ClientFormModal';
import { useAuth } from '../hooks/useAuth';
import { getClients, deleteClient } from '../api/clients';
import { getReceivablesClients } from '../api/receivables';
import { getErrorMessage } from '../utils/errors';
import { formatCurrency, plural } from '../utils/format';
import { formatDate } from '../utils/time';

const SORTS = [
  { id: 'overdue', label: 'Overdue first' },
  { id: 'outstanding', label: 'Outstanding' },
  { id: 'name', label: 'Name' },
];

const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
const amountOf = (client, field) => client.money?.[field] ?? 0;
const COMPARATORS = {
  overdue: (a, b) => amountOf(b, 'overdueAmount') - amountOf(a, 'overdueAmount') || amountOf(b, 'outstanding') - amountOf(a, 'outstanding') || byName(a, b),
  outstanding: (a, b) => amountOf(b, 'outstanding') - amountOf(a, 'outstanding') || byName(a, b),
  name: byName,
};

// All paid (emerald), Owes $X (amber) or Overdue (red); a client that was never invoiced is just "No invoices yet"
function ClientStatus({ money, currency }) {
  if (!money) return null;
  if (money.overdueCount > 0) return <Badge tone="danger">Overdue</Badge>;
  if (money.outstanding > 0) return <Badge tone="warning">Owes {formatCurrency(money.outstanding, currency)}</Badge>;
  if (money.invoicedTotal > 0) return <Badge tone="success">All paid</Badge>;
  return <Badge>No invoices yet</Badge>;
}

function Figure({ label, testId, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-sm font-medium text-slate-900" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

const NONE = <span className="text-slate-400">—</span>;

export default function Clients() {
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('overdue');
  const [owesOnly, setOwesOnly] = useState(false);
  const [form, setForm] = useState({ open: false, client: null }); // client = null means "add"
  const [clientToDelete, setClientToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // The clients, and next to each one what they owe. If the numbers can't be had, the list still works without them.
  const loadClients = useCallback(async () => {
    try {
      const [list, money] = await Promise.all([getClients(), getReceivablesClients().catch(() => [])]);
      const moneyOf = new Map(money.map((row) => [row.client._id, row]));
      setClients(list.map((client) => ({ ...client, money: moneyOf.get(client._id) ?? null })));
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const visible = useMemo(
    () => clients.filter((client) => !owesOnly || amountOf(client, 'outstanding') > 0).sort(COMPARATORS[sort]),
    [clients, owesOnly, sort]
  );

  const openForm = (client = null) => setForm({ open: true, client });
  const closeForm = useCallback(() => setForm({ open: false, client: null }), []);

  const handleSaved = () => {
    closeForm();
    loadClients();
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteClient(clientToDelete._id);
      toast.success('Client deleted');
      await loadClients();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDeleting(false);
      setClientToDelete(null);
    }
  };

  const addButton = (
    <Button onClick={() => openForm()}>
      <Plus size={16} />
      Add client
    </Button>
  );

  const money = (amount) => formatCurrency(amount, user.currency);

  return (
    <>
      <PageHeader
        title="Clients"
        description="Who owes you what, and what is still to bill."
        action={clients.length > 0 && addButton}
      />

      {loading ? (
        <PageLoader compact />
      ) : clients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Add your first client"
          description="Clients own your projects, and you'll invoice them later."
          action={addButton}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              aria-pressed={owesOnly}
              onClick={() => setOwesOnly((current) => !current)}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                owesOnly ? 'border-primary bg-indigo-50 text-primary' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              Owes me money
            </button>

            <label className="flex items-center gap-2 text-sm text-slate-500">
              Sort by
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {SORTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Nobody owes you money"
              description="Every invoice you sent has been paid."
              action={
                <Button variant="secondary" onClick={() => setOwesOnly(false)}>
                  Show all clients
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="client-list">
              {visible.map((client) => (
                <li key={client._id} className="relative px-4 py-4 transition hover:bg-slate-50 sm:px-6" data-testid="client-row">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 font-semibold text-primary">
                      {client.name[0].toUpperCase()}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {/* the whole row opens the client; the edit and delete buttons stay on top of it */}
                        <Link to={`/clients/${client._id}`} className="truncate font-semibold text-slate-900 after:absolute after:inset-0 hover:underline focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary/40">
                          {client.name}
                        </Link>
                        <span data-testid="client-status">
                          <ClientStatus money={client.money} currency={user.currency} />
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                        <Badge tone="primary">{plural(client.projectCount, 'project')}</Badge>
                        {client.company && (
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Building2 size={14} className="shrink-0" />
                            <span className="truncate">{client.company}</span>
                          </span>
                        )}
                        {client.email && (
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Mail size={14} className="shrink-0" />
                            <span className="truncate">{client.email}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="relative z-10 flex shrink-0 items-center">
                      <IconButton icon={Pencil} label={`Edit ${client.name}`} onClick={() => openForm(client)} />
                      <IconButton icon={Trash2} label={`Delete ${client.name}`} danger onClick={() => setClientToDelete(client)} />
                    </div>
                  </div>

                  {client.money && (
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 sm:pl-14">
                      <Figure label="Outstanding" testId="client-outstanding">
                        {money(client.money.outstanding)}
                      </Figure>
                      <Figure label="Overdue" testId="client-overdue">
                        {client.money.overdueCount > 0 ? (
                          <span className="text-red-600">
                            {money(client.money.overdueAmount)} <span className="text-xs font-normal">{plural(client.money.oldestOverdueDays, 'day')}</span>
                          </span>
                        ) : (
                          NONE
                        )}
                      </Figure>
                      <Figure label="Unbilled" testId="client-unbilled">
                        {client.money.unbilledAmount > 0 ? money(client.money.unbilledAmount) : NONE}
                      </Figure>
                      <Figure label="Last payment" testId="client-last-payment">
                        {client.money.lastPaymentAt ? formatDate(client.money.lastPaymentAt, user.timezone) : NONE}
                      </Figure>
                    </dl>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {form.open && <ClientFormModal client={form.client} onClose={closeForm} onSaved={handleSaved} />}

      {clientToDelete && (
        <ConfirmDialog
          title="Delete client?"
          message={`"${clientToDelete.name}" will be permanently deleted. This can't be undone.`}
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setClientToDelete(null)}
        />
      )}
    </>
  );
}
