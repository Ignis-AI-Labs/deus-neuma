// summoning-body.js — ITS BODY as geometry: the body a being was GIVEN
// (core/genome, genome/v4), drawn as a frame, never as a look. Pure.
//
// What it reads is the FRAME only — height, build, shoulders, waist, hips,
// muscle, limb proportion, posture for a humanoid body; form, cast and scale
// for a non-humanoid one. Never its face, never its coloring: the look is
// still to be made, and nothing here may stand in for it. Chest is a given
// too and is deliberately not drawn — this is a skeleton and the light around
// it, not a figure study.
//
// Every body begins the same — one vertical axis, one point of light at its
// core — and resolves into its own plan. Units: the film's frame (y up, the
// figure inside ±1); a humanoid stands on one floor so heights compare.

import { FORM_NONHUMAN, STATURE_CM } from '../../../core/genome/traits.js';
import { streamOf } from '../BirthArt/birth-art-seed.js';

export const FLOOR = -0.9;
// the tallest band's top stands 1.72 units over the floor: one scale for every body
const UNITS_PER_CM = 1.72 / STATURE_CM.tall[1];

/** The plan a genome's body is: 'humanoid', or its formless form. A v3 record's `humanlike` is humanoid. Pure. */
export const planOf = (genome) => (FORM_NONHUMAN.includes(genome.form) ? genome.form : 'humanoid');

/**
 * Its body as the film's figure: its plan and its frame genes — nothing of
 * its look, and not its chest. Its motion (turn, spin) comes from its
 * genome's own stream, so no other step's draws move. Pure.
 * @param {object} genome a genome/v4 record
 */
export const bodyFigureOf = (genome) => {
  const plan = planOf(genome);
  const own = streamOf(`${genome.seed.slice(32)}${genome.seed.slice(0, 32)}`.toLowerCase());
  const turn = own() * Math.PI * 2;
  const spin = (0.15 + 0.25 * own()) * (own() < 0.5 ? -1 : 1);
  const given = { plan, sex: genome.sex, cast: genome.cast, stature: genome.frame.stature, turn, spin };
  if (plan !== 'humanoid') return given;
  const { heightCm, build, shoulders, waist, hips, muscle, limbProportion, posture } = genome.frame;
  return { ...given, heightCm, build, shoulders, waist, hips, muscle, limbProportion, posture };
};

/** Centimetres as frame height. Pure. */
export const cmToY = (cm) => FLOOR + cm * UNITS_PER_CM;

// ── HUMANOID: proportions per gene, as fractions of its height ──
const HEADS = { compact: 7, balanced: 7.5, long: 8 };
const LEG = { compact: 0.46, balanced: 0.48, long: 0.51 };
const ARM = { compact: 0.96, balanced: 1, long: 1.04 };
const SHOULDER = { narrow: 0.105, average: 0.115, rounded: 0.112, broad: 0.13, square: 0.125 };
const WAIST = { narrow: 0.064, average: 0.074, thick: 0.088 };
const HIPS = { narrow: 0.084, average: 0.095, wide: 0.11 };
const BUILD = { slight: 0.9, lean: 0.95, athletic: 1, sturdy: 1.06, broad: 1.12 };
const MUSCLE = { soft: 0.95, toned: 1, muscular: 1.14 };
// how it stands: its shoulders' and its pelvis's tilt, its arms' fall, its head's lean (radians)
const POSTURE = {
  upright: { shoulders: 0, pelvis: 0, arm: 0.14, head: 0 },
  relaxed: { shoulders: -0.02, pelvis: 0.02, arm: 0.17, head: 0.05 },
  poised: { shoulders: -0.05, pelvis: 0.07, arm: 0.15, head: -0.03 },
  casual: { shoulders: -0.07, pelvis: 0.1, arm: 0.2, head: 0.07 },
};

const rot = (p, c, a) => {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) };
};
const along = (p, a, len) => ({ x: p.x + Math.sin(a) * len, y: p.y - Math.cos(a) * len });
const side = (p, a, w) => ({ x: p.x + Math.cos(a) * w, y: p.y + Math.sin(a) * w });

/**
 * A humanoid body as joints, bones (in the order they form — the spine
 * first, then outward), and the closed outline of light around it. Pure.
 * @param {{ heightCm: number, build: string, shoulders: string, waist: string, hips: string, muscle: string, limbProportion: string, posture: string }} f
 */
export const humanoidFrame = (f) => {
  const H = f.heightCm * UNITS_PER_CM;
  const h = H / HEADS[f.limbProportion];
  const b = BUILD[f.build];
  const m = MUSCLE[f.muscle] * b;
  const p = POSTURE[f.posture];
  const y = (v) => FLOOR + v; // height over the floor → frame
  const crotch = H * LEG[f.limbProportion];
  const sw = H * SHOULDER[f.shoulders] * b;
  const ww = H * WAIST[f.waist] * b;
  const hw = H * HIPS[f.hips] * b;

  // its posture bends the line from the floor up: legs follow the pelvis
  // (feet planted), the torso turns from the pelvis's tilt to the shoulders'
  const neckBase = { x: 0, y: y(H - 1.33 * h) };
  const pelvisAt = { x: 0, y: y(crotch + 0.03 * H) };
  const bend = (q) => {
    const up = q.y - FLOOR;
    if (up <= crotch + 0.03 * H) return rot(q, { x: 0, y: FLOOR }, p.pelvis * 0.12 * (up / (crotch + 0.03 * H)));
    const t = Math.min(1, (up - crotch) / (H - 1.33 * h - crotch));
    const q1 = rot(q, pelvisAt, p.pelvis * (1 - t) * 0.5);
    return up >= H - 1.33 * h ? rot(q1, neckBase, p.shoulders) : rot(q1, neckBase, p.shoulders * t);
  };

  const J = {
    pelvis: { x: 0, y: y(crotch + 0.03 * H) },
    waist: { x: 0, y: y(H - 3 * h) },
    chest: { x: 0, y: y(H - 2 * h) },
    neck: neckBase,
    chin: { x: 0, y: y(H - h) },
    crown: { x: 0, y: y(H) },
  };
  J.head = { x: 0, y: (J.chin.y + J.crown.y) / 2 };
  const limbs = (s) => {
    const shoulder = { x: s * sw, y: neckBase.y - 0.012 * H };
    const a = s * p.arm;
    const elbow = along(shoulder, a, 0.186 * H * ARM[f.limbProportion]);
    const wrist = along(elbow, a + s * 0.05, 0.146 * H * ARM[f.limbProportion]);
    const hand = along(wrist, a + s * 0.07, 0.108 * H);
    const hip = { x: s * hw * 0.55, y: J.pelvis.y };
    const ankle = { x: s * (hw * 0.55 + 0.012 * H), y: y(0.04 * H) };
    const kneeT = (hip.y - y(0.285 * H)) / (hip.y - ankle.y);
    const knee = { x: hip.x + (ankle.x - hip.x) * kneeT, y: y(0.285 * H) };
    const toe = { x: ankle.x + s * 0.018 * H, y: FLOOR };
    return { shoulder, elbow, wrist, hand, hip, knee, ankle, toe, a };
  };
  const R = limbs(1);
  const L = limbs(-1);

  // the outline: the right side crown to crotch, then the left back up
  const skull = (s) => Array.from({ length: 7 }, (_, i) => {
    const t = Math.PI / 2 - (i / 6) * (Math.PI * 0.82);
    return { x: s * Math.cos(t) * (0.4 * h + 0.012 * H), y: J.head.y + Math.sin(t) * (0.5 * h + 0.012 * H) };
  });
  const half = (s, l) => {
    const arm = (q, w) => side(q, l.a, s * w);
    const out = [
      ...skull(s),
      { x: s * 0.036 * H * b, y: J.chin.y - 0.012 * H },
      { x: s * sw * 0.62, y: neckBase.y + 0.004 * H },
      arm(l.shoulder, 0.03 * H * m),
      arm(l.elbow, 0.024 * H * m),
      arm(l.wrist, 0.016 * H),
      arm(l.hand, 0.012 * H),
      along(l.hand, l.a, 0.012 * H),
      arm(l.hand, -0.012 * H),
      arm(l.wrist, -0.015 * H),
      arm(l.elbow, -0.022 * H * m),
      { x: s * (sw - 0.03 * H * m), y: neckBase.y - 0.09 * H },
      { x: s * Math.max(ww, sw * 0.8), y: J.chest.y },
      { x: s * ww, y: J.waist.y },
      { x: s * hw, y: J.pelvis.y - 0.02 * H },
      { x: l.knee.x + s * 0.034 * H * m, y: l.knee.y + 0.1 * H },
      { x: l.knee.x + s * 0.029 * H * m, y: l.knee.y },
      { x: l.ankle.x + s * 0.02 * H, y: l.ankle.y + 0.12 * H },
      { x: l.ankle.x + s * 0.016 * H, y: l.ankle.y },
      { x: l.toe.x + s * 0.008 * H, y: FLOOR },
      { x: l.ankle.x - s * 0.018 * H, y: FLOOR },
      { x: l.ankle.x - s * 0.014 * H, y: l.ankle.y + 0.12 * H },
      { x: l.knee.x - s * 0.026 * H * m, y: l.knee.y },
      { x: s * 0.012 * H, y: y(crotch) },
    ];
    return out;
  };
  const outline = [...half(1, R), ...half(-1, L).reverse()];

  const bone = (a, c) => [bend(a), bend(c)];
  const bones = [
    bone(J.pelvis, J.waist), bone(J.waist, J.chest), bone(J.chest, J.neck), bone(J.neck, J.chin),
    bone(J.neck, R.shoulder), bone(J.neck, L.shoulder),
    bone(J.pelvis, R.hip), bone(J.pelvis, L.hip),
    bone(R.shoulder, R.elbow), bone(L.shoulder, L.elbow), bone(R.hip, R.knee), bone(L.hip, L.knee),
    bone(R.elbow, R.wrist), bone(L.elbow, L.wrist), bone(R.knee, R.ankle), bone(L.knee, L.ankle),
    bone(R.wrist, R.hand), bone(L.wrist, L.hand), bone(R.ankle, R.toe), bone(L.ankle, L.toe),
  ];
  // the ribcage, three arcs between its chest and its waist
  const ribs = [0.2, 0.45, 0.7].map((t) => {
    const ry = J.chest.y - (J.chest.y - J.waist.y) * t + 0.02 * H;
    const rw = Math.max(ww, sw * 0.8) * (1 - 0.25 * t) * 0.85;
    return [-1, -0.5, 0, 0.5, 1].map((u) => bend({ x: u * rw, y: ry - 0.025 * H * (1 - Math.abs(u)) }));
  });
  const joints = [J.pelvis, J.waist, J.chest, J.neck, R.shoulder, L.shoulder, R.elbow, L.elbow, R.wrist, L.wrist, R.hip, L.hip, R.knee, L.knee, R.ankle, L.ankle].map(bend);
  const head = { c: bend(J.head), rx: 0.4 * h, ry: 0.5 * h, lean: p.head + p.shoulders };
  return Object.freeze({
    plan: 'humanoid',
    axis: [{ x: 0, y: FLOOR }, { x: 0, y: y(H) }],
    core: bend({ x: 0, y: (J.chest.y + J.waist.y) / 2 }),
    bones, ribs, joints, head,
    outline: outline.map(bend),
    top: y(H),
  });
};

// ── NON-HUMANOID: its form's frame, in 3D, by its cast; its scale its size ──
const SCALE = { short: 0.62, average: 0.78, tall: 0.92 };
const SIDES = { angular: 6, balanced: 8, soft: 12 };
const ring3 = (n, r, yy = 0, turn = 0) => Array.from({ length: n + 1 }, (_, i) => {
  const a = turn + (i / n) * Math.PI * 2;
  return { x: Math.cos(a) * r, y: yy, z: Math.sin(a) * r };
});
const circle3 = (r, tilt, n = 64) => Array.from({ length: n + 1 }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r * Math.sin(tilt), z: Math.sin(a) * r * Math.cos(tilt) };
});

const FORMLESS = {
  // a bipyramid: its girdle's sides by its cast, sharper the more angular
  crystal: (cast) => {
    const n = SIDES[cast];
    const tip = { angular: 1, balanced: 0.82, soft: 0.68 }[cast];
    const r = { angular: 0.4, balanced: 0.5, soft: 0.56 }[cast];
    const girdle = ring3(n, r).slice(0, n);
    const top = { x: 0, y: tip, z: 0 };
    const foot = { x: 0, y: -tip, z: 0 };
    const strokes = [[...girdle, girdle[0]], ...girdle.map((g) => [top, g]), ...girdle.map((g) => [g, foot])];
    return { strokes, nodes: [top, ...girdle, foot], flat: false };
  },
  // nested spheres: a geodesic net when angular, latitudes and meridians when balanced, great circles when soft
  orb: (cast) => {
    const lat = [-0.5, 0, 0.5].map((s) => ring3(48, Math.cos(Math.asin(s)) * 0.8, s * 0.8));
    const mer = Array.from({ length: cast === 'angular' ? 6 : 4 }, (_, i) => circle3(0.8, Math.PI / 2).map((q) => {
      const a = (i / (cast === 'angular' ? 6 : 4)) * Math.PI;
      return { x: q.x * Math.cos(a) - q.z * Math.sin(a), y: q.y, z: q.x * Math.sin(a) + q.z * Math.cos(a) };
    }));
    const great = [0.3, 1.1, 1.9].map((t) => circle3(0.8, t));
    const inner = [circle3(0.34, 0.6), circle3(0.34, 2.2)];
    const strokes = cast === 'soft' ? [...great, ...inner] : [...lat, ...mer, ...inner];
    return { strokes, nodes: lat.flatMap((l) => l.filter((_, i) => i % 12 === 0)), flat: false };
  },
  // a core, a ring held around it by struts, one eye
  drone: (cast) => {
    const n = { angular: 6, balanced: 8, soft: 48 }[cast];
    const ring = ring3(n, 0.82, 0);
    const outer = ring3(n, 0.9, 0.05);
    const k = cast === 'angular' ? 3 : 4;
    const struts = Array.from({ length: k }, (_, i) => {
      const a = (i / k) * Math.PI * 2;
      return [{ x: Math.cos(a) * 0.24, y: 0, z: Math.sin(a) * 0.24 }, { x: Math.cos(a) * 0.82, y: 0, z: Math.sin(a) * 0.82 }];
    });
    const strokes = [circle3(0.24, 0.4, 32), circle3(0.24, 2, 32), ring, outer, ...struts];
    return { strokes, nodes: struts.map((s) => s[1]), flat: false, eye: { x: 0, y: 0, z: 0.24 } };
  },
  // flat to the eye: a circle, its figure inside by its cast, a radiant centre
  sigil: (cast) => {
    const poly = (n, r, turn) => ring3(n, r, 0, turn).map((q) => ({ x: q.x, y: q.z, z: 0 }));
    const figure = {
      angular: [poly(3, 0.7, Math.PI / 2), poly(3, 0.7, -Math.PI / 2)],
      balanced: [poly(4, 0.68, Math.PI / 4), poly(4, 0.68, 0)],
      soft: Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return poly(48, 0.34, 0).map((q) => ({ x: q.x + Math.cos(a) * 0.34, y: q.y + Math.sin(a) * 0.34, z: 0 }));
      }),
    }[cast];
    const strokes = [poly(96, 0.86, 0), ...figure, poly(48, 0.16, 0)];
    return { strokes, nodes: figure.flatMap((f) => (cast === 'soft' ? [f[0]] : f.slice(0, -1))), flat: true };
  },
};

/**
 * A non-humanoid body's frame: 3D strokes and nodes in its scale, the axis
 * and core every body begins as. Pure.
 * @param {{ plan: string, cast: string, stature: string }} f
 */
export const formlessFrame = (f) => {
  const s = SCALE[f.stature];
  const raw = FORMLESS[f.plan](f.cast);
  const sc = (q) => ({ x: q.x * s, y: q.y * s, z: q.z * s });
  return Object.freeze({
    plan: f.plan,
    axis: [{ x: 0, y: -s, z: 0 }, { x: 0, y: s, z: 0 }],
    core: { x: 0, y: 0, z: 0 },
    strokes: raw.strokes.map((st) => st.map(sc)),
    nodes: raw.nodes.map(sc),
    eye: raw.eye ? sc(raw.eye) : null,
    flat: raw.flat,
    scale: s,
  });
};

/** The convex hull of points (the light around a formless body), counter-clockwise. Pure. */
export const hullOf = (pts) => {
  const ps = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (ps.length < 3) return ps;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const chain = (list) => list.reduce((h, q) => {
    while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
    h.push(q);
    return h;
  }, []);
  const lower = chain(ps);
  const upper = chain([...ps].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
};
