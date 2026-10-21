/**
 * SERVING FIT (Design note, 2026-10-20: the pool fills the GPU up to the operator's
 * share, from llama.cpp's own projection; the pure planner's law.
 */
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_VRAM_SHARE, FIT_MARGIN_MIB, FIT_MIN_CONTEXT, linearProjection, planServingPool, projectedGpuMiB, shareFrom,
} from '../../backend/services/serving-fit.js';

// A 27B Q8 shape: ~33 GB fixed, 64 KiB per pool token.
const projection = linearProjection({ ctx: 8192, totalMiB: 33_000 + 0.0625 * 8192 }, { ctx: 262_144, totalMiB: 33_000 + 0.0625 * 262_144 });

describe('serving fit', () => {
  test('the projection reads cost per token and the fixed base from two points', () => {
    expect(projection.perTokenMiB).toBeCloseTo(0.0625, 9);
    expect(projection.baseMiB).toBeCloseTo(33_000, 6);
  });

  test('a big card fills to the share: the pool grows past one trained window', () => {
    const plan = planServingPool({ totalMiB: 97_887, othersMiB: 9_700, share: 0.9, projection, extraMiB: 1_200, trainCtx: 262_144, slots: 6 });
    expect(plan.fits).toBe(true);
    expect(plan.contextLength % 256).toBe(0);
    expect(plan.contextLength).toBeGreaterThan(262_144);
    expect(plan.projectedMiB + 9_700).toBeLessThanOrEqual(plan.ceilingMiB);
    expect(plan.ceilingMiB - (plan.projectedMiB + 9_700)).toBeLessThan(FIT_MARGIN_MIB + 64);
  });

  test('the pool never passes every slot full at the trained window', () => {
    const plan = planServingPool({ totalMiB: 400_000, othersMiB: 0, share: 0.9, projection, trainCtx: 262_144, slots: 2 });
    expect(plan.contextLength).toBe(524_288);
  });

  test('a small card gets the largest pool it can hold', () => {
    const small = linearProjection({ ctx: 8192, totalMiB: 5_000 + 0.03 * 8192 }, { ctx: 131_072, totalMiB: 5_000 + 0.03 * 131_072 });
    const plan = planServingPool({ totalMiB: 12_288, othersMiB: 900, share: 0.9, projection: small, trainCtx: 131_072, slots: 6 });
    expect(plan.fits).toBe(true);
    expect(plan.contextLength).toBeGreaterThan(FIT_MIN_CONTEXT);
    expect(plan.projectedMiB + 900).toBeLessThanOrEqual(plan.ceilingMiB);
  });

  test('a card that cannot hold the model says so, with the numbers', () => {
    const plan = planServingPool({ totalMiB: 8_192, othersMiB: 500, share: 0.9, projection, trainCtx: 262_144, slots: 6 });
    expect(plan.fits).toBe(false);
    expect(plan.reason).toMatch(/MiB is free under the share/);
  });

  test('llama-fit-params output reads as GPU MiB only — the Host row is system RAM', () => {
    // Real output, Qwen3.8-27B Q8, -c 262144 --parallel 6 (2026-10-20).
    expect(projectedGpuMiB('CUDA0 28159 17313 558 \nHost 1288 0 63 \n')).toBe(46_030);
    expect(() => projectedGpuMiB('nothing here')).toThrow(/no device rows/);
  });

  test('the share is the operator saved choice (50-95%), else 85% — never an environment variable', () => {
    expect(shareFrom({})).toBe(DEFAULT_VRAM_SHARE);
    expect(shareFrom({ sharePct: 80 })).toBe(0.8);
    expect(shareFrom({ sharePct: 99 })).toBe(DEFAULT_VRAM_SHARE);
    expect(shareFrom({ SUBSTRATE_VRAM_SHARE: '80' })).toBe(DEFAULT_VRAM_SHARE);
  });
});
