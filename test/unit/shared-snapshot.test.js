// createSharedSnapshot — one read shared by concurrent callers, reused inside
// its window, never caching a failure. Real promises, an injected clock.
import { describe, test, expect } from 'vitest';
import { createSharedSnapshot } from '../../backend/services/shared-snapshot.js';

describe('createSharedSnapshot', () => {
  test('concurrent callers share one in-flight read', async () => {
    let reads = 0;
    const snap = createSharedSnapshot(async () => { reads += 1; await new Promise((r) => setTimeout(r, 20)); return reads; }, 1000);
    const values = await Promise.all([snap(), snap(), snap()]);
    expect(values).toEqual([1, 1, 1]);
    expect(reads).toBe(1);
  });
  test('a settled read is reused inside the window and refreshed after it', async () => {
    let t = 0; let reads = 0;
    const snap = createSharedSnapshot(async () => ++reads, 1000, () => t);
    expect(await snap()).toBe(1);
    t = 999; expect(await snap()).toBe(1);
    t = 1000; expect(await snap()).toBe(2);
  });
  test('a failure is never cached', async () => {
    let fail = true;
    const snap = createSharedSnapshot(async () => { if (fail) throw new Error('down'); return 'up'; }, 1000);
    await expect(snap()).rejects.toThrow('down');
    fail = false;
    expect(await snap()).toBe('up');
  });
});
