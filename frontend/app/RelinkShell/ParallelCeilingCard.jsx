// ParallelCeilingCard — the rig's parallel team ceiling, honestly framed.
//
// Lives on RIG-LEVEL surfaces only — the RECORD window's SUBSTRATE section,
// and the SUBSTRATE window itself (Design note, 2026-08-28: […], where the + TAB stale-ceiling refusal sends
// the operator): capacity is a rig+model fact shared by every neuma, never
// per-neuma growth (docs/architecture/measurement/stats-and-benchmarks.md).
// The component takes NO neumaId — structurally it cannot render a per-being
// number.
//
// F-1 honesty: the measured ceiling reflects the SERVER'S CURRENT CONFIG, not
// the hardware's potential. The configured slot count is unreadable, so the
// card only ever frames what the ramp curve's shape looks like (boundClass
// A/B/C) — assertive on the one high-confidence case (B: serialized single
// slot), tentative ("appears") everywhere else.

import { useEffect, useRef, useState, useCallback } from 'react';
import { loadCapacity, runCapacityScan, announceCapacityChange } from './capacity-client.js';
import { sameSubstrate } from '../../../core/runtime/tab-budget.js';
import { uiSound } from '../../services/ui-sound.js';
import { formatRelativeTime } from '../../utils/format.js';
import { useVisibleInterval } from './use-visible-interval.js';

/**
 * The honest headline for a completed scan. Pure.
 *
 * ── WHY THIS TAKES THE SERVED MODEL ─────────────────────────────────────────
 *
 * It used to say […] unconditionally —
 * without ever looking at what the server is currently running. On 2026-08-29
 * that produced two surfaces contradicting each other on one screen: this card
 * reading `~6 neuma working at once — measured on your current server config`
 * while the tab strip refused a sitting because the ceiling […]. One of them had to be
 * wrong, and it was this one: a claim about the current config that never
 * checked the current config is not a measurement, it is a decoration.
 *
 * So the comparison is made HERE, with the same `sameSubstrate` the budget
 * uses — same function, same family-normalisation, same answer. The two
 * surfaces are now structurally incapable of disagreeing.
 *
 * @param {object} latest - the newest completed scan record
 * @param {?string} [servingModel] - what the rig serves NOW; null = unreadable,
 *   which is not evidence of a change and so never reported as staleness
 */
export const headlineFor = (latest, servingModel = null) => {
  const scanned = latest?.substrate?.model ?? null;
  // A ceiling measured on a different model is not this machine's ceiling. Said
  // first and plainly, because it is the one thing that makes the number below
  // it untrue — and because it names the fix.
  if (servingModel && scanned && !sameSubstrate(servingModel, scanned)) {
    return {
      big: `~${latest.ceiling} neuma working at once`,
      sub: `measured on ${scanned}, but this machine is now serving ${servingModel}`
        + ' — re-scan to run more than one at a time',
      stale: true,
    };
  }
  if (latest.boundClass === 'B') {
    return { big: '1 neuma at a time', sub: "limited by your server's configuration, not your hardware", stale: false };
  }
  const big = `~${latest.ceiling} neuma working at once`;
  return latest.boundClass === 'C'
    ? { big, sub: 'appears hardware-bound on this rig', stale: false }
    : { big, sub: 'measured on your current server config', stale: false };
};

/** The live scan, in the operator's words. Every figure is measured — the
 *  level actually under load, the elapsed clock, and an ETA derived from the
 *  levels ALREADY timed. A knee can end the scan at any level, so the estimate
 *  is stated as a ceiling ("at most"), never as a countdown that pretends to
 *  know. Pure. */
export const scanLine = (scan, nowMs) => {
  if (!scan?.running) return null;
  const p = scan.progress || {};
  const started = scan.startedAt ? Date.parse(scan.startedAt) : NaN;
  const elapsedMs = Number.isFinite(started) ? Math.max(0, nowMs - started) : (p.elapsedMs || 0);
  const mins = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);
  const bits = [];
  if (p.phase === 'unreachable') return 'THE SUBSTRATE DID NOT ANSWER — nothing is being measured';
  if (Number.isFinite(p.concurrency)) {
    bits.push(`${p.phase === 'level-done' ? 'MEASURED' : 'MEASURING'} ${p.concurrency} AT ONCE`);
  } else {
    bits.push('STARTING');
  }
  if (Array.isArray(p.ladder)) bits.push(`level ${(p.levelsDone || 0) + (p.phase === 'level-done' ? 0 : 1)}/${p.ladder.length}`);
  bits.push(`${mins(elapsedMs)} elapsed`);
  // The ETA only exists once a level has actually been timed. Before that,
  // saying nothing is more honest than saying a number.
  if (p.meanLevelMs && Array.isArray(p.ladder)) {
    const left = Math.max(0, p.ladder.length - (p.levelsDone || 0));
    const est = Math.min(left * p.meanLevelMs, Math.max(0, (p.deadlineMs || 0) - elapsedMs) || Infinity);
    if (Number.isFinite(est) && est > 0) bits.push(`at most ~${mins(est)} left — it stops early when the ceiling is found`);
  }
  return bits.join(' · ');
};

export const ParallelCeilingCard = () => {
  const [cap, setCap] = useState(undefined); // undefined = loading, null = unreadable
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const [tick, setTick] = useState(Date.now());
  // The runAt of the record we last SAW. A poll that brings back a different
  // one means a scan landed — possibly one started in another window, or by the
  // operator pressing CONFIRM here — and every surface holding a ceiling needs
  // to hear about it. Announcing from the read rather than only from the press
  // is what makes a scan run anywhere reach the tab budget everywhere.
  const seenRunAt = useRef(undefined);
  const refresh = useCallback(() => loadCapacity().then((c) => {
    setCap(c);
    const runAt = c?.latest?.runAt ?? null;
    const first = seenRunAt.current === undefined;
    if (!first && runAt !== seenRunAt.current) announceCapacityChange();
    seenRunAt.current = runAt;
    return c;
  }), []);
  useEffect(() => { refresh(); }, [refresh]);

  // A scan in flight is SERVER truth, polled — not this component's local
  // optimism. Reopen the window mid-scan and the progress is still there; if
  // the run wedges, the elapsed clock climbs while the level does not, which
  // is exactly the difference the operator could not see before. Polled only
  // while the card is seen (use-visible-interval.js).
  const scanning = Boolean(cap?.scan?.running) || running;
  useVisibleInterval(() => { setTick(Date.now()); refresh(); }, 2000, { enabled: scanning });
  useEffect(() => () => abortRef.current?.abort(), []);

  const onConfirmRun = async () => {
    uiSound('activate');
    setConfirming(false);
    setRunning(true);
    setError(null);
    abortRef.current = new AbortController();
    const r = await runCapacityScan(abortRef.current.signal);
    abortRef.current = null;
    setRunning(false);
    if (r.stopped) return; // soft stop: nothing recorded, card stays as it was
    if (!r.ok) { setError(r.error); return; }
    refresh();
  };

  const onAbort = () => {
    uiSound('close');
    abortRef.current?.abort();
  };

  if (cap === undefined) return <p className="rec-line label-data">PARALLEL TEAM CEILING · LOADING…</p>;

  const latest = cap?.latest || null;
  const measurable = cap?.measurable ?? false;
  // `current` is stamped by the SAME detector that stamped `latest.substrate`,
  // which is the only reason the two are comparable — see capacity-client.js.
  const headline = latest ? headlineFor(latest, cap?.current?.model ?? null) : null;

  if (!measurable) {
    return (
      <div className="rec-cap">
        <p className="rec-line label-data">PARALLEL TEAM CEILING · NOT MEASURABLE</p>
        <p className="rec-note">A remote provider has no local concurrency to observe — this is only measurable on a local server.</p>
      </div>
    );
  }

  return (
    <div className="rec-cap">
      <p className="rec-line label-data">PARALLEL TEAM CEILING</p>

      {latest ? (
        <>
          <p className="rec-sub">
            <span className={headline.stale ? 'rec-warn' : 'rec-sig'}>{headline.big}</span> — {headline.sub}
            {latest.incomplete ? ' (measured up to the tested limit; the true ceiling may be higher)' : ''}
          </p>
          <p className="rec-line label-data">
            {headline.stale ? `measured on ${latest.substrate?.model}` : "your server's current config"}
            {' · measured '}{latest.runAt ? formatRelativeTime(new Date(latest.runAt).getTime()) : null}
          </p>
          <details className="rec-cap-detail">
            <summary className="label-data">MEASUREMENT DETAIL</summary>
            <p className="rec-line label-data">MAX SUSTAINED SLOTS {latest.ceiling ?? '—'}</p>
            <p className="rec-line label-data">
              AGGREGATE {latest.aggregateTokPerSecAtCeiling != null ? `${Math.round(latest.aggregateTokPerSecAtCeiling)} TOK/S` : '—'}
              {' · '}PER-NEUMA LATENCY {latest.perAgentLatencyAtCeiling != null ? `${Math.round(latest.perAgentLatencyAtCeiling)}MS` : '—'}
            </p>
            <p className="rec-line label-data">1 MODEL LOAD — CONCURRENCY SHARES IT</p>
          </details>
          {latest.boundClass === 'B' ? (
            <p className="rec-note">
              Your server is serializing requests. Run a real team → raise its parallel slots
              (LM Studio: Developer settings · ollama: OLLAMA_NUM_PARALLEL), then re-scan.
              NEUMA does not change your server settings for you.
            </p>
          ) : null}
        </>
      ) : (
        <p className="rec-line label-data">NOT MEASURED</p>
      )}

      {confirming ? (
        <div className="rec-confirm cham">
          <p className="rec-confirm-msg">
            «NOTICE» A capacity scan fires several real requests through the substrate at once — it may
            briefly slow any neuma you're talking to. Nothing is written unless a real measurement
            completes. Run it?
          </p>
          <div className="rec-confirm-actions">
            <button type="button" className="rec-btn rec-btn-go" onClick={onConfirmRun}>CONFIRM</button>
            <button type="button" className="rec-btn" onClick={() => { uiSound('close'); setConfirming(false); }}>CANCEL</button>
          </div>
        </div>
      ) : (
        <div className="rec-run-bar">
          {scanning ? (
            <button type="button" className="rec-btn" onClick={onAbort}>
              ABORT — STOP AFTER CURRENT LEVEL
            </button>
          ) : (
            <button type="button" className="rec-btn rec-run" onClick={() => { uiSound('open'); setConfirming(true); }}>
              {latest ? 'RE-SCAN CAPACITY' : 'RUN CAPACITY SCAN'}
            </button>
          )}
          <span className="rec-meta label-data">
            {scanning ? (scanLine(cap?.scan, tick) || 'MEASURING — REAL LOAD ON THE RIG') : ''}
          </span>
        </div>
      )}

      {error ? <p className="rec-err">{error}</p> : null}
    </div>
  );
};
