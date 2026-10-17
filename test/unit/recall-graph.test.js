import { describe, expect, it } from 'vitest';
import {
  GRAPH_MAX_EDGES,
  GRAPH_MAX_EXPANDED,
  GRAPH_MAX_HOPS,
  GRAPH_MAX_RECORDS,
  GRAPH_MAX_RELATIONS,
  buildRecallAdjacency,
  continuityStableId,
  mapContinuityEdges,
  rankGraphRecall,
} from '../../core/memory/recall-graph.js';

const AT = '2025-01-01T00:00:00.000Z';

const doc = (id, {
  space = 'project-a',
  occurredAt = '2024-01-01T00:00:00.000Z',
  invalidatedAt = null,
  supersededBy = null,
  sessionId = null,
} = {}) => ({
  id: Number.NaN,
  obsId: id,
  text: `search text for ${id}`,
  space: { id: space },
  occurredAt,
  invalidatedAt,
  supersededBy,
  anchor: sessionId ? { sessionId } : null,
});

const options = {
  space: { id: 'project-a' },
  asOf: AT,
  maxHops: 2,
  maxExpanded: 64,
};

describe('continuity stable-id mapping', () => {
  it('maps record ids and relation targets through meta.observationId', () => {
    const records = [
      {
        id: 'record-a',
        meta: { observationId: 'observation-a' },
        relations: [{ type: 'supports', targetId: 'record-b', validFrom: '2024-01-01T00:00:00.000Z' }],
      },
      {
        id: 'record-b',
        meta: { observationId: 'observation-b' },
        supersedes: 'record-a',
        validFrom: '2024-06-01T00:00:00.000Z',
      },
    ];

    expect(continuityStableId(records[0])).toBe('observation-a');
    expect(mapContinuityEdges(records)).toEqual([
      {
        from: 'observation-a',
        to: 'observation-b',
        type: 'supports',
        kind: 'explicit',
        validFrom: '2024-01-01T00:00:00.000Z',
        validTo: null,
      },
      {
        from: 'observation-a',
        to: 'observation-b',
        type: 'supersession',
        kind: 'supersession',
        validFrom: '2024-06-01T00:00:00.000Z',
        validTo: null,
      },
    ]);
  });
});

describe('rankGraphRecall eligibility', () => {
  it('filters future, retired, foreign-space, and temporally invalid edges before traversal', () => {
    const docs = [
      doc('anchor'),
      doc('active'),
      doc('general', { space: 'general' }),
      doc('foreign', { space: 'project-b' }),
      doc('retired', { invalidatedAt: '2024-12-01T00:00:00.000Z' }),
      doc('future', { occurredAt: '2026-01-01T00:00:00.000Z' }),
      doc('edge-future'),
      doc('edge-expired'),
    ];
    const continuityRecords = [{
      id: 'anchor',
      relations: [
        { type: 'explicit', targetId: 'active', validFrom: '2024-01-01T00:00:00.000Z' },
        { type: 'explicit', targetId: 'general', validFrom: '2024-01-01T00:00:00.000Z' },
        { type: 'explicit', targetId: 'foreign', validFrom: '2024-01-01T00:00:00.000Z' },
        { type: 'explicit', targetId: 'retired', validFrom: '2024-01-01T00:00:00.000Z' },
        { type: 'explicit', targetId: 'future', validFrom: '2024-01-01T00:00:00.000Z' },
        { type: 'explicit', targetId: 'edge-future', validFrom: '2026-01-01T00:00:00.000Z' },
        { type: 'explicit', targetId: 'edge-expired', validFrom: '2023-01-01T00:00:00.000Z', validTo: AT },
      ],
    }];

    const ranked = rankGraphRecall({ docs, continuityRecords, anchorIds: ['anchor'] }, options);
    expect(ranked.results.map((hit) => hit.id)).toEqual(['active', 'general']);
    expect(ranked.metrics.corpusNodes).toBe(5);
  });

  it('routes explicit edges through the strict current-relation view', () => {
    const continuityRecords = [{
      id: 'anchor',
      validFrom: '2024-01-01T00:00:00.000Z',
      relations: [
        { type: 'explicit', targetId: 'active' },
        { type: 'explicit', targetId: 'malformed', validFrom: 'not-a-time' },
        { type: 'explicit', targetId: 'expired', validTo: AT },
        { type: 'explicit', targetId: 'future', validFrom: '2026-01-01T00:00:00.000Z' },
      ],
    }];

    expect(mapContinuityEdges(continuityRecords, { asOf: AT })).toEqual([{
      from: 'anchor',
      to: 'active',
      type: 'explicit',
      kind: 'explicit',
      validFrom: '2024-01-01T00:00:00.000Z',
      validTo: null,
    }]);
    const ranked = rankGraphRecall({
      docs: [doc('anchor'), doc('active'), doc('malformed'), doc('expired'), doc('future')],
      continuityRecords,
      anchorIds: ['anchor'],
    }, options);
    expect(ranked.results.map((hit) => hit.id)).toEqual(['active']);
  });

  it('does not include general when the caller disables general padding', () => {
    const docs = [doc('anchor'), doc('general', { space: 'general' })];
    const continuityRecords = [{
      id: 'anchor',
      relations: [{ type: 'explicit', targetId: 'general' }],
    }];

    const ranked = rankGraphRecall(
      { docs, continuityRecords, anchorIds: ['anchor'] },
      { ...options, fallbackToGeneral: false },
    );
    expect(ranked.results).toEqual([]);
    expect(ranked.metrics.corpusNodes).toBe(1);
  });
  it.each([
    ['foreign', doc('bridge', { space: 'project-b' })],
    ['retired', doc('bridge', { invalidatedAt: '2024-12-01T00:00:00.000Z' })],
    ['future', doc('bridge', { occurredAt: '2026-01-01T00:00:00.000Z' })],
  ])('discards a whole community with a %s bridge instead of synthesizing A-B', (_kind, bridge) => {
    const ranked = rankGraphRecall({
      docs: [doc('active-a'), bridge, doc('active-b')],
      communities: [{ memberIds: ['active-a', 'bridge', 'active-b'] }],
      anchorIds: ['active-a'],
    }, options);

    expect(ranked.results).toEqual([]);
    expect(ranked.metrics.corpusEdges).toBe(0);
  });

  it('uses a coherently retired predecessor only as a direct non-emitted supersession seed', () => {
    const cutover = '2024-06-01T00:00:00.000Z';
    const docs = [
      doc('predecessor', { invalidatedAt: cutover, supersededBy: 'successor' }),
      doc('successor', { occurredAt: cutover }),
      doc('successor-neighbor'),
    ];
    const ranked = rankGraphRecall({
      docs,
      continuityRecords: [{
        id: 'successor',
        relations: [{ type: 'supports', targetId: 'successor-neighbor' }],
      }],
      anchorIds: ['predecessor'],
    }, options);

    expect(ranked.results).toEqual([expect.objectContaining({
      id: 'successor',
      hop: 1,
      path: ['predecessor', 'successor'],
      via: ['supersession'],
    })]);
    expect(ranked.results.flatMap((hit) => hit.path.slice(1))).not.toContain('predecessor');
    expect(ranked.results.map((hit) => hit.id)).not.toContain('successor-neighbor');
  });

  it.each([
    ['foreign successor', doc('successor', { space: 'project-b', occurredAt: '2024-06-01T00:00:00.000Z' })],
    ['future successor', doc('successor', { occurredAt: '2026-01-01T00:00:00.000Z' })],
    ['retired successor', doc('successor', {
      occurredAt: '2024-06-01T00:00:00.000Z',
      invalidatedAt: '2024-12-01T00:00:00.000Z',
    })],
  ])('does not seed through a %s', (_kind, successor) => {
    const ranked = rankGraphRecall({
      docs: [
        doc('predecessor', {
          invalidatedAt: '2024-06-01T00:00:00.000Z',
          supersededBy: 'successor',
        }),
        successor,
      ],
      anchorIds: ['predecessor'],
    }, options);

    expect(ranked.results).toEqual([]);
    expect(ranked.metrics.lexicalAnchors).toBe(0);
  });

  it('does not turn a retraction without a successor into a graph seed', () => {
    const ranked = rankGraphRecall({
      docs: [doc('retracted', { invalidatedAt: '2024-06-01T00:00:00.000Z' }), doc('active')],
      communities: [{ memberIds: ['retracted', 'active'] }],
      anchorIds: ['retracted'],
    }, options);

    expect(ranked.results).toEqual([]);
    expect(ranked.metrics.lexicalAnchors).toBe(0);
    expect(ranked.metrics.corpusEdges).toBe(0);
  });
});

describe('rankGraphRecall bounds and ordering', () => {
  it('prefers explicit, supersession, session, then community edges', () => {
    const docs = [
      doc('root', { sessionId: 'session' }),
      doc('explicit'),
      doc('successor'),
      doc('session-peer', { sessionId: 'session' }),
      doc('community-peer'),
    ];
    const continuityRecords = [
      { id: 'root', relations: [{ type: 'supports', targetId: 'explicit' }] },
      { id: 'successor', supersedes: 'root', validFrom: '2024-01-01T00:00:00.000Z' },
    ];
    const communities = [{ memberIds: ['root', 'community-peer'] }];

    const ranked = rankGraphRecall({
      docs,
      continuityRecords,
      communities,
      anchorIds: ['root'],
    }, { ...options, maxHops: 1 });

    expect(ranked.results.map((hit) => hit.id)).toEqual([
      'explicit',
      'successor',
      'session-peer',
      'community-peer',
    ]);
    expect(ranked.results.map((hit) => hit.via[0])).toEqual([
      'supports',
      'supersession',
      'session',
      'community',
    ]);
  });

  it('clamps traversal bounds, caps node degree, and is deterministic', () => {
    const targets = Array.from({ length: 20 }, (_, index) => `target-${String(index).padStart(2, '0')}`);
    const docs = [doc('root'), ...targets.map((id) => doc(id))];
    const continuityRecords = [{
      id: 'root',
      relations: targets.map((targetId) => ({ type: 'explicit', targetId })),
    }];
    const input = { docs, continuityRecords, anchorIds: ['root'] };
    const overBounds = { ...options, maxHops: 99, maxExpanded: 999 };

    const first = rankGraphRecall(input, overBounds);
    const second = rankGraphRecall(input, overBounds);
    expect(second).toEqual(first);
    expect(first.results).toHaveLength(8);
    expect(first.metrics.nodesExpanded).toBeLessThanOrEqual(GRAPH_MAX_EXPANDED);
    expect(first.metrics.maxHop).toBeLessThanOrEqual(GRAPH_MAX_HOPS);
    expect(first.metrics.maxHops).toBe(GRAPH_MAX_HOPS);
    expect(first.metrics.maxExpanded).toBe(GRAPH_MAX_EXPANDED);
  });

  it('bounds oversized records, relations, communities, adjacency, and text-free metrics', () => {
    const targets = Array.from(
      { length: GRAPH_MAX_RELATIONS + 12 },
      (_, index) => `bounded-${String(index).padStart(2, '0')}`,
    );
    const ignored = Array.from(
      { length: GRAPH_MAX_RECORDS + 12 },
      (_, index) => ({ id: `ignored-${index}`, relations: [] }),
    );
    const docs = [doc('root'), ...targets.map((id) => doc(id))];
    const continuityRecords = [{
      id: 'root',
      content: 'must never enter metrics',
      relations: targets.map((targetId) => ({
        type: 'supports',
        targetId,
        content: 'must never enter metrics',
      })),
    }, ...ignored];
    const communities = Array.from({ length: 100 }, (_, index) => ({
      memberIds: ['root', targets[index % targets.length]],
      summary: 'must never enter metrics',
    }));

    const allowedIds = new Set(docs.map((row) => row.obsId));
    const mapped = mapContinuityEdges(continuityRecords, { allowedIds });
    const ranked = rankGraphRecall({ docs, continuityRecords, communities, anchorIds: ['root'] }, options);

    expect(mapped).toHaveLength(GRAPH_MAX_RELATIONS);
    expect(ranked.results).toHaveLength(8);
    expect(ranked.metrics.corpusEdges).toBeLessThanOrEqual(GRAPH_MAX_EDGES);
    expect(ranked.metrics.nodesExpanded).toBeLessThanOrEqual(GRAPH_MAX_EXPANDED);
    expect(JSON.stringify(ranked.metrics)).not.toContain('must never enter metrics');
    expect(JSON.stringify(ranked.results)).not.toContain('must never enter metrics');
  });


  it('retains only the deterministic top neighbors while inserting edges', () => {
    const ids = [
      'root',
      'target-z',
      ...Array.from({ length: 8 }, (_, index) => `target-0${index}`),
    ];
    const eligible = new Map(ids.map((id) => [id, doc(id)]));
    const { adjacency, edgeCount } = buildRecallAdjacency({
      eligible,
      docs: [...eligible.values()],
      continuityRecords: [
        {
          id: 'root-supersession',
          meta: { observationId: 'root' },
          supersededBy: 'target-z',
        },
        {
          id: 'root-explicit',
          meta: { observationId: 'root' },
          relations: ids.slice(2).map((targetId) => ({ type: 'supports', targetId })),
        },
      ],
      communities: [],
      asOf: AT,
    });

    expect(adjacency.get('root')).toHaveLength(8);
    expect(edgeCount).toBe(8);
    expect(adjacency.get('root').map((edge) => edge.to)).toEqual([
      'target-00',
      'target-01',
      'target-02',
      'target-03',
      'target-04',
      'target-05',
      'target-06',
      'target-07',
    ]);
  });

  it('returns ids, rank scores, and provenance only', () => {
    const ranked = rankGraphRecall({
      docs: [doc('root'), doc('related')],
      continuityRecords: [{ id: 'root', relations: [{ type: 'supports', targetId: 'related' }] }],
      anchorIds: ['root'],
    }, options);

    expect(Object.keys(ranked.results[0]).sort()).toEqual(['hop', 'id', 'path', 'score', 'via']);
    expect(ranked.results[0].path).toEqual(['root', 'related']);
  });
});
