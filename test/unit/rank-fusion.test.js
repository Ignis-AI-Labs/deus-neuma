import { describe, expect, it } from 'vitest';
import { reciprocalRankFusionMany } from '../../core/memory/rank-fusion.js';

describe('reciprocalRankFusionMany', () => {
  it('returns no hits for no ranked input', () => {
    expect(reciprocalRankFusionMany([])).toEqual([]);
    expect(reciprocalRankFusionMany([[], []])).toEqual([]);
  });

  it('preserves two-list behavior when one constituent list is empty', () => {
    const source = [{ id: 'a', score: 5 }, { id: 'b', score: 3 }];
    expect(reciprocalRankFusionMany([source, []])).toEqual([
      { id: 'a', score: 1 / 61 },
      { id: 'b', score: 1 / 62 },
    ]);
  });

  it('preserves the exact former two-list payload, scores, and order', () => {
    const first = [
      { id: 'a', score: 10, owner: 'first-a' },
      { id: 'b', score: 8, owner: 'first-b' },
      { id: 'c', score: 6 },
    ];
    const second = [
      { id: 'b', score: 99, owner: 'second-b' },
      { id: 'd', score: 4 },
      { id: 'a', score: 2, owner: 'second-a' },
    ];

    const expected = [
      { id: 'b', score: 1 / 62 + 1 / 61, owner: 'first-b' },
      { id: 'a', score: 1 / 61 + 1 / 63, owner: 'first-a' },
      { id: 'd', score: 1 / 62 },
      { id: 'c', score: 1 / 63 },
    ];
    const result = reciprocalRankFusionMany([first, second], { k: 60, limit: 10 });
    expect(result).toEqual(expected);
    expect(JSON.stringify(result)).toBe(JSON.stringify(expected));
  });

  it('breaks equal fused scores by earliest first-seen list and rank', () => {
    const left = [{ id: 'a' }, { id: 'b' }];
    const right = [{ id: 'b' }, { id: 'a' }];

    expect(reciprocalRankFusionMany([left, right]).map((hit) => hit.id)).toEqual(['a', 'b']);
  });

  it('keeps deterministic earliest-first ordering across three lists', () => {
    const lists = [
      [{ id: 'a' }, { id: 'shared' }],
      [{ id: 'b' }, { id: 'shared' }],
      [{ id: 'c' }, { id: 'shared' }],
    ];

    const first = reciprocalRankFusionMany(lists, { limit: 4 });
    const second = reciprocalRankFusionMany(lists, { limit: 4 });
    expect(first.map((hit) => hit.id)).toEqual(['shared', 'a', 'b', 'c']);
    expect(second).toEqual(first);
  });

  it('sums duplicate ids, ignores empty constituent lists, and respects limit', () => {
    const ranked = reciprocalRankFusionMany([
      [{ id: 'a', owner: 'first' }, { id: 'a', owner: 'duplicate' }],
      [],
      [{ id: 'b' }],
    ], { k: 60, limit: 1 });

    expect(ranked).toEqual([{ id: 'a', owner: 'first', score: 1 / 61 + 1 / 62 }]);
  });
});
