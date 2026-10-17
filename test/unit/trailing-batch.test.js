/**
 * trailing-batch.js — proven with REAL timers and REAL bursts, no mock
 * anywhere: the flush callback the test arms is the caller's own seam (the
 * collector records what the desk would spend), exactly the shape the
 * house's emit-collecting integration tests use.
 *
 * The contract under proof (Founder, live 2026-08-27 — the Explorer 429 storm):
 * a burst folds to ONE flush carrying every detail; a quiet gap ends the
 * burst; sustained churn still flushes by the max wait; cancel drops the
 * pending burst.
 */
import { describe, test, expect } from 'vitest';
import { createTrailingBatch } from '../../frontend/utils/trailing-batch.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('createTrailingBatch (real timers)', () => {
  test('a burst flushes ONCE, carrying every detail', async () => {
    const flushes = [];
    const batch = createTrailingBatch((items) => flushes.push(items), 40, 400);
    for (let i = 0; i < 50; i += 1) batch.push({ path: `/repo/file-${i}` });
    expect(batch.pendingCount()).toBe(50);
    await sleep(120);
    expect(flushes).toHaveLength(1);
    expect(flushes[0]).toHaveLength(50);
    expect(flushes[0][49].path).toBe('/repo/file-49');
    expect(batch.pendingCount()).toBe(0);
  });

  test('a quiet gap ends the burst — the next event is its own flush', async () => {
    const flushes = [];
    const batch = createTrailingBatch((items) => flushes.push(items), 40, 400);
    batch.push('a');
    batch.push('b');
    await sleep(120);
    batch.push('c');
    await sleep(120);
    expect(flushes).toEqual([['a', 'b'], ['c']]);
  });

  test('sustained churn never starves the first detail past the max wait', async () => {
    const flushes = [];
    const batch = createTrailingBatch((items) => flushes.push(items), 400, 80);
    const start = Date.now();
    // Keep pushing inside the quiet window — without the cap this never fires.
    for (let i = 0; i < 10; i += 1) {
      batch.push(i);
      await sleep(30);
    }
    expect(flushes.length).toBeGreaterThan(0);
    expect(flushes[0][0]).toBe(0); // the burst's FIRST detail led the flush
    expect(Date.now() - start).toBeLessThan(400); // the cap beat the quiet window
    await sleep(500); // the tail trails out
    expect(flushes.flat()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('cancel drops the pending burst — unmount never flushes into a dead panel', async () => {
    const flushes = [];
    const batch = createTrailingBatch((items) => flushes.push(items), 40, 400);
    batch.push('x');
    batch.cancel();
    expect(batch.pendingCount()).toBe(0);
    await sleep(120);
    expect(flushes).toHaveLength(0);
  });
});
