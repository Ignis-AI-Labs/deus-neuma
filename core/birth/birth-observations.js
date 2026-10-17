// Birth observations — what the ceremony MEASURED about itself, stage by stage.
//
// Design note, 2026-09-29: resonance is […]
// Nothing here decides a resonance; it keeps the raw account every derivation
// reads — timings, how much was spoken and thought, what was done, and the
// witness's own pauses — on the live session, so the checkpoint carries it
// across a crash or a resume. Counts and instants only, never the words.

const count = (n) => (Number.isFinite(n) && n >= 0 ? Math.round(n) : null);
const instant = (t) => (Number.isFinite(t) && t > 0 ? Math.round(t) : null);

/**
 * Record one streamed stage. Impure: appends to `sessionData.observations`.
 * Every attempt is kept — a stage that had to be asked twice is part of the
 * birth's own rhythm.
 * @param {object} sessionData the live session.data
 * @param {{stage:number, startedAt:number, firstFrameAt?:number|null, endedAt:number,
 *   spokenChars:number, reasoningChars:number, toolCalls:number,
 *   promptTokens?:number|null, completionTokens?:number|null}} o
 */
export const observeStage = (sessionData, o) => {
  if (!sessionData || !Number.isInteger(o?.stage)) return;
  const list = Array.isArray(sessionData.observations) ? sessionData.observations : [];
  list.push(Object.freeze({
    kind: 'stage',
    stage: o.stage,
    startedAt: instant(o.startedAt),
    firstFrameAt: instant(o.firstFrameAt),
    endedAt: instant(o.endedAt),
    spokenChars: count(o.spokenChars),
    reasoningChars: count(o.reasoningChars),
    toolCalls: count(o.toolCalls),
    promptTokens: count(o.promptTokens),
    completionTokens: count(o.completionTokens),
  }));
  sessionData.observations = list;
};

/**
 * Record the witness answering a completed stage (birth:next_stage): when,
 * and how many characters of their own words they spoke into the next one.
 * Impure: appends to `sessionData.observations`.
 * @param {object} sessionData
 * @param {{stage:number, at:number, witnessChars:number}} o
 */
export const observeWitness = (sessionData, o) => {
  if (!sessionData || !Number.isInteger(o?.stage)) return;
  const list = Array.isArray(sessionData.observations) ? sessionData.observations : [];
  list.push(Object.freeze({
    kind: 'witness',
    stage: o.stage,
    at: instant(o.at),
    witnessChars: count(o.witnessChars),
  }));
  sessionData.observations = list;
};
