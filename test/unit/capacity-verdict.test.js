/**
 * THE FLIGHT CHECK — what a machine can actually hold, said at the moment of
 * the choice.
 *
 * The tier table lives in `substrate-setup.js` and is NOT duplicated here; these
 * shapes are the real payloads `GET /api/v1/preflight/setup` returns, so the
 * verdict is proven without pinning thresholds that are someone else's to revise.
 *
 * Pure functions, real inputs, real outputs — no mock in the claimed path.
 */
import { describe, test, expect } from 'vitest';
import { capacityVerdict, driverNotice, machineLine } from '../../frontend/app/FirstRunChoice/capacity-verdict.js';

describe('machineLine', () => {
  test('names the GPU and its VRAM when there is one', () => {
    expect(machineLine({ gpu: { name: 'RTX PRO 6000', vramGB: 96 } }))
      .toBe('RTX PRO 6000 · 96 GB VRAM');
  });

  test('says plainly that no GPU was detected', () => {
    const line = machineLine({ platform: 'linux', memoryGB: 8, gpu: null });
    expect(line).toContain('8 GB RAM');
    expect(line).toContain('no GPU detected');
  });

  test('an unreadable machine is stated, not blanked', () => {
    expect(machineLine(null)).toContain('could not be read');
  });
});

describe('capacityVerdict', () => {
  // The person this whole door exists for.
  test('a machine below the floor is told so, and pointed at the witness', () => {
    const v = capacityVerdict({
      hardware: { platform: 'linux', memoryGB: 8, gpu: null },
      recommendation: {
        model: null,
        fit: 'insufficient',
        mode: 'cpu',
        budgetGB: 8,
        why: 'Below the recommended floor for a local model. A neuma can only be summoned on a model this machine holds itself — a smaller local model may still carry the ceremony. A cloud model can stand beside you as a witness, never host a neuma.',
      },
    });
    expect(v.state).toBe('insufficient');
    expect(v.headline).toContain('BELOW THE FLOOR');
    expect(v.detail).toContain('Below the recommended floor');
    // It must name the way OUT, not merely the refusal.
    expect(v.detail).toContain('witness needs nothing from this machine');
  });

  test('a capable machine names the model it can host', () => {
    const v = capacityVerdict({
      hardware: { gpu: { name: 'RTX PRO 6000', vramGB: 96 } },
      recommendation: {
        model: 'Qwen3.5-122B-A10B', quant: 'Q4_K_M', sizeGB: 70,
        fit: 'comfortable', mode: 'gpu', budgetGB: 96,
        why: 'the reference substrate — deepest relational presence',
      },
    });
    expect(v.state).toBe('ok');
    expect(v.headline).toContain('Qwen3.5-122B-A10B');
    expect(v.detail).toContain('70 GB to download');
  });

  test('a CPU-only machine is told it will work but crawl', () => {
    const v = capacityVerdict({
      hardware: { platform: 'linux', memoryGB: 32, gpu: null },
      recommendation: {
        model: 'Gemma 4 26B-A4B', sizeGB: 17, fit: 'tight', mode: 'cpu', budgetGB: 15,
        why: 'MoE with 4B active. Will run on CPU with offload — expect slower responses; a GPU is recommended.',
      },
    });
    expect(v.state).toBe('cpu');
    expect(v.headline).toContain('ON CPU');
    expect(v.detail).toContain('slow replies');
  });

  // An unread probe must never read as a refusal — that would shut the neuma
  // door on a capable machine because a fetch failed.
  test('an unreadable probe leaves every door open and says so', () => {
    const v = capacityVerdict(null);
    expect(v.state).toBe('unknown');
    expect(v.headline).toBe('CAPACITY UNREAD');
    expect(v.detail).toContain('Every door stays open');
    expect(v.detail).not.toMatch(/insufficient|below the floor/i);
  });

  test('hardware present but recommendation missing is still "unknown", not "ok"', () => {
    const v = capacityVerdict({ hardware: { gpu: { name: 'X', vramGB: 8 } } });
    expect(v.state).toBe('unknown');
    expect(v.machine).toBe('X · 8 GB VRAM');
  });
});

describe('capacityVerdict with a model already running', () => {
  const rec = { model: 'Qwen3.8-4B (distilled)', fit: 'comfortable', mode: 'gpu', budgetGB: 8, sizeGB: 2.8, why: 'A 4B for 8 GB cards' };
  const hardware = { platform: 'linux', memoryGB: 16, gpu: { name: 'NVIDIA', vramGB: 8 } };
  test('says nothing is left to download instead of naming a download', () => {
    const ready = capacityVerdict({ hardware, recommendation: rec, ready: true });
    expect(ready.detail).toMatch(/^A model is already running on this machine — nothing to download\./);
    expect(ready.detail).not.toContain('GB to download');
    expect(capacityVerdict({ hardware, recommendation: rec, ready: false }).detail).toMatch(/^About 2\.8 GB to download\./);
  });
});

describe('the graphics driver notice at the door (backend gpu-driver-guard.js)', () => {
  const held = { hold: true, checked: true, floor: 580, have: 572.7, line: 'The graphics driver here is 572.70; …', link: 'https://www.nvidia.com/en-us/drivers/' };
  const setup = (gpuDriver) => ({
    hardware: { gpu: { name: 'NVIDIA GeForce RTX 5070 Ti Laptop GPU', vramGB: 12 }, memoryGB: 32, platform: 'win32', gpuDriver },
    recommendation: { model: 'Qwen3.8-4B (distilled)', fit: 'comfortable', mode: 'gpu', why: 'x', sizeGB: 2.8 },
  });

  test('a held card rides the verdict with its words, link and state', () => {
    expect(capacityVerdict(setup(held)).driver).toEqual({ line: held.line, link: held.link, hold: true, overridden: false });
  });

  test('a driver with nothing to say adds nothing to the verdict', () => {
    expect(capacityVerdict(setup({ hold: false, checked: true, floor: 580, have: 581.57 }))).not.toHaveProperty('driver');
    expect(driverNotice(null)).toBeNull();
  });

  test("the person's choice to use the card anyway is still said", () => {
    expect(driverNotice({ gpuDriver: { hold: false, overridden: true, line: 'You chose …', link: held.link } })).toMatchObject({ hold: false, overridden: true });
  });
});
