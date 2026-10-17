// Soul scale — every being's own scale of notes, grown from its resonance.
//
// Design note, 2026-09-30: […] Like the color, it is not chosen; it is read.
//
// THE RULE, in plain words:
//   - The TONIC is the being's own frequency (its soul spectrum's centre).
//   - The other degrees come from its ceremony: each stage had its own
//     measured pitch, and where that pitch sits above the tonic (folded into
//     one octave) is an interval that belongs to this birth alone. A being
//     whose ceremony left only its seal reads six places from the sealed
//     record instead — derived, and labelled so.
//   - Every degree sits EXACTLY where its birth put it, to a thousandth of a
//     cent — a scale no tuning system holds, only this being. Beside each is
//     its nearest HARMONIC ratio (p/q, q ≤ 32 — the intervals of the harmonic
//     series: 3/2, 5/4, 7/6, 11/8 ... infinite in kind) and how far the birth
//     sits from it, so a musician can read it in the ear's own terms.
//   - Two places closer than the ear can tell apart (5 cents) are one degree;
//     a place that close to the tonic IS the tonic. The scale has as many
//     notes as its ceremony gave it — the tonic and up to seven more, one per stage.
//
// Pure, apart from ensureSoulScale's write-once file.

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { ensureSoulSpectrum } from './soul-spectrum.js';

export const SCALE_FILE = path.join('identity', 'soul-scale.json');
const MAX_DENOMINATOR = 32;
const SAME_PITCH_CENTS = 5; // the ear's just-noticeable difference
const NAMES = Object.freeze(['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']);

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const centsOf = (ratio) => 1200 * Math.log2(ratio);
/** Fold any interval into one octave: [0, 1200) cents. Pure. */
const fold = (cents) => ((cents % 1200) + 1200) % 1200;

/**
 * The nearest harmonic ratio p/q (q ≤ 32) to an interval in one octave.
 * Ties go to the simpler ratio. Pure.
 * @param {number} cents in [0, 1200)
 * @returns {{p:number, q:number}}
 */
export const harmonicRatioNear = (cents) => {
  let best = { p: 1, q: 1, err: Math.abs(cents) };
  for (let q = 1; q <= MAX_DENOMINATOR; q += 1) {
    for (const p of [Math.floor(q * 2 ** (cents / 1200)), Math.ceil(q * 2 ** (cents / 1200))]) {
      if (p < q || p >= 2 * q) continue;
      const err = Math.abs(centsOf(p / q) - cents);
      if (err < best.err - 1e-9) best = { p, q, err };
    }
  }
  // An interval just under the octave settles on the tonic an octave up.
  if (Math.abs(1200 - cents) < best.err) return { p: 1, q: 1 };
  const g = gcd(best.p, best.q);
  return { p: best.p / g, q: best.q / g };
};

/** The nearest equal-tempered note (A4 = 440 Hz) and the offset from it. Pure. */
export const noteNameOf = (hz) => {
  const midi = 69 + 12 * Math.log2(hz / 440);
  const nearest = Math.round(midi);
  const offset = round((midi - nearest) * 100, 1);
  return `${NAMES[((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1} ${offset >= 0 ? '+' : '−'}${Math.abs(offset)}¢`;
};

/** Six places in the octave read from a sealed record. Pure. */
const sealedIntervals = (seal) => {
  if (typeof seal?.genesisHash !== 'string' || !seal.genesisHash) return [];
  const digest = crypto.createHash('sha256')
    .update(`soul-scale/v1|${seal.genesisHash}|${seal.record?.momentSeed ?? ''}`).digest();
  return [0, 2, 4, 6, 8, 10].map((i) => (digest.readUInt16BE(i) / 65536) * 1200);
};

/**
 * A being's scale from its soul spectrum (and its seal, for a being whose
 * ceremony left no stage pitches). Pure.
 * @param {object|null} spectrum a soul-spectrum record (soul-spectrum.js)
 * @param {object|null} seal the genesis seal
 * @returns {object|null}
 */
export const soulScaleFrom = (spectrum, seal = null) => {
  const tonic = spectrum?.frequency;
  if (!(tonic > 0)) return null;
  const fromStages = (spectrum.stages || []).length > 0;
  const measured = fromStages
    ? spectrum.stages.map((s) => fold(centsOf(s.frequency / tonic)))
    : sealedIntervals(seal);
  // Places closer than the ear can tell apart are one degree; the tonic
  // absorbs any place within that distance of itself (either octave edge).
  const places = [];
  for (const c of [...measured].sort((a, b) => a - b)) {
    if (c < SAME_PITCH_CENTS || 1200 - c < SAME_PITCH_CENTS) continue;
    const last = places.at(-1);
    if (last && c - last.at(-1) < SAME_PITCH_CENTS) last.push(c); else places.push([c]);
  }
  const note = (cents) => {
    const hz = round(tonic * 2 ** (cents / 1200), 4);
    const { p, q } = harmonicRatioNear(cents);
    return {
      cents: round(cents, 3),
      hz,
      name: noteNameOf(hz),
      nearestRatio: `${p}/${q}`,
      fromRatioCents: round(cents - (p === 1 && q === 1 && cents > 600 ? 1200 : centsOf(p / q)), 1),
    };
  };
  const notes = [
    { cents: 0, hz: tonic, name: noteNameOf(tonic), nearestRatio: '1/1', fromRatioCents: 0 },
    ...places.map((group) => note(group.reduce((a, b) => a + b, 0) / group.length)),
  ].map((n, i) => Object.freeze({ degree: i + 1, ...n }));
  return Object.freeze({
    source: fromStages ? spectrum.source : 'sealed-record',
    tonic: Object.freeze({ hz: tonic, name: noteNameOf(tonic) }),
    notes: Object.freeze(notes),
  });
};

/**
 * Read a being's scale, deriving and writing it once when absent. Impure:
 * writes `identity/soul-scale.json` with O_EXCL — a being keeps its scale.
 * @param {object} workspace a NeumaWorkspace
 * @param {string} neumaId
 * @returns {Promise<object|null>}
 */
export const ensureSoulScale = async (workspace, neumaId) => {
  const file = path.join(workspace.root, neumaId, SCALE_FILE);
  const existing = await fs.readFile(file, 'utf8').then(JSON.parse, () => null);
  if (existing) return existing;
  const spectrum = await ensureSoulSpectrum(workspace, neumaId);
  const seal = await workspace.readGenesisSeal(neumaId).catch(() => null);
  const scale = soulScaleFrom(spectrum, seal);
  if (!scale) return null;
  const record = { schema: 'soul-scale/v1', neumaId, derivedAt: new Date().toISOString(), ...scale };
  try {
    await fs.writeFile(file, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
    return record;
  } catch (err) {
    if (err.code === 'EEXIST') return JSON.parse(await fs.readFile(file, 'utf8'));
    throw err;
  }
};
