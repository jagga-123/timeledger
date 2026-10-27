import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderKanban, Pencil, Plus, Trash2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/PageHeader';
import PageLoader from '../components/PageLoader';
import EmptyState from '../components/EmptyState';
import Button from '../components/Button';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import ProjectFormModal from '../components/ProjectFormModal';
import { useAuth } from '../hooks/useAuth';
import { getClients } from '../api/clients';
import { getProjects, deleteProject } from '../api/projects';
import { getErrorMessage } from '../utils/errors';
import { formatCurrency } from '../utils/format';

export default function Projects() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [clientFilter, setClientFilter] = useState(''); // '' = all clients
  const [loading, setLoading] = useState(true);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [form, setForm] = useState({ open: false, project: null }); // project = null means "add"
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    getClients()
      .then(setClients)
      .catch((err) => toast.error(getErrorMessage(err)))
      .finally(() => setClientsLoading(false));
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      setProjects(await getProjects(clientFilter));
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [clientFilter]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const openForm = (project = null) => setForm({ open: true, project });
  const closeForm = useCallback(() => setForm({ open: false, project: null }), []);

  const handleSaved = () => {
    closeForm();
    loadProjects();
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteProject(projectToDelete._id);
      toast.success('Project deleted');
      await loadProjects();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDeleting(false);
      setProjectToDelete(null);
    }
  };

  const addButton = (
    <Button onClick={() => openForm()}>
      <Plus size={16} />
      Add project
    </Button>
  );

  const renderBody = () => {
    // Wait for both so we never flash "Add a client first" while clients are still loading
    if (loading || clientsLoading) return <PageLoader compact />;

    if (clients.length === 0) {
      return (
        <EmptyState
          icon={Users}
          title="Add a client first"
          description="Every project belongs to a client, so create one before adding projects."
          action={<Button onClick={() => navigate('/clients')}>Go to clients</Button>}
        />
      );
    }

    if (projects.length === 0) {
      return clientFilter ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects for this client"
          description="Add one, or pick a different client from the filter."
          action={addButton}
        />
      ) : (
        <EmptyState
          icon={FolderKanban}
          title="Add your first project"
          description="Projects hold the hourly rate you'll bill your time at."
          action={addButton}
        />
      );
    }

    return (
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {projects.map((project) => {
          const rate = (
            <>
              <span className="font-mono">{formatCurrency(project.hourlyRate, user.currency)}</span>/hr
            </>
          );

          return (
            <li key={project._id} className="flex items-center gap-3 px-4 py-4 sm:gap-4 sm:px-6">
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full"
                style={{ backgroundColor: project.color }}
                aria-hidden="true"
              />

              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{project.name}</p>
                <p className="truncate text-sm text-slate-500">{project.client?.name}</p>
                <p className="mt-0.5 text-sm font-medium text-slate-700 sm:hidden">{rate}</p>
              </div>

              <p className="hidden shrink-0 text-sm font-medium text-slate-700 sm:block">{rate}</p>

              <div className="flex shrink-0 items-center">
                <IconButton icon={Pencil} label={`Edit ${project.name}`} onClick={() => openForm(project)} />
                <IconButton
                  icon={Trash2}
                  label={`Delete ${project.name}`}
                  danger
                  onClick={() => setProjectToDelete(project)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project has its own hourly rate."
        action={clients.length > 0 && addButton}
      />

      {clients.length > 0 && (
        <div className="mb-4 max-w-xs">
          <label htmlFor="clientFilter" className="mb-1 block text-sm font-medium text-slate-700">
            Filter by client
          </label>
          <select
            id="clientFilter"
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All clients</option>
            {clients.map((client) => (
              <option key={client._id} value={client._id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {renderBody()}

      {form.open && (
        <ProjectFormModal
          project={form.project}
          clients={clients}
          defaultClientId={clientFilter}
          onClose={closeForm}
          onSaved={handleSaved}
        />
      )}

      {projectToDelete && (
        <ConfirmDialog
          title="Delete project?"
          message={`"${projectToDelete.name}" will be permanently deleted. This can't be undone.`}
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setProjectToDelete(null)}
        />
      )}
    </>
  );
}
