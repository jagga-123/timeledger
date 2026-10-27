import { useState } from 'react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import FormField from './FormField';
import Button from './Button';
import { createClient, updateClient } from '../api/clients';
import { handleFormError } from '../utils/errors';

// Add (client is null) or edit a client. Render it only while it should be open.
export default function ClientFormModal({ client, onClose, onSaved }) {
  const isEdit = Boolean(client);
  const [form, setForm] = useState({
    name: client?.name ?? '',
    email: client?.email ?? '',
    company: client?.company ?? '',
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

    try {
      if (isEdit) {
        await updateClient(client._id, form);
      } else {
        await createClient(form);
      }
      toast.success(isEdit ? 'Client updated' : 'Client added');
      onSaved();
    } catch (err) {
      handleFormError(err, setErrors, 'name');
      setSubmitting(false);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit client' : 'Add client'} onClose={onClose}>
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
          label="Company (optional)"
          name="company"
          type="text"
          autoComplete="organization"
          value={form.company}
          onChange={handleChange}
          error={errors.company}
        />
        <FormField
          label="Email (optional)"
          name="email"
          type="email"
          autoComplete="off"
          value={form.email}
          onChange={handleChange}
          error={errors.email}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {isEdit ? 'Save changes' : 'Add client'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
