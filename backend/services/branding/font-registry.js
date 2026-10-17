// font-registry — the vendored faces, shaped for a picker rather than a loader.
//
// Design note, 2026-08-31: […]
//
// The BRAND KITS panel used to offer type as eleven free-text boxes while the
// renderer only ever embeds the faces in EMBEDDABLE. An operator could type a
// family, watch the specimen render it from their own machine's fonts, save,
// and get a card drawn in a fallback — with nothing anywhere saying so. This
// file is what lets the panel offer the closed set instead, and only the
// weights that are genuinely on disk.
//
// ⚠️ NO FILE PATHS CROSS THIS BOUNDARY. EMBEDDABLE carries absolute paths into
// the repo; a route serving this straight through would publish the rig's
// directory layout. `families()` returns names and weights, and `faceFile()` is
// the only way to a path — by registered id, never by anything a caller typed.

import { EMBEDDABLE, FALLBACK_TAIL, DEFAULT_TAIL } from './embeddable-faces.js';

/** Is this a face this repo carries? Pure. */
const isFaceId = (id) => Object.prototype.hasOwnProperty.call(EMBEDDABLE, String(id || ''));

/**
 * The registered path for one face id. impure only in that the path is real —
 * no disk is touched here.
 *
 * The id is looked UP, never joined. A caller passing "../../etc/passwd" gets
 * null, because the only strings that resolve are the keys this repo declared.
 *
 * @returns {{file: string, family: string, weight: number, format: string}|null}
 */
export const faceFile = (id) => {
  if (!isFaceId(id)) return null;
  const face = EMBEDDABLE[id];
  return {
    file: face.file,
    family: face.family,
    weight: face.weight,
    format: face.format || 'ttf',
  };
};

/**
 * The vendored faces grouped by family, each family's weights ascending. Pure.
 *
 * Grouped because that is how the choice is actually made: an operator picks
 * Space Grotesk and THEN picks how heavy. A flat list of fourteen ids makes the
 * same decision twice as hard and invites the pairing that does not exist —
 * Rajdhani at 400, which this repo does not carry.
 *
 * @returns {Array<{family: string, tail: string, weights: Array<{id: string, weight: number, format: string}>}>}
 */
export const families = () => {
  const byFamily = new Map();
  for (const [id, face] of Object.entries(EMBEDDABLE)) {
    if (!byFamily.has(face.family)) byFamily.set(face.family, []);
    byFamily.get(face.family).push({ id, weight: face.weight, format: face.format || 'ttf' });
  }
  return [...byFamily.entries()]
    .map(([family, weights]) => ({
      family,
      tail: FALLBACK_TAIL[family] || DEFAULT_TAIL,
      weights: weights.sort((a, b) => a.weight - b.weight),
    }))
    .sort((a, b) => a.family.localeCompare(b.family));
};
