// ModelBar — the first thing on the door: is a model running on this computer? One line of state
// and, when one is needed, one big act — SET UP <the model> · <the download>. While it sets up, one
// progress bar; when it answers, "Model ready" in the signal. Every detail (steps, paths, versions,
// the machine read, the technical error) waits behind "details" (CHOKKAN: one decision per moment,
// the depth on demand). The state is the flight check's own (GET /api/v1/preflight/mind via
// use-mind-check.js), so the door and the flight check can never disagree.
import { useState } from 'react';
import { useModelSetup } from './use-model-setup.js';
import { barView, settingLine } from './model-bar-view.js';
import { size } from './setup-words.js';
import { StatusRing } from './door-glyphs.jsx';
import './ModelBar.css';

/** The setup's act, labelled with the model and the download it costs. Pure. */
const setupLabel = (plan) => {
  if (!plan?.model) return 'SET UP A MODEL';
  return plan.downloadBytes > 0 ? `SET UP ${plan.model.name} · ${size(plan.downloadBytes)}` : `SET UP ${plan.model.name}`;
};

/** Everything technical, for whoever opens it. */
const BarDetails = ({ verdict, mind, plan, home, job, error }) => (
  <div className="door-bar-details" id="door-bar-details">
    {verdict ? (
      <p className={`firstrun-capacity is-${verdict.state}`}>
        <span className="firstrun-capacity-machine label-data">{verdict.machine}</span>
        <span className="firstrun-capacity-headline label-data">{verdict.headline}</span>
        <span className="firstrun-capacity-detail">{verdict.detail}</span>
      </p>
    ) : null}
    {mind.detail ? <p>{mind.detail}</p> : null}
    {plan?.supported === false ? <p>{plan.reason}</p> : null}
    {plan?.supported ? (
      <>
        <ul className="door-bar-steps">
          {plan.steps.map((s) => <li key={s.id}>{s.label}{s.bytes ? ` · ${size(s.bytes)}` : ''}</li>)}
        </ul>
        {(plan.notes || []).map((n) => <p key={n}>{n}</p>)}
        <p className="label-data">
          DOWNLOAD {size(plan.downloadBytes)} · NEEDS {size(plan.needBytes)} FREE
          {plan.freeBytes != null ? ` · ${size(plan.freeBytes)} FREE` : ''}{home ? ` · INTO ${home}` : ''}
        </p>
      </>
    ) : null}
    {job?.line ? <p>{job.line}</p> : null}
    {job?.error ? <p>{job.error}</p> : null}
    {job?.detail ? <p className="label-data">{job.detail}</p> : null}
    {error ? <p>{error}</p> : null}
  </div>
);

/**
 * @param {{ref?: import('react').Ref<HTMLElement>, mind: {state: string, detail?: string}, recheck: () => void, readyModel: string|null,
 *   verdict: object|null, waiting: string|null, onDone: () => void}} props
 *   `waiting` — the gate's line while a pressed door waits on the model
 */
export const ModelBar = ({ ref, mind, recheck, readyModel, verdict, waiting, onDone }) => {
  const setup = useModelSetup({ onDone, enabled: mind.state !== 'ready' });
  const { plan, job, error, progress, start, stop, reread } = setup;
  const [open, setOpen] = useState(false);
  const bar = barView({ mind, plan, job, error, readyModel });
  const line = bar.view === 'setting' ? settingLine(job, progress) : bar.line;
  const blocked = bar.act === 'setup' && !plan?.enoughDisk;

  return (
    <section ref={ref} className={`door-bar cham is-${bar.view}${waiting ? ' is-holding' : ''}`} aria-label="Model" data-testid="door-bar">
      <StatusRing view={bar.view} pct={progress.pct} />
      <div className="door-bar-state">
        <p className="door-bar-line" role="status" aria-live="polite">{line}</p>
        {bar.view === 'setting' ? <progress className="door-bar-progress" max={100} value={progress.pct ?? undefined} /> : null}
        {bar.note || waiting ? <p className="door-bar-note">{[bar.note, waiting].filter(Boolean).join(' ')}</p> : null}
      </div>
      <div className="door-bar-act">
        {bar.act === 'setup' || bar.act === 'reading' ? (
          <button type="button" className="btn btn-primary btn-lg" onClick={start} disabled={bar.act === 'reading' || blocked}>
            {setupLabel(plan)}
          </button>
        ) : null}
        {bar.act === 'retry' ? <button type="button" className="btn btn-primary btn-lg" onClick={start}>TRY AGAIN</button> : null}
        {bar.act === 'reread' ? <button type="button" className="btn btn-primary btn-lg" onClick={reread}>TRY AGAIN</button> : null}
        {bar.act === 'stop' ? <button type="button" className="btn btn-secondary btn-sm" onClick={stop}>STOP</button> : null}
        <span className="door-bar-small">
          <button type="button" className="door-bar-link" aria-expanded={open} aria-controls="door-bar-details" onClick={() => setOpen((o) => !o)}>
            details
          </button>
          {bar.view !== 'setting' ? <button type="button" className="door-bar-link" onClick={() => { recheck(); reread(); }}>check again</button> : null}
        </span>
      </div>
      {open ? <BarDetails verdict={verdict} mind={mind} {...setup} /> : null}
    </section>
  );
};
