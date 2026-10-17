// armillary-geometry.js — THE ARMILLARY in three dimensions: the Deus Neuma
// logo as the object it draws, and the sacred figures that truly belong to
// it. Pure.
//
// The logo (docs/design/logo/neuma/build.py, a 100-unit canvas) is a picture
// of an armillary sphere: a meridian ring r30 seen face-on, an equator seen
// from just above (rx30 ry8), a steel axis tilted 23.44° (Earth's true tilt,
// leaning upper-left) reaching 44 units to its poles, and a core r3.4. Built
// in 3D at the meridian's radius = 1, and seen from asin(8/30) above the
// equator, the object projects to the logo — and can turn, because it is real.
//
// The figures are not ornament; each is a construction the armillary already
// holds (SHINKEI — true counts, true relations):
//   THE OCTAHEDRON   its six vertices ARE the armillary's six cardinal points —
//                    the two poles where the axis meets the sphere, and four on
//                    the equator. V 6 · E 12 · F 8.
//   THE CUBE         its dual: one vertex at each octahedron face's centre.
//                    V 8 · E 12 · F 6.
//   THE SEED         seven circles in the equator's plane, radius ½: six
//                    around one, their outer envelope exactly the equator.
//   THE NUCLEUS      icosahedron ⇄ dodecahedron, the last dual pair, held
//                    around the core.

import { platonicSolids, regularEdges, NUCLEUS_RADIUS } from '../BootIgnition/gyro-geometry.js';

const LOGO_R = 30; // the meridian, in logo units

export const AXIAL_TILT_DEG = 23.44;

/** The logo's parts in world units (meridian radius 1). */
export const ARMILLARY = Object.freeze({
  RADIUS: 1,
  RING_TUBE: 1.7 / 2 / LOGO_R, // the meridian's body weight, as a tube
  EQUATOR_TUBE: 1.8 / 2 / LOGO_R,
  AXIS_REACH: 44 / LOGO_R, // the axis's true points, past the poles
  AXIS_HALF_WIDTH: 1.3 / LOGO_R, // the spear at its widest, the still point
  CORE: 3.4 / LOGO_R,
  // seen from this far above the equator, rx30 ry8 is what the eye receives
  ELEVATION: Math.asin(8 / LOGO_R),
  NUCLEUS: 0.26, // the icosahedron's circumradius around the core
});

/** The octahedron on the armillary's cardinal points: poles on the axis (y), four on the equator. */
export const cardinalOctahedron = () => {
  const vertices = [
    { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
    { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
  ];
  return { vertices, edges: regularEdges(vertices) };
};

/** The octahedron's dual: a vertex at the centre of each of its eight faces. */
export const dualCube = () => {
  const vertices = [];
  for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) vertices.push({ x: x / 3, y: y / 3, z: z / 3 });
  return { vertices, edges: regularEdges(vertices) };
};

/** The seed of life in the equator's plane (y = 0): seven centres, one radius ½. */
export const equatorSeed = () => {
  const r = ARMILLARY.RADIUS / 2;
  const centres = [{ x: 0, y: 0, z: 0 }];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    centres.push({ x: r * Math.cos(a), y: 0, z: r * Math.sin(a) });
  }
  return { centres, radius: r };
};

/** The nucleus pair, scaled to its place around the core. */
export const nucleusPair = () => {
  const { icosahedron, dodecahedron } = platonicSolids();
  const k = ARMILLARY.NUCLEUS / NUCLEUS_RADIUS;
  const scale = ({ vertices, edges }) => ({ vertices: vertices.map((v) => ({ x: v.x * k, y: v.y * k, z: v.z * k })), edges });
  return { icosahedron: scale(icosahedron), dodecahedron: scale(dodecahedron) };
};
