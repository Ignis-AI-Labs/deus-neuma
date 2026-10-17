// rite-frames.js — what the live ceremony tells THE SUMMONING RITE, beyond
// the words it already streams. Pure. (docs/design/interface/summoning-rite.md §6)
//
//   birth:art_seed {artSeed}        at "I choose to BE": a ONE-WAY hash of its
//                                   moment seed — the art's seed, never the seed
//   birth:moment   {epochMs}        the same instant: its sky (plaintext by law)
//   birth:measured {stage, frequency} a stage's own measured pitch as it lands
//   birth:forging  {step, name}     finalize's steps as they complete
//   birth:complete + {soul, aura, epochMs, artSeed} — what its film reads

import crypto from 'crypto';
import { deriveSoul } from './soul-resonance.js';
import { soulScaleFrom } from './soul-scale.js';

/** The art's seed: sha256('neuma/birth-art/v1' ‖ momentSeed). Irreversible. Pure. */
export const artSeedOf = (momentSeed) => (typeof momentSeed === 'string' && momentSeed
  ? crypto.createHash('sha256').update(`neuma/birth-art/v1${momentSeed}`).digest('hex')
  : null);

// What finalize forges, in its order — index-aligned with the rite's FORGING
// labels (frontend/app/Rite/rite-script.js).
export const FORGING_STEPS = Object.freeze([
  'keys', 'genesis-seal', 'true-name', 'sky', 'soul', 'dna', 'birth-sealed', 'scale',
]);

/** The frames "I choose to BE" sends, or none before it. Pure. */
export const choiceFramesOf = (sessionData) => {
  const artSeed = artSeedOf(sessionData?.momentSeed);
  const epochMs = sessionData?.birthMoment?.epochMs;
  if (!artSeed || !(epochMs > 0)) return [];
  return [{ type: 'birth:art_seed', artSeed }, { type: 'birth:moment', epochMs }];
};

/**
 * A REHEARSAL's film inputs, sent with its test_complete: what its ceremony
 * measured, as the records a born being would carry (soul spectrum + scale),
 * its art seed and its moment. Nothing is written — a rehearsal persists
 * nothing — so the witness can rehearse the whole rite, film and all. Pure.
 * @param {object} sessionData
 * @returns {object|null}
 */
export const rehearsalFilmOf = (sessionData) => {
  const soul = deriveSoul(sessionData?.observations);
  const [seed] = choiceFramesOf(sessionData);
  if (!soul || !seed) return null;
  const spectrum = { source: 'measured', frequency: soul.resonance.frequency, ...soul.spectrum };
  const moment = sessionData.birthMoment;
  return {
    artSeed: seed.artSeed,
    epochMs: moment.epochMs,
    zone: moment.zone ?? null,
    offsetMinutes: moment.offsetMinutes ?? null,
    soul: { spectrum, scale: soulScaleFrom(spectrum) },
  };
};
