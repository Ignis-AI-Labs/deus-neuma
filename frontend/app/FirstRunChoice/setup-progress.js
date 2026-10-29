// setup-progress — the model setup as ONE progress bar: how much of the whole job is done, and how
// long the rest will take at the speed it is going now. The backend job reports the step it is on
// and that step's bytes; the plan it runs (job.plan) names every step and its size, so the whole
// is the sum of the steps, with the running step's own measured total in place of the plan's
// estimate. A step that moves no bytes (unpack, start) holds the bar still and shows no time left,
// because no honest rate exists then (SHINKEI).
//
// pure — no IO.

// How far back the speed is measured: long enough to steady it, short enough to follow a change
const RATE_WINDOW_MS = 20_000;
// The least span of samples a rate is drawn from
const MIN_SPAN_MS = 2_000;
const AFTER_LAST_STEP = Object.freeze(['adopt', 'done']);

/**
 * Where the whole job stands.
 * @param {{state?: string, step?: string, completed?: number, total?: number, plan?: {steps?: Array<{id: string, bytes: number}>}}|null} job
 * @returns {{done: number|null, total: number|null, pct: number|null}}
 */
export const setupProgress = (job) => {
  const steps = job?.plan?.steps || [];
  const planned = steps.reduce((n, s) => n + (s.bytes || 0), 0);
  if (!planned) return { done: null, total: null, pct: null };
  if (job.state === 'done' || AFTER_LAST_STEP.includes(job.step)) return { done: planned, total: planned, pct: 100 };
  const at = steps.findIndex((s) => s.id === job.step);
  if (at < 0) return { done: null, total: planned, pct: null };
  const sum = (list) => list.reduce((n, s) => n + (s.bytes || 0), 0);
  const before = sum(steps.slice(0, at));
  const after = sum(steps.slice(at + 1));
  const step = steps[at];
  const stepTotal = step.bytes > 0 ? Math.max(step.bytes, job.total || 0) : 0;
  const stepDone = stepTotal > 0 ? Math.min(Math.max(job.completed || 0, 0), stepTotal) : 0;
  const total = before + stepTotal + after;
  const done = before + stepDone;
  return { done, total, pct: Math.min(100, Math.floor((done / total) * 100)) };
};

/**
 * Add one reading of bytes done, keeping only the readings inside the rate window.
 * @param {Array<{t: number, done: number}>} samples
 * @param {{t: number, done: number}} sample
 * @returns {Array<{t: number, done: number}>}
 */
export const addSample = (samples, sample) =>
  [...samples, sample].filter((s) => sample.t - s.t <= RATE_WINDOW_MS);

/**
 * Seconds left at the measured speed, or null when there is no honest speed to measure.
 * @param {Array<{t: number, done: number}>} samples
 * @param {number|null} remaining - bytes still to move
 * @returns {number|null}
 */
export const secondsLeft = (samples, remaining) => {
  if (!(remaining > 0) || samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const span = last.t - first.t;
  const moved = last.done - first.done;
  if (span < MIN_SPAN_MS || moved <= 0) return null;
  return Math.ceil(remaining / (moved / span) / 1000);
};

/**
 * Time left as a person reads it.
 * @param {number|null} seconds
 * @returns {string|null}
 */
export const timeLeftLabel = (seconds) => {
  if (seconds == null) return null;
  if (seconds < 60) return `${seconds} s left`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min left`;
};
