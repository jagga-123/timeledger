import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import * as timerApi from '../api/timer';
import { getErrorMessage } from '../utils/errors';
import { formatElapsed } from '../utils/time';

export const TimerContext = createContext(null);

const POLL_INTERVAL_MS = 30_000;

// The running timer lives on the server. Here we only keep a copy of its startedAt and work out
// the elapsed time from it, so a refresh, a closed browser or another device always shows the same time.
export function TimerProvider({ children }) {
  const { user } = useAuth();
  const userId = user?._id;

  const [timer, setTimer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clockOffset, setClockOffset] = useState(0); // server clock minus this device's clock, in ms
  const [now, setNow] = useState(() => Date.now()); // ticks every second while a timer runs
  const [stoppedCount, setStoppedCount] = useState(0); // goes up whenever a timer ends, so lists can reload

  const shownTimerId = useRef(null); // id of the timer we are showing right now
  const mutations = useRef(0); // goes up around start/stop/update so older refresh results are dropped

  // Use the server's answer: the timer itself and its clock
  const applyServerState = useCallback(({ timer: nextTimer, serverTime }, requestSentAt) => {
    const receivedAt = Date.now();
    // Assume the reply took as long to arrive as the request took to leave
    setClockOffset(Date.parse(serverTime) - (requestSentAt + receivedAt) / 2);
    setNow(receivedAt);

    const nextId = nextTimer?._id ?? null;
    if (shownTimerId.current && shownTimerId.current !== nextId) {
      setStoppedCount((count) => count + 1); // the timer we showed has ended (maybe on another device)
    }
    shownTimerId.current = nextId;
    setTimer(nextTimer);
  }, []);

  const refresh = useCallback(async () => {
    const versionAtStart = mutations.current;
    const requestSentAt = Date.now();
    try {
      const data = await timerApi.getTimer();
      // If we started/stopped something while this request was in flight, its answer may be outdated
      if (versionAtStart === mutations.current) applyServerState(data, requestSentAt);
    } catch {
      // Background refresh: stay quiet and try again at the next interval
    } finally {
      setLoading(false);
    }
  }, [applyServerState]);

  // Load the timer after login, and keep it in sync with other devices
  useEffect(() => {
    if (!userId) {
      shownTimerId.current = null;
      setTimer(null);
      setLoading(true);
      return;
    }

    setLoading(true);
    refresh();

    const poll = setInterval(refresh, POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [userId, refresh]);

  // Re-render every second while a timer is running
  const runningId = timer?._id;
  useEffect(() => {
    if (!runningId) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [runningId]);

  // Elapsed time is never stored: it is always worked out from the server's startedAt
  const elapsedSeconds = timer
    ? Math.max(0, Math.floor((now + clockOffset - Date.parse(timer.startedAt)) / 1000))
    : 0;

  // Show the time in the browser tab title
  useEffect(() => {
    document.title = timer ? `${formatElapsed(elapsedSeconds)} · TimeLedger` : 'TimeLedger';
  }, [timer, elapsedSeconds]);

  const start = async ({ projectId, description, billable }) => {
    mutations.current += 1;
    const requestSentAt = Date.now();
    try {
      applyServerState(await timerApi.startTimer({ projectId, description, billable }), requestSentAt);
      return true;
    } catch (err) {
      toast.error(getErrorMessage(err)); // e.g. "A timer is already running. Stop it first."
      if (err.response?.status === 409) await refresh(); // show the timer that is running elsewhere
      return false;
    } finally {
      mutations.current += 1;
    }
  };

  const stop = async () => {
    mutations.current += 1;
    const requestSentAt = Date.now();
    try {
      const data = await timerApi.stopTimer();
      applyServerState({ timer: null, serverTime: data.serverTime }, requestSentAt);
      toast.success(`Timer stopped · ${formatElapsed(data.entry.durationSeconds)}`);
      return true;
    } catch (err) {
      toast.error(getErrorMessage(err));
      if (err.response?.status === 404) await refresh(); // it was already stopped on another device
      return false;
    } finally {
      mutations.current += 1;
    }
  };

  // Change the description, billable flag or project of the running timer
  const update = async (changes) => {
    mutations.current += 1;
    const requestSentAt = Date.now();
    try {
      applyServerState(await timerApi.updateTimer(changes), requestSentAt);
      return true;
    } catch (err) {
      toast.error(getErrorMessage(err));
      if (err.response?.status === 404) await refresh();
      return false;
    } finally {
      mutations.current += 1;
    }
  };

  return (
    <TimerContext.Provider
      value={{ timer, elapsedSeconds, loading, stoppedCount, start, stop, update, refresh }}
    >
      {children}
    </TimerContext.Provider>
  );
}
