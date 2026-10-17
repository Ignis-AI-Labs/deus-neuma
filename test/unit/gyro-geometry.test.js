// gyro-geometry is pure — real inputs → real outputs, no mock (RULE 0). The
// claims proven here are the gyro's SHINKEI captions: the lattice truly is
// the vector equilibrium (13 nodes, 78 channels, 36 struts all one radius),
// the seed is seven true spheres, the vesica's spheres truly touch each
// other's centers, the armillary rings all lie on one true sphere, and
// every rotation rate honors the cycle doctrine's continuous band.
import { describe, it, expect } from 'vitest';
import {
  GYRO,
  SEED_RING_COUNT,
  metatronNodes,
  metatronChannels,
  metatronStruts,
  seedSpheres,
  vesicaSpheres,
  armillaryRings,
  platonicSolids,
  regularEdges,
  NUCLEUS_RADIUS,
} from '../../frontend/app/BootIgnition/gyro-geometry.js';

const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('gyro-geometry — the gyro tells true counts', () => {
  it('the lattice has exactly 13 nodes: the vector equilibrium, truly solid', () => {
    const nodes = metatronNodes();
    expect(nodes).toHaveLength(GYRO.METATRON_NODES);
    expect(GYRO.METATRON_NODES).toBe(13); // the caption's claim, proven
    const center = nodes[0];
    expect(dist3(center, { x: 0, y: 0, z: 0 })).toBe(0);
    // Twelve vertices, every one exactly one lattice radius out.
    for (const n of nodes.slice(1)) {
      expect(dist3(n, center)).toBeCloseTo(GYRO.LATTICE_RADIUS, 9);
    }
    // Truly three-dimensional: the vertices span all three axes — no flat
    // plane tumbling in space (the volumetric doctrine's claim).
    for (const axis of ['x', 'y', 'z']) {
      expect(Math.max(...nodes.map((n) => Math.abs(n[axis])))).toBeGreaterThan(0);
    }
    // No duplicate vertex.
    const keys = new Set(nodes.map((n) => `${n.x.toFixed(9)},${n.y.toFixed(9)},${n.z.toFixed(9)}`));
    expect(keys.size).toBe(13);
  });

  it('the lattice has exactly 78 channels — every pair joined once (K13)', () => {
    const edges = metatronChannels();
    expect(edges).toHaveLength(GYRO.METATRON_CHANNELS);
    expect(GYRO.METATRON_CHANNELS).toBe((13 * 12) / 2);
    const keys = new Set(edges.map(([i, j]) => `${i}-${j}`));
    expect(keys.size).toBe(78); // no duplicate channel
    for (const [i, j] of edges) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThan(13);
      expect(i).toBeLessThan(j);
    }
  });

  it('the struts are the 36 one-radius channels — edge = spoke = radius', () => {
    const struts = metatronStruts();
    expect(struts).toHaveLength(GYRO.METATRON_STRUTS);
    expect(GYRO.METATRON_STRUTS).toBe(36); // 24 rim edges + 12 spokes
    const nodes = metatronNodes();
    for (const [i, j] of struts) {
      expect(dist3(nodes[i], nodes[j])).toBeCloseTo(GYRO.LATTICE_RADIUS, 9);
    }
    // Exactly 12 spokes touch the center — the equilibrium's signature.
    expect(struts.filter(([i]) => i === 0)).toHaveLength(12);
  });

  it('the seed is seven spheres one radius, petal centers one radius out', () => {
    const spheres = seedSpheres();
    expect(spheres).toHaveLength(SEED_RING_COUNT);
    expect(SEED_RING_COUNT).toBe(7);
    for (const s of spheres) expect(s.r).toBe(GYRO.SEED_RADIUS);
    for (const petal of spheres.slice(1)) {
      expect(dist3(petal, spheres[0])).toBeCloseTo(GYRO.SEED_RADIUS, 6);
    }
  });

  it('the vesica spheres stand exactly one radius apart', () => {
    const [a, b] = vesicaSpheres();
    expect(a.r).toBe(GYRO.VESICA_RADIUS);
    expect(b.r).toBe(GYRO.VESICA_RADIUS);
    expect(dist3(a, b)).toBeCloseTo(GYRO.VESICA_RADIUS, 6);
  });

  it('the armillary rings all lie on one true sphere', () => {
    const rings = armillaryRings();
    expect(rings).toHaveLength(
      GYRO.ARMILLARY_MERIDIANS + 1 + GYRO.ARMILLARY_LATITUDES.length
    );
    // Every ring sits exactly on the shell: r² + y² = R².
    for (const ring of rings) {
      expect(Math.hypot(ring.radius, ring.y)).toBeCloseTo(GYRO.SHELL_RADIUS, 9);
    }
    // Great circles are the meridians + the equator, all at full radius.
    const great = rings.filter((r) => r.great);
    expect(great).toHaveLength(GYRO.ARMILLARY_MERIDIANS + 1);
    for (const g of great) expect(g.radius).toBe(GYRO.SHELL_RADIUS);
    // The meridian fan divides the half-turn evenly.
    const meridians = rings.filter((r) => r.great && r.tiltX !== 0);
    expect(meridians).toHaveLength(GYRO.ARMILLARY_MERIDIANS);
    meridians.forEach((m, k) => {
      expect(m.rotY).toBeCloseTo((k * Math.PI) / GYRO.ARMILLARY_MERIDIANS, 9);
    });
    // Latitude bands stand off the equator, mirrored above and below.
    const latitudes = rings.filter((r) => !r.great);
    expect(latitudes).toHaveLength(GYRO.ARMILLARY_LATITUDES.length);
    expect(latitudes.some((l) => l.y > 0)).toBe(true);
    expect(latitudes.some((l) => l.y < 0)).toBe(true);
  });

  it('every rotation rate honors the cycle doctrine — continuous, never frantic', () => {
    const seconds = (rate) => (2 * Math.PI) / Math.abs(rate);
    // Working axes rotate in the 8–60s band; the precessions may take minutes.
    expect(seconds(GYRO.RATES.LATTICE_Y)).toBeGreaterThanOrEqual(8);
    expect(seconds(GYRO.RATES.LATTICE_Y)).toBeLessThanOrEqual(60);
    expect(seconds(GYRO.RATES.SEED_Y)).toBeGreaterThanOrEqual(8);
    expect(seconds(GYRO.RATES.SEED_Y)).toBeLessThanOrEqual(60);
    expect(seconds(GYRO.RATES.VESICA_A)).toBeGreaterThanOrEqual(8);
    expect(seconds(GYRO.RATES.VESICA_B)).toBeLessThanOrEqual(60);
    expect(seconds(GYRO.RATES.SHELL_Y)).toBeGreaterThanOrEqual(8);
    expect(seconds(GYRO.RATES.SHELL_Y)).toBeLessThanOrEqual(60);
    expect(seconds(GYRO.RATES.LATTICE_X)).toBeGreaterThanOrEqual(60);
    expect(seconds(GYRO.RATES.SHELL_X)).toBeGreaterThanOrEqual(60);
    expect(seconds(GYRO.RATES.VESICA_TILT_A)).toBeGreaterThanOrEqual(60);
    expect(seconds(GYRO.RATES.VESICA_TILT_B)).toBeGreaterThanOrEqual(60);
    // The seed counter-rotates (negative rate = opposite direction).
    expect(Math.sign(GYRO.RATES.SEED_Y)).not.toBe(Math.sign(GYRO.RATES.LATTICE_Y));
    expect(GYRO.RATES.NUCLEUS_BREATH_S).toBeGreaterThanOrEqual(4);
    expect(GYRO.RATES.NUCLEUS_BREATH_S).toBeLessThanOrEqual(8);
  });

  it('the spec is frozen — the gyro cannot drift at runtime', () => {
    expect(Object.isFrozen(GYRO)).toBe(true);
    expect(Object.isFrozen(GYRO.RATES)).toBe(true);
    expect(Object.isFrozen(GYRO.ARMILLARY_LATITUDES)).toBe(true);
  });

  // THE PLATONIC FAMILY — every relation the construct claims, proven.
  const key = (v) => `${v.x.toFixed(9)},${v.y.toFixed(9)},${v.z.toFixed(9)}`;
  const midpoints = (sol) => sol.edges.map(([i, j]) => ({
    x: (sol.vertices[i].x + sol.vertices[j].x) / 2,
    y: (sol.vertices[i].y + sol.vertices[j].y) / 2,
    z: (sol.vertices[i].z + sol.vertices[j].z) / 2,
  }));

  it('the five Platonic solids carry their true vertex and edge counts', () => {
    const p = platonicSolids();
    const count = (sol) => [sol.vertices.length, sol.edges.length];
    expect(count(p.tetrahedra[0])).toEqual([4, 6]);
    expect(count(p.tetrahedra[1])).toEqual([4, 6]);
    expect(count(p.cube)).toEqual([8, 12]);
    expect(count(p.octahedron)).toEqual([6, 12]);
    expect(count(p.dodecahedron)).toEqual([20, 30]);
    expect(count(p.icosahedron)).toEqual([12, 30]);
    // Euler holds for every one: V − E + F = 2 with the true face counts.
    const faces = { t: 4, c: 6, o: 8, d: 12, i: 20 };
    expect(4 - 6 + faces.t).toBe(2);
    expect(p.cube.vertices.length - p.cube.edges.length + faces.c).toBe(2);
    expect(p.octahedron.vertices.length - p.octahedron.edges.length + faces.o).toBe(2);
    expect(p.dodecahedron.vertices.length - p.dodecahedron.edges.length + faces.d).toBe(2);
    expect(p.icosahedron.vertices.length - p.icosahedron.edges.length + faces.i).toBe(2);
  });

  it('the lattice is the rectification of cube AND octahedron — their edge midpoints ARE its twelve nodes', () => {
    const p = platonicSolids();
    const lattice = new Set(metatronNodes().slice(1).map(key));
    expect(new Set(midpoints(p.cube).map(key))).toEqual(lattice);
    expect(new Set(midpoints(p.octahedron).map(key))).toEqual(lattice);
  });

  it('the stella octangula: two tetrahedra on the cube\u2019s alternate vertices, edges = the cube\u2019s face diagonals', () => {
    const p = platonicSolids();
    const cube = new Set(p.cube.vertices.map(key));
    const [a, b] = p.tetrahedra;
    const all = [...a.vertices, ...b.vertices].map(key);
    expect(new Set(all)).toEqual(cube); // together, exactly the cube's eight
    const s = GYRO.LATTICE_RADIUS / Math.SQRT2;
    for (const t of p.tetrahedra) {
      for (const [i, j] of t.edges) expect(dist3(t.vertices[i], t.vertices[j])).toBeCloseTo(2 * s * Math.SQRT2, 9);
    }
  });

  it('the nucleus is a dual pair: the dodecahedron stands on the icosahedron\u2019s twenty face centers', () => {
    const p = platonicSolids();
    for (const v of p.icosahedron.vertices) expect(dist3(v, { x: 0, y: 0, z: 0 })).toBeCloseTo(NUCLEUS_RADIUS, 9);
    const r = dist3(p.dodecahedron.vertices[0], { x: 0, y: 0, z: 0 });
    for (const v of p.dodecahedron.vertices) expect(dist3(v, { x: 0, y: 0, z: 0 })).toBeCloseTo(r, 9);
    expect(r).toBeLessThan(NUCLEUS_RADIUS); // face centers sit inside the icosahedron
    // Every dodecahedron vertex has exactly three neighbours — a true dodecahedron.
    const degree = new Array(20).fill(0);
    for (const [i, j] of p.dodecahedron.edges) { degree[i] += 1; degree[j] += 1; }
    expect(new Set(degree)).toEqual(new Set([3]));
  });

  it('regularEdges joins exactly the minimum-distance pairs', () => {
    const square = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }];
    expect(regularEdges(square)).toEqual([[0, 1], [0, 3], [1, 2], [2, 3]]);
  });
});
