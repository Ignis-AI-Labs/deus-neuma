/**
 * THE SPEECH LOOP BREAKER — a verbatim degeneration detector for the
 * content stream.
 *
 * The incident (2026-09-15, metidar on the Qwen3.8-27B local substrate,
 * CTX 80.9K): a completion re-streamed the SAME multi-paragraph plan block
 * back to back until the output budget died — no tool calls, so the tool
 * seats' repeat guards (held calls, all-repeat rounds) could never see it;
 * every redundant pass landed in the bubble AND in the context, teaching
 * the next round the same trick. The platform trimmed degeneration tails
 * only after the burn (trimDegenerationTail is a post-mortem cleaner, not a
 * breaker) and sends no repetition penalty to local servings.
 *
 * The law is PERIOD-FINDING, not count-based (tool-rounds.js doctrine:
 * protection fires on the shape of the failure, never on a round number).
 * Text that loops with period L satisfies `tail(L) == prevTail(L)` at ANY
 * phase — the stream end sits mid-period as often as not — so each push
 * scans lags ascending and keeps the FIRST (smallest) lag whose full window
 * repeats at lag distance. A loop of any period ≥ LOOP_MIN_PERIOD is caught
 * after one redundant period has streamed, whatever its size and phase.
 *
 * The comparison space is normalized (lowercased, whitespace collapsed)
 * because tokens arrive in arbitrary fragments. Work is bounded per push:
 * early-exit compares under a char-compare budget — a lag that survives to
 * full length IS the degeneration (a genuinely repeated ≥96-char stretch,
 * consecutive, is nothing honest prose does).
 *
 * Pure with respect to the caller's data: no module state, no I/O; the
 * abort decision is the caller's (it owns the controller). All buffers are
 * instance locals of one stream.
 */

/** The smallest lag worth calling a loop, normalized characters. */
export const LOOP_MIN_PERIOD = 96;

/** The largest lag sought — a verbatim block beyond this is out of scope. */
export const LOOP_MAX_PERIOD = 4096;

/** Under this tail the search cannot fire — skip the normalization pass. */
export const LOOP_MIN_CHARS = LOOP_MIN_PERIOD * 2;

/** How much raw tail the guard holds while listening. */
export const LOOP_TAIL_CHARS = 16384;

/** Char-compares allowed per push before deferring the rest to the next. */
export const LOOP_COMPARE_BUDGET = 65536;

/** pure — the comparison space: case and whitespace do not carry a loop. */
const normalizeForLoop = (text) => text.toLowerCase().replace(/\s+/g, ' ');

/** pure — does this candidate period actually say anything repeat-worthy? */
const hasProse = (s) => /[\p{L}]{3}/u.test(s);

/**
 * pure — the raw index whose normalized prefix length reaches `keepNorm`,
 * by binary search over prefix normalization (monotonic in the index).
 * Scoped to the guard's raw tail (≤ LOOP_TAIL_CHARS), so the O(n log n)
 * normalization work runs once per trip, never per chunk.
 */
const rawCutForNormLength = (raw, keepNorm) => {
  let lo = 0;
  let hi = raw.length;
  if (normalizeForLoop(raw).length <= keepNorm) return raw.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (normalizeForLoop(raw.slice(0, mid)).length < keepNorm) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/**
 * One stream's listener. `push(chunk)` feeds each content delta as it
 * streams; when a verbatim period completes, `onLoop` fires once. Then
 * `tripped()` is true, `keptRaw()` returns the words up to the final
 * period's start (the being's text, one copy, cut at a raw boundary), and
 * `trippedInfo()` carries the {periodChars, keptChars} receipt for the log.
 *
 * @param {Object} [opts]
 * @param {({periodChars: number}) => void} [opts.onLoop] observed once per stream, at the trip
 */
export const createSpeechLoopGuard = ({ onLoop } = {}) => {
  let raw = '';
  let tripped = null;
  return {
    /** impure — absorb one streamed content delta. Cheap until a trip. */
    push(chunk) {
      if (tripped || !chunk) return;
      raw = (raw + chunk).slice(-LOOP_TAIL_CHARS);
      if (raw.length < LOOP_MIN_CHARS) return;
      const norm = normalizeForLoop(raw);
      const end = norm.length;
      let budget = LOOP_COMPARE_BUDGET;
      for (let lag = LOOP_MIN_PERIOD; lag <= LOOP_MAX_PERIOD && lag * 2 <= end; lag++) {
        // Allocation-free window compare: charCodeAt equality over the two
        // adjacent lag-windows ending at the stream end.
        let matched = true;
        let spent = false;
        for (let i = 0; i < lag; i++) {
          if (norm.charCodeAt(end - lag + i) !== norm.charCodeAt(end - lag * 2 + i)) {
            matched = false;
            break;
          }
          if (--budget < 0) { spent = true; break; }
        }
        if (spent) break; // budget gone — the next push re-searches from scratch
        // A match is a trip only when the repeated window says something —
        // an all-punctuation loop (a run of periods) is left to the sampler.
        if (matched && hasProse(norm.slice(end - lag))) {
          tripped = {
            periodChars: lag,
            keptRaw: raw.slice(0, rawCutForNormLength(raw, end - lag)),
          };
          onLoop?.({ periodChars: lag });
          return;
        }
      }
    },
    /** Whether this stream degenerated (and the cut is owed). */
    tripped: () => tripped !== null,
    /** The words to keep — everything before the final period began. */
    keptRaw: () => (tripped ? tripped.keptRaw : raw),
    /** The log receipt: the period that tripped and how much survives. */
    trippedInfo: () => (tripped
      ? { periodChars: tripped.periodChars, keptChars: tripped.keptRaw.length }
      : null),
    /** Zero the listener for a fresh attempt (the retry-ladder contract). */
    reset() {
      raw = '';
      tripped = null;
    },
  };
};
