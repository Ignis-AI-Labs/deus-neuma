// BenchProof — THE PROOF SUITE panel, pure rendering: benchmark the model the
// platform has LOADED, from the desk, and seal the certificate. The panel
// reads what's actually served before offering the act; a «NOTICE» confirm
// stands before the GPU works; the run's progress and verdict render the
// server's own state; a refusal reads verbatim.
// No sound imports — node-renderable (the static-markup view tests).

import './BenchApp.css';
import './BenchApp-runs.css';
import { servingLive, servingLine, gpuLine, proofStateLine } from './bench-view.js';
import { sectionMeaning, paceLine, nowAnsweringLine, lastItemLine } from './bench-proof-view.js';

export const BenchProof = ({ status, run, confirm, busy, refusal, onAsk, onCancel, onRun, nowMs }) => {
  const serving = status?.serving ?? null;
  const gpu = gpuLine(status?.gpu);
  const live = servingLive(serving);
  const running = run?.state === 'running';
  return (
    <section className="bench-sec">
      <p className="bench-sec-head label-data">BENCHMARK THE LOADED MODEL — THE PROOF SUITE</p>
      <p className={`bench-line label-data${live ? ' is-signal' : ' is-alert'}`}>{servingLine(serving)}</p>
      <p className={`bench-line label-data${gpu.alert ? ' is-alert' : ''}`}>{gpu.text}</p>
      <p className="bench-line label-data">
        THE SUITE — 43 ITEMS: 25 REAL GSM8K · 12 INSTRUCTION CHECKS · 6 STRICT JSON SHAPES
      </p>
      <p className={`bench-line label-data${running ? ' is-signal' : run?.state === 'failed' ? ' is-alert' : ''}`}>
        {proofStateLine(run)}
      </p>
      {running ? (
        <div className="bench-progress">
          <p className="bench-line">{sectionMeaning(run.section)}</p>
          <p className="bench-line label-data is-signal">{paceLine(run, nowMs ?? Date.now())}</p>
          {nowAnsweringLine(run) ? (
            <p className="bench-now">{nowAnsweringLine(run)}</p>
          ) : null}
          {lastItemLine(run) ? (
            <p className={`bench-line label-data${run.lastItem.pass ? '' : ' is-alert'}`}>{lastItemLine(run)}</p>
          ) : null}
        </div>
      ) : null}
      {refusal ? <p className="bench-line label-data is-alert">{refusal}</p> : null}
      {!confirm ? (
        <div className="bench-controls">
          <button
            type="button"
            className="bench-btn is-signal-btn label-data"
            disabled={busy || running || !live}
            onClick={onAsk}
          >
            {running ? 'RUNNING…' : 'RUN THE PROOF SUITE'}
          </button>
        </div>
      ) : (
        <div className="bench-confirm">
          <span className="bench-confirm-notice">
            «NOTICE» the proof suite runs 43 items against the loaded model — the GPU works for a few
            minutes while every answer is scored deterministically and sealed as a certificate you can
            export. One run at a time; the run refuses if the endpoint stops answering.
          </span>
          <button type="button" className="bench-btn is-signal-btn label-data" disabled={busy} onClick={onRun}>
            RUN — SCORE THE LOADED MODEL
          </button>
          <button type="button" className="bench-btn label-data" disabled={busy} onClick={onCancel}>
            CANCEL
          </button>
        </div>
      )}
      {run?.state === 'done' ? (
        <p className="bench-line label-data">THE CERTIFICATE STANDS IN REPORTS → PROOF CERTIFICATES</p>
      ) : null}
    </section>
  );
};
