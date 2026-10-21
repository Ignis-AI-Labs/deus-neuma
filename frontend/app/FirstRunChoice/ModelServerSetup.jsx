// ModelServerSetup — when this machine has no model server ready, offer to set one up and do it.
// THE STANDARD (Design note, 2026-10-22: say what is missing, then install it for the person. The plan
// (what downloads, how big, whether the disk holds it) is read from this machine by
// GET /api/v1/model-server/plan; the work runs in the backend (managed-ollama.js) and this card
// polls its progress. Done → the parent re-reads the machine and the server shows READY.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiCall } from '../../utils/http.js';
import './FirstRunHarness.css';

const GB = 1_000_000_000;
const size = (n) => (n >= GB ? `${(n / GB).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1_000_000))} MB`);
const STEP_TEXT = Object.freeze({
  download: 'DOWNLOADING THE MODEL SERVER',
  unpack: 'UNPACKING',
  start: 'STARTING THE MODEL SERVER',
  pull: 'DOWNLOADING THE MODEL',
  adopt: 'FINISHING',
  done: 'READY',
});

/** @param {{onDone: () => void}} props */
export const ModelServerSetup = ({ onDone }) => {
  const [plan, setPlan] = useState(null);
  const [home, setHome] = useState('');
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);

  // impure — read the plan (and any job already running) from the backend
  useEffect(() => {
    apiCall('GET', '/api/v1/model-server/plan', { useServerError: true, strictJson: true })
      .then((r) => { setPlan(r.plan); setHome(r.home); setJob(r.job); })
      .catch((err) => setError(err?.message || 'This machine could not be read for a setup plan.'));
  }, []);

  // impure — poll the job while it runs
  const poll = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await apiCall('GET', '/api/v1/model-server/status', { useServerError: false, strictJson: true }).catch(() => null);
      if (r?.job) setJob(r.job);
      if (r?.job?.state === 'running' || !r) poll();
      else if (r.job.state === 'done') onDone();
    }, 1000);
  }, [onDone]);
  useEffect(() => { if (job?.state === 'running') poll(); return () => clearTimeout(timer.current); }, [job?.state, poll]);

  // impure — start (or resume) the setup
  const start = async () => {
    setError('');
    const r = await apiCall('POST', '/api/v1/model-server/install', { useServerError: true, strictJson: true })
      .catch((err) => ({ error: err?.message || 'The setup could not start.' }));
    if (r.error) setError(r.error);
    else setJob(r.job);
  };
  const stop = () => apiCall('POST', '/api/v1/model-server/cancel', { useServerError: false, strictJson: true }).catch(() => null);

  if (error && !plan) return <p className="harness-setup-note label-data" role="alert">{error}</p>;
  if (!plan) return <p className="harness-setup-note label-data">READING WHAT THIS MACHINE NEEDS…</p>;
  if (!plan.supported) return <p className="harness-setup-note">{plan.reason}</p>;

  const running = job?.state === 'running';
  const pct = running && job.total > 0 ? Math.min(100, Math.round((job.completed / job.total) * 100)) : null;
  return (
    <div className="harness-setup" data-testid="model-server-setup">
      <p className="label-data">SET IT UP FOR ME</p>
      <p>
        Deus Neuma can set up a model server on this machine and download the model that fits it:
        {' '}<strong>{plan.model.name}</strong> ({plan.model.quant}, {plan.model.sizeGB} GB).
        {plan.server === 'download' ? ' The server is Ollama, kept inside Deus Neuma\'s own folder; no admin rights needed.' : ''}
        {plan.server === 'installed' ? ' Ollama is already installed here; it will be started.' : ''}
      </p>
      {(plan.notes || []).map((n) => <p key={n} className="harness-setup-note">{n}</p>)}
      <ul className="harness-setup-steps">
        {plan.steps.map((s) => <li key={s.id}>{s.label}{s.bytes ? ` · ${size(s.bytes)}` : ''}</li>)}
      </ul>
      <p className="label-data">
        DOWNLOAD {size(plan.downloadBytes)} · NEEDS {size(plan.needBytes)} FREE
        {plan.freeBytes != null ? ` · ${size(plan.freeBytes)} FREE ON THIS DISK` : ''}{home ? ` · INTO ${home}` : ''}
      </p>
      {!plan.enoughDisk ? <p role="alert">This disk does not have room for it. Free some space, then RECHECK.</p> : null}
      {running ? (
        <div className="harness-setup-progress" role="status" aria-live="polite">
          <p className="label-data">{STEP_TEXT[job.step] || 'WORKING'}{pct != null ? ` · ${pct}% · ${size(job.completed)} OF ${size(job.total)}` : '…'}</p>
          <progress max={100} value={pct ?? undefined} />
          <button type="button" className="sub-btn" onClick={stop}>STOP</button>
        </div>
      ) : (
        <button type="button" className="settings-set" onClick={start} disabled={!plan.enoughDisk}>
          {job?.state === 'failed' || job?.state === 'cancelled' ? 'TRY AGAIN' : 'SET IT UP FOR ME'}
        </button>
      )}
      {job?.state === 'done' ? <p role="status">{job.line}</p> : null}
      {(job?.state === 'failed' || job?.state === 'cancelled') && job.error ? <p role="alert">{job.error}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
};
