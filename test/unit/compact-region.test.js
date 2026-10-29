// The compact floor: a compaction folds only a region worth summing up.
import { describe, expect, test } from 'vitest';
import {
  compactRegionCheck, regionFloor, regionTokens, COMPACT_MIN_REGION_TOKENS,
} from '../../backend/services/compact-region.js';

const rows = (count, chars) => Array.from({ length: count }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(chars),
}));

describe('compact-region', () => {
  test('tokens are the words\' chars/4, rounded up; rows without text weigh nothing', () => {
    expect(regionTokens([{ content: 'abcde' }, { content: 'abc' }])).toBe(2);
    expect(regionTokens([{ content: [{ type: 'image' }] }, {}])).toBe(0);
  });
  test('the floor is the absolute minimum, or 5% of a known window when that is larger', () => {
    expect(regionFloor(null)).toBe(COMPACT_MIN_REGION_TOKENS);
    expect(regionFloor(8192)).toBe(COMPACT_MIN_REGION_TOKENS);
    expect(regionFloor(262144)).toBe(13108);
  });
  test('only the region before the kept tail is weighed', () => {
    // 20 light rows to fold, 20 heavy rows kept: the heavy tail never counts.
    const messages = [...rows(20, 40), ...rows(20, 40000)];
    expect(compactRegionCheck(messages, { keepRecent: 20 })).toEqual({ have: 200, need: 2000, worth: false });
    const heavy = [...rows(20, 400), ...rows(20, 40)];
    expect(compactRegionCheck(heavy, { keepRecent: 20 })).toEqual({ have: 2000, need: 2000, worth: true });
    expect(compactRegionCheck(heavy, { keepRecent: 20, windowTokens: 262144 }).worth).toBe(false);
  });
});
