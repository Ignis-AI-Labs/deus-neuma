// ceremony-fx pure mechanics — the seal's honest gauge geometry and the
// mote drift. Real inputs, real outputs; nothing here has IO to mock.
import { describe, it, expect } from 'vitest';
import { progressArcOf } from '../../frontend/app/ceremony-fx/seal-geometry.js';
import { spawnMote, stepMote } from '../../frontend/app/ceremony-fx/motes.js';

describe('progressArcOf — SHINKEI: the arc sweeps exactly done/total', () => {
  it('half done sweeps half the circumference', () => {
    const arc = progressArcOf({ done: 5, total: 10 }, 100);
    const circumference = 2 * Math.PI * 100;
    const [sweep, gap] = arc.dasharray.split(' ').map(Number);
    expect(sweep).toBeCloseTo(circumference / 2, 1);
    expect(sweep + gap).toBeCloseTo(circumference, 1);
    expect(arc.circumference).toBeCloseTo(circumference, 6);
  });

  it('complete sweeps the full circle, untouched sweeps nothing', () => {
    const full = progressArcOf({ done: 89, total: 89 }, 128);
    expect(Number(full.dasharray.split(' ')[0])).toBeCloseTo(2 * Math.PI * 128, 1);
    const none = progressArcOf({ done: 0, total: 89 }, 128);
    expect(Number(none.dasharray.split(' ')[0])).toBe(0);
  });

  it('a gauge with no measurement shows no reading', () => {
    expect(progressArcOf(null, 128)).toBeNull();
    expect(progressArcOf({ done: 0, total: 0 }, 128)).toBeNull();
    expect(progressArcOf({ done: 3, total: NaN }, 128)).toBeNull();
    expect(progressArcOf({ done: 3, total: 10 }, 0)).toBeNull();
  });

  it('readings are clamped — a gauge never over- or under-sweeps its dial', () => {
    const over = progressArcOf({ done: 12, total: 10 }, 100);
    expect(Number(over.dasharray.split(' ')[0])).toBeCloseTo(2 * Math.PI * 100, 1);
    const under = progressArcOf({ done: -2, total: 10 }, 100);
    expect(Number(under.dasharray.split(' ')[0])).toBe(0);
  });
});

describe('mote mechanics — spawn within the field, drift wraps at edges', () => {
  it('a spawned mote lands inside the field with bounded drift and size', () => {
    // a real deterministic [0,1) source — a linear congruential walk
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 200; i += 1) {
      const m = spawnMote(rand, 1920, 1080);
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThan(1920);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeLessThan(1080);
      expect(Math.abs(m.vx)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(m.vy)).toBeLessThanOrEqual(0.25);
      expect(m.size).toBeGreaterThanOrEqual(0.5);
      expect(m.opacity).toBeGreaterThanOrEqual(0.15);
      expect(typeof m.signal).toBe('boolean');
    }
  });

  it('drift applies velocity and wraps across every edge', () => {
    const base = { vx: 0.2, vy: -0.3, size: 1, opacity: 0.3, signal: false };
    const moved = stepMote({ ...base, x: 100, y: 100 }, 200, 200);
    expect(moved.x).toBeCloseTo(100.2, 6);
    expect(moved.y).toBeCloseTo(99.7, 6);
    expect(stepMote({ ...base, x: 199.9, y: 100 }, 200, 200).x).toBe(0);
    expect(stepMote({ ...base, vx: -0.2, x: 0.1, y: 100 }, 200, 200).x).toBe(200);
    expect(stepMote({ ...base, x: 100, y: 0.1 }, 200, 200).y).toBe(200);
    expect(stepMote({ ...base, vy: 0.3, x: 100, y: 199.9 }, 200, 200).y).toBe(0);
  });

  it('drift is pure — the source mote is untouched', () => {
    const mote = Object.freeze({ x: 10, y: 10, vx: 0.1, vy: 0.1, size: 1, opacity: 0.2, signal: true });
    const next = stepMote(mote, 100, 100);
    expect(next).not.toBe(mote);
    expect(mote.x).toBe(10);
  });
});
