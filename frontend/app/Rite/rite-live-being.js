// rite-live-being.js — a live birth's film inputs as the being THE SUMMONING
// plays: its art seed, true name, moment, aura, sky and soul. Pure.
//
// A born being's inputs come on birth:complete — every one re-derivable from
// its lane (soul-spectrum/scale records, beingAura, its sealed moment). A
// REHEARSAL is born nowhere: it has no seal, so no soul mark and no aura of
// its own. Its film plays on what the rehearsal truly measured (its soul, its
// moment, its art seed) with the aura its art seed derives — and says it is a
// rehearsal on screen. Nothing of it is kept.

import { skyOf } from '../Summoning/summoning-sky.js';
import { soulOf } from '../Summoning/summoning-soul.js';
import { specimenAura } from '../Summoning/summoning-aura.js';

/**
 * @param {object|null} film the feed's film inputs (rite-live-feed.js)
 * @returns {object|null} the being scoreOf reads, or null until it can be played
 */
export const liveBeingOf = (film) => {
  if (!film?.artSeed || !(film.epochMs > 0) || !film.soul?.spectrum || !film.soul?.scale) return null;
  const trueName = film.rehearsal
    ? { fullName: film.chosenName || 'REHEARSAL', chosenName: film.chosenName || 'REHEARSAL' }
    : { ...(film.trueName || {}), genesisHash: film.genesisHash || film.trueName?.genesisHash };
  const aura = film.rehearsal ? specimenAura(film.artSeed) : film.aura;
  if (!aura?.form) return null;
  return {
    seed: film.artSeed,
    trueName,
    epochMs: film.epochMs,
    bornAt: new Date(film.epochMs).toISOString(),
    aura,
    sky: skyOf(film.epochMs, { zone: film.zone, offsetMinutes: film.offsetMinutes ?? 0 }),
    soul: soulOf(film.soul.spectrum, film.soul.scale),
    rehearsal: Boolean(film.rehearsal),
  };
};

/**
 * The live rite as the rite's pure state reads it. Its film begins at its
 * birth (birth:complete, or a rehearsal's end). Pure.
 * @param {object[]} events the feed's events
 * @param {number} filmMs its film's length, once known
 * @param {number} now the rite clock now
 */
export const liveRiteOf = (events, filmMs, now) => {
  const born = events.find((e) => e.type === 'birth:complete'
    || (e.type === 'birth:ended' && e.reason === 'test_complete'));
  return Object.freeze({
    events,
    film: Object.freeze({ at: born ? born.at : Number.POSITIVE_INFINITY, ms: filmMs }),
    length: Math.max(now, born ? born.at + filmMs : now),
  });
};
