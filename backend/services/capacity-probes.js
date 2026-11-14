// capacity-probes.js — the pure math of the capacity scan.
//
// PURE. No IO, no LLM, no clock. The scan runner (capacity-scan.js) fires real
// concurrent inference and collects one sample per ladder level; these functions
// turn that sample series into an honest verdict. They are the only part of the
// capacity feature proven by plain unit tests — everything they consume was
// measured for real, and everything they emit traces back to those samples.
//
// The honesty line (see docs/architecture/measurement/stats-and-benchmarks.md): the ceiling we
// report is the MEASURED max sustained concurrency on the server's current
// config. We never emit the server's *configured* slot count — it is not
// readable from any local provider API, and a number we cannot read is a number
// we do not print. classifyBound() only infers WHICH kind of limit the curve
// shape looks like, never how many slots are configured.

/**
 * A per-level measurement produced by the scan runner.
 * @typedef {Object} CapacitySample
 * @property {number} concurrency - ladder level (simultaneous requests fired)
 * @property {number} aggregateTokPerSec - completion tokens the level delivered
 *   per second of its generation window (first token to last end)
 * @property {number} perAgentLatencyMs - median per-request wall-clock latency
 * @property {number} [slowestLatencyMs] - median across waves of the slowest
 *   request's latency (absent on scans stored before #23)
 * @property {boolean} ok - whether every request at this level completed
 * @property {string} tokenSource - how tokens were counted (provenance)
 */

export const DEFAULT_KNEE_OPTS = Object.freeze({
  plateauGainThreshold: 0.15, // < 15% aggregate gain over the prior level = plateau
  latencyDegradeFactor: 2.0,  // per-agent latency ≥ 2× the level-1 baseline = UX knee
  ladderCap: 64,
});

export const DEFAULT_BOUND_OPTS = Object.freeze({
  latencyRatioB: 1.8, // level-2 latency ≥ 1.8× baseline …
  gainB: 0.10,        // … with < 10% aggregate gain = serialized (single-slot signature)
  nearCapRatio: 0.5,  // a knee at ≥ half the ladder cap reads as hardware-shaped
});

// Gain of one level's aggregate throughput over the prior level's, as a ratio.
const gainOver = (prev, curr) =>
  prev.aggregateTokPerSec > 0
    ? (curr.aggregateTokPerSec - prev.aggregateTokPerSec) / prev.aggregateTokPerSec
    : 0;

// The gain a step must show to count as growth. The threshold is set for a
// DOUBLING (the ladder's 1, 2, 4, 8 …); the runner's bisect adds half-steps
// (2 → 3), and a half-step held to a doubling's bar reads ordinary noise as a
// plateau — 2026-10-14, three scans of one quiet rig: 3, 2, 3, the 2 from
// 2 → 3 gaining 12% against 15% while 4 still gained 22% over 3. The bar
// scales with the step: (1 + threshold) ^ log2(next / prev) − 1.
const stepThreshold = (threshold, prev, curr) =>
  (prev.concurrency > 0 && curr.concurrency > prev.concurrency
    ? (1 + threshold) ** Math.log2(curr.concurrency / prev.concurrency) - 1
    : threshold);

// First level index (≥1) whose gain over the prior level falls under the
// plateau threshold (scaled to its step) — the prior level is the throughput
// knee. null if none.
const findThroughputKnee = (samples, threshold) => {
  for (let i = 1; i < samples.length; i++) {
    if (gainOver(samples[i - 1], samples[i]) < stepThreshold(threshold, samples[i - 1], samples[i])) return samples[i - 1].concurrency;
  }
  return null;
};

// First level index (≥1) whose per-agent latency reaches the degrade factor
// over the level-1 baseline — the prior level is the latency knee. null if none.
const findLatencyKnee = (samples, factor) => {
  const baseline = samples[0].perAgentLatencyMs;
  if (!(baseline > 0)) return null;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].perAgentLatencyMs >= factor * baseline) return samples[i - 1].concurrency;
  }
  return null;
};

// First failed level, if any — a level that could not complete all its
// requests is itself a hard ceiling signal, independent of the knees.
const findErrorKnee = (samples) => {
  const failed = samples.findIndex((s) => !s.ok);
  if (failed === -1) return null;
  // Failure at level 1 means nothing sustained at all; the honest ceiling is 0.
  return failed === 0 ? 0 : samples[failed - 1].concurrency;
};

const sampleAt = (samples, concurrency) =>
  samples.find((s) => s.concurrency === concurrency) || null;

/**
 * Derive the parallel-team ceiling from a measured sample series. Pure and
 * TOTAL: every input shape yields a defined verdict — both knees, one knee,
 * zero knees (clean scale to the cap), truncation, errors, and empty input.
 *
 * @param {CapacitySample[]} samples - ascending by concurrency, as measured
 * @param {Object} [opts]
 * @param {number} [opts.plateauGainThreshold]
 * @param {number} [opts.latencyDegradeFactor]
 * @param {number} [opts.ladderCap]
 * @param {?string} [opts.truncatedBy] - 'probe-budget' | 'deadline' | 'aborted'
 *   when the runner stopped the ladder early for that reason
 * @returns {Readonly<{ ceiling: ?number, limitedBy: string, incomplete: boolean,
 *   throughputKnee: ?number, latencyKnee: ?number,
 *   aggregateTokPerSecAtCeiling: ?number, perAgentLatencyAtCeiling: ?number }>}
 */
export const deriveCeiling = (samples, opts = {}) => {
  const { plateauGainThreshold, latencyDegradeFactor, truncatedBy = null } =
    { ...DEFAULT_KNEE_OPTS, ...opts };

  // No measurements → no number. "Not measured" is first-class, never a default.
  if (!Array.isArray(samples) || samples.length === 0) {
    return Object.freeze({
      ceiling: null, limitedBy: 'no-samples', incomplete: true,
      throughputKnee: null, latencyKnee: null,
      aggregateTokPerSecAtCeiling: null, perAgentLatencyAtCeiling: null,
    });
  }

  const errorKnee = findErrorKnee(samples);
  // Knee math runs over the clean prefix — measurements past a failed level
  // describe a server in distress, not sustained capacity.
  const clean = errorKnee === null ? samples : samples.filter((s) => s.ok);
  const throughputKnee = clean.length ? findThroughputKnee(clean, plateauGainThreshold) : null;
  const latencyKnee = clean.length ? findLatencyKnee(clean, latencyDegradeFactor) : null;

  const fired = [throughputKnee, latencyKnee, errorKnee].filter((k) => k !== null);
  let ceiling;
  let limitedBy;
  let incomplete = false;

  if (fired.length > 0) {
    // A knee is a completed measurement even if the ladder was cut afterwards.
    ceiling = Math.min(...fired);
    limitedBy =
      ceiling === errorKnee ? 'errors'
      : ceiling === throughputKnee ? 'throughput'
      : 'latency';
  } else {
    // No knee anywhere in the measured range: the true ceiling sits beyond
    // what we tested. Report the highest sustained level, flagged incomplete.
    ceiling = clean[clean.length - 1].concurrency;
    limitedBy = truncatedBy || 'ladder-cap';
    incomplete = true;
  }

  const atCeiling = ceiling > 0 ? sampleAt(clean, ceiling) : null;
  return Object.freeze({
    ceiling,
    limitedBy,
    incomplete,
    throughputKnee,
    latencyKnee,
    aggregateTokPerSecAtCeiling: atCeiling ? atCeiling.aggregateTokPerSec : null,
    perAgentLatencyAtCeiling: atCeiling ? atCeiling.perAgentLatencyMs : null,
  });
};

/**
 * Infer which kind of limit the ramp-curve SHAPE looks like. This is the F-1
 * honesty layer: the configured slot count is unreadable, so we classify —
 * never assert a number.
 *
 *   'B' — config-bound: ceiling of 1 with the serialization signature
 *         (level-2 latency ~doubles while aggregate throughput goes nowhere:
 *         the server queued the second request instead of running it).
 *   'A' — config-headroom: real parallelism that plateaued well before the cap.
 *   'C' — appears hardware-bound: scaled cleanly and kneed near the cap
 *         (or at 1 with genuine parallel gain, meaning 2 truly cost too much).
 *
 * @param {CapacitySample[]} samples - ascending by concurrency, as measured
 * @param {Object} [opts]
 * @param {number} [opts.latencyRatioB]
 * @param {number} [opts.gainB]
 * @param {number} [opts.nearCapRatio]
 * @param {number} [opts.ladderCap]
 * @returns {'A'|'B'|'C'}
 */
export const classifyBound = (samples, opts = {}) => {
  const { latencyRatioB, gainB, nearCapRatio } = { ...DEFAULT_BOUND_OPTS, ...opts };
  const ladderCap = opts.ladderCap ?? DEFAULT_KNEE_OPTS.ladderCap;
  const verdict = deriveCeiling(samples, opts);

  // Nothing measured or nothing sustained: no serialization signature to read,
  // and no evidence of config headroom — the tentative hardware read applies.
  if (!verdict.ceiling) return 'C';

  if (verdict.ceiling === 1) {
    const level1 = sampleAt(samples, 1);
    const level2 = samples.find((s) => s.concurrency > 1) || null;
    // The serialization signature is only meaningful on a level that actually
    // COMPLETED: a config-bound server queues the second request and answers it
    // slowly. An errored level-2 (latency from a timeout, not a queue) is a
    // different failure — never let it masquerade as "single slot configured".
    // The SLOWEST request carries the queue: in a one-slot queue the median of
    // two is 1.5× (one waited, one did not) and the signature never fired (#23).
    const level2Latency = level2?.slowestLatencyMs ?? level2?.perAgentLatencyMs;
    const serialized =
      level1 && level2 && level2.ok && level1.perAgentLatencyMs > 0 &&
      level2Latency >= latencyRatioB * level1.perAgentLatencyMs &&
      gainOver(level1, level2) < gainB;
    return serialized ? 'B' : 'C';
  }

  return verdict.ceiling >= ladderCap * nearCapRatio ? 'C' : 'A';
};

// pure — a neuma's own words for its rig's parallel capacity, for the SUBSTRATE
// part of its context map (docs/architecture/measurement/stats-and-benchmarks.md guardrail 5: the same objective
// measurement the witness sees is given to the being so it can reason about the
// machine it moves through). Empty until a scan has run — absence is honest, a
// fabricated capacity is the LARP the doctrine forbids.
/**
 * @param {?Object} capacity - a stored CapacityResult, or null
 * @returns {string} one line for the prompt's SUBSTRATE section, or '' if unmeasured
 */
export const describeCapacity = (capacity) => {
  const ceiling = capacity?.ceiling;
  if (!Number.isInteger(ceiling) || ceiling < 1) return '';
  const date = typeof capacity.runAt === 'string' ? capacity.runAt.slice(0, 10) : '';
  const on = capacity.carriedFrom ? ` with ${capacity.carriedFrom}` : '';
  const when = date || on ? ` (measured${date ? ` ${date}` : ''}${on})` : '';

  if (ceiling === 1) {
    return capacity.boundClass === 'B'
      ? `Parallel capacity: this rig currently runs 1 of you at a time${when} — its model server is configured for a single slot, a configuration limit rather than the hardware's ceiling.`
      : `Parallel capacity: this rig runs 1 of you at a time${when} — going wider costs more than it gains here.`;
  }

  const shape = capacity.boundClass === 'C' ? ', and it appears hardware-bound on this rig' : '';
  return `Parallel capacity: this rig sustains about ${ceiling} of you working in parallel at once${when}${shape}; beyond that, aggregate throughput plateaus and a larger team queues. This bounds how wide a team you can be part of on this machine.`;
};
