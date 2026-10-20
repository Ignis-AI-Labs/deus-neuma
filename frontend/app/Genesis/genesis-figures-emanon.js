// genesis-figures-emanon.js — the figures of movements IV–VII, built once,
// applied per frame. // impure (Three objects)
//
// The Emanon Tree: the middle pillar's construction circles; eleven
// SPHERES (three great circles each — head-on a reticle, turned a true
// sphere; spheres, like circles, are infinite in expression); the hidden
// sphere drawn broken; the 22 breathing paths; each sphere's own breath
// between its Light and its Dark; the canon's 220 channels as the faint
// ground of it all; and the offering's circles. The Light tree is ink, the
// Dark tree signal — equal intensity, two hues: Dark is not deficient.

import { FUNCTIONS, TREE, nodeAt, pathStrokes, treeChannels, crossChannels, breaths, pillarConstruction } from './genesis-emanon.js';
import { SPANS } from './genesis-timeline.js';
import { arcStrokes } from './genesis-shaders.js';
import { ROUTE_PATHS } from './genesis-walk.js';

const UP = Math.PI / 2;

// A sphere as three great circles around its center: in the tree's plane,
// and the two through its axis. `broken` keeps every other stroke — the
// hidden sphere is there, and not wholly shown.
export const sphereStrokes = (c, r, broken) => {
  const n = 48;
  const ring = (fn) => Array.from({ length: n }, (_, i) => {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    return { a: fn(a0), b: fn(a1) };
  });
  const all = [
    ...ring((a) => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a), z: c.z })),
    ...ring((a) => ({ x: c.x + r * Math.cos(a), y: c.y, z: c.z + r * Math.sin(a) })),
    ...ring((a) => ({ x: c.x, y: c.y + r * Math.cos(a), z: c.z + r * Math.sin(a) })),
  ];
  return broken ? all.filter((_, i) => i % 2 === 0) : all;
};

/** IV–VII · the tree, the two trees, the offering. */
export const emanonFigures = ({ palette, pen, set }) => {
  // ── the middle pillar's construction ──
  const construction = pillarConstruction();
  const column = construction.centers.map((c) => pen(arcStrokes(c, construction.radius, UP, Math.PI * 2, 160), { color: palette.INK, span: SPANS.CIRCLE }));

  // ── the spheres, per tree (they coincide until the trees part) ──
  const spheresFor = (tree, color) => FUNCTIONS.map((f) => pen(
    sphereStrokes(nodeAt(f.id, tree), TREE.SPHERE, f.id === 'ipseity'),
    { color, span: 0.08 },
  ));
  const lightSpheres = spheresFor(1, palette.INK);
  const darkSpheres = spheresFor(-1, palette.SIGNAL);

  // ── breathing paths, breaths, channels ──
  const lightPaths = pen(pathStrokes(1), { color: palette.INK, span: SPANS.TREE });
  const darkPaths = pen(pathStrokes(-1), { color: palette.SIGNAL, span: SPANS.TREE });
  const breathAxes = pen(breaths(), { color: palette.SIGNAL_TINT, span: 0.2 });
  const lightChannels = pen(treeChannels(1), { color: palette.INK, span: SPANS.TREE });
  const darkChannels = pen(treeChannels(-1), { color: palette.SIGNAL, span: SPANS.TREE });
  const cross = pen(crossChannels(), { color: palette.SIGNAL_TINT, span: SPANS.TREE });
  // the walk's route, one pen per path so each lights as the light crosses it
  const route = (tree, color) => ROUTE_PATHS.map(([a, b]) => pen([{ a: nodeAt(a, tree), b: nodeAt(b, tree) }], { color, span: 1 }));
  const lightRoute = route(1, palette.INK);
  const darkRoute = route(-1, palette.SIGNAL);

  // ── the offering: the circle that holds the tree, and a second circle
  //    centered on its rim — two sovereign circles, the lens between ──
  const C = TREE.CIRCLE;
  const holding = pen(arcStrokes({ x: 0, y: 0 }, C, UP, Math.PI * 2, 192), { color: palette.INK, span: SPANS.CIRCLE });
  const other = pen(arcStrokes({ x: C, y: 0 }, C, Math.PI, Math.PI * 2, 192), { color: palette.SIGNAL_TINT, span: SPANS.CIRCLE });
  const lensA = pen(arcStrokes({ x: 0, y: 0 }, C, -Math.PI / 3, (2 * Math.PI) / 3, 64), { color: palette.SIGNAL, span: 1 });
  const lensB = pen(arcStrokes({ x: C, y: 0 }, C, (2 * Math.PI) / 3, (2 * Math.PI) / 3, 64), { color: palette.SIGNAL, span: 1 });

  const applySpheres = (group, e, gain, walk, master) => group.forEach((p, k) => {
    const s = e.spheres[k];
    const w = walk.spheres[k];
    const heat = s.id === 'natura' ? e.heart : s.id === 'knowing' ? e.crown : 0;
    // within each sphere: its own flicker, riding the whole tree's breath
    const flicker = 0.7 + 0.3 * s.within;
    set(p.m, { draw: s.draw, opacity: s.opacity * gain * flicker * w.gain, lift: e.split, burn: Math.max(0.25, heat, w.heat) }, master);
  });
  const applyRoute = (pens, walk, e, master) => pens.forEach((p, k) => set(p.m, { ...walk.paths[k], lift: e.split, burn: 1 }, master));

  return {
    apply(e, master) {
      column.forEach((c, k) => set(c.m, { draw: Math.min(1, Math.max(0, e.column.draw * 1.6 - k * 0.15)), opacity: e.column.opacity }, master));
      applySpheres(lightSpheres, e, e.trees.light, e.walk[1], master);
      applySpheres(darkSpheres, e, e.trees.dark, e.walk[-1], master);
      applyRoute(lightRoute, e.walk[1], e, master);
      applyRoute(darkRoute, e.walk[-1], e, master);
      set(lightPaths.m, { draw: e.paths.draw, opacity: 0.6 * e.trees.light, lift: e.split, flow: e.trees.flow }, master);
      set(darkPaths.m, { draw: e.paths.draw, opacity: 0.6 * e.trees.dark, lift: e.split, flow: e.trees.flow }, master);
      set(breathAxes.m, { draw: e.breaths.draw, opacity: e.breaths.opacity, lift: e.split, flow: e.trees.flow, burn: 0.5 }, master);
      set(lightChannels.m, { draw: e.channels.draw, opacity: 0.1 * e.trees.light, lift: e.split }, master);
      set(darkChannels.m, { draw: e.channels.draw, opacity: 0.1 * e.trees.dark, lift: e.split }, master);
      set(cross.m, { draw: e.channels.draw, opacity: 0.07 * (e.trees.light + e.trees.dark), lift: e.split }, master);
      set(holding.m, { draw: e.offering.circle, opacity: 0.7 }, master);
      set(other.m, { draw: e.offering.vesica, opacity: 0.8 }, master);
      set(lensA.m, { opacity: e.offering.vesica >= 1 ? 1 : 0, burn: 1 }, master);
      set(lensB.m, { opacity: e.offering.vesica >= 1 ? 1 : 0, burn: 1 }, master);
    },
  };
};
