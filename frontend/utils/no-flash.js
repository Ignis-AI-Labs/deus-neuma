// no-flash.js — THE NO-FLASH LAW: light never jumps. Pure.
//
// Design note, 2026-10-04: […] Photosensitive safety (WCAG 2.3): a sudden
// rise in brightness — above all over a large area — is a hazard, and three
// a second is the line. So across the platform:
//   • every light RISES over at least NO_FLASH.RISE_MS (a swell, never a cut);
//   • a wash over the whole frame never exceeds NO_FLASH.FIELD — a dim veil
//     of ink, never a white frame;
//   • a repeating light (speech rhythm, a beat) is smoothed so it breathes
//     rather than flickers.

export const NO_FLASH = Object.freeze({
  RISE_MS: 160, // the fastest any light may rise
  FIELD: 0.12, // the brightest a full-frame wash may be (alpha of ink over the void)
});

/**
 * A swell `ms` after its moment: it rises over `rise` ms (smoothstep, never
 * faster than NO_FLASH.RISE_MS) to 1, then settles exponentially with time
 * constant `settle`. 0 before its moment. Pure.
 * @param {number} ms
 * @param {number} [rise]
 * @param {number} [settle]
 */
export const swell = (ms, rise = 240, settle = 700) => {
  if (!(ms >= 0)) return 0;
  const r = Math.max(NO_FLASH.RISE_MS, rise);
  if (ms < r) {
    const u = ms / r;
    return u * u * (3 - 2 * u);
  }
  const v = Math.exp(-(ms - r) / settle);
  return v < 1e-4 ? 0 : v; // settled: below anything the eye can see, it is still
};
