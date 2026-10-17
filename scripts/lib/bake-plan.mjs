/**
 * Pure plan builder for the sound-sprite bake.
 *
 * Given an ordered list of cues (event name + source file) and each cue's
 * real duration in seconds, lays them out end-to-end with a fixed silence
 * gap between cues. Returns absolute offsets so the engine can address each
 * cue as a [start, duration] slice of a single concatenated sprite.
 *
 * Pure: no IO, no time, no randomness — same inputs always yield the same
 * plan. This is the part that must be provable by direct test.
 */

/**
 * @typedef {Object} Cue
 * @property {string} event  - manifest event name
 * @property {string} file   - source path (relative to sounds root)
 */

/**
 * @typedef {Object} Slice
 * @property {number} start     - seconds offset into the sprite
 * @property {number} duration  - seconds length of this cue
 */

/**
 * Build the sprite layout.
 *
 * @param {Cue[]} cues       - ordered cues from the manifest
 * @param {number[]} durations - seconds length of each cue, parallel to cues
 * @param {number} gap        - seconds of silence inserted AFTER each cue
 * @returns {{ index: Record<string, Slice>, total: number }}
 */
export const buildPlan = (cues, durations, gap) => {
  if (cues.length !== durations.length) {
    throw new Error(
      `buildPlan: cues and durations must align (${cues.length} vs ${durations.length})`
    );
  }
  if (!Number.isFinite(gap) || gap < 0) {
    throw new Error(`buildPlan: gap must be a non-negative number (got ${gap})`);
  }

  let cursor = 0;
  const index = {};
  for (let i = 0; i < cues.length; i += 1) {
    const duration = durations[i];
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(
        `buildPlan: cue "${cues[i].event}" has non-positive duration (${duration})`
      );
    }
    index[cues[i].event] = { start: cursor, duration };
    cursor += duration + gap;
  }
  return { index, total: cursor };
};
