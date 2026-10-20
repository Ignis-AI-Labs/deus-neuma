// capacity-scan.js — the capacity scan: real concurrent inference, measured.
//
// Every effect is injected (the concurrent-fire function, the health probe, the
// clock, the consent record), so the ramp logic is deterministic under a
// scripted fire while the REAL fire (fireCapacityProbes) sends genuine
// parallel requests through createStreamRequest — no mock anywhere in the
// path we claim works (RULE 0; the live proof is the gated integration test).
//
// A scan with no real measurement is never written: any throw propagates and
// the route records nothing. Aborting is a soft stop — checked BETWEEN ladder
// levels, never forwarded into fetch — so in-flight requests drain naturally
// and an aborted scan leaves no partial ceiling behind.

import {
  createStreamRequest,
  readStreamLine,
  getConfig,
} from './llm-provider.js';
import { reachSubstrate } from './substrate-reach.js';
import { deriveCeiling, classifyBound, DEFAULT_KNEE_OPTS } from './capacity-probes.js';
import { withLineExempt } from './substrate-lease.js';

export const DEFAULT_LADDER = Object.freeze([1, 2, 4, 8, 16, 32, 64]);
export const DEFAULT_LIMITS = Object.freeze({
  maxTotalProbes: 900,      // 1 probe = 1 concurrent HTTP request
  perRunDeadlineMs: 300_000,
});
export const DEFAULT_PROBE = Object.freeze({
  // Fixed synthetic prompt: the scan measures the RIG, not any being — no
  // DNA/soul assembly, no per-neuma variance in what must be a substrate fact.
  prompt: 'Count from 1 to 20, one number per line. Output only the numbers.',
  maxTokens: 64,
  temperature: 0,
});
export const REPEATS_PER_LEVEL = 5; // ratified: ±15% tolerance via median-of-5
const SCAN_STALL_MS = 45_000; // per-request; well under the run deadline so one hang can't eat it

// Only local servers expose an observable concurrency knee; firing hundreds of
// probes at a paid remote API measures nothing about this rig.
// llama-server joined 2026-08-28: it is THE primary serving lane (real slots,
// -np), speaks the same createStreamRequest wire the scan rides, and its
// absence left the rig unable to renew a stale ceiling at all — the + TAB
// refusal said "re-scan" while the card said "not measurable" (Founder's report).
export const SCANNABLE_PROVIDERS = Object.freeze(['lm-studio', 'ollama', 'custom', 'llama-server']);

/** Thrown when the operator aborts mid-scan; the route writes nothing. */
export class ScanAborted extends Error {
  constructor() { super('capacity scan aborted by the operator — no run recorded'); }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Whitespace token proxy: deterministic, provider-uniform, dependency-free.
// Approximate by design — the knee math runs on ratios, so a consistent
// proxy finds the same knee a true tokenizer would.
const countTokens = (text) => text.trim().split(/\s+/).filter(Boolean).length;

// impure — drain one real completion stream with the scan's own stall budget.
// The shared consumeStream hardcodes a 120s stall guard and hides token
// accounting; the scan needs both under its control, so it reads the wire
// itself and reuses the provider's own line parser (readStreamLine).
const drainOneRequest = async (probe, stallMs) => {
  const t0 = Date.now();
  const { response, provider } = await createStreamRequest(
    [{ role: 'user', content: probe.prompt }],
    { maxTokens: probe.maxTokens, temperature: probe.temperature }
  );

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let tFirst = null;
  let served = null; // the server's own count of what it generated (stream usage)
  try {
    for (;;) {
      let timer;
      const chunk = await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`capacity probe stalled — no data for ${stallMs / 1000}s`)),
            stallMs
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const event = readStreamLine(line, provider);
        if (!event) continue;
        if (event.done) { buffer = ''; break; }
        if (Number.isFinite(event.usage?.completionTokens)) served = event.usage.completionTokens;
        // A thinking model's reasoning is generated work too: counting only
        // the visible words read a ~80 tok/s server as ~20 (2026-10-13 —
        // the Sep 9 scan's one-agent row, against the long-session bench).
        const piece = (event.content || '') + (event.reasoning || '');
        if (piece) {
          if (tFirst === null) tFirst = Date.now();
          text += piece;
        }
      }
    }
  } finally {
    reader.cancel().catch(() => { /* stream already closed */ });
  }

  const tEnd = Date.now();
  // The server's count when it gives one; the whitespace proxy only when not.
  const tokens = served ?? countTokens(text);
  const genMs = tFirst !== null ? Math.max(tEnd - tFirst, 1) : null;
  return {
    latencyMs: tEnd - t0,
    tokPerSec: genMs !== null ? (tokens / genMs) * 1000 : 0,
    tokenSource: served != null ? 'server-usage' : 'whitespace-proxy',
  };
};

// impure — the REAL concurrent fire: one wave of `concurrency` genuine
// simultaneous requests. Per-request failures are a measurement (ok: false);
// a wave where nothing completed throws, because that is an outage, not data.
export const fireCapacityProbes = async (concurrency, probe) => {
  // Outside the line on purpose (substrate-lease.js): the scan measures what the SERVER does
  // with N at once — queued behind the line it would measure the line instead.
  const settled = await withLineExempt(() => Promise.allSettled(
    Array.from({ length: concurrency }, () => drainOneRequest(probe, SCAN_STALL_MS))
  ));
  const done = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  if (done.length === 0) {
    throw settled[0].reason;
  }
  return {
    aggregateTokPerSec: done.reduce((sum, r) => sum + r.tokPerSec, 0),
    perAgentLatencyMs: done.map((r) => r.latencyMs),
    ok: done.length === concurrency,
    tokenSource: done.every((r) => r.tokenSource === 'server-usage') ? 'server-usage' : 'whitespace-proxy',
  };
};

const checkAborted = (signal) => {
  if (signal?.aborted) throw new ScanAborted();
};

// One measured ladder level: REPEATS_PER_LEVEL sequential waves, medians
// across them. Sequential waves keep the peak load at exactly `concurrency`.
const measureLevel = async (fire, concurrency, probe, repeats) => {
  const waves = [];
  for (let r = 0; r < repeats; r++) {
    waves.push(await fire(concurrency, probe));
  }
  return Object.freeze({
    concurrency,
    aggregateTokPerSec: median(waves.map((w) => w.aggregateTokPerSec)),
    perAgentLatencyMs: median(waves.flatMap((w) => w.perAgentLatencyMs)),
    ok: waves.every((w) => w.ok),
    tokenSource: waves.every((w) => w.tokenSource === 'server-usage') ? 'server-usage' : 'whitespace-proxy',
  });
};

// impure — the injectable orchestrator. Ascends the ladder until a knee
// fires, bisects once if the budget allows, and assembles the frozen result.
/**
 * @param {Object} deps
 * @param {Function} [deps.fire] - (concurrency, probe) => wave result; the RULE-0 seam
 * @param {number[]} [deps.ladder]
 * @param {Object} [deps.probe]
 * @param {Object} [deps.kneeOpts]
 * @param {Object} [deps.limits]
 * @param {Function} [deps.testConnection]
 * @param {number} [deps.repeats]
 * @param {Object} deps.substrate - flattened rig facts, stamped by the route
 * @param {string} deps.runAt - ISO timestamp, stamped by the route
 * @param {?Object} [deps.consent]
 * @param {?AbortSignal} [deps.signal] - soft stop, checked between levels only
 * @param {Function} [deps.onProgress] - called as each ladder level starts and
 *   finishes. THE SCAN USED TO EMIT NOTHING: the operator saw a static
 *   "MEASURING" label for up to five minutes and could not tell a working scan
 *   from a wedged one (Design note, 2026-08-29: […]). Progress is the measurement's
 *   own truth — the level actually under load, not a timer pretending to be one.
 * @param {Function} [deps.now]
 * @returns {Promise<Readonly<Object>>} frozen CapacityResult
 */
export const runCapacityScan = async ({
  fire = fireCapacityProbes,
  ladder = DEFAULT_LADDER,
  probe = DEFAULT_PROBE,
  kneeOpts = DEFAULT_KNEE_OPTS,
  limits = DEFAULT_LIMITS,
  testConnection = reachSubstrate,
  repeats = REPEATS_PER_LEVEL,
  substrate,
  runAt,
  consent = null,
  signal = null,
  onProgress = null,
  now = Date.now,
}) => {
  const alive = await testConnection();
  if (!alive) {
    if (typeof onProgress === 'function') {
      try { onProgress(Object.freeze({ phase: 'unreachable', ladder: [...ladder] })); } catch { /* never fails a scan */ }
    }
    throw new Error('substrate unreachable — capacity scan requires a live local server');
  }

  const t0 = now();
  const samples = [];
  let probesUsed = 0;
  let truncatedBy = null;

  const budgetAllows = (concurrency) =>
    probesUsed + concurrency * repeats <= limits.maxTotalProbes;
  const deadlinePassed = () => now() - t0 > limits.perRunDeadlineMs;

  // Every level's real wall time, so an ETA is arithmetic over measurements
  // already taken rather than a guess dressed as one.
  const levelMs = [];
  const say = (phase, extra = {}) => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress(Object.freeze({
        phase,
        ladder: [...ladder],
        levelsDone: levelMs.length,
        elapsedMs: now() - t0,
        // A knee can end the scan at ANY level, so this is an upper bound and
        // is named as one. A "remaining" that pretends to be exact would be
        // the same lie as the static label it replaces.
        meanLevelMs: levelMs.length ? Math.round(levelMs.reduce((a, b) => a + b, 0) / levelMs.length) : null,
        deadlineMs: limits.perRunDeadlineMs,
        ...extra,
      }));
    } catch { /* progress must never be able to fail a measurement */ }
  };

  const runLevel = async (concurrency) => {
    say('level-start', { concurrency, probesInLevel: concurrency * repeats });
    const startedAt = now();
    const sample = await measureLevel(fire, concurrency, probe, repeats);
    levelMs.push(now() - startedAt);
    probesUsed += concurrency * repeats;
    samples.push(sample);
    samples.sort((a, b) => a.concurrency - b.concurrency);
    say('level-done', { concurrency, ok: sample.ok, probesUsed });
    return sample;
  };

  for (const concurrency of ladder) {
    checkAborted(signal);
    if (!budgetAllows(concurrency)) { truncatedBy = 'probe-budget'; break; }
    if (deadlinePassed()) { truncatedBy = 'deadline'; break; }

    const sample = await runLevel(concurrency);
    if (!sample.ok) break; // a failed level is itself the ceiling signal
    if (deriveCeiling(samples, kneeOpts).limitedBy !== 'ladder-cap' && samples.length > 1) {
      break; // a knee fired — the measurement is complete
    }
  }

  // One bisection step tightens a wide doubling gap between the detected
  // ceiling and the level that triggered it — skipped, never forced, when the
  // budget can't afford it (a skipped bisection is honest; an overrun is not).
  const kneed = deriveCeiling(samples, kneeOpts);
  if (!kneed.incomplete && kneed.ceiling > 0) {
    const trigger = samples.find((s) => s.concurrency > kneed.ceiling);
    if (trigger) {
      const midpoint = Math.floor((kneed.ceiling + trigger.concurrency) / 2);
      if (
        midpoint > kneed.ceiling && midpoint < trigger.concurrency &&
        budgetAllows(midpoint) && !deadlinePassed()
      ) {
        checkAborted(signal);
        await runLevel(midpoint);
      }
    }
  }

  const verdict = deriveCeiling(samples, { ...kneeOpts, truncatedBy });
  return Object.freeze({
    ceiling: verdict.ceiling,
    limitedBy: verdict.limitedBy,
    incomplete: verdict.incomplete,
    aggregateTokPerSecAtCeiling: verdict.aggregateTokPerSecAtCeiling,
    perAgentLatencyAtCeiling: verdict.perAgentLatencyAtCeiling,
    boundClass: classifyBound(samples, kneeOpts),
    vramFitEstimate: null, // deferred: only honest if measured (load-delta), never spec-sheet math
    rawSamples: Object.freeze(samples.map((s) => ({ ...s }))),
    substrate,
    runAt,
    consent,
  });
};

// impure — whether the active provider is one the scan can honestly measure.
// Remote APIs render "not measurable": there is no local knee to observe.
export const isScannableProvider = () => SCANNABLE_PROVIDERS.includes(getConfig().provider);
