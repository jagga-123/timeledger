import { Link } from 'react-router-dom';
import { Square } from 'lucide-react';
import { useTimer } from '../hooks/useTimer';
import { formatClock } from '../utils/time';

// Small "a timer is running" indicator for the sidebar and mobile top bar. Shows nothing when idle.
export default function MiniTimer() {
  const { timer, elapsedSeconds, stop } = useTimer();
  if (!timer) return null;

  const time = formatClock(elapsedSeconds);

  return (
    <div className="flex items-center rounded-lg bg-white/10 text-white" data-testid="mini-timer">
      <Link
        to="/"
        aria-label={`Timer running, ${time}. Go to the dashboard`}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-l-lg px-2.5 py-2 transition hover:bg-white/10"
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        <span className="font-mono text-sm tabular-nums">{time}</span>
      </Link>

      <button
        type="button"
        onClick={stop}
        aria-label="Stop timer"
        title="Stop timer"
        className="rounded-r-lg p-2.5 text-indigo-100 transition hover:bg-white/10 hover:text-white"
      >
        <Square size={14} fill="currentColor" />
      </button>
    </div>
  );
}
