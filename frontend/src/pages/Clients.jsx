import { useCallback, useEffect, useState } from 'react';
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
import { getClients, deleteClient } from '../api/clients';
import { getErrorMessage } from '../utils/errors';

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ open: false, client: null }); // client = null means "add"
  const [clientToDelete, setClientToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadClients = useCallback(async () => {
    try {
      setClients(await getClients());
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

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

  return (
    <>
      <PageHeader
        title="Clients"
        description="The people and companies you work for."
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
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {clients.map((client) => (
            <li key={client._id} className="flex items-center gap-4 px-4 py-4 sm:px-6">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 font-semibold text-primary">
                {client.name[0].toUpperCase()}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{client.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                  <Badge tone="primary">
                    {client.projectCount} {client.projectCount === 1 ? 'project' : 'projects'}
                  </Badge>
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

              <div className="flex shrink-0 items-center">
                <IconButton icon={Pencil} label={`Edit ${client.name}`} onClick={() => openForm(client)} />
                <IconButton
                  icon={Trash2}
                  label={`Delete ${client.name}`}
                  danger
                  onClick={() => setClientToDelete(client)}
                />
              </div>
            </li>
          ))}
        </ul>
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
