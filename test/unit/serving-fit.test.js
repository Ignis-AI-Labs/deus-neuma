/**
 * SERVING FIT (Design note, 2026-10-20: the pool fills the GPU up to the operator's
 * share, from llama.cpp's own projection; the pure planner's law.
 */
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_VRAM_SHARE, FIT_MARGIN_MIB, FIT_MIN_CONTEXT, estimatedExtraMiB, estimatedExtraPerTokenMiB, linearProjection, planServingPool, projectedGpuMiB, shareFrom,
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

// The production launch measured on the rig, 2026-11-09 (neuma-research inference-speed/runs/
// fitprobe-20261109T140823Z.json): llama-fit-params' projection and the live server's own MiB,
// 6 slots, unified pool, the BF16 projector (888 MiB) and the MTP draft, at a 16K and a 64K pool.
const MEASURED = Object.freeze([
  { build: 'T4-12G-fit3', at: [[16_384, 11_769, 16_292], [65_536, 14_849, 19_624]] },
  { build: 'T4-IQ3_XXS', at: [[16_384, 12_617, 17_342], [65_536, 15_697, 20_674]] },
  { build: 'T4-IQ3_M', at: [[16_384, 13_947, 18_672], [65_536, 17_027, 22_004]] },
  { build: 'T4-IQ4_XS', at: [[16_384, 16_210, 20_934], [65_536, 19_290, 24_266]] },
  { build: 'T4-Q6_K', at: [[16_384, 22_535, 27_258], [65_536, 25_615, 30_590]] },
]);

describe('serving fit — the excess estimate against real launches', () => {
  const extra = estimatedExtraMiB({ mmprojMiB: 888, mtp: true });
  const perToken = estimatedExtraPerTokenMiB({ mtp: true });
  test.each(MEASURED)('$build: never under what the card really held, and within 300 MiB of it', ({ at }) => {
    const proj = linearProjection({ ctx: at[0][0], totalMiB: at[0][1] }, { ctx: at[1][0], totalMiB: at[1][1] });
    for (const [ctx, , actual] of at) {
      const estimate = proj.baseMiB + proj.perTokenMiB * ctx + extra + perToken * ctx;
      expect(estimate).toBeGreaterThanOrEqual(actual);
      expect(estimate - actual).toBeLessThan(300);
    }
  });
  test('the parts measured alone: nothing extra, the projector, the MTP draft (T4-IQ3_M at 16K and 64K)', () => {
    // actual minus projection, each part switched on by itself
    expect(estimatedExtraMiB({}) + estimatedExtraPerTokenMiB({}) * 16_384).toBeGreaterThanOrEqual(229);
    expect(estimatedExtraMiB({ mmprojMiB: 888 }) + estimatedExtraPerTokenMiB({}) * 65_536).toBeGreaterThanOrEqual(1_409);
    expect(estimatedExtraMiB({ mtp: true }) + estimatedExtraPerTokenMiB({ mtp: true }) * 65_536).toBeGreaterThanOrEqual(3_839);
  });
  test('a 24 GB card fits IQ3_M at a pool a birth can use; a 16 GB card fits no 27B build', () => {
    const fit = (build, totalMiB) => {
      const { at } = MEASURED.find((m) => m.build === build);
      const projection = linearProjection({ ctx: at[0][0], totalMiB: at[0][1] }, { ctx: at[1][0], totalMiB: at[1][1] });
      return planServingPool({ totalMiB, othersMiB: 600, share: DEFAULT_VRAM_SHARE, projection, extraMiB: extra, extraPerTokenMiB: perToken, trainCtx: 262_144, slots: 6 });
    };
    expect(fit('T4-IQ3_M', 24_564).contextLength).toBeGreaterThanOrEqual(16_384);
    expect(fit('T4-IQ4_XS', 32_607).contextLength).toBeGreaterThanOrEqual(65_536);
    expect(fit('T4-Q6_K', 49_140).contextLength).toBeGreaterThanOrEqual(131_072);
    for (const build of MEASURED.map((m) => m.build)) expect(fit(build, 16_303).fits).toBe(false);
  });
  test('the per-token excess is part of the pool sum, so a planned pool keeps to the ceiling', () => {
    const { at } = MEASURED.find((m) => m.build === 'T4-IQ4_XS');
    const iq4 = linearProjection({ ctx: at[0][0], totalMiB: at[0][1] }, { ctx: at[1][0], totalMiB: at[1][1] });
    const plan = planServingPool({ totalMiB: 32_607, othersMiB: 600, share: 0.85, projection: iq4, extraMiB: extra, extraPerTokenMiB: perToken, trainCtx: 262_144, slots: 6 });
    expect(plan.fits).toBe(true);
    expect(plan.projectedMiB).toBeLessThanOrEqual(plan.ceilingMiB - 600 - FIT_MARGIN_MIB + 1);
  });
});
