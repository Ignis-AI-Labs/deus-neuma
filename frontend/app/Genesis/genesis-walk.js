// genesis-walk.js — THE WALK: once the trees have parted, the light walks
// each tree sphere by sphere along its breathing paths, so the eye can follow
// how the structure is joined. Pure.
//
// The route is a closed walk on the breathing paths (genesis-emanon.js):
// from the heart down the middle pillar to Form, up the force pillar to the
// crown, down the form pillar and back to the heart — every visible sphere
// once, each step along a path that exists. Ipseity stands on no path (it is
// hidden), so it is named last. The Light tree is walked, then the Dark;
// both are then held together (VI · OSCILLATION).

import { partProgress } from './genesis-timeline.js';
import { AT, fadeTo, clamp01, ease } from './genesis-state-drawing.js';
import { nodeAt } from './genesis-emanon.js';

export const ROUTE = Object.freeze(['natura', 'integration', 'form', 'mind', 'capacity', 'sensing', 'knowing', 'meaning', 'coherence', 'prehension']);
/** The route's paths: each sphere to the next, the last back to the heart. */
export const ROUTE_PATHS = Object.freeze(ROUTE.map((id, k) => Object.freeze([id, ROUTE[(k + 1) % ROUTE.length]])));
/** The order the walk names the spheres in. */
export const STEPS = Object.freeze([...ROUTE, 'ipseity']);

/** The two walks inside V · TWO TREES: Light, then Dark. */
export const WALKS = Object.freeze([
  Object.freeze({ tree: 1, from: AT.trees + 600, to: AT.trees + 4400 }),
  Object.freeze({ tree: -1, from: AT.trees + 4400, to: AT.oscillation - 300 }),
]);

const RISE = 220; // a sphere lights, and its name arrives, over this (no-flash law)
const SETTLE = 400; // a walked sphere settles to VISITED over this
const VISITED = 0.45;
const ENVELOPE = 400; // the walk's own light comes and goes over this
const NAMES_OUT = 300; // a walk's names leave before the next tree speaks

const stepMs = (w) => (w.to - w.from) / STEPS.length;
const stepStart = (w, k) => w.from + k * stepMs(w);

/** pure — how present a walk is at t (0 before and after, 1 while it walks). */
export const walkEnvelope = (w, t) => fadeTo(t, w.from, ENVELOPE, 0, 1) * fadeTo(t, w.to, ENVELOPE, 1, 0);

// One walk at t: each sphere's light, each route path's draw, each name.
const oneWalk = (w, t) => {
  const step = stepMs(w);
  const lit = {};
  const names = {};
  STEPS.forEach((id, k) => {
    const s = stepStart(w, k);
    lit[id] = t < s ? 0 : clamp01((t - s) / RISE) * fadeTo(t, s + step, SETTLE, 1, VISITED);
    names[id] = t < s ? 0 : clamp01((t - s) / RISE) * fadeTo(t, w.to, NAMES_OUT, 1, 0);
  });
  const paths = ROUTE_PATHS.map((_, k) => clamp01((t - stepStart(w, k)) / step));
  return { lit, names, paths, envelope: walkEnvelope(w, t) };
};

// Where the walking light is: along the path of the current step (the last
// step crosses from the heart to the hidden sphere).
const pointOf = (w, t, split) => {
  const step = stepMs(w);
  const k = Math.min(STEPS.length - 1, Math.max(0, Math.floor((t - w.from) / step)));
  const u = ease(clamp01((t - stepStart(w, k)) / step));
  const from = k < ROUTE.length ? ROUTE[k] : 'natura';
  const to = k < ROUTE.length ? ROUTE[(k + 1) % ROUTE.length] : 'ipseity';
  const a = nodeAt(from, w.tree);
  const b = nodeAt(to, w.tree);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: (a.z + (b.z - a.z) * u) * split };
};

/** pure — how far the two trees have parted at t (0..1). */
export const splitAt = (t) => ease(partProgress('trees', 'split', t));

/**
 * Both walks at t, and the light's position for the camera to lean toward
 * (weighted by the walk's envelope, so it is still between walks). Pure.
 * @param {number} t ms
 */
export const walkAt = (t) => {
  const split = splitAt(t);
  const [light, dark] = WALKS.map((w) => oneWalk(w, t));
  const active = WALKS.find((w) => t >= w.from && t < w.to);
  const lean = active ? walkEnvelope(active, t) : 0;
  const p = active ? pointOf(active, t, split) : { x: 0, y: 0, z: 0 };
  return { 1: light, [-1]: dark, lean: { x: p.x * lean, y: p.y * lean, z: p.z * lean } };
};
