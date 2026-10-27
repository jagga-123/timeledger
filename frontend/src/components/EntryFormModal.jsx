import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import FormField from './FormField';
import Button from './Button';
import Switch from './Switch';
import ProjectSelect from './ProjectSelect';
import PageLoader from './PageLoader';
import { useAuth } from '../hooks/useAuth';
import { getProjects } from '../api/projects';
import { createEntry, updateEntry } from '../api/entries';
import { getFieldErrors, getErrorMessage } from '../utils/errors';
import {
  addDaysToDateKey,
  dateKeyInZone,
  dateTimeInZone,
  formatDuration,
  timeOfDayInZone,
} from '../utils/time';

const initialForm = (entry, timeZone) =>
  entry
    ? {
        projectId: entry.projectId,
        description: entry.description,
        date: dateKeyInZone(new Date(entry.startedAt), timeZone),
        startTime: timeOfDayInZone(new Date(entry.startedAt), timeZone),
        endTime: timeOfDayInZone(new Date(entry.endedAt), timeZone),
        billable: entry.billable,
      }
    : {
        projectId: '',
        description: '',
        date: dateKeyInZone(new Date(), timeZone),
        startTime: '',
        endTime: '',
        billable: true,
      };

// The start and end moments for the typed date and times, in the user's time zone.
// An end time earlier than the start time means the entry runs past midnight.
const timesFromForm = ({ date, startTime, endTime }, timeZone) => {
  if (!date || !startTime || !endTime) return null;

  const endsNextDay = endTime < startTime;
  const start = dateTimeInZone(date, startTime, timeZone);
  const end = dateTimeInZone(endsNextDay ? addDaysToDateKey(date, 1) : date, endTime, timeZone);
  return { start, end, endsNextDay, seconds: Math.round((end - start) / 1000) };
};

// Add (entry is null) or edit a finished time entry. Render it only while it should be open.
// Pass `projects` to reuse a list you already loaded; otherwise the modal loads them itself.
export default function EntryFormModal({ entry, projects: projectsProp, onClose, onSaved }) {
  const { user } = useAuth();
  const timeZone = user.timezone;
  const isEdit = Boolean(entry);

  const [initial] = useState(() => initialForm(entry, timeZone));
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [loadedProjects, setLoadedProjects] = useState(null);

  useEffect(() => {
    if (projectsProp) return;
    getProjects()
      .then(setLoadedProjects)
      .catch((err) => {
        toast.error(getErrorMessage(err));
        setLoadedProjects([]);
      });
  }, [projectsProp]);

  const allProjects = projectsProp ?? loadedProjects;
  if (allProjects === null) {
    return (
      <Modal title={isEdit ? 'Edit time entry' : 'Add time entry'} onClose={onClose}>
        <PageLoader compact />
      </Modal>
    );
  }

  // Archived projects can't get new time, but an entry that already uses one must still show it
  const projects = allProjects.filter((project) => !project.archived);
  if (isEdit && !projects.some((project) => project._id === entry.projectId) && entry.project) {
    projects.unshift({ ...entry.project, client: entry.client });
  }

  const times = timesFromForm(form, timeZone);

  const change = (field, value) => {
    setForm({ ...form, [field]: value });
    setErrors({ ...errors, [field]: undefined });
  };
  const handleChange = (e) => change(e.target.name, e.target.value);

  const handleSubmit = async (e) => {
    e.preventDefault();
    toast.dismiss();

    const missing = {};
    if (!form.projectId) missing.projectId = 'Pick a project';
    if (!form.date) missing.date = 'Pick a date';
    if (!form.startTime) missing.startTime = 'Enter a start time';
    if (!form.endTime) missing.endTime = 'Enter an end time';
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }

    setErrors({});
    setSubmitting(true);

    try {
      const { start, end } = times;
      if (isEdit) {
        const changes = { description: form.description, billable: form.billable };
        if (form.projectId !== entry.projectId) changes.projectId = form.projectId;
        // Leave the times alone when they weren't edited, so a timer entry keeps its exact seconds
        const timesEdited = ['date', 'startTime', 'endTime'].some((field) => form[field] !== initial[field]);
        if (timesEdited) {
          changes.startedAt = start.toISOString();
          changes.endedAt = end.toISOString();
        }
        await updateEntry(entry._id, changes);
      } else {
        await createEntry({
          projectId: form.projectId,
          description: form.description,
          billable: form.billable,
          startedAt: start.toISOString(),
          endedAt: end.toISOString(),
        });
      }
      toast.success(isEdit ? 'Entry updated' : 'Entry added');
      onSaved();
    } catch (err) {
      const fieldErrors = getFieldErrors(err);
      if (Object.keys(fieldErrors).length > 0) {
        // The server talks about startedAt/endedAt; the form calls those fields start and end time
        setErrors({ ...fieldErrors, startTime: fieldErrors.startedAt, endTime: fieldErrors.endedAt });
      } else {
        toast.error(getErrorMessage(err));
      }
      setSubmitting(false);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit time entry' : 'Add time entry'} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Project</span>
          <ProjectSelect
            id="entry-project"
            projects={projects}
            value={form.projectId}
            onChange={(projectId) => change('projectId', projectId)}
            error={errors.projectId}
          />
        </div>

        <FormField
          label="Description (optional)"
          name="description"
          type="text"
          maxLength={200}
          value={form.description}
          onChange={handleChange}
          error={errors.description}
        />

        <FormField label="Date" name="date" type="date" value={form.date} onChange={handleChange} error={errors.date} />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Start time"
            name="startTime"
            type="time"
            value={form.startTime}
            onChange={handleChange}
            error={errors.startTime}
          />
          <FormField
            label="End time"
            name="endTime"
            type="time"
            value={form.endTime}
            onChange={handleChange}
            error={errors.endTime}
          />
        </div>

        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600" aria-live="polite" data-testid="entry-duration">
          <span>
            Duration:{' '}
            <span className="font-mono font-medium text-slate-900">
              {times && times.seconds > 0 ? formatDuration(times.seconds) : '—'}
            </span>
          </span>
          {times?.endsNextDay && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              ends next day
            </span>
          )}
        </p>

        <Switch checked={form.billable} onChange={(billable) => change('billable', billable)} label="Billable" />

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {isEdit ? 'Save changes' : 'Add entry'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
