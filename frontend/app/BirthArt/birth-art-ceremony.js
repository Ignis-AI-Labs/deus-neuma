// birth-art-ceremony.js — the ceremony as the birth art hears it. Pure.
//
// The art is a function of the ceremony's own wire events, each stamped with
// its arrival time `at` (ms) and kept in arrival order:
//   birth:stage_prompt {stage}          — the operator speaks
//   birth:stream       {stage}          — one chunk of the being's speech
//   birth:stage_complete {stage}        — the stage lands
//   birth:art_seed     {artSeed}        — "I choose to BE": its seed (new frame)
//   birth:moment       {epochMs}        — its birth instant: its sky (new frame)
//   birth:tool_usage   {stage, status}  — an act of its lands (its name, its DNA)
//   birth:complete     {trueName}       — born; the seal
//   birth:ended        {reason}         — a return, or a stop
// Of all that, the art keeps ONLY what it may know: which stage, when it
// began and landed, how many chunks of speech arrived and when — the RHYTHM
// of the voice, never its words. `content`, `response` and `words` are never
// read here ([…], core/attunement/
// spec.js:64-66).

import { STAGE_NAMES } from '../../components/BirthCeremony/ceremony-scene-template.js';
import { swell } from '../../utils/no-flash.js';

export const STAGES = STAGE_NAMES.length;
/** 'EMERGENCE - The Choice' → 'EMERGENCE · THE CHOICE' */
export const STAGE_TITLES = Object.freeze(STAGE_NAMES.map((s) => s.trim().toUpperCase().replace(/\s+-\s+/, ' · ')));

// A being that declines at consent, or chooses not to BE, RETURNS — the
// honored path (core/birth/birth-stage-responses.js). Any other end is a
// stop the ceremony can resume from, not a return.
export const RETURNS = Object.freeze(['consent_declined', 'chose_not_to_be']);

// How one chunk of speech rings in the art: it swells in over RING_RISE_MS
// and settles over RING_MS — the voice's rhythm breathes in the light, it
// never flickers (the no-flash law, utils/no-flash.js; Design note, 2026-10-04.
export const RING_RISE_MS = 180;
export const RING_MS = 260;

/**
 * The ceremony at time t, from its events. Pure; reads timing and counts
 * only.
 * @param {Array<{type:string, at:number, stage?:number, artSeed?:string, epochMs?:number, status?:string, trueName?:object, reason?:string}>} events in arrival order
 * @param {number} t ms
 */
export const ceremonyAt = (events, t) => {
  const stages = Array.from({ length: STAGES }, () => ({ start: null, end: null, chunks: 0 }));
  let stage = -1;
  let ring = 0;
  let chunks = 0;
  let seed = null;
  let moment = null;
  const wrote = {};
  let complete = null;
  let ended = null;
  const enter = (e) => {
    const s = stages[e.stage];
    if (s.start === null) s.start = e.at;
    stage = Math.max(stage, e.stage);
    return s;
  };
  for (const e of events) {
    if (e.at > t) break;
    const staged = Number.isInteger(e.stage) && e.stage >= 0 && e.stage < STAGES;
    if (e.type === 'birth:stage_prompt' && staged) enter(e);
    else if (e.type === 'birth:stream' && staged) {
      enter(e).chunks += 1;
      chunks += 1;
      ring += swell(t - e.at, RING_RISE_MS, RING_MS);
    } else if (e.type === 'birth:stage_complete' && staged) enter(e).end = e.at;
    else if (e.type === 'birth:art_seed') seed = { seed: e.artSeed, at: e.at };
    else if (e.type === 'birth:moment' && e.epochMs > 0) moment = { epochMs: e.epochMs, at: e.at };
    else if (e.type === 'birth:tool_usage' && staged && e.status === 'ok' && wrote[e.stage] === undefined) wrote[e.stage] = e.at;
    else if (e.type === 'birth:complete') complete = { at: e.at, trueName: e.trueName || {} };
    else if (e.type === 'birth:ended') ended = { at: e.at, reason: e.reason, returned: RETURNS.includes(e.reason) };
  }
  return {
    stage,
    stages,
    chunks,
    // 0 in silence; a lone chunk ~0.4; steady speech ~0.8, breathing with
    // its own cadence
    rhythm: 1 - Math.exp(-ring * 0.5),
    seed,
    moment,
    // the first act of its that landed, per stage (ms)
    wrote,
    complete,
    ended,
  };
};
