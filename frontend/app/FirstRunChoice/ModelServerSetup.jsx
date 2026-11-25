// ModelServerSetup — the flight check's setup card: when this machine has no model server ready,
// offer to set one up and do it (preflight-model-setup.js mounts it inside the ceremony). The door
// carries the same setup in its model bar (ModelBar.jsx); both talk to the backend through one
// hook (use-model-setup.js). Done → the caller re-reads the machine and the server shows READY.
import { useEffect, useRef } from 'react';
import { useModelSetup } from './use-model-setup.js';
import { STEP_TEXT, size } from './setup-words.js';
import { GpuDriverNotice } from './GpuDriverNotice.jsx';
import './FirstRunHarness.css';

/** @param {{onDone: () => void}} props */
export const ModelServerSetup = ({ onDone }) => {
  const { plan, home, canChooseHome, chooseHome, job, error, progress: whole, start, stop, reread } = useModelSetup({ onDone });
  // The progress is what the person watches next: it comes into view when the work starts
  const progress = useRef(null);
  const working = job?.state === 'running';
  useEffect(() => {
    if (!working) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    progress.current?.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  }, [working]);

  if (error && !plan) return <p className="harness-setup-note label-data" role="alert">{error}</p>;
  if (!plan) return <p className="harness-setup-note label-data">READING WHAT THIS MACHINE NEEDS…</p>;
  if (!plan.supported) return <p className="harness-setup-note">{plan.reason}</p>;

  const pct = working ? whole.pct : null;
  return (
    <div className="harness-setup" data-testid="model-server-setup">
      <p className="label-data">SET IT UP FOR ME</p>
      <p>
        Deus Neuma can set up a model server on this machine and download the model that fits it:
        {' '}<strong>{plan.model.name}</strong> ({plan.model.quant}, {plan.model.sizeGB} GB).
        {plan.server === 'download' ? ' The server is Ollama, kept inside Deus Neuma\'s own folder; no admin rights needed.' : ''}
        {plan.server === 'installed' ? ' Ollama is already installed here; it will be started.' : ''}
        {plan.server === 'engine-download' ? ` The server is llama.cpp ${plan.build}, kept inside Deus Neuma\'s own folder; no admin rights needed.` : ''}
      </p>
      {(plan.notes || []).map((n) => <p key={n} className="harness-setup-note">{n}</p>)}
      <GpuDriverNotice notice={plan.gpuDriver} onChange={reread} />
      <ul className="harness-setup-steps">
        {plan.steps.map((s) => <li key={s.id}>{s.label}{s.bytes ? ` · ${size(s.bytes)}` : ''}</li>)}
      </ul>
      <p className="label-data">
        DOWNLOAD {size(plan.downloadBytes)} · NEEDS {size(plan.needBytes)} FREE
        {plan.freeBytes != null ? ` · ${size(plan.freeBytes)} FREE ON THIS DISK` : ''}{home ? ` · INTO ${home}` : ''}
        {canChooseHome ? <>{' '}<button type="button" className="sub-btn" onClick={chooseHome}>CHANGE FOLDER</button></> : null}
      </p>
      {!plan.enoughDisk ? <p role="alert">This disk does not have room for it. Choose a folder on another drive{canChooseHome ? ' with CHANGE FOLDER' : ''}, or free some space, then RECHECK.</p> : null}
      {working ? (
        <div className="harness-setup-progress" role="status" aria-live="polite" ref={progress}>
          <p className="label-data">{(STEP_TEXT[job.step] || 'Working').toUpperCase()}{pct != null ? ` · ${pct}% · ${size(whole.done)} OF ${size(whole.total)}` : '…'}</p>
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
      {job?.state === 'failed' && job.detail ? <p className="harness-setup-note label-data">{job.detail}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
};
