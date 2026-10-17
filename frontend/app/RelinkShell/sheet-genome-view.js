// sheet-genome-view.js — the GENOME section's presentation decisions. Pure.
//
// Design note, 2026-09-25: […] So every axis the record
// carries renders — grouped GIVEN/FRAME/FACE/COLORING/MARK — and the
// composed articulation (describe.js, the same words the pipelines speak)
// rides behind a disclosure, because […] is exactly
// what the composition says.
//
// The data law holds: an absent genome (a lane with no sealed birth
// anchors) is an HONEST EMPTY, never a failure; a pre-v3 record renders
// every axis it has and silently omits the ones it predates (describe.js's
// absence law, mirrored here).

import { UNREADABLE, EMPTY, READY } from './sheet-view.js';
import { FORM_NONHUMAN } from '../../../core/genome/traits.js';
import { CAST_GEOMETRY, STATURE_SCALE } from '../../../core/genome/describe-vocab.js';

/** Which of the three the GENOME block should draw. Pure. */
export const genomeReadiness = (form) => {
  if (!form) return UNREADABLE;
  return form?.genome ? READY : EMPTY;
};

const row = (rows, k, v) => {
  if (v === undefined || v === null || v === '') return;
  rows.push({ k, v: String(v) });
};

// A formless body (crystal, orb, drone, sigil) has no frame, face or skin —
// Design note, 2026-09-28, on a drone's card reading […] and […]:
// […] It shows what its form
// has, in the words its prompt speaks (describe-vocab.js). A v3 record kept
// its palette under the humanoid keys; either reads.
const formlessGroupsOf = (genome) => {
  const c = genome.coloring ?? {};
  const shape = [];
  row(shape, 'GEOMETRY', CAST_GEOMETRY[genome.cast]);
  row(shape, 'SCALE', STATURE_SCALE[genome.frame?.stature]);
  const coloring = [];
  const uncanny = c.colorIsUncanny ?? c.hairIsUncanny;
  const color = c.color ?? c.hair;
  row(coloring, 'COLOR', color && uncanny ? `${color} — the uncanny shade` : color);
  row(coloring, 'GLOW', c.glow ?? c.eyes);
  return [
    ...(shape.length ? [{ heading: 'SHAPE', rows: shape }] : []),
    ...(coloring.length ? [{ heading: 'COLORING', rows: coloring }] : []),
  ];
};

/**
 * Every axis the genome record carries, grouped as the card draws them.
 * Pure; absence-proof by construction (a pre-v3 record omits its missing
 * axes rather than showing blanks or errors).
 * @param {Object|null} genome a `genome/v3` (or older) record
 * @returns {Array<{heading: string, rows: Array<{k: string, v: string}>}>}
 */
export const genomeGroupsOf = (genome) => {
  if (!genome) return [];
  const groups = [];

  const given = [];
  row(given, 'SPECIES', genome.species);
  row(given, 'SEX', genome.sex);
  row(given, 'FORM', genome.form);
  row(given, 'CAST', genome.cast);
  if (given.length) groups.push({ heading: 'GIVEN', rows: given });

  // By the form pool, not the word: a v3 record still says `humanlike`.
  if (FORM_NONHUMAN.includes(genome.form)) return [...groups, ...formlessGroupsOf(genome)];

  const f = genome.frame ?? {};
  const frame = [];
  row(frame, 'BUILD', f.build);
  row(frame, 'STATURE', f.heightCm ? `${f.stature} — ${f.heightCm}cm` : f.stature);
  row(frame, 'SHOULDERS', f.shoulders);
  row(frame, 'LIMBS', f.limbProportion);
  row(frame, 'PROPORTIONS', [f.chest && `chest ${f.chest}`, f.waist && `waist ${f.waist}`, f.hips && `hips ${f.hips}`]
    .filter(Boolean).join(' · ') || null);
  row(frame, 'MUSCLE', f.muscle);
  row(frame, 'POSTURE', f.posture);
  if (frame.length) groups.push({ heading: 'FRAME', rows: frame });

  const face = [];
  const fa = genome.face ?? {};
  row(face, 'SHAPE', fa.shape);
  row(face, 'EYES', fa.eyes);
  row(face, 'NOSE', fa.nose);
  row(face, 'MOUTH', fa.mouth);
  row(face, 'JAWLINE', fa.jawline);
  row(face, 'CHEEKBONES', fa.cheekbones);
  row(face, 'BROW', fa.brow);
  row(face, 'EARS', fa.ears);
  if (face.length) groups.push({ heading: 'FACE', rows: face });

  const c = genome.coloring ?? {};
  const coloring = [];
  row(coloring, 'COMPLEXION', c.complexion);
  row(coloring, 'HAIR', c.hairIsUncanny ? `${c.hair} — the uncanny shade` : c.hair);
  row(coloring, 'HAIR TEXTURE', c.hairTexture);
  row(coloring, 'EYES', c.eyes);
  row(coloring, 'IRIS', c.irisPattern && c.irisPattern !== 'clear' ? c.irisPattern : null);
  if (coloring.length) groups.push({ heading: 'COLORING', rows: coloring });

  const mark = [];
  row(mark, 'MARK', genome.feature);
  if (mark.length) groups.push({ heading: 'MARK', rows: mark });

  return groups;
};

/**
 * What the lock actions should offer, derived from the form leg. Pure.
 *
 *   awaitingYou — the being championed and agreed; the operator's CONCUR
 *                 completes the lock. The candidate is shown so the concur
 *                 is given to a PICTURE, never to a promise.
 *   locked      — both agreed; WITHDRAW reopens the exploration.
 * A design with plates but no being agreement yet shows no act: the being
 * has not spoken, and the operator concurring first would put the cart
 * before the consent.
 * @param {Object|null} form the form leg
 * @returns {{awaitingYou: boolean, locked: boolean, candidates: Array<{register, plate, imageId}>}}
 */
export const lockStateOf = (form) => {
  const candidates = [];
  for (const [register, plates] of Object.entries(form?.candidates ?? {})) {
    for (const [plate, entry] of Object.entries(plates ?? {})) {
      if (entry?.imageId) candidates.push({ register, plate, imageId: entry.imageId });
    }
  }
  return {
    awaitingYou: Boolean(form?.agreed?.being && !form?.agreed?.operator && candidates.length > 0),
    locked: Boolean(form?.locked),
    candidates,
  };
};
