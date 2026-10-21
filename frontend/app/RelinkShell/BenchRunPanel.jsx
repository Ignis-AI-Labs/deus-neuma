// BenchRunPanel — THIS RUN, the LAUNCH tab's right column, pure rendering.
// Before the click it answers […]: the model that
// will be measured (shown, never chosen), the picked benchmark and arms, the
// cost as one display numeral with its finish time, and the two acts. A run
// in flight is WATCHED in the LIVE tab (BenchLive.jsx — Design note, 2026-10-15:
// […]); here it is one line and the way there.
// No sound imports — node-renderable (the static-markup view tests).

import {
  servedModelMatch, subjectNotice, readinessVerdict, machineNotice,
} from './bench-launch-view.js';
import { benchmarkRow, estimateView } from './bench-launch-layout-view.js';

const Subject = ({ serving, models }) => {
  const match = servedModelMatch(serving, models);
  const notice = subjectNotice(match);
  return (
    <div className="bl-run-block">
      <span className="bl-kicker label-data">MODEL UNDER TEST</span>
      {match.state === 'matched' ? (
        <>
          <span className="bl-run-name">{match.model.label || match.model.key}</span>
          <span className="bl-run-meta">as served · {match.model.key}</span>
        </>
      ) : null}
      {match.state === 'unregistered' ? (
        <span className="bl-run-name">{String(match.served).split('/').pop()}</span>
      ) : null}
      {notice ? <span className="bl-run-notice is-alert">{notice}</span> : null}
    </div>
  );
};

const MachineNotice = ({ machine }) => {
  const notice = machineNotice(machine);
  if (!notice) return null;
  return (
    <div className="bl-run-block">
      <span className="bl-run-notice is-alert">{notice.line}</span>
      {notice.processes.map((p) => (
        <span key={p.pid} className="bl-run-meta">{p.pid} · {p.command}</span>
      ))}
    </div>
  );
};

export const BenchRunPanel = ({
  serving, machine = null, models, cell, arms, laneLabel, ready, busy, preflightResults, launchResult,
  ownedRun, chainState, live = [], runRows = [], nowMs, onPreflight, onRun, answer = null, onWatch,
}) => {
  const row = cell ? benchmarkRow(cell) : null;
  // anything in flight on this machine — this desk's set, another desk's, the night queue
  const inFlight = chainState?.state === 'running' || Boolean(ownedRun) || live.length > 0;
  const running = inFlight;
  const estimate = running ? null : estimateView(arms, cell, runRows, nowMs);
  const readinesses = (preflightResults ?? []).map((r) => ({ arm: r.arm, ...readinessVerdict(r.result) }));
  return (
    <aside className="bl-run" aria-label="This run">
      <p className="bl-run-head label-data">THIS RUN</p>
      <Subject serving={serving} models={models} />
      <MachineNotice machine={machine} />

      <div className="bl-run-block">
        <span className="bl-kicker label-data">BENCHMARK</span>
        {row ? (
          <>
            <span className="bl-run-name">{row.name}</span>
            {row.about ? <span className="bl-run-meta">{row.about}</span> : null}
          </>
        ) : <span className="bl-run-meta">Pick a benchmark on the left.</span>}
        {arms.length > 0 && row ? (
          <span className="bl-run-meta">
            {arms.length === 1 ? '1 arm' : `${arms.length} arms`}{laneLabel ? ` · ${laneLabel}` : ''}
          </span>
        ) : null}
      </div>

      {estimate ? (
        <div className="bl-run-block">
          <span className="bl-kicker label-data">ESTIMATED TIME</span>
          <span key={estimate.total} className="bl-numeral kx-scan">{estimate.total}</span>
          <span className="bl-run-meta">finish ≈ {estimate.finish} if started now</span>
          {estimate.parts.length > 1 ? (
            <span className="bl-run-meta">{estimate.parts.map((p) => `${p.name.toLowerCase()} ${p.text}`).join(' · ')}</span>
          ) : null}
        </div>
      ) : null}

      {readinesses.map((r) => (
        <p key={r.arm} className={`bl-run-verdict${r.ok ? ' is-signal' : ' is-alert'}`}>
          {r.arm.toUpperCase()} — {r.line}
        </p>
      ))}
      {inFlight ? (
        <div className="bl-run-block">
          <span className="bl-kicker label-data is-signal">{launchResult ? 'THE RUN IS FIRED' : 'A RUN IS IN FLIGHT'}</span>
          <span className="bl-run-meta">
            {live.length ? live.map((r) => `${r.cell} · ${r.arm ?? '?'} arm`).join('; ') : `${chainState?.cell ?? 'a benchmark'} · starting`}
            {' '}— one run at a time on this GPU; the next launches when it settles
          </span>
          <button type="button" className="bl-btn is-primary label-data" onClick={onWatch}>WATCH IT LIVE →</button>
        </div>
      ) : null}

      {answer}
      <div className="bl-run-acts">
        {inFlight ? null : (
          <>
            <button type="button" className="bl-btn is-primary label-data" disabled={busy || !ready} onClick={onRun}>
              {busy ? 'WORKING…' : arms.length > 1 ? `RUN THE MATCHED SET (${arms.length})` : 'RUN THE BENCHMARK'}
            </button>
            <button type="button" className="bl-btn label-data" disabled={busy || !ready} onClick={onPreflight}>
              CHECK READINESS
            </button>
          </>
        )}
      </div>
    </aside>
  );
};
