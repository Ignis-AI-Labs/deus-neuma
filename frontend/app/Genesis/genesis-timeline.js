// genesis-timeline.js — GENESIS's one clock and its score sheet. Pure.
//
// Every beat of the first-ever opening is declared ONCE here: when it
// starts, how long it runs, its sound cue, and its inner parts. The stage,
// the captions and the sound all read time from this table — no duration
// is ever copied into a second file (the old opening drifted exactly that
// way: 520 in one file, "18% of 520" hand-copied into another). The cue
// sheet derived from it is what the sound designer scores against.
//
// Times are milliseconds on the genesis clock (0 = the void begins).

import { GENESIS } from './genesis-geometry.js';

const beat = (id, at, dur, cue, parts = [], movement = null) => Object.freeze({ id, at, dur, cue, movement, parts: Object.freeze(parts) });
// A part is a sub-beat: offset within its beat, duration, optional cue.
const part = (id, at, dur, cue = null) => Object.freeze({ id, at, dur, cue });

// Seven movements, in the order of the Emanon canon's own recognitions
// (The_Emanon_Principle.md:1135 — Light-Void → Dimensions → the eleven
// functions → two trees → oscillation), then the offering. Each beat names its
// movement.
export const BEATS = Object.freeze([
  // I · THE FIELD — the void is not nothing; the first thing is a vibration.
  // The field is silent: the first sound is the vibration itself.
  beat('field', 0, 5000, null, [part('vibration', 1500, 2400, 'G1')], 'I'),
  // II · DIMENSIONS — the simplex, one dimension at a time, and the plane unfolded.
  beat('monad', 5000, 2500, 'G2', [], 'II'),
  beat('circle', 7500, 2500, 'G3', [], 'II'),
  beat('vesica', 10000, 3000, 'G4', [part('lens', 1600, 1100)], 'II'),
  beat('line', 13000, 3000, 'G5', [part('chord', 0, 1200), part('triad', 1400, 1400)], 'II'),
  beat('seed', 16000, 7000, 'G6', [
    part('petal-3', 0, 1000, 'G6.3'),
    part('petal-4', 1100, 1000, 'G6.4'),
    part('petal-5', 2200, 1000, 'G6.5'),
    part('petal-6', 3300, 1000, 'G6.6'),
    part('petal-7', 4400, 1000, 'G6.7'),
  ], 'II'),
  beat('fruit', 23000, 4500, 'G7', [part('reach', 300, 3000)], 'II'),
  beat('metatron', 27500, 6000, 'G8', [part('channels', 300, 5200)], 'II'),
  // III · THE +1 VERTEX — the first solid needs an observer off the plane.
  beat('simplex', 33500, 5000, 'G9', [part('tetrahedron', 0, 3200), part('observer', 2600, 0, 'G9.1')], 'III'),
  beat('solids', 38500, 9000, 'G10', [
    part('stella', 0, 1400, 'G10.1'),
    part('cube', 1200, 1800, 'G10.2'),
    part('octahedron', 2800, 1800, 'G10.3'),
    part('icosahedron', 4600, 2000, 'G10.4'),
    part('dodecahedron', 6600, 1800, 'G10.5'),
  ], 'III'),
  beat('cosmos', 47500, 3000, 'G11', [
    part('lattice', 0, 1200),
    part('pulse-1', 900, 0, 'G11.1'),
    part('pulse-2', 1500, 0, 'G11.2'),
    part('pulse-3', 2100, 0, 'G11.3'),
  ], 'III'),
  // IV · THE TREE — the middle pillar's circles, the spheres on their
  // crossings, the heart, the hidden sphere, the crown, the breathing paths.
  beat('tree', 50500, 15000, 'G12', [
    part('column', 0, 3200),
    part('spheres', 2800, 2600, 'G12.1'),
    part('heart', 5600, 0, 'G12.2'),
    part('hidden', 7200, 0, 'G12.3'),
    part('crown', 8800, 0, 'G12.4'),
    part('paths', 10200, 4000, 'G12.5'),
  ], 'IV'),
  // V · TWO TREES — Light and Dark part; each sphere's own breath between
  // them; every function to every other.
  beat('trees', 65500, 8500, 'G13', [
    part('split', 0, 2600),
    part('breaths', 2200, 2400, 'G13.1'),
    part('channels', 4600, 3400, 'G13.2'),
  ], 'V'),
  // VI · OSCILLATION — at every scale: within each sphere, between spheres,
  // through the whole tree.
  beat('oscillation', 74000, 7000, 'G14', [
    part('between', 1800, 0, 'G14.1'),
    part('whole', 3600, 0, 'G14.2'),
  ], 'VI'),
  // VII · THE OFFERING
  beat('offering', 81000, 8500, 'G15', [
    part('inscribe', 0, 2600),
    part('record', 2200, 1800, 'G15.1'),
    part('vesica', 4400, 1800, 'G15.2'),
    part('vertex', 5800, 0, 'G15.3'),
    part('namaste', 7000, 0, 'G15.4'),
  ], 'VII'),
  beat('handoff', 89500, 1500, 'G16', [], 'VII'),
]);

const last = BEATS[BEATS.length - 1];
export const GENESIS_MS = last.at + last.dur;

const byId = Object.freeze(Object.fromEntries(BEATS.map((b) => [b.id, b])));

/** pure — clamp to 0..1 */
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** pure — the beat standing at genesis time t (the last beat past the end). */
export const beatAt = (t) => {
  for (let i = BEATS.length - 1; i >= 0; i--) if (t >= BEATS[i].at) return BEATS[i];
  return BEATS[0];
};

/** pure — a beat's progress 0..1 at time t. */
export const progress = (id, t) => {
  const b = byId[id];
  return b.dur === 0 ? (t >= b.at ? 1 : 0) : clamp01((t - b.at) / b.dur);
};

/** pure — a part's progress 0..1 at time t (an instant part is a step). */
export const partProgress = (beatId, partId, t) => {
  const b = byId[beatId];
  const p = b.parts.find((x) => x.id === partId);
  const start = b.at + p.at;
  return p.dur === 0 ? (t >= start ? 1 : 0) : clamp01((t - start) / p.dur);
};

/** pure — the absolute start (ms) of a part. */
export const partStart = (beatId, partId) => {
  const b = byId[beatId];
  return b.at + b.parts.find((x) => x.id === partId).at;
};

/**
 * The score sheet: every cue with its absolute time, in order. What the
 * sound designer scores against, and what playback fires. Pure.
 * @returns {ReadonlyArray<{cue: string, at: number, beat: string, part: string|null}>}
 */
export const cueSheet = () => Object.freeze(
  BEATS.flatMap((b) => [
    ...(b.cue ? [{ cue: b.cue, at: b.at, beat: b.id, part: null }] : []),
    ...b.parts.filter((p) => p.cue).map((p) => ({ cue: p.cue, at: b.at + p.at, beat: b.id, part: p.id })),
  ]).sort((a, b) => a.at - b.at),
);

/**
 * The cues crossed moving from t0 to t1 — the half-open window (t0, t1], so
 * a cue fires exactly once however the frames fall, and a scrub backwards
 * fires nothing. Pure.
 */
export const cuesBetween = (sheet, t0, t1) => (t1 <= t0 ? [] : sheet.filter((c) => c.at > t0 && c.at <= t1));

// ── SEQUENTIAL DRAW — one formula, shared by the GPU and the counters ───
// A group of n strokes draws under one uniform u (0..1); stroke k (order
// o = k/n) runs over u ∈ [o·(1−span), o·(1−span) + span]. The shader
// evaluates exactly this; the captions count with it — so a counter can
// only count strokes that are truly on screen (SHINKEI).

/** pure — how far stroke k of n has drawn at group progress u. */
export const strokeProgress = (u, k, n, span) => clamp01((u - (k / n) * (1 - span)) / span);

/** pure — how many of n strokes are fully drawn at group progress u. */
export const strokesDrawn = (u, n, span) => {
  let done = 0;
  for (let k = 0; k < n; k++) if (strokeProgress(u, k, n, span) >= 1) done += 1;
  return done;
};

// The spans the stage draws with (declared here, beside the clock).
export const SPANS = Object.freeze({
  CIRCLE: 0.02, // a ring's segments: a pen going around
  METATRON: 0.08, // a few channels in flight at once
  SOLID: 0.18, // a solid's edges: a quick radar-ish sweep
  TREE: 0.12, // a tree's channels: a wave of light, not a list
});

/** The true numbers the captions quote, from the geometry — never typed. */
export const CAPTION_FACTS = Object.freeze({
  sqrt3: GENESIS.VESICA_RATIO.toFixed(4),
  phi: GENESIS.PHI.toFixed(4),
  seed: GENESIS.SEED_CIRCLES,
  fruit: GENESIS.FRUIT_CENTERS,
  channels: GENESIS.METATRON_LINES,
});

/** pure — a clock reading "MM:SS.s" for a transport. */
export const clockOf = (ms) => {
  const s = ms / 1000;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};
