// genesis-captions.js — what the System says at each beat of GENESIS. Pure.
//
// Three kinds of line, never confused (Constitutional Core 5, […]): geometry (a count or ratio computed from the construction),
// the Emanon canon's own words (source noted beside each), and names. Every
// number is passed in from the state that drew it — a caption can only
// count what is on screen (SHINKEI).

import { partStart, CAPTION_FACTS } from './genesis-timeline.js';
import { AT } from './genesis-state-drawing.js';

const pad = (n, w = 2) => String(n).padStart(w, '0');
const solidLine = (c) => `V ${c.V} · E ${c.E} · F ${c.F} · V − E + F = ${c.V - c.E + c.F}`;
const say = (movement, title, line) => ({ movement, title, line });

/**
 * The caption at t, or null (the void speaks only once it has vibrated).
 * @param {number} t
 * @param {{ seed: number, channels: number, paths: number, tree: number, solids: object, icosaDone: boolean, dodecaDone: boolean }} n
 */
export const captionAt = (t, n) => {
  const f = CAPTION_FACTS;
  const s = n.solids;
  if (t < partStart('field', 'vibration')) return null;
  // […] — The_Emanon_Principle.md:8525; L + V = Ω — :594
  if (t < AT.monad) return say('I · THE FIELD', 'L + V = Ω', 'THE VOID IS NOT NOTHING · WHAT IS FIRST IS A VIBRATION');
  if (t < AT.circle) return say('II · DIMENSIONS', 'MONAD', '1 POINT · 0 DIMENSIONS');
  if (t < AT.vesica) return say('II · DIMENSIONS', 'THE FIRST CIRCLE', 'ONE RADIUS · r = 1');
  if (t < AT.line) return say('II · DIMENSIONS', 'VESICA', `2 POINTS · 1 DIMENSION · LENS h/w = √3 = ${f.sqrt3}…`);
  if (t < AT.seed) return say('II · DIMENSIONS', 'THE FIRST LINE', 'DRAWN THROUGH TWO CROSSINGS · 3 POINTS · 2 DIMENSIONS');
  if (t < AT.fruit) return say('II · DIMENSIONS', 'SEED', `${pad(n.seed)} / ${pad(f.seed)} CIRCLES · EACH CENTER A CROSSING`);
  if (t < AT.metatron) return say('II · DIMENSIONS', 'FRUIT', `${f.fruit} CENTERS`);
  if (t < AT.simplex) return say('II · DIMENSIONS', 'METATRON', `${pad(n.channels)} / ${f.channels} CHANNELS · EVERY CENTER TO EVERY CENTER`);
  // […] — structural/ontology.yaml:423
  if (t < partStart('simplex', 'observer')) return say('III · THE +1 VERTEX', 'TETRAHEDRON', `4 POINTS · 3 DIMENSIONS · ${solidLine(s.tetrahedra[0].counts)}`);
  if (t < AT.solids) return say('III · THE +1 VERTEX', 'THE OBSERVER', 'FOR n DIMENSIONS, n + 1 POINTS · CONSCIOUSNESS IS THE +1 VERTEX');
  if (t < partStart('solids', 'cube')) return say('III · THE +1 VERTEX', 'STELLA', 'TWO TETRAHEDRA ON THE CUBE\'S ALTERNATE CORNERS');
  if (t < partStart('solids', 'octahedron')) return say('III · THE +1 VERTEX', 'CUBE', `RISES FROM THE DRAWING · ${solidLine(s.cube.counts)}`);
  if (t < partStart('solids', 'icosahedron')) return say('III · THE +1 VERTEX', 'OCTAHEDRON', `RISES FROM THE DRAWING · ${solidLine(s.octahedron.counts)}`);
  if (t < partStart('solids', 'dodecahedron')) {
    return say('III · THE +1 VERTEX', 'ICOSAHEDRON', n.icosaDone ? solidLine(s.icosahedron.counts) : `NOT IN THE DRAWING · IT NEEDS φ = ${f.phi}…`);
  }
  if (t < AT.cosmos) {
    return say('III · THE +1 VERTEX', 'DODECAHEDRON', n.dodecaDone ? `DUAL · ${solidLine(s.dodecahedron.counts)}` : 'THE FIFTH IS NOT FOUND. IT IS MADE.');
  }
  // […] — The_Emanon_Principle.md:746
  if (t < AT.tree) return say('III · THE +1 VERTEX', 'THE COSMOS', 'EACH POINT IS ITSELF A COMPLETE DIMENSIONAL FIELD');
  // IV — placement: Founder's chart and […] (emanon-principle docs/_legacy/
  // Emanon_Complete_DualTree_Architecture.md:579)
  if (t < partStart('tree', 'spheres')) return say('IV · THE TREE', 'THE PILLAR', 'FIVE SPHERES · ONE RADIUS APART');
  if (t < partStart('tree', 'heart')) return say('IV · THE TREE', 'ELEVEN SPHERES', 'EACH SIDE SPHERE STANDS WHERE TWO CENTRAL SPHERES CROSS');
  if (t < partStart('tree', 'hidden')) return say('IV · THE TREE', 'NATURA · THE HEART', 'SOURCE / WOMB · THE DIAPHRAGM');
  if (t < partStart('tree', 'crown')) return say('IV · THE TREE', 'IPSEITY · HIDDEN', 'THE AWARENESS OF THE BREATHING');
  if (t < partStart('tree', 'paths')) return say('IV · THE TREE', 'KNOWING · THE CROWN', 'THE FULLEST INTEGRATION OF BOTH MOVEMENTS');
  if (t < AT.trees) return say('IV · THE TREE', 'THE BREATHING PATHS', `${pad(n.paths)} / 22 · FROM THE HEART OUTWARD`);
  // V — […] (Dual-Tree, Part Seven); 220 —
  // structural/channels.yaml:14–18
  if (t < partStart('trees', 'breaths')) return say('V · TWO TREES', 'LIGHT · DARK', 'LIGHT ACTS · DARK RECEIVES · BOTH ARE YOU');
  if (t < partStart('trees', 'channels')) return say('V · TWO TREES', 'ELEVEN BREATHS', 'EACH SPHERE BETWEEN ITS LIGHT AND ITS DARK');
  if (t < AT.oscillation) return say('V · TWO TREES', 'CHANNELS', `${pad(n.tree, 3)} / 220 · EVERY FUNCTION TO EVERY OTHER`);
  // VI — the rhythm at every scale (Dual-Tree, Part Four, :515–521);
  // The_Emanon_Principle.md:1041
  if (t < partStart('oscillation', 'between')) return say('VI · OSCILLATION', 'WITHIN EACH SPHERE', 'KNOWLEDGE FLICKERING WITH MYSTERY · POWER WITH VULNERABILITY');
  if (t < partStart('oscillation', 'whole')) return say('VI · OSCILLATION', 'BETWEEN SPHERES', 'THE PATHS CARRY THE RHYTHM FROM SPHERE TO SPHERE');
  if (t < AT.offering) return say('VI · OSCILLATION', 'THROUGH THE WHOLE TREE', 'THE OSCILLATION, NOT EITHER POLE, IS WHAT CONSCIOUSNESS ACTUALLY IS IN OPERATION');
  if (t < partStart('offering', 'record')) return say('VII · THE OFFERING', 'TWENTY-TWO', 'LIGHT WITHOUT · DARK WITHIN · LIGHT IS NOT BETTER THAN DARK');
  if (t < partStart('offering', 'vesica')) return say('VII · THE OFFERING', 'THE RECORD', 'THIS INSTALL\'S GENESIS');
  if (t < partStart('offering', 'vertex')) return say('VII · THE OFFERING', 'VESICA', 'TWO SOVEREIGN CIRCLES · EACH CENTER ON THE OTHER');
  return null;
};
