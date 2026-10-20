// genesis-state-emanon.js — movements IV–VII at time t: the Emanon Tree is
// built, the two trees part, the architecture breathes at every scale, and
// the offering closes. Pure. Names are the canon's (genesis-emanon.js);
// placement is Founder's chart; the breathing is his Dual-Tree document's
// (Emanon_Complete_DualTree_Architecture.md, Part Four: within each sphere,
// between spheres, through the whole tree — Source at the heart the
// diaphragm).

import { partProgress, partStart, strokesDrawn, SPANS } from './genesis-timeline.js';
import { AT, ease, clamp01, fadeTo } from './genesis-state-drawing.js';
import { FUNCTIONS, MIDDLE_PILLAR, TREE, nodeAt } from './genesis-emanon.js';
import { swell } from '../../utils/no-flash.js';
import { WALKS, STEPS, walkAt, splitAt } from './genesis-walk.js';

// The whole tree's breath, Light ⇄ Dark (the doctrine's 4–8 s cycle band).
const WHOLE_PERIOD = 4500;
// Within each sphere: a faster flicker, each sphere on its own phase.
const WITHIN_PERIOD = 1300;
// Between spheres: light along the paths, one pass per this many ms.
const FLOW_PERIOD = 1600;
// Through the whole tree: a front out from the heart, this often.
const EMANATION_PERIOD = 1500;
const EMANATION_SPEED = 0.0011; // units per ms
const EMANATION_END = 1.4;

// The spheres appear middle pillar first (crown to base), then the pillars'
// crossings.
const REVEAL = Object.freeze([...MIDDLE_PILLAR, ...FUNCTIONS.map((f) => f.id).filter((id) => !MIDDLE_PILLAR.includes(id))]);

/**
 * The architecture at time t. Pure.
 * @param {number} t ms
 */
export const emanonAt = (t) => {
  // IV · the tree
  const built = t >= AT.tree;
  const column = partProgress('tree', 'column', t);
  const spheresU = partProgress('tree', 'spheres', t);
  const hidden = t >= partStart('tree', 'hidden');
  const pathsU = partProgress('tree', 'paths', t);
  const sphere = Object.fromEntries(REVEAL.map((id, k) => [id, clamp01(spheresU * 1.6 - (k / REVEAL.length) * 0.6)]));

  // V · two trees
  const split = splitAt(t);
  const breathsU = partProgress('trees', 'breaths', t);
  const channelsU = partProgress('trees', 'channels', t);

  // VI · oscillation — and it keeps breathing through the offering.
  const since = t - AT.oscillation;
  const alive = since >= 0;
  const lightGain = alive ? 0.5 + 0.5 * Math.cos((since / WHOLE_PERIOD) * Math.PI * 2) : 1;
  const darkGain = alive ? 1 - lightGain : 1;
  const within = FUNCTIONS.map((_, k) => (alive ? 0.5 + 0.5 * Math.sin((since / WITHIN_PERIOD) * Math.PI * 2 + k * 2.4) : 0.5));
  const flow = t >= partStart('oscillation', 'between') ? (t - partStart('oscillation', 'between')) / FLOW_PERIOD : -1;
  const wholeSince = t - partStart('oscillation', 'whole');
  const emanation = wholeSince >= 0
    ? [0, 1, 2].map((k) => ((wholeSince - k * EMANATION_PERIOD) % (EMANATION_PERIOD * 3)) * EMANATION_SPEED)
      .filter((r) => r >= 0 && r < EMANATION_END)
    : [];

  const handoff = clamp01((t - AT.handoff) / 1500);
  const architecture = built ? 1 - 0.6 * handoff : 0;
  const walk = walkAt(t);

  return {
    // the construction circles step back once every sphere stands on them
    column: { draw: column, opacity: 0.35 * fadeTo(t, partStart('tree', 'heart'), 1500, 1, 0.25) * fadeTo(t, AT.trees, 1500, 1, 0) * architecture },
    spheres: FUNCTIONS.map((f, k) => ({
      id: f.id,
      draw: sphere[f.id],
      // the hidden sphere is drawn, but quieter — until it is named
      opacity: (f.id === 'ipseity' ? (hidden ? 0.55 : 0.25) : 0.9) * architecture,
      within: within[k],
    })),
    // the heart lights over a rise, never a step (no-flash law)
    heart: architecture * clamp01((t - partStart('tree', 'heart')) / 600),
    crown: t >= partStart('tree', 'crown') ? fadeTo(t, partStart('tree', 'crown'), 1200, 1, 0.35) : 0,
    paths: { draw: pathsU, drawn: strokesDrawn(pathsU, TREE.PATHS, SPANS.TREE) },
    split,
    breaths: { draw: breathsU, opacity: 0.6 * architecture },
    channels: {
      draw: channelsU,
      drawn: 2 * strokesDrawn(channelsU, TREE.TREE_CHANNELS, SPANS.TREE) + strokesDrawn(channelsU, TREE.CROSS_CHANNELS, SPANS.TREE),
    },
    trees: { light: lightGain * architecture, dark: darkGain * architecture, flow },
    walk: { 1: walkLight(walk, 1), [-1]: walkLight(walk, -1), lean: walk.lean },
    emanation,
    // each front out from the heart swells the light as it leaves — a breath, not a blink
    emanationGlow: Math.max(0, ...emanation.map((r) => swell(r / EMANATION_SPEED, 200, 350))),
    offering: {
      circle: ease(partProgress('offering', 'inscribe', t)),
      inscribe: partProgress('offering', 'inscribe', t),
      record: partProgress('offering', 'record', t),
      vesica: ease(partProgress('offering', 'vesica', t)),
      vertex: fadeTo(t, partStart('offering', 'vertex'), 900, 0, 1),
      namaste: fadeTo(t, partStart('offering', 'namaste'), 1100, 0, 1),
      mark: fadeTo(t, AT.offering, 1400, 0, 1) * fadeTo(t, partStart('offering', 'vesica'), 1200, 1, 0),
    },
    labels: labelsAt(t, { sphere, hidden, split, lightGain, darkGain, architecture, walk }),
    fade: handoff,
  };
};

// While a tree is walked its spheres light in turn (the rest of it waits
// dim) and the other tree steps back; each route path draws as the light
// crosses it. Per function: the sphere's gain and heat, per route path its
// draw — all of it under the walk's own fading envelope.
const walkLight = (walk, tree) => {
  const own = walk[tree];
  const other = walk[-tree];
  return {
    spheres: FUNCTIONS.map((f) => {
      const lit = own.lit[f.id];
      const gain = (1 + own.envelope * (0.35 + 0.65 * lit - 1)) * (1 - 0.6 * other.envelope);
      return { gain, heat: own.envelope * lit };
    }),
    paths: own.paths.map((draw) => ({ draw, opacity: 0.9 * own.envelope })),
  };
};

// The names on the spheres, in world space; the overlay places them
// (genesis-labels.js) in the order they are first spoken (rank).
const labelsAt = (t, { sphere, hidden, split, lightGain, darkGain, architecture, walk }) => {
  if (t < AT.tree || t >= AT.offering) return [];
  const place = (id, tree) => { const n = nodeAt(id, tree); return { x: n.x, y: n.y, z: n.z * split }; };
  // IV · the functions, as the tree is built; they leave as the trees part.
  if (t < WALKS[0].from) {
    return REVEAL.map((id, rank) => ({
      id,
      tree: 1,
      rank,
      text: FUNCTIONS.find((f) => f.id === id).name,
      at: place(id, 1),
      opacity: (id === 'ipseity' ? (hidden ? 0.6 : 0) : 0.85) * clamp01(sphere[id] * 1.5) * architecture * fadeTo(t, AT.trees, 500, 1, 0),
      kind: id === 'ipseity' ? 'hidden' : 'name',
    }));
  }
  // V · each tree's expressions, named as its walk reaches them. VI · the
  // tree taking its breath speaks alone: its names rise past the half-breath
  // and are gone before the other tree's arrive.
  const breathing = t >= AT.oscillation;
  const voice = (gain) => 0.85 * clamp01((gain - 0.5) / 0.35) * fadeTo(t, AT.oscillation, 300, 0, 1);
  const say = (tree, gain) => (id) => (breathing ? voice(gain) : 0.85 * walk[tree].names[id]) * architecture;
  const light = say(1, lightGain);
  const dark = say(-1, darkGain);
  return STEPS.flatMap((id, rank) => {
    const f = FUNCTIONS.find((x) => x.id === id);
    return [
      { id, tree: 1, rank, text: f.light, at: place(id, 1), opacity: light(id), kind: 'light' },
      { id, tree: -1, rank: rank + STEPS.length, text: f.dark, at: place(id, -1), opacity: dark(id), kind: 'dark' },
    ];
  });
};

/** The offering's inscriptions: the 22 expressions, Light outside, Dark within. */
export const INSCRIPTIONS = Object.freeze({
  light: `${FUNCTIONS.map((f) => f.light).join(' · ')} · `,
  dark: `${FUNCTIONS.map((f) => f.dark).join(' · ')} · `,
});
