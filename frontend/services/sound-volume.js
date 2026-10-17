// sound-volume.js — the level the world speaks at, as pure arithmetic.
//
// The engine owns the storage and the gain nodes; this module owns the rules
// about what a level MEANS. Split out so the rules can be proven with real
// calls and real values — no browser, no mock (RULE 0).

/** The level a witness who has never touched the dial hears. */
export const DEFAULT_SOUND_VOLUME = 0.5;

/**
 * The share of the master level a sustained loop takes. The typing bed plays
 * continuously underneath one-shot cues — at equal gain it buries the very
 * events it accompanies.
 */
export const LOOP_SHARE = 0.55;

/**
 * pure — hold a level inside [0, 1].
 * @param {number} level
 * @returns {number}
 */
export const clampVolume = (level) => Math.min(1, Math.max(0, level));

/**
 * pure — read a stored (or typed) level back as a usable one. An absent value
 * is the DEFAULT, never zero: `Number(null)` is 0, so a naive parse would hand
 * silence to every witness who has never opened the dial.
 * @param {unknown} raw
 * @returns {number}
 */
export const parseVolume = (raw) => {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_SOUND_VOLUME;
  const level = Number(raw);
  return Number.isFinite(level) ? clampVolume(level) : DEFAULT_SOUND_VOLUME;
};

/**
 * pure — the gain a sustained loop takes from the master level.
 * @param {number} master
 * @returns {number}
 */
export const loopVolume = (master) => clampVolume(master) * LOOP_SHARE;
