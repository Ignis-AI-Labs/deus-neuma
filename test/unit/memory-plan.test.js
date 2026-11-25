/**
 * RAM OFFLOAD (Design note, 2026-11-11: […]): a model the card
 * cannot hold spills to system RAM inside two budgets — the card's share and a RAM share that
 * always leaves the machine room — and the server is launched with llama.cpp's own placement.
 * docs/work/ram-offload.md. Pure laws, on the T4 launches measured on the rig (2026-11-09).
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import {
  RAM_RESERVE_MIB, RAM_SHARE_DEFAULT, SPILL_POOL, fitTargetMiB, parseMeminfo, ramBudgetMiB, ramShareFrom, spillPlan,
} from '../../backend/services/memory-plan.js';
import {
  DEFAULT_VRAM_SHARE, FIT_MARGIN_MIB, estimatedExtraMiB, estimatedExtraPerTokenMiB, linearProjection, planServingPool, planSpill, readServingFit, saveServingRamShare,
} from '../../backend/services/serving-fit.js';
import { resolveServingLaunchConfig, sameServingLaunch, servingLaunchArguments, validatedServingLaunchConfig } from '../../backend/services/serving-launch-config.js';

// llama-fit-params' projection at a 16K and a 64K pool, 6 slots (fitprobe-20261109T140823Z.json)
const MEASURED = Object.freeze({
  'T4-IQ3_XXS': [[16_384, 12_617], [65_536, 15_697]],
  'T4-IQ3_M': [[16_384, 13_947], [65_536, 17_027]],
  'T4-IQ4_XS': [[16_384, 16_210], [65_536, 19_290]],
});
const projectionOf = (build) => {
  const [[c0, m0], [c1, m1]] = MEASURED[build];
  return linearProjection({ ctx: c0, totalMiB: m0 }, { ctx: c1, totalMiB: m1 });
};
const extraMiB = estimatedExtraMiB({ mmprojMiB: 888, mtp: true });
const extraPerTokenMiB = estimatedExtraPerTokenMiB({ mtp: true });
const card = (totalMiB) => ({ totalMiB, othersMiB: 600, share: DEFAULT_VRAM_SHARE, extraMiB, extraPerTokenMiB, trainCtx: 262_144, slots: 6 });
const RAM_64 = { totalMiB: 64_000, availableMiB: 52_000 };

describe('the RAM budget', () => {
  test('the operator\'s share of the total (20-80%), else half — never an environment variable', () => {
    expect(RAM_SHARE_DEFAULT).toBe(0.5);
    expect(ramShareFrom({ ramSharePct: 30 })).toBe(0.3);
    expect(ramShareFrom({ ramSharePct: 95 })).toBe(RAM_SHARE_DEFAULT);
    expect(ramShareFrom({ RAM_SHARE: '30' })).toBe(RAM_SHARE_DEFAULT);
  });

  test('never past what leaves 8 GiB free right now', () => {
    expect(ramBudgetMiB({ totalMiB: 131_072, availableMiB: 100_000 })).toBe(65_536);
    expect(ramBudgetMiB({ totalMiB: 131_072, availableMiB: 20_000 })).toBe(20_000 - RAM_RESERVE_MIB);
    expect(ramBudgetMiB({ totalMiB: 16_000, availableMiB: 6_000 })).toBe(0);
    expect(ramBudgetMiB(null)).toBe(0);
  });

  test('the RAM share is saved beside the GPU share, a whole percent from 20 to 80', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ram-share-'));
    process.env.NEUMA_SUBSTRATE_CLAIM_DIR = dir;
    try {
      expect(saveServingRamShare(40)).toBe(40);
      expect(ramShareFrom(readServingFit())).toBe(0.4);
      for (const bad of [10, 90, 33.5, 'forty']) expect(() => saveServingRamShare(bad)).toThrow(/20 to 80/);
    } finally {
      delete process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('this machine\'s own /proc/meminfo reads as total and available MiB', () => {
    const ram = parseMeminfo(readFileSync('/proc/meminfo', 'utf8'));
    expect(ram.totalMiB).toBeGreaterThan(1024);
    expect(ram.availableMiB).toBeGreaterThan(0);
    expect(ram.availableMiB).toBeLessThanOrEqual(ram.totalMiB);
    expect(parseMeminfo('nothing here')).toBeNull();
  });
});

describe('the spill', () => {
  test('what does not fit the card goes to RAM, inside the budget', () => {
    expect(spillPlan({ needMiB: 18_000, cardRoomMiB: 10_000, ramBudgetMiB: 20_000 })).toEqual({ fits: true, cardMiB: 10_000, ramMiB: 8_000 });
    const refused = spillPlan({ needMiB: 18_000, cardRoomMiB: 10_000, ramBudgetMiB: 4_000 });
    expect(refused.fits).toBe(false);
    expect(refused.reason).toContain('8000 MiB of RAM');
    expect(refused.reason).toContain('4000 MiB');
  });

  test('the card margin llama.cpp must leave: above the ceiling, the allocator margin, and what it does not count', () => {
    expect(fitTargetMiB({ totalMiB: 12_227, ceilingMiB: 10_392, marginMiB: 512, uncountedMiB: 1_000 })).toBe(12_227 - 10_392 + 512 + 1_000);
  });

  test('THE CASE IT EXISTS FOR: a 16 GB card fit no 27B build; now IQ3_M runs with the rest in RAM', () => {
    expect(planServingPool({ ...card(16_303), projection: projectionOf('T4-IQ3_M') }).fits).toBe(false);
    const plan = planSpill({ ...card(16_303), projection: projectionOf('T4-IQ3_M'), ramBudget: ramBudgetMiB(RAM_64) });
    expect(plan.fits).toBe(true);
    expect(plan.spill).toBe(true);
    expect(plan.contextLength).toBe(SPILL_POOL);
    // the card part stays under the operator's ceiling with the margin kept
    expect(plan.cardMiB + 600 + FIT_MARGIN_MIB).toBeLessThanOrEqual(plan.ceilingMiB);
    expect(plan.cardMiB + plan.ramMiB).toBe(plan.projectedMiB);
    expect(plan.placement).toEqual({ fitTargetMiB: fitTargetMiB({ totalMiB: 16_303, ceilingMiB: plan.ceilingMiB, marginMiB: FIT_MARGIN_MIB, uncountedMiB: extraMiB }), minCtx: SPILL_POOL });
  });

  test('a 12 GB card takes IQ4_XS with about half of it in RAM', () => {
    const plan = planSpill({ ...card(12_227), projection: projectionOf('T4-IQ4_XS'), ramBudget: ramBudgetMiB(RAM_64) });
    expect(plan.fits).toBe(true);
    expect(plan.ramMiB).toBeGreaterThan(plan.cardMiB);
  });

  test('a machine without the RAM is told so with both numbers, and nothing launches spilled', () => {
    const plan = planSpill({ ...card(12_227), projection: projectionOf('T4-IQ4_XS'), ramBudget: ramBudgetMiB({ totalMiB: 16_000, availableMiB: 11_000 }) });
    expect(plan.fits).toBe(false);
    expect(plan.reason).toMatch(/MiB of RAM beside the card; the RAM share allows \d+ MiB/);
  });
});

describe('the launch', () => {
  const base = resolveServingLaunchConfig({ LLAMA_SERVER_MODEL: '/models/t4.gguf' });

  test('every layer on the card by default — the launch every machine had', () => {
    expect(base.placement).toBeNull();
    const args = servingLaunchArguments(base);
    expect(args).toContain('-ngl');
    expect(args).not.toContain('--fit');
  });

  test('a spilled serving hands placement to llama.cpp\'s own fit, never -ngl 999', () => {
    const spilled = validatedServingLaunchConfig({ ...base, contextLength: SPILL_POOL, placement: { fitTargetMiB: 3_500, minCtx: SPILL_POOL } });
    const args = servingLaunchArguments(spilled);
    expect(args).not.toContain('-ngl');
    const at = args.indexOf('--fit');
    expect(args.slice(at, at + 6)).toEqual(['--fit', 'on', '--fit-target', '3500', '--fit-ctx', String(SPILL_POOL)]);
    expect(sameServingLaunch(base, spilled)).toBe(false);
  });

  test('a placement outside its bounds or with stray fields is refused', () => {
    for (const placement of [{ fitTargetMiB: -1, minCtx: 8192 }, { fitTargetMiB: 100, minCtx: 10 }, { fitTargetMiB: 100, minCtx: 8192, ngl: 999 }, { fitTargetMiB: '100', minCtx: 8192 }]) {
      expect(() => validatedServingLaunchConfig({ ...base, placement })).toThrow(/serving placement/);
    }
  });
});
