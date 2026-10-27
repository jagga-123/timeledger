import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Square } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from './Button';
import Switch from './Switch';
import ProjectSelect from './ProjectSelect';
import { useTimer } from '../hooks/useTimer';
import { getProjects } from '../api/projects';
import { getErrorMessage } from '../utils/errors';
import { formatClock } from '../utils/time';

const CARD = 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6';

// The big timer on the dashboard: start form when idle, a running clock when a timer is on
export default function TimerCard() {
  const { timer, elapsedSeconds, loading, start, stop, update } = useTimer();
  const [projects, setProjects] = useState(null); // null = still loading

  useEffect(() => {
    getProjects()
      .then((all) => setProjects(all.filter((project) => !project.archived)))
      .catch((err) => {
        toast.error(getErrorMessage(err));
        setProjects([]);
      });
  }, []);

  // A running timer needs nothing but itself, so don't wait for the project list
  if (timer) {
    return <RunningTimer timer={timer} elapsedSeconds={elapsedSeconds} onStop={stop} onUpdate={update} />;
  }

  if (loading || projects === null) {
    return (
      <div className={`${CARD} min-h-44 animate-pulse`} aria-busy="true" aria-label="Loading timer">
        <div className="h-4 w-40 rounded bg-slate-200" />
        <div className="mt-4 h-10 rounded bg-slate-100" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className={`${CARD} py-10 text-center`}>
        <h2 className="text-lg font-semibold text-slate-900">Create a project first</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
          Time is tracked against a project, so add one (with a client) before starting the timer.
        </p>
        <Link
          to="/projects"
          className="mt-5 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90"
        >
          Go to projects
        </Link>
      </div>
    );
  }

  return <StartForm projects={projects} onStart={start} />;
}

function StartForm({ projects, onStart }) {
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [billable, setBillable] = useState(true);
  const [projectError, setProjectError] = useState('');
  const [starting, setStarting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    toast.dismiss();
    if (!projectId) {
      setProjectError('Pick a project to track time on');
      return;
    }

    setStarting(true);
    const started = await onStart({ projectId, description, billable });
    if (started) {
      setDescription('');
    } else {
      setStarting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className={CARD}>
      <label htmlFor="timer-description" className="mb-1 block text-sm font-medium text-slate-700">
        What are you working on?
      </label>
      <input
        id="timer-description"
        type="text"
        maxLength={200}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Add a description (optional)"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
      />

      <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <span className="mb-1 block text-sm font-medium text-slate-700">Project</span>
          <ProjectSelect
            projects={projects}
            value={projectId}
            onChange={(id) => {
              setProjectId(id);
              setProjectError('');
            }}
            error={projectError}
          />
        </div>

        <div className="md:pt-7">
          <Switch checked={billable} onChange={setBillable} label="Billable" />
        </div>

        <Button type="submit" size="lg" loading={starting} className="w-full md:mt-6 md:w-auto">
          {!starting && <Play size={18} fill="currentColor" />}
          Start
        </Button>
      </div>
    </form>
  );
}

function RunningTimer({ timer, elapsedSeconds, onStop, onUpdate }) {
  const [description, setDescription] = useState(timer.description);
  const [stopping, setStopping] = useState(false);
  const typing = useRef(false);
  const discardEdit = useRef(false); // set by Escape so the blur that follows doesn't save

  // Pick up a description changed on another device, unless I'm typing here
  useEffect(() => {
    if (!typing.current) setDescription(timer.description);
  }, [timer.description]);

  const saveDescription = async () => {
    typing.current = false;
    if (discardEdit.current) {
      discardEdit.current = false;
      setDescription(timer.description);
      return;
    }
    const next = description.trim();
    if (next === timer.description) {
      setDescription(next);
      return;
    }
    const saved = await onUpdate({ description: next });
    if (!saved) setDescription(timer.description);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur(); // saves
    } else if (e.key === 'Escape') {
      discardEdit.current = true; // revert instead of saving
      e.currentTarget.blur();
    }
  };

  const handleStop = async () => {
    setStopping(true);
    await onStop();
    setStopping(false);
  };

  const clientName = timer.client?.name;
  const projectName = timer.project?.name;

  return (
    <section className="rounded-xl bg-primary p-5 text-white shadow-sm sm:p-8" aria-label="Running timer">
      <p className="flex min-w-0 items-center gap-2 text-sm text-indigo-100">
        <span
          className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white"
          style={{ backgroundColor: timer.project?.color }}
          aria-hidden="true"
        />
        <span className="truncate">
          Running · {clientName} / {projectName}
          {!timer.billable && ' · Non-billable'}
        </span>
      </p>

      <p className="mt-3 font-mono text-5xl font-semibold tabular-nums sm:text-6xl" data-testid="elapsed">
        {formatClock(elapsedSeconds)}
      </p>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <input
          type="text"
          aria-label="Description"
          maxLength={200}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onFocus={() => (typing.current = true)}
          onBlur={saveDescription}
          onKeyDown={handleKeyDown}
          placeholder="Add a description"
          className="w-full min-w-0 flex-1 rounded-lg border border-white/30 bg-white/10 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-indigo-200 focus:border-white focus:bg-white/20"
        />

        <button
          type="button"
          onClick={handleStop}
          disabled={stopping}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-8 py-3 text-base font-semibold text-primary transition hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-primary disabled:opacity-70 sm:w-auto"
        >
          <Square size={18} fill="currentColor" />
          Stop
        </button>
      </div>
    </section>
  );
}
