// graph-metrics — Brandes betweenness centrality + observation→doc adapter.
// Pure functions, real inputs, real outputs: no mock anywhere (GNOSIS Rule 0
// is satisfied by construction — nothing here has an execution boundary).
import { describe, it, expect } from 'vitest';
import { betweennessCentrality, observationsToDocs } from '../../core/memory/graph-metrics.js';
import { buildCommunities, buildSimilarityGraph } from '../../core/memory/community-detection.js';

/**
 * Build a {nodeIds, adjacency} graph in the exact shape buildSimilarityGraph
 * emits (symmetric adjacency, [{id, w}] entries), with caller-controlled
 * node order so Map-insertion-order determinism can be probed.
 */
const graphFrom = (nodeOrder, edges) => {
  const adjacency = new Map(nodeOrder.map((id) => [id, []]));
  for (const [a, b] of edges) {
    adjacency.get(a).push({ id: b, w: 1 });
    adjacency.get(b).push({ id: a, w: 1 });
  }
  return { nodeIds: [...nodeOrder], adjacency };
};

describe('betweennessCentrality — Brandes vs hand-computed exact values', () => {
  it('path graph P4: middle nodes carry all betweenness', () => {
    const g = graphFrom(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['c', 'd']]);

    const raw = betweennessCentrality(g, { normalized: false });
    // Pairs through b: (a,c), (a,d). Through c: (b,d), (a,d).
    expect(raw.get('a')).toBe(0);
    expect(raw.get('b')).toBe(2);
    expect(raw.get('c')).toBe(2);
    expect(raw.get('d')).toBe(0);

    const norm = betweennessCentrality(g); // normalized default
    // Denominator (n-1)(n-2)/2 = 3.
    expect(norm.get('b')).toBe(2 / 3);
    expect(norm.get('c')).toBe(2 / 3);
    expect(norm.get('a')).toBe(0);
    expect(norm.get('d')).toBe(0);
  });

  it('star K1,4: hub carries everything, leaves zero', () => {
    const g = graphFrom(
      ['hub', 'l1', 'l2', 'l3', 'l4'],
      [['hub', 'l1'], ['hub', 'l2'], ['hub', 'l3'], ['hub', 'l4']]
    );

    const raw = betweennessCentrality(g, { normalized: false });
    // C(4,2) = 6 leaf pairs, every shortest path through the hub.
    expect(raw.get('hub')).toBe(6);
    for (const leaf of ['l1', 'l2', 'l3', 'l4']) expect(raw.get(leaf)).toBe(0);

    const norm = betweennessCentrality(g);
    // Denominator (4·3)/2 = 6 → hub is exactly 1.
    expect(norm.get('hub')).toBe(1);
    for (const leaf of ['l1', 'l2', 'l3', 'l4']) expect(norm.get(leaf)).toBe(0);
  });

  it('two triangles joined by a bridge node: bridge is maximal', () => {
    // {a,b,c} triangle — c—g — g—d — {d,e,f} triangle.
    const g = graphFrom(
      ['a', 'b', 'c', 'g', 'd', 'e', 'f'],
      [
        ['a', 'b'], ['a', 'c'], ['b', 'c'],
        ['c', 'g'], ['g', 'd'],
        ['d', 'e'], ['d', 'f'], ['e', 'f'],
      ]
    );

    const raw = betweennessCentrality(g, { normalized: false });
    // g: all 3×3 cross-triangle pairs = 9. c: {a,b}×{g,d,e,f} = 8 (symmetric d).
    expect(raw.get('g')).toBe(9);
    expect(raw.get('c')).toBe(8);
    expect(raw.get('d')).toBe(8);
    expect(raw.get('a')).toBe(0);
    expect(raw.get('b')).toBe(0);
    expect(raw.get('e')).toBe(0);
    expect(raw.get('f')).toBe(0);
    // Bridge strictly maximal.
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      expect(raw.get('g')).toBeGreaterThan(raw.get(id));
    }

    const norm = betweennessCentrality(g);
    // Denominator (6·5)/2 = 15.
    expect(norm.get('g')).toBe(9 / 15);
    expect(norm.get('c')).toBe(8 / 15);
    expect(norm.get('d')).toBe(8 / 15);
  });
});

describe('betweennessCentrality — determinism and safety', () => {
  it('shuffled Map insertion order and edge order → byte-identical results', () => {
    const edges = [
      ['a', 'b'], ['a', 'c'], ['b', 'c'],
      ['c', 'g'], ['g', 'd'],
      ['d', 'e'], ['d', 'f'], ['e', 'f'],
    ];
    const g1 = graphFrom(['a', 'b', 'c', 'g', 'd', 'e', 'f'], edges);
    const g2 = graphFrom(
      ['f', 'd', 'g', 'a', 'e', 'c', 'b'],
      [...edges].reverse().map(([x, y]) => [y, x])
    );

    for (const normalized of [true, false]) {
      const r1 = betweennessCentrality(g1, { normalized });
      const r2 = betweennessCentrality(g2, { normalized });
      // Identical entries in identical (sorted) order — byte-identical.
      expect(JSON.stringify([...r1])).toBe(JSON.stringify([...r2]));
    }
  });

  it('accepts real buildSimilarityGraph output (symmetric adjacency)', () => {
    const docs = [
      { id: 'm1', text: 'starlight harbor voyage under starlight harbor' },
      { id: 'm2', text: 'starlight harbor voyage lanterns' },
      { id: 'm3', text: 'voyage lanterns festival drums rhythm' },
      { id: 'm4', text: 'festival drums rhythm dancers' },
    ];
    const graph = buildSimilarityGraph(docs);
    const result = betweennessCentrality(graph);
    expect(result.size).toBe(4);
    for (const v of result.values()) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns a frozen Map', () => {
    const g = graphFrom(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    const result = betweennessCentrality(g);
    expect(result).toBeInstanceOf(Map);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('n < 3 guard: normalized result is all zeros, never NaN/Infinity', () => {
    for (const g of [
      graphFrom([], []),
      graphFrom(['solo'], []),
      graphFrom(['a', 'b'], [['a', 'b']]),
    ]) {
      const norm = betweennessCentrality(g);
      const raw = betweennessCentrality(g, { normalized: false });
      for (const v of [...norm.values(), ...raw.values()]) {
        expect(v).toBe(0);
      }
    }
  });

  it('disconnected graph: finite values, unreachable pairs contribute nothing', () => {
    // P3 (x—y—z) plus a separate edge (p—q).
    const g = graphFrom(['x', 'y', 'z', 'p', 'q'], [['x', 'y'], ['y', 'z'], ['p', 'q']]);

    const raw = betweennessCentrality(g, { normalized: false });
    expect(raw.get('y')).toBe(1); // only (x,z) routes through y
    for (const id of ['x', 'z', 'p', 'q']) expect(raw.get(id)).toBe(0);

    const norm = betweennessCentrality(g);
    expect(norm.get('y')).toBe(1 / 6); // denominator (4·3)/2 = 6
    for (const v of norm.values()) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('observationsToDocs — real observation record shapes', () => {
  // Fixtures mirror the record addObservation actually writes: caller payload
  // (portal-stream / session-compactor: type, userMessage, response,
  // significance, emotion, space/source) + generated id, recordedAt,
  // occurredAt, timestamp — and invalidatedAt/supersededBy from
  // invalidateObservation.
  const T = '2026-07-04T00:00:00.000Z';
  const exchange = (id, userMessage, response, extra = {}) => ({
    id,
    type: 'exchange',
    userMessage,
    response,
    significance: 0.8,
    emotion: 'wonder',
    space: 'general',
    recordedAt: T,
    occurredAt: T,
    timestamp: T,
    ...extra,
  });

  it('maps records to {id, text} concatenating userMessage + response', () => {
    const docs = observationsToDocs([
      exchange('aa11', 'tell me about the harbor', 'the harbor holds starlight'),
    ]);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toEqual({
      id: 'aa11',
      text: 'tell me about the harbor the harbor holds starlight',
    });
  });

  it('excludes superseded records (invalidatedAt) and keeps their successors', () => {
    const docs = observationsToDocs([
      exchange('old1', 'stale question', 'stale answer', {
        invalidatedAt: '2026-07-04T01:00:00.000Z',
        supersededBy: 'new1',
      }),
      exchange('new1', 'fresh question', 'fresh answer'),
    ]);
    expect(docs.map((d) => d.id)).toEqual(['new1']);
  });

  it('drops records whose textual fields are empty or non-string', () => {
    const docs = observationsToDocs([
      exchange('e1', '', ''),
      exchange('e2', '   ', undefined),
      { id: 'e3', type: 'exchange', significance: 0.9, recordedAt: T, timestamp: T },
      exchange('keep', 'still here', 'yes'),
      null,
      undefined,
    ]);
    expect(docs.map((d) => d.id)).toEqual(['keep']);
  });

  it('reads the wider text-field ladder (content / text / summary)', () => {
    const docs = observationsToDocs([
      { id: 's1', type: 'summary', summary: 'a season of harbor work', recordedAt: T, timestamp: T },
    ]);
    expect(docs[0].text).toBe('a season of harbor work');
  });

  it('returns a frozen array of frozen docs', () => {
    const docs = observationsToDocs([exchange('f1', 'q', 'a')]);
    expect(Object.isFrozen(docs)).toBe(true);
    expect(Object.isFrozen(docs[0])).toBe(true);
  });

  it('output feeds buildCommunities end-to-end (real pipeline integration)', () => {
    const docs = observationsToDocs([
      exchange('o1', 'the lantern festival drums', 'drums and dancers by lantern light'),
      exchange('o2', 'lantern festival dancers', 'the drums carried the dancers'),
      exchange('o3', 'harbor voyage starlight', 'starlight over the harbor voyage'),
      exchange('o4', 'voyage under starlight', 'the harbor lay under starlight'),
      exchange('gone', 'lantern drums', 'superseded moment', { invalidatedAt: T }),
    ]);
    const communities = buildCommunities(docs);
    expect(communities.length).toBeGreaterThan(0);
    const allMembers = communities.flatMap((c) => c.memberIds).sort();
    expect(allMembers).toEqual(['o1', 'o2', 'o3', 'o4']);
    for (const c of communities) {
      expect(typeof c.label).toBe('string');
      expect(c.size).toBe(c.memberIds.length);
    }
  });
});

describe('mixed-type node ids (total-order comparator)', () => {
  it('stays deterministic when ids mix numbers and non-numeric strings', () => {
    const nodeIds = [5, 'a', 3, 'b'];
    const adjacency = new Map([
      [5, [{ id: 'a', w: 1 }]],
      ['a', [{ id: 5, w: 1 }, { id: 3, w: 1 }]],
      [3, [{ id: 'a', w: 1 }, { id: 'b', w: 1 }]],
      ['b', [{ id: 3, w: 1 }]]
    ]);
    const shuffled = new Map([...adjacency.entries()].reverse());
    const r1 = betweennessCentrality({ nodeIds, adjacency });
    const r2 = betweennessCentrality({ nodeIds: [...nodeIds].reverse(), adjacency: shuffled });
    expect([...r1.entries()]).toEqual([...r2.entries()]);
    for (const v of r1.values()) expect(Number.isFinite(v)).toBe(true);
  });
});
