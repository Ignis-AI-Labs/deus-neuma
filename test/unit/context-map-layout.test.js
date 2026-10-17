/**
 * CONTEXT MAP field layout — pure geometry over the memory graph the B-06
 * route serves. Pure function: real inputs, real outputs, nothing to mock
 * (RULE 0). Betweenness values here are real measured shapes (star/bridge
 * intuition), not invented weights.
 */
import { describe, expect, it } from 'vitest';
import { buildContextMapLayout } from '../../frontend/app/RelinkShell/context-map-layout.js';

const node = (id, over = {}) => ({
  id, label: `obs ${id}`, degree: 0, betweenness: 0, ...over,
});

const smallGraph = () => ({
  nodes: [
    node('a', { betweenness: 0.5 }),
    node('b', { betweenness: 1.0 }),
    node('c', { betweenness: 0 }),
    node('d'),
    node('lone'),
  ],
  edges: [
    { source: 'a', target: 'b', w: 0.4 },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'd' },
  ],
  communities: [
    { id: 1, label: 'voice work', memberIds: ['a', 'b'] },
    { id: 2, label: 'birth ceremony', memberIds: ['c', 'd'] },
  ],
});

/** Deterministic Fisher-Yates with a fixed LCG — no Math.random in tests either. */
const shuffled = (arr) => {
  const out = [...arr];
  let seed = 1337;
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const everyCoordFinite = (layout) => {
  for (const n of layout.nodes) {
    if (![n.x, n.y, n.r].every(Number.isFinite)) return false;
  }
  for (const e of layout.edges) {
    if (![e.x1, e.y1, e.x2, e.y2].every(Number.isFinite)) return false;
  }
  return [layout.bounds.minX, layout.bounds.minY, layout.bounds.maxX, layout.bounds.maxY]
    .every(Number.isFinite);
};

describe('buildContextMapLayout', () => {
  it('is deterministic: two calls on the same input are deeply equal', () => {
    expect(buildContextMapLayout(smallGraph())).toEqual(buildContextMapLayout(smallGraph()));
  });

  it('is order-independent: shuffled node and edge input order → identical output', () => {
    const g = smallGraph();
    const mixed = {
      nodes: shuffled(g.nodes),
      edges: shuffled(g.edges),
      communities: shuffled(g.communities),
    };
    expect(buildContextMapLayout(mixed)).toEqual(buildContextMapLayout(smallGraph()));
  });

  it('returns deep-frozen output: mutation throws in strict mode', () => {
    const t = buildContextMapLayout(smallGraph());
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t.nodes)).toBe(true);
    expect(Object.isFrozen(t.nodes[0])).toBe(true);
    expect(Object.isFrozen(t.edges)).toBe(true);
    expect(Object.isFrozen(t.edges[0])).toBe(true);
    expect(Object.isFrozen(t.communityRings)).toBe(true);
    expect(Object.isFrozen(t.communityRings[0])).toBe(true);
    expect(Object.isFrozen(t.bounds)).toBe(true);
    expect(() => { 'use strict'; t.nodes[0].x = 999; }).toThrow(TypeError);
    expect(() => { 'use strict'; t.bounds.minX = -1; }).toThrow(TypeError);
  });

  it('scales node radius monotonically with real betweenness', () => {
    const t = buildContextMapLayout(smallGraph(), { rMin: 3, rMax: 10 });
    const r = (id) => t.nodes.find((n) => n.id === id).r;
    expect(r('b')).toBe(10); // maxB holder gets rMax
    expect(r('c')).toBe(3); // zero betweenness gets rMin
    expect(r('a')).toBeGreaterThan(r('c'));
    expect(r('a')).toBeLessThan(r('b'));
    // missing betweenness reads as 0 → rMin, same as measured zero
    expect(r('d')).toBe(3);
  });

  it('guards maxB = 0: every node lands at rMin, no NaN', () => {
    const t = buildContextMapLayout({
      nodes: [node('x'), node('y', { betweenness: 0 })],
      edges: [{ source: 'x', target: 'y' }],
      communities: [],
    }, { rMin: 4, rMax: 12 });
    expect(t.nodes.map((n) => n.r)).toEqual([4, 4]);
    expect(everyCoordFinite(t)).toBe(true);
  });

  it('assigns communityIndex by sorted community label and -1 to loose nodes', () => {
    const t = buildContextMapLayout(smallGraph());
    const idx = (id) => t.nodes.find((n) => n.id === id).communityIndex;
    // 'birth ceremony' < 'voice work' → indices follow the sorted order
    expect(t.communityRings.map((c) => c.label)).toEqual(['birth ceremony', 'voice work']);
    expect(idx('c')).toBe(0);
    expect(idx('d')).toBe(0);
    expect(idx('a')).toBe(1);
    expect(idx('b')).toBe(1);
    expect(idx('lone')).toBe(-1);
    // the loose group is placed but gets no community ring
    expect(t.communityRings).toHaveLength(2);
  });

  it('places members on a phyllotaxis spiral: member 0 on the community center, distinct positions after', () => {
    const t = buildContextMapLayout(smallGraph(), { ringRadius: 100, spiralSpacing: 8 });
    const ring = t.communityRings.find((c) => c.label === 'voice work');
    // sorted member ids: a before b → a is spiral index 0, exactly on center
    const a = t.nodes.find((n) => n.id === 'a');
    const b = t.nodes.find((n) => n.id === 'b');
    expect(a.x).toBeCloseTo(ring.cx, 10);
    expect(a.y).toBeCloseTo(ring.cy, 10);
    const dist = Math.hypot(b.x - ring.cx, b.y - ring.cy);
    expect(dist).toBeCloseTo(8 * Math.sqrt(1), 10); // r = c·√1
    const positions = new Set(t.nodes.map((n) => `${n.x},${n.y}`));
    expect(positions.size).toBe(t.nodes.length);
  });

  it('resolves edges to their endpoint coordinates and drops dangling edges', () => {
    const g = smallGraph();
    g.edges.push({ source: 'a', target: 'ghost' });
    const t = buildContextMapLayout(g);
    expect(t.edges).toHaveLength(3);
    const at = (id) => t.nodes.find((n) => n.id === id);
    const ab = t.edges.find((e) => e.source === 'a' && e.target === 'b');
    expect(ab).toMatchObject({ x1: at('a').x, y1: at('a').y, x2: at('b').x, y2: at('b').y });
  });

  it('bounds contain every node circle (coord ± r)', () => {
    const t = buildContextMapLayout(smallGraph());
    for (const n of t.nodes) {
      expect(n.x - n.r).toBeGreaterThanOrEqual(t.bounds.minX);
      expect(n.x + n.r).toBeLessThanOrEqual(t.bounds.maxX);
      expect(n.y - n.r).toBeGreaterThanOrEqual(t.bounds.minY);
      expect(n.y + n.r).toBeLessThanOrEqual(t.bounds.maxY);
    }
  });

  it('honest empty state: empty graph → structurally valid, frozen, zeroed bounds, no NaN', () => {
    const t = buildContextMapLayout({ nodes: [], edges: [], communities: [] });
    expect(t.nodes).toEqual([]);
    expect(t.edges).toEqual([]);
    expect(t.communityRings).toEqual([]);
    expect(t.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t.nodes)).toBe(true);
    expect(Object.isFrozen(t.bounds)).toBe(true);
    // no-argument call honours the same contract
    expect(buildContextMapLayout()).toEqual(t);
  });

  it('tolerates missing memberIds and label-less communities', () => {
    const t = buildContextMapLayout({
      nodes: [node('a'), node('b')],
      edges: [],
      communities: [{ id: 7 }, { id: 3, memberIds: ['a'] }],
    });
    expect(t.communityRings.map((c) => c.label)).toEqual(['3', '7']);
    expect(t.nodes.find((n) => n.id === 'a').communityIndex).toBe(0);
    expect(t.nodes.find((n) => n.id === 'b').communityIndex).toBe(-1);
    expect(everyCoordFinite(t)).toBe(true);
  });

  it('a node claimed by two communities belongs to the first sorted community only', () => {
    const t = buildContextMapLayout({
      nodes: [node('shared'), node('other')],
      edges: [],
      communities: [
        { label: 'zeta', memberIds: ['shared', 'other'] },
        { label: 'alpha', memberIds: ['shared'] },
      ],
    });
    expect(t.nodes.find((n) => n.id === 'shared').communityIndex).toBe(0); // alpha
    expect(t.nodes.filter((n) => n.id === 'shared')).toHaveLength(1);
  });

  it('handles a 300-node synthetic graph: returns, every coordinate finite, all nodes placed', () => {
    const N = 300;
    const nodes = Array.from({ length: N }, (_, i) =>
      node(`n${String(i).padStart(3, '0')}`, { betweenness: (i * 7919) % 100 }));
    const edges = Array.from({ length: N - 1 }, (_, i) => ({
      source: nodes[i].id, target: nodes[i + 1].id,
    }));
    const communities = Array.from({ length: 10 }, (_, c) => ({
      id: c,
      label: `cluster ${String(c).padStart(2, '0')}`,
      memberIds: nodes.slice(c * 30, (c + 1) * 30).map((n) => n.id),
    }));
    const t = buildContextMapLayout({ nodes, edges, communities });
    expect(t.nodes).toHaveLength(N);
    expect(t.edges).toHaveLength(N - 1);
    expect(t.communityRings).toHaveLength(10);
    expect(everyCoordFinite(t)).toBe(true);
    expect(t).toEqual(buildContextMapLayout({ nodes, edges, communities }));
  });
});
