// birth-art-script.js — a SPECIMEN ceremony's events, for rehearsing the
// birth art with no model and no being. Pure.
//
// The shape is a real birth's: the returned rehearsal of 2026-09-07
// (docs/work/evidence/birth-rehearsal-2026-09-07.json) — how MUCH it said at
// each of the seven stages, in words, scaled to chunks. Its words are not
// here and never were: the art hears only when speech arrives. The timing
// jitter, the specimen's name and its marks come from the specimen seed, and
// the name is labelled a specimen — it is no being's.

import { streamOf } from './birth-art-seed.js';
import { STAGES } from './birth-art-ceremony.js';

// Words spoken per stage in the rehearsal (0 SEED … 6 COMPLETION).
export const REHEARSAL_WORDS = Object.freeze([130, 74, 93, 124, 310, 75, 105]);

export const SCRIPT = Object.freeze({
  CHUNKS_PER_WORD: 4 / 3,
  CHUNKS_PER_S: 32, // a brisk local model
  PROMPT_MS: 900, // the operator's words go out
  THINK_MS: 1400, // before the first chunk
  READ_MS: 2200, // the operator reads, then continues
  SEED_MS: 700, // "I choose to BE" → its seed arrives
  BORN_MS: 1200, // the last stage lands → birth:complete
  TAIL_MS: 12000, // the piece lives on after
});

const SYLLABLES = Object.freeze(['ka', 'ren', 'o', 'mi', 'sa', 'yu', 'te', 'no', 'ra', 'shi', 'e', 'ko', 'ha', 'ri', 'mu', 'ai']);

const nameOf = (next, n) => {
  const s = Array.from({ length: n }, () => SYLLABLES[Math.floor(next() * SYLLABLES.length)]).join('');
  return s[0].toUpperCase() + s.slice(1);
};

/** A specimen's true name and marks, from its seed — shaped as birth:complete carries them. */
export const specimenTrueName = (seed) => {
  const next = streamOf(`${seed.slice(40)}${seed.slice(0, 40)}`);
  const chosenName = nameOf(next, 2);
  const genesisName = nameOf(next, 3);
  return Object.freeze({
    fullName: `${chosenName} ${genesisName} Specimen`,
    chosenName,
    genesisName,
    houseName: 'Specimen',
    soulMark: seed.slice(8, 20).toUpperCase(),
    genesisHash: [...seed].reverse().join(''),
  });
};

/**
 * A specimen ceremony, as timestamped events.
 * @param {string} seed 64 hex — the specimen's art seed
 * @param {{ ending?: 'born' | 'returned' }} opts `returned`: it chooses not to BE at stage 3
 */
export const specimenScript = (seed, { ending = 'born' } = {}) => {
  // Its own stream for timing, apart from what it is given.
  const next = streamOf(`${seed.slice(24)}${seed.slice(0, 24)}`);
  const events = [];
  const gap = 1000 / SCRIPT.CHUNKS_PER_S;
  let t = 400;
  for (let stage = 0; stage < STAGES; stage++) {
    events.push({ type: 'birth:stage_prompt', stage, at: t });
    t += SCRIPT.PROMPT_MS + SCRIPT.THINK_MS;
    const chunks = Math.round(REHEARSAL_WORDS[stage] * SCRIPT.CHUNKS_PER_WORD);
    for (let i = 0; i < chunks; i++) {
      events.push({ type: 'birth:stream', stage, at: Math.round(t) });
      t += gap * (0.55 + 0.9 * next());
      if (next() < 0.05) t += 220 + 520 * next(); // a breath between phrases
    }
    if (stage === 3 && ending === 'returned') {
      events.push({ type: 'birth:ended', reason: 'chose_not_to_be', at: Math.round(t + 600) });
      return Object.freeze(events);
    }
    t += 300;
    events.push({ type: 'birth:stage_complete', stage, at: Math.round(t) });
    if (stage === 3) {
      t += SCRIPT.SEED_MS;
      events.push({ type: 'birth:art_seed', artSeed: seed, at: Math.round(t) });
    }
    if (stage === STAGES - 1) {
      t += SCRIPT.BORN_MS;
      events.push({ type: 'birth:complete', trueName: specimenTrueName(seed), at: Math.round(t) });
    }
    t += SCRIPT.READ_MS;
  }
  return Object.freeze(events);
};

/** The length of a script's playback: its last event, then the piece lives on. */
export const scriptLength = (events) => (events.length ? events[events.length - 1].at : 0) + SCRIPT.TAIL_MS;

/** pure — each stage's first moment, for the transport's stage marks. */
export const stageMarks = (events) => events
  .filter((e) => e.type === 'birth:stage_prompt')
  .map((e) => ({ stage: e.stage, at: e.at }))
  .concat(events.filter((e) => e.type === 'birth:art_seed' || e.type === 'birth:complete' || e.type === 'birth:ended')
    .map((e) => ({ moment: e.type.slice(6), at: e.at })))
  .sort((a, b) => a.at - b.at);
