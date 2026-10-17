/**
 * frontend/app/Armillary — THE ARMILLARY: the logo built in 3D projects to
 * the logo; its figures are constructions it truly holds; its light never
 * flashes; its turn never jumps; its layout never lets the ring touch the
 * name. Pure; real values.
 */
import { describe, it, expect } from 'vitest';
import { ARMILLARY, cardinalOctahedron, dualCube, equatorSeed, nucleusPair } from '../../frontend/app/Armillary/armillary-geometry.js';
import { restingSpinOf, armillaryOfIgnition, ARMILLARY_REST } from '../../frontend/app/Armillary/armillary-state.js';
import { armillaryLayoutOf } from '../../frontend/app/Armillary/armillary-layout.js';
import { energyAt, swellAt, ENERGY } from '../../frontend/app/Ignition/ignition-energy.js';
import { ignitionAt, IGNITION } from '../../frontend/app/Ignition/ignition-timeline.js';

const len = (v) => Math.hypot(v.x, v.y, v.z);

describe('the logo, built in three dimensions', () => {
  it('seen from asin(8/30) above, the equator projects to the logo’s rx30 ry8', () => {
    expect(Math.sin(ARMILLARY.ELEVATION) * 30).toBeCloseTo(8, 9);
    expect(ARMILLARY.AXIS_REACH * 30).toBeCloseTo(44, 9);
    expect(ARMILLARY.CORE * 30).toBeCloseTo(3.4, 9);
  });
});

describe('its figures are constructions it truly holds', () => {
  it('the octahedron: six vertices, all on the sphere — two poles on the axis, four on the equator; 12 edges', () => {
    const { vertices, edges } = cardinalOctahedron();
    expect(vertices).toHaveLength(6);
    expect(edges).toHaveLength(12);
    vertices.forEach((v) => expect(len(v)).toBeCloseTo(ARMILLARY.RADIUS, 12));
    expect(vertices.filter((v) => v.x === 0 && v.z === 0)).toHaveLength(2); // the poles
    expect(vertices.filter((v) => v.y === 0)).toHaveLength(4); // the equator
  });

  it('its dual cube: a vertex at each of the eight face centres; 12 edges', () => {
    const { vertices, edges } = dualCube();
    const octa = cardinalOctahedron().vertices;
    expect(vertices).toHaveLength(8);
    expect(edges).toHaveLength(12);
    // each cube vertex is the centroid of the three octahedron vertices on its side
    vertices.forEach((c) => {
      const face = octa.filter((v) => v.x * c.x + v.y * c.y + v.z * c.z > 0);
      expect(face).toHaveLength(3);
      const centroid = face.reduce((m, v) => ({ x: m.x + v.x / 3, y: m.y + v.y / 3, z: m.z + v.z / 3 }), { x: 0, y: 0, z: 0 });
      expect(Math.hypot(centroid.x - c.x, centroid.y - c.y, centroid.z - c.z)).toBeLessThan(1e-12);
    });
  });

  it('the seed: seven circles in the equator’s plane whose outer envelope is exactly the equator', () => {
    const { centres, radius } = equatorSeed();
    expect(centres).toHaveLength(7);
    centres.forEach((c) => expect(c.y).toBe(0));
    expect(Math.max(...centres.map((c) => len(c) + radius))).toBeCloseTo(ARMILLARY.RADIUS, 12);
  });

  it('the nucleus: icosahedron 12/30 and its dual dodecahedron 20/30, around the core', () => {
    const { icosahedron, dodecahedron } = nucleusPair();
    expect([icosahedron.vertices.length, icosahedron.edges.length]).toEqual([12, 30]);
    expect([dodecahedron.vertices.length, dodecahedron.edges.length]).toEqual([20, 30]);
    icosahedron.vertices.forEach((v) => expect(len(v)).toBeCloseTo(ARMILLARY.NUCLEUS, 12));
    expect(ARMILLARY.NUCLEUS).toBeGreaterThan(ARMILLARY.CORE);
  });
});

describe('its light never flashes (WCAG 2.3)', () => {
  it('a swell rises over its rise time — never a jump — then settles', () => {
    expect(swellAt(-1)).toBe(0);
    expect(swellAt(0)).toBe(0);
    // no frame (16 ms) ever adds more than a fifth of the full light
    for (let ms = 0; ms < 2000; ms += 16) expect(Math.abs(swellAt(ms + 16) - swellAt(ms))).toBeLessThan(0.2);
    expect(swellAt(ENERGY.FLARE_RISE_MS)).toBeCloseTo(1, 9);
    expect(swellAt(3000)).toBeLessThan(0.05);
  });

  it('only a true answer sends light; the opening is one discharge and one dive', () => {
    const at = 1400 + IGNITION.PACKET_MS;
    expect(energyAt(at + 100, { verdicts: [{ at: 1400, state: 'fail' }], openAt: null })).toEqual({ pulses: [], flare: 0, dive: 0 });
    const ok = energyAt(at + 100, { verdicts: [{ at: 1400, state: 'ok' }], openAt: null });
    expect(ok.pulses).toHaveLength(1);
    expect(ok.flare).toBeGreaterThan(0);
    expect(energyAt(3500 + IGNITION.OPEN_MS, { verdicts: [], openAt: 3500 }).dive).toBe(1);
  });
});

describe('its turn never jumps, and the ignition hands it over whole', () => {
  it('the resting turn gathers from stillness and is continuous through the ramp', () => {
    expect(restingSpinOf(0)).toBe(0);
    for (let s = 0; s < 10; s += 0.05) expect(restingSpinOf(s + 0.05) - restingSpinOf(s)).toBeGreaterThanOrEqual(0);
    expect(Math.abs(restingSpinOf(4.0001) - restingSpinOf(3.9999))).toBeLessThan(1e-4);
  });

  it('the ignition’s last frame is the gateway’s rest', () => {
    const s = ignitionAt(10000, { verdicts: [] });
    const a = armillaryOfIgnition(s, { pulses: [], flare: 0, dive: 0 }, 0);
    ['point', 'axis', 'meridian', 'equator', 'geometry', 'spin'].forEach((k) => expect(a[k]).toBe(ARMILLARY_REST[k]));
    expect(a.lean).toBeCloseTo(ARMILLARY_REST.lean, 9);
  });
});

describe('the layout keeps the ring off the name, and the threshold beneath it', () => {
  it.each([[1600, 900], [1300, 830], [3449, 1345], [1024, 1366], [800, 600]])('%i × %i', (w, h) => {
    const L = armillaryLayoutOf(w, h);
    expect(L.mark).toBeLessThan(L.ring);
    expect(L.nameY - L.nameSize / 2).toBeGreaterThan(L.cy + L.ring + 12);
    expect(L.belowY).toBeGreaterThan(L.lineY);
    expect(L.belowY + 90).toBeLessThan(h - 24); // the threshold and the strip both fit
  });
});
