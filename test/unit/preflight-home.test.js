// The flight check's verdict in plain words: ready when the checks clear and a starting space is set.
import { describe, expect, test } from 'vitest';
import { verdictFor } from '../../frontend/components/BirthCeremony/preflight-home.js';

const home = { affordable: true, availableGB: 400 };
describe('verdictFor', () => {
  test('checks clear and a starting space set: ready to begin', () => {
    expect(verdictFor({ verdict: 'ready', checksFailed: false, allocationGB: 5, home }))
      .toEqual({ text: 'READY — EVERYTHING IS IN PLACE · BEGIN THE CEREMONY WHEN YOU ARE', state: 'ready', begin: true });
  });
  test('no starting space yet (the default could not be applied): asked for, never blocked', () => {
    const v = verdictFor({ verdict: 'ready', checksFailed: false, allocationGB: null, home });
    expect(v).toMatchObject({ state: 'ready', begin: false });
    expect(v.text).toContain('CHOOSE HOW MUCH SPACE');
  });
  test('a failed check wins over everything, in plain words', () => {
    expect(verdictFor({ verdict: 'blocked', checksFailed: true, allocationGB: 5, home }))
      .toMatchObject({ state: 'blocked', begin: false, text: 'NOT YET — FIX WHAT IS MARKED ABOVE, THEN PRESS RECHECK' });
  });
  test('a space larger than the disk has left names both numbers', () => {
    const v = verdictFor({ verdict: 'blocked', checksFailed: false, allocationGB: 50, home: { affordable: false, availableGB: 12.5 } });
    expect(v).toMatchObject({ state: 'blocked', begin: false });
    expect(v.text).toBe('NOT YET — 50 GB IS MORE THAN THE 12.5 GB LEFT ON THIS DISK · CHOOSE LESS BELOW');
  });
});
