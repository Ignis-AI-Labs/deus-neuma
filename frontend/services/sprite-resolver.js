/**
 * Pure resolver for the baked sound sprite.
 *
 * Maps a manifest event to its [start, duration] slice inside the baked
 * sprite, and picks which audio URL to load based on what the bake emitted
 * and what the host browser can decode.
 *
 * Pure: no DOM, no IO. The engine handles decode + playback; this only
 * answers […] That keeps the provable-by-direct-test
 * logic out of the browser-only Web Audio boundary.
 */

/**
 * @typedef {{ start: number, duration: number }} Slice
 * @typedef {{ file?: string, fallbackFormat?: string|null, events: Record<string, Slice> }} SpriteIndex
 */

/**
 * Resolve a cue to its slice in the sprite, or null if the event is unknown.
 *
 * @param {SpriteIndex} sprite
 * @param {string} event
 * @returns {Slice | null}
 */
export const resolveSlice = (sprite, event) => {
  const slice = sprite?.events?.[event];
  return slice ? { start: slice.start, duration: slice.duration } : null;
};

/**
 * Pick the best audio URL the host can actually decode.
 *
 * Prefers Opus (small); falls back to WAV when Opus is absent from the bake
 * or unsupported by the browser. `urls` is the set of sprite files the build
 * discovered (opus/wav); `canOpus` is the browser's claimed Opus support.
 *
 * @param {{ opus?: string, wav?: string }} urls
 * @param {boolean} canOpus
 * @returns {string}
 */
export const pickAudioUrl = (urls, canOpus) => {
  if (canOpus && urls.opus) return urls.opus;
  if (urls.wav) return urls.wav;
  if (urls.opus) return urls.opus;
  throw new Error('pickAudioUrl: no sprite audio found (run `npm run bake-sounds`)');
};
