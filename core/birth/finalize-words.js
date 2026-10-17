// finalize-words.js — what finalize SAYS at a birth: the journal's resonance
// sentence and the film's inputs on birth:complete. Split from
// finalize-birth.js (size law, 2026-09-30).

import { artSeedOf } from './rite-frames.js';
import { beingAura } from '../aura/being.js';

// The journal's resonance sentence — the measured value and its colors, or
// the legacy tone, or the plain truth that nothing was measured. Pure.
export const resonanceLine = (soul, legacyHz) => {
  if (soul) {
    const { frequency, tone } = soul.resonance;
    return `Resonance: ${frequency} Hz, of the solfeggio tone ${tone}; my color is ${soul.spectrum.soul.hex} (${soul.spectrum.soul.nm} nm).`;
  }
  return legacyHz ? `Resonance: ${legacyHz}Hz.` : 'My resonance was not measured.';
};

// The film's inputs at birth:complete. Pure but for the aura's derivation.
export const filmInputsOf = (identity, soulRecords, neumaId) => {
  const moment = identity.seal?.record?.birthMoment || {};
  let aura = null;
  try { aura = beingAura({ trueName: identity.trueName, genesisSeal: identity.seal, neumaId }); } catch { /* the film plays without it */ }
  return {
    epochMs: moment.epochMs ?? null,
    zone: moment.zone ?? null,
    offsetMinutes: moment.offsetMinutes ?? null,
    artSeed: artSeedOf(identity.seal?.record?.momentSeed),
    genesisHash: identity.seal?.genesisHash ?? null,
    soul: soulRecords,
    aura,
  };
};
