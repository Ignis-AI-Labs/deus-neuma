// bench-view.js — the BENCH window's pure display law for the OVERVIEW,
// REPORTS and shared reads: serving/daemon/lock lines, the night-window
// countdown, queue rows, the incident rail, catalog labels, the metrics.csv
// parser, the proof suite's state lines. The LAUNCH tab's display law lives
// in bench-launch-view.js (the 500-line law; 2026-09-25), the run ledger's in
// bench-runs-view.js. The impure shell (fetch, poll, state) lives in
// BenchApp.jsx; the bodies stay declarative.

import { formatDateTime } from '../../utils/format.js';

/**
 * The harness-absent register: the whole app reads a «NOTICE» empty state
 * instead of an error when the machine carries no harness. The client's
 * thrown Error carries the structured refusal's code (http.js unwraps it).
 * Pure.
 */
export const isHarnessAbsent = (err) => err?.code === 'BENCH_HARNESS_ABSENT';

/**
 * A compact relative time with the clock INJECTED (the view stays pure and
 * the test decides what "now" is). Future reads 'in …'.
 * @param {string|number} isoOrMs
 * @param {number} nowMs
 */
export const relTime = (isoOrMs, nowMs) => {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return 'AGE UNKNOWN';
  const future = ms > nowMs;
  const delta = Math.abs(nowMs - ms);
  const mins = Math.floor(delta / 60000);
  const text = mins < 1 ? 'JUST NOW'
    : mins < 60 ? `${mins}M`
    : Math.floor(mins / 60) < 24 ? `${Math.floor(mins / 60)}H ${mins % 60}M`
    : `${Math.floor(mins / 1440)}D ${Math.floor((mins % 1440) / 60)}H`;
  if (text === 'JUST NOW') return future ? 'NOW' : 'JUST NOW';
  return future ? `IN ${text}` : `${text} AGO`;
};

/**
 * The deadline countdown for a live window: time left, or OVERDUE in the
 * alert register. Null when there is no parseable deadline.
 * @param {string} deadline ISO
 * @param {number} nowMs injected clock
 * @returns {{text: string, overdue: boolean}|null}
 */
export const deadlineCountdown = (deadline, nowMs) => {
  const ms = Date.parse(deadline);
  if (!Number.isFinite(ms)) return null;
  const delta = ms - nowMs;
  const overdue = delta < 0;
  const mins = Math.floor(Math.abs(delta) / 60000);
  const span = mins < 60 ? `${mins}M`
    : mins < 1440 ? `${Math.floor(mins / 60)}H ${mins % 60}M`
    : `${Math.floor(mins / 1440)}D ${Math.floor((mins % 1440) / 60)}H`;
  return { text: overdue ? `OVERDUE ${span}` : `${span} LEFT`, overdue };
};

/** pure — the serving line: live with its model ids, or DOWN with the reason. */
export const servingLive = (serving) => serving?.ok === true;

/** pure — the serving headline for the OVERVIEW. */
export const servingLine = (serving) => {
  if (!serving) return 'SERVING — NO READING';
  if (serving.ok) {
    const models = serving.models?.length ? serving.models.join(', ') : 'NONE LOADED';
    return `SERVING — LIVE · ${serving.models?.length ?? 0} MODEL${serving.models?.length === 1 ? '' : 'S'}: ${models}`;
  }
  return `SERVING — DOWN (${serving.error || 'no answer'})`;
};

/**
 * The GPU row: name, utilization, memory while the driver answers; the
 * driver-silent reading reads loud — it is the one failure relight cannot
 * fix. Pure.
 * @param {{ok: boolean, name?: string, utilizationPercent?: number,
 *   memoryUsedMiB?: number, error?: string}|null} gpu
 * @returns {{text: string, alert: boolean}}
 */
export const gpuLine = (gpu) => {
  if (!gpu) return { text: 'GPU — NO READING', alert: false };
  if (gpu.ok) {
    return {
      text: `GPU — ${String(gpu.name).toUpperCase()} · ${gpu.utilizationPercent}% · ${gpu.memoryUsedMiB} MIB`,
      alert: false,
    };
  }
  return { text: `GPU — DRIVER NOT ANSWERING (${gpu.error || 'nvidia-smi silent'})`, alert: true };
};

/** pure — the relight outcome as display lines: who stands, and what next. */
export const relightResultLines = (result) => [
  ...(result?.spawned ?? []).map((s) => `${String(s.name).toUpperCase()} STANDS — VIA ${String(s.via).toUpperCase()}${s.pid ? ` · PID ${s.pid}` : ''}`),
  ...(result?.detail ? [result.detail] : []),
];

/**
 * The proof run's one-line state for the panel: what is happening, honestly,
 * per state. Pure.
 * @param {{state: string, done?: number, total?: number, section?: string,
 *   itemId?: string, passCount?: number, error?: string, verdict?: object,
 *   proofId?: string}|null} run
 */
export const proofStateLine = (run) => {
  if (!run || run.state === 'idle') return 'NO PROOF RUN YET — THE SUITE HAS NOT RUN ON THIS MACHINE';
  if (run.state === 'running') {
    return `RUNNING — ${run.done}/${run.total} · ${String(run.section ?? 'starting').toUpperCase()} · ${run.itemId ?? ''} · ${run.passCount} PASS SO FAR`;
  }
  if (run.state === 'done') {
    return `DONE — ${run.verdict?.pass ?? '?'}/${run.verdict?.total ?? '?'} PASS · CERTIFICATE ${run.proofId ?? '?'}`;
  }
  return `FAILED — ${run.error ?? 'unknown'}`;
};

/**
 * The score line for a finished receipt: per-section accuracy beside the
 * total. Pure.
 * @param {object} receipt
 */
export const proofScoreLine = (receipt) => {
  const total = receipt?.total ?? { pass: 0, total: 0 };
  const per = Object.entries(receipt?.sections ?? {})
    .map(([name, s]) => `${name} ${s.pass}/${s.total}`)
    .join(' · ');
  return `${total.pass}/${total.total} PASS — ${per}`;
};

/** pure — a sealed certificate as the PROOFS list reads it. */
export const proofRow = (proof, nowMs) => ({
  key: proof.id,
  id: proof.id,
  age: relTime(proof.mtimeMs, nowMs),
});

/**
 * One harness daemon's liveness line. Live carries the signal — the Sep-21
 * postmortem exists because nobody watched serving; a live watchdog IS the
 * news. Pure.
 * @param {string} label e.g. 'SERVING WATCHDOG'
 * @param {{running: boolean, pids: number[]}|null} d
 */
export const daemonLine = (label, d) => ({
  text: d?.running ? `${label} — LIVE (PID ${d.pids.join(', ')})` : `${label} — NOT RUNNING`,
  live: d?.running === true,
});

/**
 * The rig lock line, or null when no window holds the rig (the section then
 * reads as free). A live lock carries the signal; a stale lock (dead pid) is
 * quiet — it blocks nothing.
 * @param {{pid: (number|null), alive: boolean}|null} lock
 */
export const lockLine = (lock) => {
  if (!lock) return null;
  return {
    text: lock.alive
      ? `RIG LOCKED — PID ${lock.pid ?? '?'} ALIVE (one benchmark at a time)`
      : `RIG LOCK — STALE (PID ${lock.pid ?? '?'} not running)`,
    live: lock.alive === true,
  };
};

/**
 * The night window's headline: status, and what matters about it right now —
 * the deadline countdown while it lives, the finish stamp when it is done.
 * Pure (clock injected).
 * @param {object|null} night the parsed night status
 * @param {number} nowMs
 */
export const nightLine = (night, nowMs) => {
  if (!night) return 'NO NIGHT WINDOW ON RECORD';
  const status = (night.status || 'unknown').replace(/-/g, ' ').toUpperCase();
  if (night.finishedAt) return `${status} — FINISHED ${formatDateTime(night.finishedAt)}`;
  const left = deadlineCountdown(night.deadline, nowMs);
  return `${status}${left ? ` — ${left.text}` : ''}`;
};

/** pure — the window's groups as display rows. */
export const nightGroups = (night) => (night?.groups ?? []).map((g) => ({
  key: g.id ?? '?',
  text: `${g.id ?? '?'} — ${(g.status || 'unknown').replace(/-/g, ' ').toUpperCase()}`,
  register: /fail|unavailable|abort/i.test(g.status || '') ? 'loud'
    : /run|succeed/i.test(g.status || '') ? 'live' : 'quiet',
}));

/** pure — the window's steps as display rows. */
export const nightSteps = (night) => (night?.steps ?? []).map((s, i) => ({
  key: `${s.cell}-${s.arm}-${i}`,
  text: `${s.cell ?? '?'} / ${s.arm ?? '?'} · ATTEMPT ${s.attempt ?? '?'} — ${(s.status || 'unknown').toUpperCase()}`,
  register: /fail/i.test(s.status || '') ? 'loud'
    : /run|succeed/i.test(s.status || '') ? 'live' : 'quiet',
}));

/** pure — a plane-owned child as the operator reads it (the STOP list too). */
export const ownedLine = (child, nowMs = Date.now()) =>
  `${(child.verb || '?').toUpperCase()} — PID ${child.pid} · STARTED ${relTime(child.startedAt, nowMs)} · LOG ${child.logFile}`;

/**
 * One incident row (either journal) normalized for the rail. Harness serving
 * rows are {at, event, ...}; the plane's watch rows are {at, source,
 * condition, severity, detail}. Down rows, failed relights and escalations
 * read loud. Pure.
 * @param {object} row
 * @param {number} i fallback key index
 */
export const incidentRow = (row, i = 0) => {
  const atMs = Date.parse(row?.at);
  const isWatch = row?.source === 'bench-watch';
  const loud = isWatch
    ? row?.severity === 'escalated' || row?.severity === 'warning'
    : row?.event === 'down' || (row?.event === 'relight-exit' && row?.code !== 0);
  const text = isWatch
    ? `WATCH · ${(row?.condition || 'condition').toUpperCase()} — ${row?.detail || ''}`
    : `SERVING · ${(row?.event || 'unknown').toUpperCase()}${row?.event === 'relight-exit' ? ` (EXIT ${row?.code})` : ''}${row?.note ? ` — ${row.note}` : ''}${row?.event === 'recovered' ? ` — DOWN ${Math.round((row?.downMs ?? 0) / 1000)}S` : ''}`;
  return {
    key: `${row?.at ?? 'no-at'}-${i}`,
    atMs: Number.isFinite(atMs) ? atMs : 0,
    text,
    register: loud ? 'loud' : 'quiet',
  };
};

/**
 * The incident rail: both journals merged, newest first.
 * @param {{serving?: Array, watch?: Array}} journals
 * @param {number} [cap]
 */
export const incidentRows = ({ serving = [], watch = [] } = {}, cap = 30) =>
  [...serving, ...watch]
    .map((row, i) => incidentRow(row, i))
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, cap);

/** pure — a run id without its trailing stamp (the table's width; the harness
 *  stamps 14–17 digits — '20260920230831179' in the fixture). */
export const shortRunId = (runId) => String(runId ?? '').replace(/-\d{14,17}$/, '');

/** pure — a bundle as the left rail reads it. */
export const bundleLabel = (bundle, nowMs) => ({
  key: bundle.id,
  id: bundle.id,
  age: relTime(bundle.mtimeMs, nowMs),
});

/** pure — a cell option line: tier, id, how many arms it offers. */
export const cellLabel = (cell) =>
  `${String(cell.tier || '?').toUpperCase()} · ${cell.id} — ${cell.arms.length} ARM${cell.arms.length === 1 ? '' : 'S'}`;

/** pure — a model option line; an unhashed model is NOT launch-ready. */
export const modelLabel = (model) =>
  `${model.key}${model.quantization ? ` — ${model.quantization}` : ''}${model.hasSha256 ? '' : ' · NO SHA256 — NOT LAUNCH-READY'}`;

/** pure — a plan option line. */
export const planLabel = (plan) =>
  `${plan.name} — ${plan.windowHours ?? '?'}H WINDOW · ${plan.model ?? '?'} · ${plan.groupCount} GROUP${plan.groupCount === 1 ? '' : 'S'} / ${plan.stepCount} STEP${plan.stepCount === 1 ? '' : 'S'}`;

/** pure — the artifact keys the REPORTS tab offers (the server's closed map). */
export const ARTIFACT_KEYS = Object.freeze(['report', 'metrics', 'receipts', 'queue']);

/**
 * Parse metrics.csv text — the harness's fixed header
 * (runId,comparisonId,arm,status,attempt,metric,value) with quoted fields
 * ("gsm8k/exact_match,strict-match") and "" escapes. Mirrors the plane's
 * backend parser so the REPORTS table renders the same rows the API serves.
 * Pure.
 * @param {string} text
 * @returns {Array<{runId: string, comparisonId: string, arm: string,
 *   status: string, attempt: ?number, metric: string, value: ?number}>}
 */
export const parseMetricsCsv = (text) => {
  const lines = String(text ?? '').split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const parseRow = (line) => {
    const fields = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
        } else { field += ch; }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        fields.push(field); field = '';
      } else { field += ch; }
    }
    fields.push(field);
    return fields;
  };
  const toNumber = (s) => {
    const n = Number(s);
    return s !== '' && Number.isFinite(n) ? n : null;
  };
  return lines.slice(1).map(parseRow)
    .filter((f) => f.length >= 7)
    .map((f) => ({
      runId: f[0],
      comparisonId: f[1],
      arm: f[2],
      status: f[3],
      attempt: toNumber(f[4]),
      metric: f[5],
      value: toNumber(f[6]),
    }));
};

/**
 * The launch/preflight result panel's view: the fired argv first (the
 * operator sees exactly what ran), then pid / exit / log. Refusals never
 * reach here — they render from the caught Error's own message.
 * @param {string} title what was attempted (e.g. 'RUN gsm8k / neuma')
 * @param {object} result the plane's success result
 */
export const launchResultView = (title, result) => ({
  title,
  argvLine: `node ${(result?.argv ?? []).join(' ')}`,
  lines: [
    `PID ${result?.pid ?? '?'}`,
    result?.exitCode !== undefined ? `EXIT ${result.exitCode}` : 'RUNNING (LONG VERB — THE PLANE OWNS THE CHILD)',
    `LOG ${result?.logFile ?? '?'}`,
  ],
  stdout: result?.stdout ?? result?.stdoutTail ?? '',
});
