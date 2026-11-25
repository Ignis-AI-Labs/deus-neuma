// use-titling-job — a batch titling job the desk follows (titling-client.js): start it, read its
// progress about once a second, stop it. `onLanded` runs each time more chats are named (the list's
// titles refresh as they land) and once at the end. impure (network, timers).
import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelTitling, startTitling, titlingStatus } from './titling-client.js';
import { titlingNote } from './titling-view.js';

const POLL_MS = 1000;

export const useTitlingJob = (onLanded, what) => {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const landedRef = useRef(onLanded);
  landedRef.current = onLanded;
  const doneRef = useRef(0);

  const running = job?.state === 'running';

  useEffect(() => {
    if (!running) return undefined;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const next = await titlingStatus(job.id);
        if (!alive) return;
        setNow(Date.now());
        if (next.done !== doneRef.current || next.state !== 'running') {
          doneRef.current = next.done;
          landedRef.current?.();
        }
        setJob(next);
      } catch (err) {
        if (alive) { setError(err.message); setJob(null); }
      }
    }, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [running, job?.id]);

  const start = useCallback(async (body) => {
    setError(null);
    try {
      const started = await startTitling(body);
      doneRef.current = started.done;
      setNow(Date.now());
      setJob(started);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const cancel = useCallback(async () => {
    if (!job) return;
    try { setJob(await cancelTitling(job.id)); } catch (err) { setError(err.message); }
  }, [job]);

  return { job, running, start, cancel, note: titlingNote(job, error, now, what) };
};
