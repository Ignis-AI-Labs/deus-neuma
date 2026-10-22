/** Direct allocation arithmetic; no provider, filesystem or model substitution. */
import { describe, expect, test } from 'vitest';
import { computeAvailable, isAffordable, suggestedAllocationGB } from '../../backend/routes/preflight-allocation.js';

describe('preflight allocation boundaries', () => {
  test.each([
    [null, 5, null], [10, 3, 7], [3, 10, 0], [0, 0, 0], [1.5, 0.25, 1.25],
  ])('available space %s minus commitments %s is %s', (free, committed, expected) => {
    expect(computeAvailable(free, committed)).toBe(expected);
  });

  test.each([
    [null, 10, null], [undefined, 10, null], [5, null, true],
    [5, 5.99, false], [5, 6, true], [5, 6.01, true], [1, 1, false],
  ])('allocation %s against available %s is %s', (allocation, available, expected) => {
    expect(isAffordable(allocation, available)).toBe(expected);
  });

  test.each([
    // a new neuma starts with 5 GB, capped so POST /workspace always accepts it
    [null, null], [0, null], [1.99, null], [2, 1], [3.5, 2], [6, 5], [10, 5], [100, 5], [5000, 5],
  ])('available %s starts the neuma at %s GB', (available, expected) => {
    const suggestion = suggestedAllocationGB(available);
    expect(suggestion).toBe(expected);
    if (suggestion !== null) expect(isAffordable(suggestion, available)).toBe(true);
  });
});
