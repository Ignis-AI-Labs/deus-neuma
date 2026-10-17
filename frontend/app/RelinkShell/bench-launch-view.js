// bench-launch-view.js — the LAUNCH tab's display law, PURE, split from
// bench-view.js under the 500-line law (the RUN A BENCHMARK cluster). The operator's direction (2026-09-24, on
// the live tab): […] and
// (2026-09-25) […]
//
// The two-column layout's own view-models (2026-09-25 redesign) live in
// bench-launch-layout-view.js; BenchLaunchRun.jsx stays declarative; the IO
// lives in BenchApp.jsx.

import { relTime } from './bench-view.js';

/**
 * Arms that ARE an identity — mirrors the harness's own IDENTITY_ARMS
 * (benchmarks/runtime/silo-arm-contract.js:39, verified 2026-09-23) and the
 * plane's bench-launch.js copy. On these the LAUNCH panel owes a lane.
 */
export const IDENTITY_ARMS = Object.freeze(['silo', 'neuma']);

/** pure — is this arm an identity arm (the run rides a being's live route)? */
export const isIdentityArm = (arm) => IDENTITY_ARMS.includes(arm);

/**
 * Arms seated on a lane: the identity arms plus HARNESS — the platform agent
 * with identity off (Design note, 2026-09-29, which borrows a lane's workspace and
 * tools but sends none of its identity. On these the LAUNCH panel owes a lane.
 */
export const LANE_ARMS = Object.freeze(['harness', ...IDENTITY_ARMS]);

/** pure — does this arm need a lane picked? */
export const needsLane = (arm) => LANE_ARMS.includes(arm);

// ── RUN A BENCHMARK — the first-timer flow's display law ────────────────────
// The operator's direction (2026-09-24, on the live tab): […]

/**
 * The tier legend, rendered once above the picker: what each tier MEANS and
 * what it costs in time. Authored one-liners over the catalog's real tier
 * letters; an unknown tier degrades to its letter, never a crash.
 * Pure.
 */
export const tierLegend = () => [
  Object.freeze({ tier: 't0', name: 'T0 SMOKE', line: 'proves the road works, says nothing about the model', duration: 'a few minutes' }),
  Object.freeze({ tier: 't1', name: 'T1 QUICK', line: 'core capability checks (math, instruction-following)', duration: 'minutes' }),
  Object.freeze({ tier: 't2', name: 'T2 DEEP', line: 'harder probes (broad knowledge, long reasoning)', duration: 'tens of minutes' }),
  Object.freeze({ tier: 't3', name: 'T3 AGENTIC', line: 'the model works with tools in a sandbox', duration: 'an hour plus' }),
];

/** pure — the legend entry for one tier letter, with a total fallback. */
export const tierLegendFor = (tier) =>
  tierLegend().find((t) => t.tier === tier)
  ?? { tier, name: String(tier ?? '?').toUpperCase(), line: '', duration: '' };

/**
 * The arm list in plain language — how the benchmark should run. The arm id
 * rides small in the render; the DEFAULT mark is bare's. Names people
 * already understand (Design note, 2026-09-25: BARE MODEL · PLATFORM WIRE · HARNESS ·
 * SILO · FULL BEING — and SILO says it tests NITE, the identity engine.
 * HARNESS is the platform agent with identity off; the single-reply wire once
 * called PURE HARNESS is PLATFORM WIRE (Design note, 2026-09-29.
 *
 * THREE CORE ARMS (Design note, 2026-09-29: […]). PLATFORM WIRE and SILO stay available as
 * DIAGNOSTIC arms — for debugging a specific layer, never the headline.
 * Pure.
 */
export const armChoices = () => [
  Object.freeze({ id: 'bare', name: 'BARE MODEL', line: 'The model exactly as served, nothing added — the baseline every other run is measured against.', isDefault: true, core: true }),
  Object.freeze({ id: 'harness', name: 'HARNESS', line: 'The full Neuma platform — agent loop, tools, sandbox and rules — with every identity layer off. This is the harness: what the platform itself adds.', isDefault: false, core: true }),
  Object.freeze({ id: 'neuma', name: 'FULL BEING', line: 'Identity, tools and the agent loop together — benchmarks a being, not a model.', isDefault: false, core: true }),
  Object.freeze({ id: 'platform', name: 'PLATFORM WIRE', line: 'Diagnostic: one reply through Neuma\u2019s model wire and platform rules — no tools, no agent loop, no identity. (Formerly labelled PURE HARNESS.)', isDefault: false, core: false }),
  Object.freeze({ id: 'silo', name: 'SILO', line: 'Diagnostic: the being\u2019s identity mounted through NITE, our identity engine, with no tools — isolates what identity alone adds or costs.', isDefault: false, core: false }),
];

/**
 * The duration a first-timer should EXPECT, from the cell's own
 * cost.wallclockSec: '~N MIN' under an hour, '~N.N H' past it. Empty string
 * when the cell declares no wallclock — the row simply carries no estimate.
 * Pure.
 */
export const durationLine = (sec) => {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  if (sec < 3600) return `~${Math.max(1, Math.round(sec / 60))} MIN`;
  const hours = sec / 3600;
  return `~${Number.isInteger(hours) ? hours : hours.toFixed(1)} H`;
};

/**
 * Match what is SERVED to a registered model. The platform's own loaded truth
 * (`serving.loaded` — the supervised channel that sees through the
 * fd-serving idiom) is preferred; the /v1/models probe string (a name, a
 * path, or an unnameable fd) is the fallback. Matching runs servedId/key
 * equality, then basename either way around, with the .gguf extension
 * tolerated (the loaded key drops it). Never a guess: 'matched' carries the
 * registry entry; 'unregistered' carries the served name so the panel can
 * say so; 'not-serving' when nothing answers at all. Pure.
 * @param {{ok: boolean, models?: string[], loaded?: ?string}|null} serving
 *   the /status serving section
 * @param {Array<{key: string, label?: ?string, servedId: ?string, fileName: ?string}>} models
 * @returns {{state: 'matched', model: object, served: string}
 *   | {state: 'unregistered', served: string} | {state: 'not-serving', served: null}}
 */
export const servedModelMatch = (serving, models) => {
  const served = serving?.loaded
    ?? (serving?.ok === true && serving.models?.length ? serving.models[0] : null);
  if (!served) return { state: 'not-serving', served: null };
  const servedBase = String(served).split('/').pop();
  const servedStem = servedBase.replace(/\.gguf$/i, '');
  const model = (models ?? []).find((m) => m.servedId === served || m.key === served)
    ?? (models ?? []).find((m) => m.servedId && m.servedId.split('/').pop() === servedBase)
    ?? (models ?? []).find((m) => m.fileName
      && (m.fileName === servedBase || m.fileName.replace(/\.gguf$/i, '') === servedStem));
  return model ? { state: 'matched', model, served } : { state: 'unregistered', served };
};

/**
 * STEP 3's honest notices. Unregistered blocks the run (the registry pins
 * the artifact's hash — measuring an unpinned artifact proves nothing);
 * not-serving blocks it because there is nothing to measure. Null when
 * matched. Pure.
 * @param {object} match the servedModelMatch verdict
 */
export const subjectNotice = (match) => {
  if (match?.state === 'unregistered') {
    return '«NOTICE» the loaded model is not bench-registered — it cannot be measured until it is; register it in the harness first';
  }
  if (match?.state === 'not-serving') {
    return '«NOTICE» NOTHING IS LOADED — LOAD A MODEL FIRST';
  }
  return null;
};

/** pure — the arm's plain name from its id (the multi-select cards + marks). */
export const armName = (id) =>
  armChoices().find((c) => c.id === id)?.name ?? String(id ?? '?').toUpperCase();

/**
 * The per-arm mark row for a live (or settled) chain: ✓ passed, ✗ failed,
 * … in flight, · pending, — skipped (a stopped chain). Verdicts come from the
 * chain's own outcomes — never invented. Pure.
 * @param {{arms: string[], outcomes: Array, currentIndex: number,
 *   state: string}|null} chain the plane's chainStates() snapshot
 */
export const chainMarkRow = (chain) => {
  if (!chain) return [];
  return chain.arms.map((arm, i) => {
    const outcome = chain.outcomes.find((o) => o.arm === arm);
    let mark = '·';
    if (outcome?.skipped) mark = '—';
    else if (outcome) mark = outcome.ok ? '✓' : '✗';
    else if (chain.state === 'running' && i === chain.currentIndex) mark = '…';
    return { arm, name: armName(arm), mark };
  });
};

/**
 * The chain progress block for the launch tab: the plain line (ARM 2 OF 4 —
 * IDENTITY MOUNTED — RUNNING · receipts land in RUNS as they seal) plus the
 * marks plus THE CLOCK — elapsed, the current arm's own time, estimated
 * remaining (scaled by measured pace as arms land), finish-at. Null when no
 * chain stands. Pure — the clock arrives as opts.now.
 * @param {?object} chain chainStates() snapshot
 * @param {{cell?: ?object, runRows?: Array, now?: number}} [opts]
 */
export const matchedProgressView = (chain, opts = {}) => {
  if (!chain) return null;
  const { cell = null, runRows = [], now = Date.now() } = opts;
  const clockLine = matchedClockLine(chain, cell, runRows, now);
  const marks = chainMarkRow(chain);
  if (chain.state === 'done') {
    const failed = chain.outcomes.filter((o) => !o.skipped && !o.ok).length;
    return {
      line: `MATCHED SET SETTLED — ${chain.outcomes.filter((o) => !o.skipped && o.ok).length}/${chain.arms.length} ARMS CLEAN${failed ? ` · ${failed} FAILED — THE RECEIPTS CARRY IT` : ''}`,
      clockLine,
      marks,
    };
  }
  if (chain.state === 'stopped') {
    return { line: 'MATCHED SET STOPPED — THE REST NEVER RAN', clockLine, marks };
  }
  if (chain.state === 'failed') {
    return { line: `MATCHED SET FAILED — ${chain.error ?? 'unknown'}`, clockLine, marks };
  }
  return {
    line: `ARM ${chain.currentIndex + 1} OF ${chain.arms.length} — ${armName(chain.currentArm)} — RUNNING… receipts land in RUNS as they seal`,
    clockLine,
    marks,
  };
};

/**
 * THE CLEAR-MACHINE NOTICE (2026-09-25, the operator: […]). /status carries the harness's own test-process probe; RUN stands
 * only on a PROVEN clear machine. Null when clear; otherwise the notice plus
 * the processes standing on the box (so the operator sees WHOSE run it is).
 * Pure.
 * @param {?{clear: ?boolean, processes?: Array<{pid: number, command: string}>}} machine
 * @returns {?{line: string, processes: Array<{pid: number, command: string}>}}
 */
export const machineNotice = (machine) => {
  if (machine?.clear === true) return null;
  if (machine?.clear === false) {
    const n = machine.processes?.length ?? 0;
    return {
      line: `«WARNING» THE MACHINE IS NOT CLEAR — ${n} TEST PROCESS${n === 1 ? '' : 'ES'} RUNNING. THE RUN WAITS UNTIL THEY FINISH`,
      processes: (machine.processes ?? []).slice(0, 4),
    };
  }
  return { line: '«WARNING» CANNOT PROVE THE MACHINE IS CLEAR — THE RUN WAITS', processes: [] };
};

/**
 * Does the settled set owe a FAILURE REPORT? Yes once it stops running with
 * any arm not clean, or when the chain itself failed. Pure.
 * @param {?object} chain chainStates() snapshot
 */
export const chainNeedsReport = (chain) => {
  if (!chain || chain.state === 'running') return false;
  if (chain.state === 'failed') return true;
  return (chain.outcomes ?? []).some((o) => !o.skipped && !o.ok);
};

// ── THE CLOCK (2026-09-25, the operator: […]) ──────────────────────────

const clockText = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${mm(m)}:${mm(ss)}` : `${m}:${mm(ss)}`;
};

const minutesText = (ms) => {
  const m = Math.max(1, Math.round(ms / 60000));
  return m >= 60 ? `${(m / 60).toFixed(1)} H` : `${m} MIN`;
};

/**
 * Per-arm duration estimate: the LATEST MEASURED duration from the ledger
 * (rows matching suiteId + arm — history is the estimator), else the
 * catalog's own cost estimate. Pure.
 */
export const armEstimateMs = (arm, cell, runRows = []) => {
  const measured = (runRows ?? [])
    .filter((r) => r.suiteId === cell?.id && r.arm === arm && Number.isFinite(r.durationMs))
    .sort((a, b) => Date.parse(b.startedAt ?? 0) - Date.parse(a.startedAt ?? 0))[0];
  if (measured) return measured.durationMs;
  return (Number.isFinite(cell?.cost?.wallclockSec) ? cell.cost.wallclockSec : 0) * 1000;
};

/**
 * The chain's clock line: elapsed, the current arm's own time, estimated
 * remaining (remaining arms' estimates × the measured-so-far pace), finish-at.
 * Settled chains read their TOTAL. Null when the chain predates timing or
 * nothing computes. Pure — the clock arrives as `now`.
 */
export const matchedClockLine = (chain, cell, runRows = [], now = Date.now()) => {
  if (!chain?.startedAt) return null;
  const done = (chain.outcomes ?? []).filter((o) => !o.skipped);
  if (chain.state !== 'running') {
    if (!chain.finishedAt) return null;
    return `ELAPSED ${clockText(Date.parse(chain.finishedAt) - Date.parse(chain.startedAt))} TOTAL`;
  }
  const elapsedMs = now - Date.parse(chain.startedAt);
  const estimatedDoneMs = done.reduce((t, o) => t + armEstimateMs(o.arm, cell, runRows), 0);
  const measuredDoneMs = done.reduce((t, o) => t + (Number.isFinite(o.durationMs) ? o.durationMs : 0), 0);
  // The pace clamp: one fast or slow arm never swings the whole estimate.
  const pace = done.length > 0 && estimatedDoneMs > 0
    ? Math.max(0.25, Math.min(4, measuredDoneMs / estimatedDoneMs))
    : 1;
  const rest = chain.arms.filter((a) => !done.some((o) => o.arm === a));
  const remainingMs = rest.reduce((t, a) => t + armEstimateMs(a, cell, runRows) * pace, 0);
  const finish = new Date(now + remainingMs);
  const hh = (n) => String(n).padStart(2, '0');
  const onArm = chain.armStartedAt ? ` · ${clockText(now - Date.parse(chain.armStartedAt))} ON THIS ARM` : '';
  return `ELAPSED ${clockText(elapsedMs)}${onArm} · REMAINING ~${minutesText(remainingMs)} · FINISH ~${hh(finish.getHours())}:${hh(finish.getMinutes())}`;
};

/**
 * The identity-arm lane Select's options: the operator's OWN lanes, each
 * labeled 'name — KIND'. Pure.
 * @param {Array<{laneId: string, label: string, kind: string}>} lanes
 */
export const laneOptions = (lanes) =>
  (lanes ?? []).map((l) => ({ value: l.laneId, label: `${l.label} — ${String(l.kind).toUpperCase()}` }));

/**
 * The readiness verdict as one plain line: the harness gate's own last word
 * rides verbatim (it earned it). Pure.
 * @param {{exitCode: number, stdoutTail?: string}} result the preflight result
 * @returns {{ok: boolean, line: string}}
 */
export const readinessVerdict = (result) => {
  const lastLine = String(result?.stdoutTail ?? '')
    .split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
  if (result?.exitCode === 0) {
    return { ok: true, line: `READY — ${lastLine || 'the harness gate passed'}` };
  }
  return { ok: false, line: `NOT READY — ${lastLine || `exit ${result?.exitCode ?? '?'}`}` };
};

/**
 * FINE CONTROL's law: an EMPTY field is not sent. Trimmed strings ride;
 * limit/attempt coerce to numbers (a non-number is the server's refusal to
 * give, verbatim — the client never judges beyond emptiness). Pure.
 * @param {object} fields raw form fields
 * @returns {object} the params to send (possibly empty)
 */
export const fineControlParams = (fields = {}) => {
  const params = {};
  const text = (key, target = key) => {
    const value = typeof fields[key] === 'string' ? fields[key].trim() : '';
    if (value) params[target] = value;
  };
  const numeric = (key) => {
    const value = typeof fields[key] === 'string' ? fields[key].trim() : '';
    if (value) params[key] = Number(value);
  };
  numeric('limit');
  numeric('attempt');
  text('deadline');
  text('comparisonId', 'comparisonId');
  text('lane');
  text('workspaceRoot');
  return params;
};

/**
 * The live-run progress strip: plain, with the expected duration when the
 * picked benchmark declares one. Pure.
 * @param {object} child the plane-owned long child {verb, pid, startedAt}
 * @param {?object} cell the selected cell (for its wallclock), when known
 * @param {number} nowMs
 */
export const launchProgressLine = (child, cell, nowMs) => {
  const expect = cell ? durationLine(cell.cost?.wallclockSec) : '';
  return `RUNNING — ${String(child?.verb ?? '').toUpperCase()} · STARTED ${relTime(child?.startedAt, nowMs)}`
    + `${expect ? ` — USUALLY ${expect}` : ''} — WATCHING…`;
};
