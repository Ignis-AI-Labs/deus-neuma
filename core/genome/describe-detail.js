/**
 * THE DETAIL BANDS — the 2026-09-25 structure axes, composed. Pure.
 *
 * Own module by the decomposition law: describe.js sits at the size cap, and
 * the seam is real rather than administrative — describe.js owns WHICH bands
 * a body gets and their order; this file owns how the nine structure axes
 * (jawline, cheekbones, brow, ears; shoulders, limbProportion, posture;
 * hairTexture, irisPattern) speak inside those bands. The wording itself
 * lives in describe-vocab.js, like every other axis.
 *
 * ⚠️ ABSENCE-PROOF BY CONSTRUCTION. A genome record derived before the
 * perfection pass has no detail fields — every function here answers an
 * EMPTY band for one rather than throwing or inventing. A legacy record
 * describes exactly the body it always described; the detail joins only
 * when the being's genome was derived with it. (New derivations always
 * carry the full set; retroactive records are rederived, never patched.)
 *
 * The non-humanoid forms never reach these: describe.js's formless branch
 * composes its own bands and never calls the humanoid ones, so a crystal
 * gains no jawline by accident.
 */

import {
  JAWLINE_TAGS, JAWLINE_PROSE, CHEEKBONES_TAGS, CHEEKBONES_PROSE,
  BROW_TAGS, BROW_PROSE, EARS_TAGS, EARS_PROSE,
  SHOULDERS_TAGS, SHOULDERS_PROSE, LIMB_TAGS, LIMB_PROSE,
  POSTURE_TAGS, POSTURE_PROSE, HAIR_TEXTURE_TAGS, HAIR_TEXTURE_PROSE,
  IRIS_TAGS, IRIS_PROSE,
} from './describe-vocab.js';

const pick = (table, value) => (value == null ? null : (table[value] ?? null));

/**
 * The face's structure: jaw, cheekbones, brow, ears — after the feature
 * axes describe.js already states, so the band reads head-down.
 * @param {object} g a genome record (any schema age)
 * @param {boolean} asTags tag register when true, prose when false
 * @returns {Array<string|null>} nulls filtered by the caller's join
 */
export const faceDetailOf = (g, asTags) => {
  const f = g?.face;
  if (!f || f.jawline == null) return [];
  return [
    pick(asTags ? JAWLINE_TAGS : JAWLINE_PROSE, f.jawline),
    pick(asTags ? CHEEKBONES_TAGS : CHEEKBONES_PROSE, f.cheekbones),
    pick(asTags ? BROW_TAGS : BROW_PROSE, f.brow),
    pick(asTags ? EARS_TAGS : EARS_PROSE, f.ears),
  ];
};

/**
 * The frame's carriage: shoulders, limb proportion, posture — after the
 * build/stature/proportion axes.
 * @param {object} g a genome record (any schema age)
 * @param {boolean} asTags tag register when true, prose when false
 * @returns {Array<string|null>}
 */
export const frameDetailOf = (g, asTags) => {
  const f = g?.frame;
  if (!f || f.shoulders == null) return [];
  return [
    pick(asTags ? SHOULDERS_TAGS : SHOULDERS_PROSE, f.shoulders),
    pick(asTags ? LIMB_TAGS : LIMB_PROSE, f.limbProportion),
    pick(asTags ? POSTURE_TAGS : POSTURE_PROSE, f.posture),
  ];
};

/**
 * Coloring's texture: hair texture and the iris pattern.
 * @param {object} g a genome record (any schema age)
 * @param {boolean} asTags tag register when true, prose when false
 * @returns {Array<string|null>}
 */
export const coloringDetailOf = (g, asTags) => {
  const c = g?.coloring;
  if (!c || c.hairTexture == null) return [];
  return [
    pick(asTags ? HAIR_TEXTURE_TAGS : HAIR_TEXTURE_PROSE, c.hairTexture),
    pick(asTags ? IRIS_TAGS : IRIS_PROSE, c.irisPattern),
  ];
};
