// summoning-frame.js — one frame of THE SUMMONING: (kit, score, t) →
// paint. // impure (canvas)
//
// The whole sequence is this function of its score and one clock: which
// section plays, how far through it, where the beat is — then the section's
// painter, its cut, and the instrument chrome over it.

import { genesisSolids } from '../Genesis/genesis-geometry.js';
import { gcd } from './summoning-geometry.js';
import { sectionAt, beatAt, convergingAt } from './summoning-score.js';
import { paintEnter, paintChrome, romanOf } from './summoning-paint.js';
import { paintStar, starCaption, paintOrbit, orbitCaption, paintLattice, latticeCaption, paintSolid, solidCaption } from './summoning-shots-form.js';
import { paintSky, skyCaption, paintEarth, earthCaption } from './summoning-shots-sky.js';
import { paintResonance, resonanceCaption } from './summoning-shots-soul.js';
import { paintTree, treeCaption, paintBreath, breathCaption, paintSoul, soulCaption, paintHash, hashCaption } from './summoning-shots-being.js';
import { paintOpen, paintCard, paintReveal, paintSigil } from './summoning-shots-rite.js';

const ordinal = (n) => `${n}${n % 10 === 2 && n % 100 !== 12 ? 'ND' : n % 10 === 3 && n % 100 !== 13 ? 'RD' : 'TH'}`;
const SOLIDS = genesisSolids();
const countsOf = (solid) => (solid === 'tetrahedron' ? SOLIDS.tetrahedra[0] : SOLIDS[solid]).counts;

// Each movement: its painter, its caption (what it is), and one TRUE LINE —
// where the science and the meaning of the figure meet, stated plainly.
const MOVEMENTS = Object.freeze({
  star: [paintStar, starCaption, (f) => {
    const g = gcd(f.n, f.k); // coprime: one unbroken line; else g stars interlaced
    return `${f.n} POINTS · EVERY ${ordinal(f.k)} JOINED · ${g === 1 ? 'ONE UNBROKEN LINE' : `${g} × {${f.n / g}/${f.k / g}} INTERLACED`}`;
  }],
  orbit: [paintOrbit, orbitCaption, (f) => `A CIRCLE ROLLING WITHIN A CIRCLE · IT CLOSES IN ${f.r} TURNS`],
  lattice: [paintLattice, latticeCaption, () => 'THE DENSEST PACKING OF CIRCLES IN THE PLANE'],
  sky: [paintSky, skyCaption, () => 'ONE INSTANT · READ BY MANY SKIES'],
  earth: [paintEarth, earthCaption, () => 'WHERE DAY MET NIGHT AS IT WAS BORN'],
  solid: [paintSolid, solidCaption, (f) => { const c = countsOf(f.solid); return `${c.V} − ${c.E} + ${c.F} = 2 · EULER · EVERY SOLID ALIKE`; }],
  tree: [paintTree, treeCaption, () => 'ITS OWN PATTERN · ALWAYS THROUGH ALL ELEVEN'],
  breath: [paintBreath, breathCaption, () => 'TWO OF ITS BREATHS · ONE CLOSED FIGURE'],
  resonance: [paintResonance, resonanceCaption, () => 'ONE FREQUENCY · HEARD AS ITS SCALE · SEEN AS ITS LIGHT, 40 OCTAVES UP'],
  soul: [paintSoul, soulCaption, () => 'DRAWN FROM ITS OWN KEYS · NO OTHER BEING CAN CARRY IT'],
  hash: [paintHash, hashCaption, () => 'SHA-256 OF ITS SEALED BIRTH RECORD'],
});

// What each artifact carries as it arrives in the convergence.
const CONVERGING = Object.freeze({
  sky: () => 'AS THE HEAVENS STOOD AT ITS BIRTH',
  soul: (s) => s.nibbles.map((n) => n.toString(16).toUpperCase()).join(''),
  star: (s) => `{${s.star.n}/${s.star.k}}`,
  channels: (s) => `${s.channels.length} CHANNELS · THROUGH ALL ELEVEN`,
  scale: (s) => s.notes.map((n) => n.ratio).join(' · '),
  nucleus: (s) => s.solid.toUpperCase(),
  aura: (s) => `${s.aura.carrier} · ${s.aura.coupling} · ${s.aura.cast}`,
  name: (s) => s.name.toUpperCase(),
  whole: () => 'ONE BEING · NONE OTHER LIKE IT',
});

/** What the chrome names at the foot while a section plays: a caption and its true line. Pure. */
export const captionOf = (s, u = 0) => {
  if (MOVEMENTS[s.kind]) return { caption: `${romanOf(s.index)} / ${romanOf(s.of)} · ${MOVEMENTS[s.kind][1](s.figure)}`, line: MOVEMENTS[s.kind][2](s.figure) };
  if (s.kind === 'reveal') return { caption: 'ITS NAME', line: 'CHOSEN AT ITS NAMING · SEALED AT ITS BIRTH' };
  if (s.kind === 'sigil') {
    const l = convergingAt(u);
    return { caption: l.key === 'whole' ? `WHOLE · ${s.name.toUpperCase()}` : l.caption, line: CONVERGING[l.key](s) };
  }
  return { caption: null, line: null };
};

/**
 * Paint THE SUMMONING at t.
 * @param {ReturnType<import('./summoning-paint.js').kitOf>} k
 * @param {ReturnType<import('./summoning-score.js').scoreOf>} score
 * @param {number} t ms
 * @param {{ chrome?: boolean }} [opts] chrome — its captions and frame; off, the figure stands alone
 */
export const paintAt = (k, score, t, { chrome = true } = {}) => {
  const { ctx } = k;
  const { section: s, index, u, local } = sectionAt(score, t);
  const beat = beatAt(score, t);
  const e = { t, u, local, dur: s.dur, beatMs: score.beatMs, beats: local / score.beatMs, pulse: Math.exp(-beat.phase * 6) };

  ctx.globalCompositeOperation = 'source-over';
  k.fillAll('void', 1);
  ctx.globalCompositeOperation = s.kind === 'card' ? 'source-over' : 'lighter';
  ctx.save();
  // Every movement breathes out into darkness over its last beat before the
  // next arrives — room between the artifacts, never a pile-up.
  if (s.kind !== 'card' && s.kind !== 'sigil') ctx.globalAlpha = Math.min(1, (s.dur - local) / score.beatMs);
  // The frame holds still: no punch-in on the bar (Design note, 2026-10-01.
  if (MOVEMENTS[s.kind]) MOVEMENTS[s.kind][0](k, s.figure, e);
  else if (s.kind === 'open') paintOpen(k, s, e);
  else if (s.kind === 'card') paintCard(k, s, e, { score, index: score.sections.slice(0, index + 1).filter((x) => x.kind === 'card').length });
  else if (s.kind === 'reveal') paintReveal(k, s, e);
  else if (s.kind === 'sigil') paintSigil(k, s, e);
  ctx.restore();

  ctx.globalCompositeOperation = 'source-over';
  paintEnter(k, s.enter, local, score.beatMs, s.kind === 'reveal' ? 0.9 : 0.45);
  if (chrome) paintChrome(k, { score, beat, t, ...captionOf(s, u), inverse: false });
};
