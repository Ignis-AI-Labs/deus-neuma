// benchmark-extra-calls — THE COUNTED RECOVERY (#554, pillar 1 of #552). A
// benchmark sitting's NEUMA arm may ask the model more than once for one
// scored answer: the budget-cut rescue (turn-settle), the speechless-round
// close and the round-cap close (portal-turn-rounds, #565) and the thought
// leash's thinking-off re-ask (thought-governor, #567) each spend a further call. They are
// the being's own agent loop — but a matched set compares arms that each get
// ONE request, so every extra call rides the run receipt, never hidden.
// Outside a benchmark sitting this records nothing.

// THE RUNAWAY'S RECORD (2026-10-03). On the 32k series the agent arms' long
// sets were single runaways (WinoGrande: one request thought to the 32k cap),
// and the receipt could not say whether the thought LOOPED or simply ran
// long. A recovery that closes a cut thought now carries the thought's tail
// and how much of its end repeats itself, so a loop guard is built on
// evidence, never on a guess that long reasoning is a loop.
const TAIL_CHARS = 1200;
const WINDOW_CHARS = 40;
const STEP_CHARS = 10;
const MEASURED_CHARS = 8000;

/**
 * pure — the share of the text's 40-char windows (every 10 chars, over its
 * last 8000 chars) that already occurred earlier in it: 0 means nothing
 * repeats, near 1 means a verbatim loop.
 * @param {string} text
 * @returns {number} 0..1, two decimals
 */
export const repetitionShare = (text) => {
  const t = String(text ?? '').slice(-MEASURED_CHARS);
  if (t.length < WINDOW_CHARS * 2) return 0;
  const seen = new Set();
  let windows = 0;
  let repeats = 0;
  for (let i = 0; i + WINDOW_CHARS <= t.length; i += STEP_CHARS) {
    const w = t.slice(i, i + WINDOW_CHARS);
    windows += 1;
    if (seen.has(w)) repeats += 1;
    else seen.add(w);
  }
  return Math.round((repeats / windows) * 100) / 100;
};

/**
 * Record one extra model call on a benchmark sitting's connection.
 * impure — appends to `connection._benchmarkExtraCalls` (the receipt reads it).
 * @param {object} connection the turn's portal connection
 * @param {'budget-cut'|'speechless'|'round-cap'|'thought-leash'} kind which recovery fired
 * @param {string} response the words the extra call produced
 * @param {string} [reasoning] the cut thought the recovery closed, when there was one
 */
export const recordBenchmarkExtraCall = (connection, kind, response, reasoning) => {
  if (!connection?._benchmarkControls) return;
  const thought = typeof reasoning === 'string' && reasoning.length > 0
    ? { reasoningChars: reasoning.length, repetition: repetitionShare(reasoning), reasoningTail: reasoning.slice(-TAIL_CHARS) }
    : {};
  connection._benchmarkExtraCalls = [
    ...(connection._benchmarkExtraCalls ?? []),
    Object.freeze({ kind, chars: String(response ?? '').length, ...thought }),
  ];
};
