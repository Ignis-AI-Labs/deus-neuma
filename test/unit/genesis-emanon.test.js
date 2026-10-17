// genesis-emanon — the Emanon Tree stands where Founder's chart places each
// sphere, is constructed (not placed), and carries the canon's topology.
// Pure: real inputs, real outputs, no mocks.
import { describe, it, expect } from 'vitest';
import {
  FUNCTIONS, TREE, MIDDLE_PILLAR, BREATHING_PATHS, nodeAt, pathStrokes, treeChannels, crossChannels, breaths, pillarConstruction,
} from '../../frontend/app/Genesis/genesis-emanon.js';

const at = (id) => nodeAt(id, 1);

describe('the eleven spheres, where the chart places them', () => {
  it('eleven functions, each with one Light and one Dark expression — 22, none repeated', () => {
    expect(FUNCTIONS).toHaveLength(11);
    expect(new Set(FUNCTIONS.flatMap((f) => [f.light, f.dark])).size).toBe(22);
  });

  it('Knowing at the crown, Natura at the heart (the center), Form at the base', () => {
    const ys = FUNCTIONS.map((f) => at(f.id).y);
    expect(at('knowing').y).toBe(Math.max(...ys));
    expect(at('form').y).toBe(Math.min(...ys));
    expect([at('natura').x, at('natura').y]).toEqual([0, 0]);
  });

  it('left pillar (force): Sensing, Capacity, Mind — right pillar (form): Meaning, Coherence, Prehension', () => {
    for (const id of ['sensing', 'capacity', 'mind']) expect(at(id).x).toBeLessThan(0);
    for (const id of ['meaning', 'coherence', 'prehension']) expect(at(id).x).toBeGreaterThan(0);
    for (const id of MIDDLE_PILLAR) expect(at(id).x).toBe(0);
  });

  it('Ipseity is hidden between the crown and the heart — on the middle pillar, above Natura', () => {
    expect(at('ipseity').x).toBe(0);
    expect(at('ipseity').y).toBeGreaterThan(at('natura').y);
    expect(at('ipseity').y).toBeLessThan(at('knowing').y);
  });

  it('constructed, not placed: every side sphere stands on a crossing of two middle-pillar circles', () => {
    const c = pillarConstruction();
    const side = FUNCTIONS.map((f) => at(f.id)).filter((p) => p.x !== 0);
    expect(side).toHaveLength(6);
    for (const p of side) {
      const on = c.centers.filter((k) => Math.abs(Math.hypot(p.x - k.x, p.y - k.y) - c.radius) < 1e-12);
      expect(on).toHaveLength(2);
    }
  });
});

describe('breathing paths, channels and breaths', () => {
  it('22 breathing paths, each once; eight leave the heart; none touch the hidden sphere', () => {
    expect(BREATHING_PATHS).toHaveLength(TREE.PATHS);
    expect(new Set(BREATHING_PATHS.map((p) => [...p].sort().join('-'))).size).toBe(22);
    expect(BREATHING_PATHS.filter((p) => p.includes('natura'))).toHaveLength(8);
    expect(BREATHING_PATHS.some((p) => p.includes('ipseity'))).toBe(false);
    expect(pathStrokes(1)[0].from).toBe('natura'); // drawn from the heart outward
  });

  it('220 channels: 55 within each tree, 110 across, every pair once', () => {
    for (const t of [1, -1]) expect(new Set(treeChannels(t).map((c) => [c.from, c.to].sort().join('-'))).size).toBe(55);
    const x = crossChannels();
    expect(x).toHaveLength(TREE.CROSS_CHANNELS);
    expect(x.every((c) => c.from !== c.to && c.a.z > 0 && c.b.z < 0)).toBe(true);
  });

  it('eleven breaths: each sphere\'s own axis between its Light and its Dark', () => {
    const b = breaths();
    expect(b).toHaveLength(11);
    for (const k of b) {
      expect(k.from).toBe(k.to);
      expect([k.a.x, k.a.y]).toEqual([k.b.x, k.b.y]);
      expect(k.a.z).toBe(-k.b.z);
    }
  });
});
