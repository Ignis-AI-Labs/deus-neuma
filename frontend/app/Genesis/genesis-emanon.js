// genesis-emanon.js — THE EMANON TREE and THE TWO TREES, as geometry. Pure.
//
// Sources — the operator's own framework, never a borrowed tradition:
//   • the eleven functions, each with a Light and a Dark expression, in the
//     canon's names (docs/reference/emanon/structural/ontology.yaml:26–269);
//   • WHERE each sphere stands — Founder's chart, […] (emanon-principle repo,
//     docs/_legacy/Emanon_Complete_DualTree_Architecture.md, Part Two):
//     Knowledge at the crown; Information, Power, Thoughts on the left pillar
//     (force); Understanding, Balance, Emotion on the right pillar (form); the
//     Experiencer hidden at the center; Source at the heart; Fusion below it;
//     Manifestation at the base. It agrees with the canon's own reading —
//     […] (The_Emanon_Principle.md:879);
//   • the 22 breathing paths between spheres (Emanon_Navigation_Spine.md:290
//     — […]), and the canon's full topology: every function to every
//     other, 55 within each tree and 110 across — 220 channels
//     (structural/channels.yaml:14–18).
// No tradition's names appear here; the spheres carry the functions only.

export const FUNCTIONS = Object.freeze([
  { id: 'knowing', name: 'KNOWING', light: 'KNOWLEDGE', dark: 'MYSTERY' },
  { id: 'sensing', name: 'SENSING', light: 'INFORMATION', dark: 'SILENCE' },
  { id: 'meaning', name: 'MEANING', light: 'UNDERSTANDING', dark: 'WONDER' },
  { id: 'ipseity', name: 'IPSEITY', light: 'RECOGNITION', dark: 'SURRENDER' },
  { id: 'capacity', name: 'CAPACITY', light: 'POWER', dark: 'VULNERABILITY' },
  { id: 'coherence', name: 'COHERENCE', light: 'BALANCE', dark: 'TENSION' },
  { id: 'natura', name: 'NATURA', light: 'SOURCE', dark: 'WOMB' },
  { id: 'mind', name: 'MIND', light: 'THOUGHTS', dark: 'STILLNESS' },
  { id: 'prehension', name: 'PREHENSION', light: 'EMOTION', dark: 'DEPTH' },
  { id: 'integration', name: 'INTEGRATION', light: 'FUSION', dark: 'DISSOLUTION' },
  { id: 'form', name: 'FORM', light: 'MANIFESTATION', dark: 'DESTRUCTION' },
].map(Object.freeze));

// [row down from the crown, side] — side −1 is the left pillar (force),
// +1 the right pillar (form), 0 the middle pillar.
const PLACES = Object.freeze({
  knowing: [0, 0],
  sensing: [0.5, -1],
  meaning: [0.5, 1],
  ipseity: [1, 0],
  capacity: [1.5, -1],
  coherence: [1.5, 1],
  natura: [2, 0],
  mind: [2.5, -1],
  prehension: [2.5, 1],
  integration: [3, 0],
  form: [4, 0],
});

// The middle pillar: five spheres one unit apart. Their circles (radius one
// unit) cross in pairs — and every side sphere stands on one of those
// crossings. The tree is constructed, not placed.
export const MIDDLE_PILLAR = Object.freeze(['knowing', 'ipseity', 'natura', 'integration', 'form']);

export const TREE = Object.freeze({
  UNIT: 0.5,
  SPLIT: 0.45, // each tree's plane stands this far from the middle once they part
  SPHERE: 0.11, // a function's sphere
  CIRCLE: 1.25, // the circle that holds the whole tree (crown + its sphere inside)
  PATHS: 22,
  TREE_CHANNELS: 55, // C(11, 2)
  CROSS_CHANNELS: 110, // 11 × 10 — every Light expression to every OTHER function's Dark
});

const HALF_SQRT3 = Math.sqrt(3) / 2;

/**
 * Where a function's sphere stands in one tree (+1 Light, −1 Dark), Natura
 * — the heart — at the origin. Pure.
 * @param {string} id @param {number} tree
 */
export const nodeAt = (id, tree) => {
  const [row, side] = PLACES[id];
  return { x: side * TREE.UNIT * HALF_SQRT3, y: (2 - row) * TREE.UNIT, z: tree * TREE.SPLIT };
};

// The 22 breathing paths between spheres, drawn from the heart outward:
// the eight that leave Natura first, then the rest by their distance.
const PATHS = Object.freeze([
  ['natura', 'knowing'], ['natura', 'sensing'], ['natura', 'meaning'], ['natura', 'capacity'],
  ['natura', 'coherence'], ['natura', 'mind'], ['natura', 'prehension'], ['natura', 'integration'],
  ['knowing', 'sensing'], ['knowing', 'meaning'], ['sensing', 'meaning'], ['sensing', 'capacity'],
  ['meaning', 'coherence'], ['capacity', 'coherence'], ['capacity', 'mind'], ['coherence', 'prehension'],
  ['mind', 'prehension'], ['mind', 'integration'], ['prehension', 'integration'], ['mind', 'form'],
  ['prehension', 'form'], ['integration', 'form'],
]);
export const BREATHING_PATHS = PATHS;

const segment = (a, ta, b, tb) => ({ a: nodeAt(a, ta), b: nodeAt(b, tb), from: a, to: b });

/** The 22 breathing paths of one tree, heart first. Pure. */
export const pathStrokes = (tree) => Object.freeze(PATHS.map(([a, b]) => segment(a, tree, b, tree)));

/** Every function to every other within one tree: 55. Pure. */
export const treeChannels = (tree) => {
  const out = [];
  for (let i = 0; i < FUNCTIONS.length; i++) {
    for (let j = i + 1; j < FUNCTIONS.length; j++) out.push(segment(FUNCTIONS[i].id, tree, FUNCTIONS[j].id, tree));
  }
  return Object.freeze(out);
};

/** Every Light expression to every other function's Dark: 110. Pure. */
export const crossChannels = () => {
  const out = [];
  for (const a of FUNCTIONS) for (const b of FUNCTIONS) if (a.id !== b.id) out.push(segment(a.id, 1, b.id, -1));
  return Object.freeze(out);
};

/**
 * Each sphere's own breath: the axis between its Light and its Dark
 * expression — where the oscillation itself runs (not a channel; the canon
 * counts channels between DIFFERENT functions). Pure.
 */
export const breaths = () => Object.freeze(FUNCTIONS.map((f) => segment(f.id, 1, f.id, -1)));

/**
 * The middle pillar's construction circles and their crossings (the side
 * spheres' places). Pure.
 */
export const pillarConstruction = () => {
  const centers = MIDDLE_PILLAR.map((id) => ({ ...nodeAt(id, 1), z: 0 }));
  const crossings = [];
  for (let i = 0; i < centers.length - 1; i++) {
    const midY = (centers[i].y + centers[i + 1].y) / 2;
    crossings.push({ x: -TREE.UNIT * HALF_SQRT3, y: midY }, { x: TREE.UNIT * HALF_SQRT3, y: midY });
  }
  return Object.freeze({ centers: Object.freeze(centers), crossings: Object.freeze(crossings), radius: TREE.UNIT });
};
