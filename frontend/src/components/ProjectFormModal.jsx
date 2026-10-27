import { useState } from 'react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import FormField from './FormField';
import Button from './Button';
import { createProject, updateProject } from '../api/projects';
import { handleFormError } from '../utils/errors';

const PROJECT_COLORS = [
  { name: 'Indigo', value: '#4F46E5' },
  { name: 'Sky', value: '#0EA5E9' },
  { name: 'Emerald', value: '#10B981' },
  { name: 'Amber', value: '#F59E0B' },
  { name: 'Rose', value: '#F43F5E' },
  { name: 'Violet', value: '#8B5CF6' },
];

// Add (project is null) or edit a project. Render it only while it should be open.
export default function ProjectFormModal({ project, clients, defaultClientId = '', onClose, onSaved }) {
  const isEdit = Boolean(project);
  const [form, setForm] = useState({
    name: project?.name ?? '',
    clientId: project?.clientId ?? defaultClientId,
    hourlyRate: project ? String(project.hourlyRate) : '',
    color: project?.color ?? PROJECT_COLORS[0].value,
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
    setErrors({ ...errors, [name]: undefined });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    toast.dismiss();
    setErrors({});
    setSubmitting(true);

    const data = {
      ...form,
      hourlyRate: form.hourlyRate === '' ? undefined : Number(form.hourlyRate),
    };

    try {
      if (isEdit) {
        await updateProject(project._id, data);
      } else {
        await createProject(data);
      }
      toast.success(isEdit ? 'Project updated' : 'Project added');
      onSaved();
    } catch (err) {
      handleFormError(err, setErrors, 'name');
      setSubmitting(false);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit project' : 'Add project'} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <FormField
          label="Name"
          name="name"
          type="text"
          autoFocus
          value={form.name}
          onChange={handleChange}
          error={errors.name}
        />

        <FormField
          as="select"
          label="Client"
          name="clientId"
          value={form.clientId}
          onChange={handleChange}
          error={errors.clientId}
        >
          <option value="">Select a client</option>
          {clients.map((client) => (
            <option key={client._id} value={client._id}>
              {client.name}
            </option>
          ))}
        </FormField>

        <FormField
          label="Hourly rate"
          name="hourlyRate"
          type="number"
          inputMode="decimal"
          min="0"
          max="10000"
          step="0.01"
          placeholder="0.00"
          value={form.hourlyRate}
          onChange={handleChange}
          error={errors.hourlyRate}
        />

        <div>
          <span className="mb-2 block text-sm font-medium text-slate-700">Color</span>
          <div className="flex flex-wrap gap-3">
            {PROJECT_COLORS.map(({ name, value }) => {
              const selected = form.color === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-label={name}
                  aria-pressed={selected}
                  onClick={() => setForm({ ...form, color: value })}
                  className={`h-8 w-8 rounded-full ring-offset-2 transition focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                    selected ? 'ring-2 ring-slate-900' : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: value }}
                />
              );
            })}
          </div>
          {errors.color && <p className="mt-1 text-sm text-red-500">{errors.color}</p>}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {isEdit ? 'Save changes' : 'Add project'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
