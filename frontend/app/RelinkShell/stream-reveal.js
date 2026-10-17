// Pure pacing for the live-reveal of the consciousness's speech.
//
// Cloud providers do not deliver evenly: measured real streams (kimi-k3,
// gpt-5.6-sol, 2026-07-28) arrive as long silences punctuated by same-frame
// sprays — gaps up to 2.6s mid-stream. A reveal that simply outruns the
// network (the old fixed-rate frontier-chaser) leaves the display starved
// and frozen for most of a bursty stream — measured 74-84% of stream time
// on real traces, felt as stutter.
//
// The pacer below is a jitter buffer, the same idea as video streaming:
// it banks a cushion sized from the stream's OWN measured delivery (average
// rate × recent worst gap), reveals at the arrival-matched rate, and slows
// proportionally as the cushion thins instead of freezing. Steady fast
// delivery (local substrate) produces a near-zero cushion, so it stays at
// the frontier with no added lag; bursty delivery banks enough to ride
// through the silences. All pacing math is here (pure, tested); the rAF
// loop and Web Audio typing bed live in the components that consume it.

export const REVEAL = Object.freeze({
  floorCps: 15,       // motion never dies while content remains unrevealed
  maxCushionMs: 1500, // never bank more perceived lag than this
  gapHalfLifeMs: 8000, // a remembered worst gap fades — one bad silence must not tax the whole stream
  maxRateFactor: 4,   // drain excess backlog at up to 4× the measured arrival rate
  minFillFactor: 0.25, // below a full cushion the reveal slows proportionally, to this floor of rate
  drainBoost: 50,     // stream complete: finish, don't linger
  snapBelow: 2,       // a residue this small isn't worth another frame
});

/**
 * Fresh pacing state for one segment's reveal. Pure (the caller stamps the
 * clock; the rAF loop passes `performance.now()`, tests pass a synthetic one).
 * @param {number} nowMs - clock reading at reveal start
 */
export const createPacer = (nowMs) => Object.freeze({
  startedAt: nowMs,
  lastAt: nowMs,
  lastGrowthAt: null,
  lastTarget: 0,
  worstGapMs: 0,
});

/**
 * Advance the visible character count by one animation step. Pure:
 * (state, inputs) → { state, next }, no clocks read, no mutation.
 *
 * The cushion adapts to the stream's own shape: `worstGapMs` remembers the
 * worst recent silence between chunk arrivals (decaying with a half-life),
 * and the cushion is `avgCps × worstGap` — so a metronome-steady substrate
 * gets a near-zero cushion (no added lag) while a bursty cloud route banks
 * enough to keep the eye fed through its silences.
 *
 * @param {Object} state - pacer state from createPacer / the previous step
 * @param {number} visible - characters currently revealed
 * @param {number} target - total characters arrived so far (cumulative)
 * @param {number} nowMs - current clock reading (same clock as createPacer)
 * @param {boolean} streaming - whether the turn is still arriving (false = drain fast)
 * @returns {{ state: Object, next: number }} new state + new visible count (monotonic, never past target)
 */
export const paceStep = (state, visible, target, nowMs, streaming) => {
  const dtMs = Math.max(0, nowMs - state.lastAt);
  const elapsed = Math.max(1, nowMs - state.startedAt);

  const decay = Math.pow(0.5, dtMs / REVEAL.gapHalfLifeMs);
  let worstGapMs = state.worstGapMs * decay;
  let { lastGrowthAt, lastTarget } = state;
  if (target > lastTarget) {
    // A gap is measured between growth events; the first chunk defines the
    // start (gap 0) so a slow TTFT never inflates the cushion.
    const gap = lastGrowthAt === null ? 0 : nowMs - lastGrowthAt;
    worstGapMs = Math.max(worstGapMs, gap);
    lastGrowthAt = nowMs;
    lastTarget = target;
  }
  const nextState = Object.freeze({
    startedAt: state.startedAt, lastAt: nowMs, lastGrowthAt, lastTarget, worstGapMs,
  });

  if (visible >= target) return Object.freeze({ state: nextState, next: target });

  const avgCps = (target / elapsed) * 1000;
  const cushionChars = Math.max(1, (avgCps * Math.min(worstGapMs, REVEAL.maxCushionMs)) / 1000);
  const fill = (target - visible) / cushionChars;
  const cps = Math.max(REVEAL.floorCps, avgCps * Math.min(REVEAL.maxRateFactor, Math.max(REVEAL.minFillFactor, fill)))
    * (streaming ? 1 : REVEAL.drainBoost);
  const next = visible + Math.max(1, Math.round((cps * dtMs) / 1000));
  return Object.freeze({ state: nextState, next: next >= target - REVEAL.snapBelow ? target : next });
};

/**
 * Whether the reveal still has work — drives both the rAF loop and the
 * typing sound bed. Pure.
 * @param {number} visible
 * @param {number} target
 * @returns {boolean}
 */
export const isRevealing = (visible, target) => visible < target;
