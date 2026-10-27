import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

// A dropdown for choosing a project: grouped by client, with each project's color dot.
// (A plain <select> can't show colored dots.) Works with mouse and keyboard.
export default function ProjectSelect({ id = 'projectId', projects, value, onChange, error }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);

  const groups = useMemo(() => {
    const byClient = new Map();
    for (const project of projects) {
      const clientName = project.client?.name ?? 'No client';
      if (!byClient.has(clientName)) byClient.set(clientName, []);
      byClient.get(clientName).push(project);
    }
    return [...byClient]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([clientName, items]) => ({ clientName, items }));
  }, [projects]);

  const flatProjects = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const selected = projects.find((project) => project._id === value);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const openList = () => {
    setActiveIndex(Math.max(0, flatProjects.findIndex((project) => project._id === value)));
    setOpen(true);
  };

  const choose = (project) => {
    onChange(project._id);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatProjects.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatProjects[activeIndex]) choose(flatProjects[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleKeyDown}
        className={`flex w-full items-center gap-2 rounded-lg border bg-white px-3 py-2.5 text-left text-sm outline-none transition focus:ring-2 ${
          error
            ? 'border-red-500 focus:ring-red-500/20'
            : 'border-slate-300 focus:border-primary focus:ring-primary/20'
        }`}
      >
        {selected ? (
          <>
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: selected.color }}
              aria-hidden="true"
            />
            <span className="truncate font-medium text-slate-900">{selected.name}</span>
            <span className="truncate text-slate-400">{selected.client?.name}</span>
          </>
        ) : (
          <span className="text-slate-400">Select a project</span>
        )}
        <ChevronDown size={16} className="ml-auto shrink-0 text-slate-400" aria-hidden="true" />
      </button>

      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label="Projects"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {groups.map(({ clientName, items }) => (
            <li key={clientName} role="presentation">
              <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {clientName}
              </div>
              <ul role="group" aria-label={clientName}>
                {items.map((project) => {
                  const index = flatProjects.indexOf(project);
                  return (
                    <li
                      key={project._id}
                      id={`${id}-option-${index}`}
                      role="option"
                      aria-selected={project._id === value}
                      onMouseDown={(e) => e.preventDefault()} // keep focus on the button
                      onClick={() => choose(project)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                        index === activeIndex ? 'bg-indigo-50' : ''
                      }`}
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: project.color }}
                        aria-hidden="true"
                      />
                      <span className="truncate text-slate-900">{project.name}</span>
                      {project._id === value && <Check size={16} className="ml-auto shrink-0 text-primary" />}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
