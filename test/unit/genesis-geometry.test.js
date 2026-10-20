// genesis-geometry — the first-ever opening's constructions hold their true
// counts and relations. Pure: real inputs, real outputs, no mocks.
import { describe, it, expect } from 'vitest';
import {
  GENESIS, circleCrossings, seedCenters, firstVesica, fruitCenters, metatronLines, genesisSolids, genesisFamily, genesisLattice,
} from '../../frontend/app/Genesis/genesis-geometry.js';

const R = GENESIS.R;
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

describe('the seed constructs itself', () => {
  const seed = seedCenters();

  it('seven centers: the center, then six petals one radius out, 60° apart', () => {
    expect(seed).toHaveLength(7);
    for (const p of seed.slice(1)) expect(d(p, seed[0])).toBeCloseTo(R, 12);
    const angles = seed.slice(1).map((p) => Math.round((Math.atan2(p.y, p.x) * 180) / Math.PI));
    expect(angles).toEqual([90, 150, -150, -90, -30, 30]);
  });

  it('every petal after the first stands on a crossing of the center circle and the petal before it', () => {
    for (let i = 2; i < seed.length; i++) {
      const crossings = circleCrossings(seed[0], seed[i - 1], R);
      expect(crossings.some((c) => d(c, seed[i]) < 1e-12)).toBe(true);
    }
  });
});

describe('the first vesica and the first line', () => {
  it('its lens is √3 as tall as it is wide', () => {
    const v = firstVesica();
    expect(v.height / v.width).toBeCloseTo(GENESIS.VESICA_RATIO, 12);
  });

  it('its crossings are the next petals, so the triad is equilateral', () => {
    const v = firstVesica();
    const seed = seedCenters();
    for (const c of v.crossings) expect(seed.some((p) => d(p, c) < 1e-12)).toBe(true);
    expect(d(v.a, v.b)).toBeCloseTo(d(v.a, v.crossings[0]), 12);
    expect(d(v.b, v.crossings[0])).toBeCloseTo(R, 12);
  });

  it('circles too far apart do not cross', () => {
    expect(circleCrossings({ x: 0, y: 0 }, { x: 3 * R, y: 0 }, R)).toEqual([]);
  });
});

describe('fruit and Metatron', () => {
  it('13 centers on the six rays at 0, 2r, 4r', () => {
    const f = fruitCenters();
    expect(f).toHaveLength(GENESIS.FRUIT_CENTERS);
    const radii = f.map((p) => Math.round(Math.hypot(p.x, p.y) / R));
    expect(radii.filter((x) => x === 0)).toHaveLength(1);
    expect(radii.filter((x) => x === 2)).toHaveLength(6);
    expect(radii.filter((x) => x === 4)).toHaveLength(6);
  });

  it('78 lines — every pair once, shortest first', () => {
    const lines = metatronLines();
    const f = fruitCenters();
    expect(lines).toHaveLength(GENESIS.METATRON_LINES);
    expect(new Set(lines.map(([i, j]) => `${i},${j}`)).size).toBe(78);
    const lengths = lines.map(([i, j]) => d(f[i], f[j]));
    expect(lengths.every((l, k) => k === 0 || l >= lengths[k - 1] - 1e-12)).toBe(true);
  });
});

describe('the lift: solids rise out of the drawing', () => {
  const solids = genesisSolids();
  const hex = fruitCenters().slice(0, 7); // center + inner hexagon (2r)
  const onDrawing = (v) => hex.some((p) => Math.hypot(v.x - p.x, v.y - p.y) < 1e-9);

  it('every cube, octahedron and tetrahedron vertex projects onto the center or the inner hexagon', () => {
    for (const s of [solids.cube, solids.octahedron, ...solids.tetrahedra]) {
      for (const v of s.vertices) expect(onDrawing(v)).toBe(true);
    }
  });

  it('the cube stands its body diagonal on the camera axis: two vertices over the center, at ±depth', () => {
    const axial = solids.cube.vertices.filter((v) => Math.hypot(v.x, v.y) < 1e-9);
    expect(axial).toHaveLength(2);
    expect(axial[0].z).toBeCloseTo(-axial[1].z, 12);
  });

  it('the icosahedron is NOT in the hexagonal drawing — it needs φ', () => {
    expect(solids.icosahedron.enters).toBe('phi');
    expect(solids.icosahedron.vertices.some((v) => !onDrawing(v))).toBe(true);
  });

  it('true V · E · F, faces counted (not assumed), and V − E + F = 2 for all five', () => {
    const expected = { cube: [8, 12, 6], octahedron: [6, 12, 8], icosahedron: [12, 30, 20], dodecahedron: [20, 30, 12] };
    for (const [name, [V, E, F]] of Object.entries(expected)) {
      expect(solids[name].counts).toEqual({ V, E, F });
      expect(V - E + F).toBe(2);
    }
    for (const t of solids.tetrahedra) expect(t.counts).toEqual({ V: 4, E: 6, F: 4 });
    expect(solids.dodecahedron.enters).toBe('dual');
  });

  it('the lattice keeps 13 nodes and 36 struts', () => {
    const l = genesisLattice();
    expect(l.vertices).toHaveLength(13);
    expect(l.edges).toHaveLength(36);
  });
});

describe('the nest: the icosahedron inscribed in the octahedron at 1 : φ', () => {
  const f = genesisFamily();
  const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const PHI = GENESIS.PHI;
  const octa = f.octahedron;
  const octaEdges = octa.edges.map(([i, j]) => [octa.vertices[i], octa.vertices[j]]);
  const icosa = f.icosahedron;

  it('the octahedron keeps the drawing\'s solids exactly; only the dual pair moves', () => {
    const g = genesisSolids();
    expect(f.octahedron.vertices).toEqual(g.octahedron.vertices);
    expect(f.cube.vertices).toEqual(g.cube.vertices);
  });

  it('every icosahedron vertex lies on an octahedron edge, dividing it 1 : φ — one vertex per edge', () => {
    const hosts = icosa.vertices.map((p) => {
      const on = octaEdges.findIndex(([a, b]) => Math.abs(d3(a, p) + d3(p, b) - d3(a, b)) < 1e-12);
      expect(on).toBeGreaterThanOrEqual(0);
      const [a, b] = octaEdges[on];
      const [near, far] = [d3(a, p), d3(p, b)].sort((x, y) => x - y);
      expect(far / near).toBeCloseTo(PHI, 12);
      return on;
    });
    expect(new Set(hosts).size).toBe(12);
  });

  it('it is regular: 12 vertices, 30 equal edges, five at every vertex, all on one sphere', () => {
    expect(icosa.vertices).toHaveLength(12);
    expect(icosa.edges).toHaveLength(30);
    const lengths = icosa.edges.map(([i, j]) => d3(icosa.vertices[i], icosa.vertices[j]));
    lengths.forEach((l) => expect(l).toBeCloseTo(lengths[0], 12));
    const degree = icosa.vertices.map((_, k) => icosa.edges.filter((e) => e.includes(k)).length);
    expect(new Set(degree)).toEqual(new Set([5]));
    const o = { x: 0, y: 0, z: 0 };
    icosa.vertices.forEach((v) => expect(d3(v, o)).toBeCloseTo(d3(icosa.vertices[0], o), 12));
  });

  it('the dodecahedron is its dual: one vertex at the centroid of every icosahedron face', () => {
    const adj = new Set(icosa.edges.map(([i, j]) => `${Math.min(i, j)},${Math.max(i, j)}`));
    const joined = (i, j) => adj.has(`${Math.min(i, j)},${Math.max(i, j)}`);
    const centroids = [];
    for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) {
      if (joined(i, j) && joined(j, k) && joined(i, k)) {
        const [a, b, c] = [icosa.vertices[i], icosa.vertices[j], icosa.vertices[k]];
        centroids.push({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 });
      }
    }
    expect(centroids).toHaveLength(20);
    const dodeca = f.dodecahedron.vertices;
    expect(dodeca).toHaveLength(20);
    centroids.forEach((c) => expect(Math.min(...dodeca.map((v) => d3(v, c)))).toBeLessThan(1e-12));
    const lengths = f.dodecahedron.edges.map(([i, j]) => d3(dodeca[i], dodeca[j]));
    expect(lengths).toHaveLength(30);
    lengths.forEach((l) => expect(l).toBeCloseTo(lengths[0], 12));
  });

  it('the nested pair keeps its true counts and how it enters', () => {
    expect(f.icosahedron.counts).toEqual({ V: 12, E: 30, F: 20 });
    expect(f.dodecahedron.counts).toEqual({ V: 20, E: 30, F: 12 });
    expect(f.icosahedron.enters).toBe('phi');
    expect(f.dodecahedron.enters).toBe('dual');
  });
});
