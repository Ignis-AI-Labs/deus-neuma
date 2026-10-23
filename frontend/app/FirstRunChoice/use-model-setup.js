// use-model-setup — the model setup's conversation with the backend, shared by the door's model bar
// and the flight check's setup card (ModelServerSetup), so there is one setup, never two copies.
// THE INSTALL STANDARD (2026-10-22): the plan (what downloads, how big, whether the disk holds it)
// is read from this machine by GET /api/v1/model-server/plan; the work runs in the backend
// (managed-ollama.js) and this polls its progress. Done → `onDone` (the caller checks again).
//
// impure — reads and drives the backend.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiCall } from '../../utils/http.js';
import { addSample, secondsLeft, setupProgress } from './setup-progress.js';

const POLL_MS = 1000;

/**
 * @param {{onDone: () => void, enabled?: boolean}} opts - `enabled` false holds the plan read
 * @returns {{plan: object|null, home: string, job: object|null, error: string,
 *   progress: {done: number|null, total: number|null, pct: number|null, seconds: number|null},
 *   start: () => Promise<void>, stop: () => void, reread: () => void}}
 */
export const useModelSetup = ({ onDone, enabled = true }) => {
  const [plan, setPlan] = useState(null);
  const [home, setHome] = useState('');
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);
  const [samples, setSamples] = useState([]);
  const timer = useRef(null);

  // impure — read the plan (and any job already running) from the backend
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setError('');
    apiCall('GET', '/api/v1/model-server/plan', { useServerError: true, strictJson: true })
      .then((r) => { if (live) { setPlan(r.plan); setHome(r.home); setJob(r.job); } })
      .catch((err) => { if (live) setError(err?.message || 'This machine could not be read for a setup plan.'); });
    return () => { live = false; };
  }, [enabled, round]);

  // impure — poll the job while it runs
  const poll = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await apiCall('GET', '/api/v1/model-server/status', { useServerError: false, strictJson: true }).catch(() => null);
      if (r?.job) setJob(r.job);
      if (r?.job?.state === 'running' || !r) poll();
      else if (r.job.state === 'done') onDone();
    }, POLL_MS);
  }, [onDone]);
  useEffect(() => { if (job?.state === 'running') poll(); return () => clearTimeout(timer.current); }, [job?.state, poll]);

  // Each reading of the running job is one sample of the speed the time left is drawn from
  useEffect(() => {
    const { done } = setupProgress(job);
    if (job?.state !== 'running' || done == null) { setSamples([]); return; }
    setSamples((s) => addSample(s, { t: Date.now(), done }));
  }, [job]);

  // impure — start (or resume) the setup; a second press while the first is in flight is ignored
  const starting = useRef(false);
  const start = async () => {
    if (starting.current) return;
    starting.current = true;
    setError('');
    const r = await apiCall('POST', '/api/v1/model-server/install', { useServerError: true, strictJson: true })
      .catch((err) => ({ error: err?.message || 'The setup could not start.' }));
    starting.current = false;
    if (r.error) setError(r.error);
    else setJob(r.job);
  };
  // impure — stop the setup; the next poll shows it stopped
  const stop = () => { apiCall('POST', '/api/v1/model-server/cancel', { useServerError: false, strictJson: true }).catch(() => null); };
  const reread = useCallback(() => setRound((n) => n + 1), []);

  const progress = setupProgress(job);
  const seconds = progress.total != null && progress.done != null ? secondsLeft(samples, progress.total - progress.done) : null;
  return { plan, home, job, error, progress: { ...progress, seconds }, start, stop, reread };
};
