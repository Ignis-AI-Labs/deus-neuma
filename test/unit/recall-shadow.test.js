import { describe, expect, it } from 'vitest';
import { reciprocalRankFusionMany } from '../../core/memory/rank-fusion.js';
import { compareRecallRanks, resolveGraphRecallMode } from '../../core/memory/recall-shadow.js';

describe('resolveGraphRecallMode', () => {
  it('defaults and fails closed to off', () => {
    expect(resolveGraphRecallMode()).toBe('off');
    expect(resolveGraphRecallMode('off')).toBe('off');
    expect(resolveGraphRecallMode('candidate')).toBe('off');
    expect(resolveGraphRecallMode('SHADOW')).toBe('off');
    expect(resolveGraphRecallMode('shadow')).toBe('shadow');
  });
});

describe('compareRecallRanks', () => {
  it('returns the exact canonical two-list baseline while comparing a third list', () => {
    const lexicalLists = [
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    ];
    const graphList = [{ id: 'b' }, { id: 'c' }];
    const expected = reciprocalRankFusionMany(lexicalLists, { k: 60, limit: 3 });

    const compared = compareRecallRanks({
      lexicalLists,
      graphList,
      eligibleIds: new Set(['a', 'b', 'c']),
    }, { k: 60, limit: 3 });

    expect(compared.result).toBe(compared.baseline);
    expect(compared.result).toEqual(expected);
    expect(compared.candidate.map((hit) => hit.id)).toEqual(['b', 'c', 'a']);
    expect(compared.metrics.baselineIds).toEqual(['a', 'b', 'c']);
    expect(compared.metrics.candidateIds).toEqual(['b', 'c', 'a']);
  });

  it('applies one eligible universe to baseline and candidate', () => {
    const compared = compareRecallRanks({
      lexicalLists: [
        [{ id: 'active' }, { id: 'foreign' }],
        [{ id: 'foreign' }, { id: 'active' }],
      ],
      graphList: [{ id: 'foreign' }, { id: 'general' }],
      eligibleIds: new Set(['active', 'general']),
    }, { limit: 3 });

    expect(compared.result.map((hit) => hit.id)).toEqual(['active']);
    expect(compared.candidate.map((hit) => hit.id)).toEqual(['active', 'general']);
    expect(compared.metrics.candidateIds).not.toContain('foreign');
  });

  it('preserves active-space-first ordering and the caller budget for both arms', () => {
    const compared = compareRecallRanks({
      lexicalLists: [
        [{ id: 'general' }, { id: 'active' }],
        [{ id: 'general' }, { id: 'active' }],
      ],
      graphList: [{ id: 'general' }, { id: 'active' }],
      eligibleIds: new Set(['active', 'general']),
      partitions: [new Set(['active']), new Set(['general'])],
      resultLimit: 1,
    }, { limit: 2 });

    expect(compared.result.map((hit) => hit.id)).toEqual(['active']);
    expect(compared.candidate.map((hit) => hit.id)).toEqual(['active']);
    expect(compared.metrics.baselineCount).toBe(1);
    expect(compared.metrics.candidateCount).toBe(1);
  });

  it('keeps private rank metrics bounded to opaque ids and ranks', () => {
    const ids = Array.from({ length: 100 }, (_, index) => `id-${String(index).padStart(3, '0')}`);
    const compared = compareRecallRanks({
      lexicalLists: [ids.map((id) => ({ id })), [...ids].reverse().map((id) => ({ id }))],
      graphList: ids.slice(25).map((id) => ({ id })),
      eligibleIds: new Set(ids),
    }, { limit: 100 });

    expect(compared.metrics.baselineIds.length).toBeLessThanOrEqual(64);
    expect(compared.metrics.candidateIds.length).toBeLessThanOrEqual(64);
    expect(compared.metrics.rankChanges.length).toBeLessThanOrEqual(64);
    expect(Object.keys(compared.metrics.rankChanges[0]).sort()).toEqual([
      'baselineRank',
      'candidateRank',
      'id',
    ]);
  });

  it('does not invent a candidate when no graph list exists', () => {
    const compared = compareRecallRanks({
      lexicalLists: [[{ id: 'only', score: 7 }], []],
      graphList: [],
      eligibleIds: new Set(['only']),
    }, { limit: 10 });

    expect(compared.candidate).toBe(compared.baseline);
    expect(compared.result).toEqual([{ id: 'only', score: 7 }]);
    expect(compared.metrics.graphCount).toBe(0);
  });
});
