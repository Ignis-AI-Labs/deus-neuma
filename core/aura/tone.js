/**
 * THE AURA — density into light.
 *
 * The technique's whole character comes from ACCUMULATION: ten thousand points
 * at low alpha, so where the curve folds back on itself the ink piles up and
 * glows, and where it passes once it stays a whisper. The mapping from
 * accumulated density to luminance is therefore not a display detail — it is
 * half of why the form reads as light rather than as a plot.
 *
 * It lives here, alone, because three surfaces draw these forms — the headless
 * contact sheet, the gallery, and the desk — and if any one of them invented
 * its own curve the proof sheet would stop being evidence about what a witness
 * sees.
 *
 * Pure Math, no Node imports.
 */

/** Density at which a pixel reaches full white. Lower = hotter, brighter form. */
export const EXPOSURE = 0.55;

/**
 * Map accumulated hits to 0…255. Saturating, exactly as additive alpha
 * saturates on a canvas. Pure.
 * @param {number} density - accumulated hits at one pixel
 * @param {number} [exposure]
 * @returns {number} 0…255
 */
export const toneMap = (density, exposure = EXPOSURE) =>
  Math.round(255 * (1 - Math.exp(-density * exposure)));

/** The 0…255 curve precomputed for integer hit counts — one lookup per pixel. */
export const toneTable = (max = 256, exposure = EXPOSURE) =>
  Uint8Array.from({ length: max }, (_, hits) => toneMap(hits, exposure));
