/**
 * THE COMFY VIEWPORT — what the AI is doing on the engine, for the operator.
 *
 * ComfyUI cannot tell the operator this itself. A prompt carrying a `client_id`
 * makes the engine route every `executing` / `progress` / `executed` message to
 * that ONE socket (`execution.py:732-735`, `:492`, `:575`), and our job lane
 * submits under its own `laneClientId` — so the operator's open canvas sees the
 * queue counter tick and nothing else. Submitting with no `client_id` is worse:
 * `add_message(broadcast=False)` then sends to nobody at all.
 *
 * The backend already holds the one socket that receives those events, so the
 * honest surface is a NEUMA-native record beside the canvas, fed from there.
 * This module is that record: a bounded ring of per-job entries, newest first.
 *
 * It is display truth, not audit truth — the being's journal remains the
 * durable record. Nothing here is persisted, and a restart starts empty.
 */

/** How many finished jobs stay readable behind the live ones. */
export const RECENT_CAP = 12;

/**
 * Fold one patch into a record list. PURE — the whole state law lives here, so
 * ordering, capping and phase transitions are testable without a live engine.
 *
 * Keyed by `jobId`. An unknown jobId prepends; a known one merges in place and
 * keeps its position, so a rendering row does not jump under the operator's
 * eye. Terminal rows are capped to RECENT_CAP; live rows are never dropped —
 * the engine is a single FIFO, so their number is bounded by the engine itself.
 *
 * @param {ReadonlyArray<object>} records existing records, newest first
 * @param {{jobId: string, phase?: string}} patch fields to set on this job
 * @param {number} now epoch ms — injected, never read from the clock here
 * @param {number} [cap] terminal-row cap
 * @returns {Array<object>} a new list, newest first
 */
export const foldActivity = (records, patch, now, cap = RECENT_CAP) => {
  if (!patch?.jobId) return [...records];

  const seen = records.some((r) => r.jobId === patch.jobId);
  const next = seen
    ? records.map((r) => (r.jobId === patch.jobId ? { ...r, ...patch, updatedAt: now } : r))
    : [{ startedAt: now, updatedAt: now, phase: 'queued', ...patch }, ...records];

  // Cap only the settled rows: a live row is the thing the operator is watching.
  let kept = 0;
  return next.filter((r) => (isLive(r) ? true : ++kept <= cap));
};

/** A record the engine is still working on. Pure. */
export const isLive = (record) => record?.phase === 'queued' || record?.phase === 'rendering';

/**
 * Percent complete for a record, or null when it has no meaningful progress.
 * Pure. Guards the max=0 case the engine sends before sampling begins.
 * @param {{value?: number, max?: number}} progress
 * @returns {number|null} 0-100
 */
export const percentOf = (progress) => {
  const max = Number(progress?.max ?? 0);
  const value = Number(progress?.value ?? 0);
  if (!Number.isFinite(max) || !Number.isFinite(value) || max <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
};

// ── impure shell ───────────────────────────────────────────────────────────
// Module state, deliberately: the activity feed is one rig-wide truth about one
// engine, exactly like the supervisor's own state. Scoping it per-request would
// mean losing every event that lands between polls.

let records = [];

/**
 * Told when a job REACHES AN END, so the desk can say so.
 *
 * Injected rather than imported: this module sits under services/ and the
 * notification transport lives in routes/, which services must not reach — the
 * same cycle the heartbeat's storage notifier avoids. Wired once, at load, from
 * portal-routes.
 *
 * Hooked HERE and not at the call sites because every phase already funnels
 * through `publishActivity` — which means the being-facing forge tool, a file
 * three other workstreams are editing, needs no change at all.
 */
let notifier = null;

/** impure — wire the end-of-job notifier. */
export const setActivityNotifier = (fn) => {
  notifier = typeof fn === 'function' ? fn : null;
};

/** A job is over — one of these three, and never a progress beat. */
const TERMINAL_PHASES = Object.freeze(['done', 'error', 'stopped']);

/**
 * Record a beat of a job's life. Impure (module state, clock).
 * @param {{jobId: string, phase?: string, laneId?: string, pipelineId?: string,
 *   pipelineLabel?: string, percent?: number|null, detail?: string,
 *   images?: Array<object>}} patch
 */
export const publishActivity = (patch) => {
  records = foldActivity(records, patch, Date.now());
  if (!notifier || !TERMINAL_PHASES.includes(patch?.phase)) return;
  // The folded record, not the patch: a terminal patch carries only the phase,
  // while the record has accumulated laneId, beingName and the images across
  // the job's whole life.
  const record = records.find((r) => r.jobId === patch.jobId);
  if (!record) return;
  // Never awaited and never allowed to reject — a render must not fail because
  // a card did.
  try {
    Promise.resolve(notifier(record)).catch(() => {});
  } catch { /* a notifier that throws synchronously is still not this job's problem */ }
};

/**
 * The operator-facing snapshot: live jobs and the recent tail, newest first.
 * Impure (reads module state).
 * @returns {{live: Array<object>, recent: Array<object>, at: number}}
 */
export const activitySnapshot = () => ({
  live: records.filter(isLive),
  recent: records.filter((r) => !isLive(r)),
  at: Date.now(),
});

/** Test/shutdown seam: forget everything. Impure. */
export const _resetActivity = () => { records = []; };
