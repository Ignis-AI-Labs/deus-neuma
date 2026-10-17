// BenchLive — THE LIVE TAB: what is running on this machine right now and how
// far it has come, pure rendering (Design note, 2026-10-15: […]).
//
// Three things can run, and each reads here: THIS desk's matched set (one row
// per arm, the live arm's bar filled by real items, the clock, STOP), every
// other benchmark on the machine (a chat's launch on another desk, the house
// desk's night queue — cell, arm, items, minutes), and the proof suite. When
// nothing runs the tab says so, keeps the LAST SET, and points to LAUNCH.
// No sound imports — node-renderable (the static-markup view tests).

import './BenchApp.css';
import './BenchLaunch.css';
import { EmptyState } from './empty-state.jsx';
import { matchedProgressView, chainNeedsReport, launchProgressLine } from './bench-launch-view.js';
import { benchmarkRow, chainStages } from './bench-launch-layout-view.js';
import { liveRunLine } from './bench-run-chip-view.js';
import { paceLine, nowAnsweringLine } from './bench-proof-view.js';

const STAGE_MARK = { done: '✓', failed: '✗', live: '…', pending: '·', skipped: '—' };

export const Stages = ({ stages }) => (
  <ol className="bl-stages">
    {stages.map((s) => (
      <li key={s.arm} className={`bl-stage is-${s.state}`}>
        <span className="bl-stage-mark" aria-hidden="true">{STAGE_MARK[s.state]}</span>
        <span className="bl-stage-name">{s.name}</span>
        <span className="bl-stage-bar" aria-hidden="true">
          <span className="bl-stage-fill" style={{ transform: `scaleX(${s.fill})` }} />
        </span>
        {s.items ? <span className="bl-stage-items label-data">{s.items}</span> : null}
      </li>
    ))}
  </ol>
);

// pure — is anything in flight? (the tab's dot, the window's first landing)
export const benchLiveActive = (status, proofRun) => status?.chain?.state === 'running'
  || (status?.live?.length ?? 0) > 0 || proofRun?.state === 'running'
  || (status?.owned ?? []).some((child) => child.long);

// THIS desk's set — running, or the last one, kept until the next
const ThisSet = ({ chainState, cells, live, runRows, nowMs, busy, onStop, onCopyReport, reportNote }) => {
  const cell = (cells ?? []).find((c) => c.id === chainState.cell) ?? null;
  const row = cell ? benchmarkRow(cell) : null;
  const view = matchedProgressView(chainState, { cell, runRows, now: nowMs });
  const running = chainState.state === 'running';
  return (
    <section className="bench-sec bl-live-set">
      <p className={`bench-sec-head label-data${running ? ' is-signal' : ''}`}>
        {running ? 'RUNNING NOW — THIS DESK' : 'LAST SET — THIS DESK'}
      </p>
      <p className="bl-run-name">{row?.name ?? chainState.cell}</p>
      <p className="bl-run-meta">{chainState.arms.length} arms · {chainState.arms.join(', ')} · {chainState.comparisonId}</p>
      {view ? <p className="bl-run-meta">{view.line}</p> : null}
      <Stages stages={chainStages(chainState, cell, runRows, nowMs, live)} />
      {view?.clockLine ? <p className="bl-run-clock label-data">{view.clockLine}</p> : null}
      {running ? (
        <div className="bl-run-acts">
          <button type="button" className="bl-btn is-danger label-data" disabled={busy} onClick={onStop}>STOP THE RUN</button>
        </div>
      ) : null}
      {chainNeedsReport(chainState) ? (
        <div className="bl-run-acts">
          <button type="button" className="bl-btn label-data" onClick={onCopyReport}>COPY FAILURE REPORT</button>
          {reportNote ? <span className={`bl-run-meta${reportNote.ok ? ' is-signal' : ' is-alert'}`}>{reportNote.line}</span> : null}
        </div>
      ) : null}
    </section>
  );
};

// every other benchmark running on this machine — never invisible here
const ElseOnMachine = ({ runs, alone }) => (
  <section className="bench-sec">
    <p className="bench-sec-head label-data is-signal">{alone ? 'RUNNING NOW — ON THIS MACHINE' : 'ALSO ON THIS MACHINE'}</p>
    {runs.map((run) => {
      const fill = Number.isInteger(run.done) && run.total > 0 ? Math.min(1, run.done / run.total) : null;
      return (
        <div key={run.pid} className="bl-live-run">
          <p className="bl-run-meta">{liveRunLine(run)}{run.comparisonId ? ` · ${run.comparisonId}` : ''}</p>
          {fill !== null ? (
            <span className="bl-stage-bar bl-live-bar" aria-hidden="true">
              <span className="bl-stage-fill" style={{ transform: `scaleX(${fill})` }} />
            </span>
          ) : null}
          <p className="bl-run-meta">started by another desk or the night queue — its STOP lives there</p>
        </div>
      );
    })}
  </section>
);

// a single long launch this desk owns, outside a matched set
const OwnedInFlight = ({ child, cells, nowMs, busy, onStop }) => (
  <section className="bench-sec">
    <p className="bench-sec-head label-data is-signal">RUNNING NOW — THIS DESK</p>
    <p className="bl-run-meta is-signal">{launchProgressLine(child, null, nowMs)} — READ IT LAND IN RUNS →</p>
    <div className="bl-run-acts">
      <button type="button" className="bl-btn is-danger label-data" disabled={busy} onClick={onStop}>STOP THE RUN</button>
    </div>
  </section>
);

const ProofInFlight = ({ run, nowMs }) => (
  <section className="bench-sec">
    <p className="bench-sec-head label-data is-signal">RUNNING NOW — THE PROOF SUITE</p>
    <p className="bench-line label-data is-signal">{paceLine(run, nowMs)}</p>
    {nowAnsweringLine(run) ? <p className="bench-now">{nowAnsweringLine(run)}</p> : null}
  </section>
);

export const BenchLive = ({
  status, cells, runRows = [], nowMs = Date.now(), proofRun = null, busy = false,
  onStop, onCopyReport, reportNote = null, onLaunch,
}) => {
  const chainState = status?.chain ?? null;
  const live = status?.live ?? [];
  const mine = chainState?.state === 'running' ? live.filter((r) => r.cell === chainState.cell) : [];
  const elsewhere = live.filter((r) => !mine.includes(r));
  const proofRunning = proofRun?.state === 'running';
  const ownedRun = (status?.owned ?? []).find((child) => child.long) ?? null;
  const anything = benchLiveActive(status, proofRun);
  return (
    <div className="bl-live">
      {!anything ? (
        <EmptyState title="NOTHING IS RUNNING ON THIS MACHINE">
          <small>A BENCHMARK STARTED FROM LAUNCH, FROM A CHAT, OR BY THE NIGHT QUEUE SHOWS HERE THE MOMENT IT RUNS</small>
        </EmptyState>
      ) : null}
      {chainState ? (
        <ThisSet chainState={chainState} cells={cells} live={live} runRows={runRows} nowMs={nowMs}
          busy={busy} onStop={onStop} onCopyReport={onCopyReport} reportNote={reportNote} />
      ) : null}
      {ownedRun && !chainState ? <OwnedInFlight child={ownedRun} cells={cells} nowMs={nowMs} busy={busy} onStop={onStop} /> : null}
      {elsewhere.length ? <ElseOnMachine runs={elsewhere} alone={!chainState || chainState.state !== 'running'} /> : null}
      {proofRunning ? <ProofInFlight run={proofRun} nowMs={nowMs} /> : null}
      {!anything ? (
        <div className="bl-run-acts">
          <button type="button" className="bl-btn is-primary label-data" onClick={onLaunch}>LAUNCH A BENCHMARK →</button>
        </div>
      ) : null}
    </div>
  );
};
