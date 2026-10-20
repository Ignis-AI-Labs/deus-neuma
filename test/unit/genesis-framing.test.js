// genesis-framing — every stretch of GENESIS frames what it is about, whole
// and balanced, at every common window shape — a solid is never lost while
// its caption names it. Pure: the real camera, the real geometry, the real
// state.
import { describe, it, expect } from 'vitest';
import { FEATURED, frameMetrics } from '../../frontend/app/Genesis/genesis-framing.js';
import { cameraAt, fitDistance, CROSSINGS } from '../../frontend/app/Genesis/genesis-camera.js';
import { GENESIS_MS, partStart } from '../../frontend/app/Genesis/genesis-timeline.js';
import { genesisFamily } from '../../frontend/app/Genesis/genesis-geometry.js';
import { constructScale } from '../../frontend/app/Genesis/genesis-state-construct.js';

const ASPECTS = [
  ['1920×1080', 1920 / 1080],
  ['1440×900', 1440 / 900],
  ['1280×720', 1280 / 720],
  ['900×1200', 900 / 1200],
  ['3440×1440', 3440 / 1440],
];
const STEP = 50; // ms
const BALANCE = 0.12; // the farthest a featured figure's center may sit from the frame's, of the short side

const worst = (stretch, aspect) => {
  const w = { vertices: 1, bounds: 1, low: Infinity, high: 0, offset: 0, at: null };
  for (let t = stretch.from; t < stretch.to; t += STEP) {
    const points = stretch.points(t);
    if (!points.length) continue;
    const m = frameMetrics(points, cameraAt(t, aspect), aspect);
    // a stretch may take `settle` ms to zoom up to its band's floor
    const settled = t >= stretch.from + stretch.settle;
    if (m.vertices < w.vertices || (settled && m.occupancy < w.low) || m.occupancy > w.high) w.at = t;
    w.vertices = Math.min(w.vertices, m.vertices);
    w.bounds = Math.min(w.bounds, m.bounds);
    if (settled) w.low = Math.min(w.low, m.occupancy);
    w.high = Math.max(w.high, m.occupancy);
    w.offset = Math.max(w.offset, m.offset);
  }
  return w;
};

describe('frameMetrics — the measure itself', () => {
  const cam = { x: 0, y: 0, z: 10, target: { x: 0, y: 0, z: 0 } };
  it('a sphere fitted by fitDistance spans its fill of the short side, centered', () => {
    for (const [, aspect] of ASPECTS) {
      const d = fitDistance(1, aspect, 0.6);
      const ring = Array.from({ length: 64 }, (_, k) => ({ x: Math.cos((k / 64) * 2 * Math.PI), y: Math.sin((k / 64) * 2 * Math.PI), z: 0 }));
      const m = frameMetrics(ring, { ...cam, z: d }, aspect);
      expect(m.vertices).toBe(1);
      expect(m.bounds).toBe(1);
      expect(m.occupancy).toBeGreaterThan(0.58);
      expect(m.occupancy).toBeLessThanOrEqual(0.6 + 1e-9);
      expect(m.offset).toBeLessThan(1e-9);
    }
  });
  it('a point behind the camera is out of frame, and the figure has no size to hold', () => {
    const m = frameMetrics([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 20 }], cam, 16 / 9);
    expect(m.vertices).toBe(0.5);
    expect(m.occupancy).toBe(Infinity);
  });
  it('a figure past the frame edge reads as partly in frame', () => {
    const m = frameMetrics([{ x: -1, y: -1, z: 0 }, { x: 50, y: 1, z: 0 }], cam, 1);
    expect(m.vertices).toBe(0.5);
    expect(m.bounds).toBeLessThan(0.1);
  });
});

describe('every featured stretch is whole, readable and balanced at every window shape', () => {
  const framed = FEATURED.filter((s) => !s.crossing);
  for (const s of framed) {
    for (const [name, aspect] of ASPECTS) {
      it(`${s.id} @ ${name}`, () => {
        const w = worst(s, aspect);
        const where = `worst at t=${w.at}`;
        expect(w.vertices, where).toBe(1);
        expect(w.bounds, where).toBe(1);
        expect(w.low, where).toBeGreaterThanOrEqual(s.band.MIN);
        expect(w.high, where).toBeLessThanOrEqual(s.band.MAX);
        expect(w.offset, where).toBeLessThanOrEqual(BALANCE);
      });
    }
  }
});

describe('the crossings — the only stretch a shell may leave the frame', () => {
  const S = genesisFamily();
  const reach = (s) => Math.max(...s.vertices.map((v) => Math.hypot(v.x, v.y, v.z)));
  it('the camera never enters the family: it stays outside the octahedron\'s corners until the recession', () => {
    expect(Object.keys(CROSSINGS)).toEqual(['recession']);
    for (const [, aspect] of ASPECTS) {
      for (let t = partStart('simplex', 'observer'); t < CROSSINGS.recession.from; t += STEP) {
        expect(cameraAt(t, aspect).dist).toBeGreaterThan(reach(S.octahedron) * constructScale(t));
      }
    }
  });
  it('the stretches cover the film from the first circle to the handoff without a gap', () => {
    FEATURED.forEach((s, i) => { if (i > 0) expect(s.from).toBe(FEATURED[i - 1].to); });
    expect(FEATURED[FEATURED.length - 1].to).toBe(GENESIS_MS);
  });
});

describe('the camera never jumps, at any window shape', () => {
  it('under 3° of turn and 5% of distance between 60 fps frames', () => {
    for (const [, aspect] of ASPECTS) {
      for (let t = 0; t < GENESIS_MS; t += 16) {
        const a = cameraAt(t, aspect);
        const b = cameraAt(t + 16, aspect);
        const dir = (c) => [c.x - c.target.x, c.y - c.target.y, c.z - c.target.z].map((v) => v / c.dist);
        const [p, q] = [dir(a), dir(b)];
        expect(Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]))).toBeLessThan((3 * Math.PI) / 180);
        expect(Math.abs(a.dist - b.dist) / a.dist).toBeLessThan(0.05);
      }
    }
  });
});
