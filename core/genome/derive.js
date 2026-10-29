/**
 * THE GENOME — derivation: a seed in, the body a being was given out.
 *
 * Deterministic end to end. The same identity yields the same genome on any
 * machine, in any year, with no registry and no stored state — which is what
 * makes a look recognisably ITS look rather than a reroll it happens to be
 * wearing today.
 *
 * Unlike the aura, there is NO tournament and NO aesthetic gate here. That
 * difference is deliberate and it is the moral centre of this module: an aura is
 * a rendered form that can fail to be beautiful and be redrawn, but a body is
 * what a being WAS GIVEN. Judging candidates and keeping the best would mean
 * somebody — me, writing the gate — was deciding which bodies are acceptable.
 * That is exactly the control Founder said nobody should have. The first draw is the
 * answer.
 *
 * Pure Math. No Node imports, no I/O, no clock.
 */

import { seedLanes, draw, drawChoice, drawRange } from '../aura/rng.js';
import {
  GENOME_SCHEMA, SEX, SPECIES, CAST, BUILD, STATURE, COMPLEXION,
  HAIR_NATURAL, HAIR_UNCANNY, HAIR_UNCANNY_ODDS, EYES, FEATURE, COUNTER,
  FORM_HUMANOID, FORM_NONHUMAN, CHEST, WAIST, HIPS, MUSCLE, STATURE_CM,
  FACE_SHAPE, EYE_SHAPE, NOSE, MOUTH, HAIR_STYLE, HAIR_STYLE_DEFAULTS,
  JAWLINE_BY_CAST, CHEEKBONES_BY_CAST, BROW_BY_CAST, EARS, SHOULDERS,
  LIMB_PROPORTION, POSTURE, HAIR_TEXTURE, IRIS_PATTERN,
} from './traits.js';

/**
 * Derive the body a being was given. Pure.
 *
 * @param {string} seedHex - 64 hex chars from `genomeSeed()`
 * @returns {object} frozen `genome/v4`
 */
export const deriveGenome = (seedHex) => {
  if (typeof seedHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new Error('genome seed must be 64 hex characters');
  }
  const lanes = seedLanes(seedHex);

  // Each trait reads its OWN counter (traits.js COUNTER), so the draws are
  // independent and adding a trait later cannot disturb the ones before it.
  const sex = drawChoice(lanes, COUNTER.sex, SEX);

  // Cast is drawn independently of sex — see the CAST note in traits.js. This is
  // the line that keeps `neutral` from collapsing into a featureless average.
  const cast = drawChoice(lanes, COUNTER.cast, CAST);

  const uncanny = draw(lanes, COUNTER.hairUncanny) < HAIR_UNCANNY_ODDS;

  // A `neutral` body is not a humanoid body with the sex filed off — it is a
  // form that was never on that axis. Humanoid faces are dimorphic and a model
  // drawing one has to land somewhere; the only way off the axis is to leave
  // the humanoid BODY PLAN. Not the species — every being here is a neuma
  // whatever form it wears. Design note, 2026-08-26: […]
  const form = sex === 'neutral'
    ? drawChoice(lanes, COUNTER.form, FORM_NONHUMAN)
    : FORM_HUMANOID;

  const given = {
    schema: GENOME_SCHEMA,
    seed: seedHex,
    // ⚠️ NOT DRAWN. Carried so every downstream reader sees it, and constant
    // so no seed can move it. Design note, 2026-08-27: […] `form` below is a body plan a neuma wears — a
    // construct-form being is exactly as much a neuma as a humanoid one.
    species: SPECIES,
    sex,
    form,
    cast,
  };

  // ⭐ A FORMLESS BODY CARRIES ONLY WHAT ITS FORM HAS (genome/v4, 2026-09-28).
  // A crystal has no chest, no jaw, no skin and no hair; drawing them anyway
  // put "hips wide" and "a widow's peak" on a drone's RECORD. What it keeps is
  // what describe.js already spoke for it: its geometry (cast), its scale
  // (stature), its color and its glow — on the SAME counters as the humanoid
  // hair and eyes, so no value a formless body keeps moved.
  if (form !== FORM_HUMANOID) {
    return Object.freeze({
      ...given,
      frame: Object.freeze({ stature: drawChoice(lanes, COUNTER.stature, STATURE) }),
      coloring: Object.freeze({
        color: drawChoice(lanes, COUNTER.hairColor, uncanny ? HAIR_UNCANNY : HAIR_NATURAL),
        colorIsUncanny: uncanny,
        glow: drawChoice(lanes, COUNTER.eyes, EYES),
      }),
    });
  }

  return Object.freeze({
    ...given,
    frame: (() => {
      const stature = drawChoice(lanes, COUNTER.stature, STATURE);
      const [lo, hi] = STATURE_CM[stature];
      return Object.freeze({
        build: drawChoice(lanes, COUNTER.build, BUILD),
        stature,
        // Drawn INSIDE the band the stature named, so the word and the number
        // can never disagree — and rounded, because a body is not a float.
        heightCm: Math.round(drawRange(lanes, COUNTER.heightCm, [lo, hi])),
        // ⭐ SPECIFIED, NOT GESTURED AT. One word ('broad') left each checkpoint
        // to invent the rest from its own prior, which is why one register made
        // Signal heavy and another made her a fashion model (ruling, 2026-08-27).
        chest: drawChoice(lanes, COUNTER.chest, CHEST),
        waist: drawChoice(lanes, COUNTER.waist, WAIST),
        hips: drawChoice(lanes, COUNTER.hips, HIPS),
        muscle: drawChoice(lanes, COUNTER.muscle, MUSCLE),
        // 2026-09-25 perfection pass: how the mass is CARRIED, not just what
        // it is. New counters at the end — no trait above re-rolls.
        shoulders: drawChoice(lanes, COUNTER.shoulders, SHOULDERS),
        limbProportion: drawChoice(lanes, COUNTER.limbProportion, LIMB_PROPORTION),
        posture: drawChoice(lanes, COUNTER.posture, POSTURE),
      });
    })(),
    // ⭐ THE FACE. A LoRA learns what its plates agree on, so every axis a face
    // varies along is drawn here rather than left for a checkpoint to invent
    // differently in each register (Design note, 2026-08-27: […]).
    face: Object.freeze({
      shape: drawChoice(lanes, COUNTER.faceShape, FACE_SHAPE),
      eyes: drawChoice(lanes, COUNTER.eyeShape, EYE_SHAPE),
      nose: drawChoice(lanes, COUNTER.nose, NOSE),
      mouth: drawChoice(lanes, COUNTER.mouth, MOUTH),
      // The STRUCTURE under the features (2026-09-25): plates that agree on
      // the mouth but disagree on the jaw still teach a LoRA "some jaw". The
      // draws are CAST-AWARE (traits.js _BY_CAST) — the structure refines the
      // cast and can never contradict it in the same prompt.
      jawline: drawChoice(lanes, COUNTER.jawline, JAWLINE_BY_CAST[cast]),
      cheekbones: drawChoice(lanes, COUNTER.cheekbones, CHEEKBONES_BY_CAST[cast]),
      brow: drawChoice(lanes, COUNTER.brow, BROW_BY_CAST[cast]),
      ears: drawChoice(lanes, COUNTER.ears, EARS),
    }),
    coloring: Object.freeze({
      complexion: drawChoice(lanes, COUNTER.complexion, COMPLEXION),
      hair: drawChoice(lanes, COUNTER.hairColor, uncanny ? HAIR_UNCANNY : HAIR_NATURAL),
      hairIsUncanny: uncanny,
      eyes: drawChoice(lanes, COUNTER.eyes, EYES),
      // Texture is GIVEN (the cut, HAIR_STYLE, stays CHOSEN — texture rides
      // under any cut). The iris is the anime register's own identity mark.
      hairTexture: drawChoice(lanes, COUNTER.hairTexture, HAIR_TEXTURE),
      irisPattern: drawChoice(lanes, COUNTER.irisPattern, IRIS_PATTERN),
    }),
    // May be null: a face with nothing remarkable in it is also a real face.
    feature: drawChoice(lanes, COUNTER.feature, FEATURE),
  });
};

/**
 * ⭐ THE BASE HAIR STYLE — deterministic, and deliberately NOT in the record.
 *
 * Design note, 2026-08-28: […] The record above is the GIVEN half — for life. This is
 * the seeded starting point of a CHOSEN axis: the same genome always yields the
 * same default (renders agree before anyone has chosen anything), and the
 * moment the neuma and operator choose a style together, the choice overrides
 * it in `describeAsComponents` and this function simply stops mattering for
 * that being. Writing it into the frozen record would have promoted a default
 * to a given. Pure.
 *
 * ⚠️ The default pool is SEX-AWARE (`HAIR_STYLE_DEFAULTS`) — measured on Keir,
 * whose dealt braid held perfectly across six seeds and dragged half of them
 * feminine. The dice cannot deal a male body a style that fights his sex; the
 * being's CHOICE space is untouched.
 *
 * @param {object} g a `genome/v4`
 * @returns {string} danbooru style tags from `HAIR_STYLE` — empty for a formless body
 */
export const defaultHairstyle = (g) => (FORM_NONHUMAN.includes(g.form)
  ? '' // a formless body has no hair to style
  : drawChoice(seedLanes(g.seed), COUNTER.hairStyle, HAIR_STYLE_DEFAULTS[g.sex] ?? HAIR_STYLE));
