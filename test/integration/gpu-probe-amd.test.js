import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  parseNvidiaSmi,
  parseAmdSysfs,
  parseWindowsVideoController,
  probeAmdLinux,
} from '../../backend/services/gpu-probe.js';
import { recommendSubstrate } from '../../backend/services/substrate-setup.js';

/**
 * GPU DETECTION FOR PEOPLE WHO DO NOT OWN NVIDIA (ruling, 2026-08-02).
 *
 * The detector shelled out to `nvidia-smi` and returned null on failure, so a
 * Radeon owner with 24 GB of VRAM was told `no GPU detected` and steered to CPU
 * inference. Not a crash — a confident wrong answer about their own machine.
 *
 * WHAT IS PROVEN HERE, AND WHAT IS NOT (RULE 0, stated plainly):
 *
 * PROVEN — the parsers are pure and are called with real inputs, and
 * probeAmdLinux walks a REAL directory tree on disk with real files in it, so
 * the sysfs reader, its filtering, its multi-card walk and its failure paths
 * are genuinely exercised. The substrate recommendation is driven end to end
 * from an AMD profile through the real tier table.
 *
 * WITNESSED ON REAL AMD HARDWARE 2026-08-02. This header used to end […] A member of the community with an AMD card ran it and reported
 * the detection working — the first time this path met an actual amdgpu
 * driver rather than the documented description of one.
 *
 * What that confirms: the sysfs layout assumed below is the layout a real
 * driver produces, and the card is seen. What it does NOT independently
 * confirm is the VRAM FIGURE being correct — a wrong byte count would still
 * "detect the GPU" while mis-sizing the substrate budget. If a Radeon owner
 * ever reports a model recommendation that does not match their card, start
 * at mem_info_vram_total.
 *
 * The probes remain fail-safe by construction (null on anything unexpected,
 * never a throw), so a machine this is still wrong about degrades to the
 * `null` the old NVIDIA-only detector already returned.
 */
describe('AMD GPU detection via a real sysfs-shaped tree', () => {
  let root;

  const card = (name, { vendor, vram, product } = {}) => {
    const device = path.join(root, name, 'device');
    mkdirSync(device, { recursive: true });
    if (vendor !== undefined) writeFileSync(path.join(device, 'vendor'), `${vendor}\n`);
    if (vram !== undefined) writeFileSync(path.join(device, 'mem_info_vram_total'), `${vram}\n`);
    if (product !== undefined) writeFileSync(path.join(device, 'product_name'), `${product}\n`);
  };

  beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'neuma-drm-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('reads a Radeon with 24 GB from real files on disk', async () => {
    card('card0', { vendor: '0x1002', vram: String(24 * 1024 ** 3), product: 'AMD Radeon RX 7900 XTX' });

    expect(await probeAmdLinux(root)).toEqual({
      name: 'AMD Radeon RX 7900 XTX',
      vramGB: 24,
      unified: false,
      vendor: 'amd',
    });
  });

  test('a kernel that exposes no product_name still yields a usable answer', async () => {
    card('card0', { vendor: '0x1002', vram: String(16 * 1024 ** 3) });

    const gpu = await probeAmdLinux(root);
    expect(gpu.vramGB).toBe(16);
    expect(gpu.name).toMatch(/AMD GPU/);
  });

  test('skips an Intel iGPU and finds the AMD card beside it', async () => {
    card('card0', { vendor: '0x8086', vram: String(1 * 1024 ** 3), product: 'Intel UHD' });
    card('card1', { vendor: '0x1002', vram: String(20 * 1024 ** 3), product: 'AMD Radeon RX 7900 XT' });

    expect((await probeAmdLinux(root)).name).toBe('AMD Radeon RX 7900 XT');
  });

  test('ignores connector nodes like card0-DP-1', async () => {
    card('card0', { vendor: '0x1002', vram: String(8 * 1024 ** 3), product: 'AMD Radeon RX 7600' });
    mkdirSync(path.join(root, 'card0-DP-1', 'device'), { recursive: true });

    expect((await probeAmdLinux(root)).vramGB).toBe(8);
  });

  test('an NVIDIA-only machine yields null here, leaving the nvidia probe to answer', async () => {
    card('card0', { vendor: '0x10de', vram: String(24 * 1024 ** 3), product: 'NVIDIA RTX 4090' });
    expect(await probeAmdLinux(root)).toBeNull();
  });

  test('an APU reporting zero VRAM is refused, not reported as a 0 GB GPU', async () => {
    card('card0', { vendor: '0x1002', vram: '0', product: 'AMD Radeon Graphics' });
    expect(await probeAmdLinux(root)).toBeNull();
  });

  test('a missing sysfs root is null, never a throw', async () => {
    await expect(probeAmdLinux(path.join(root, 'nope'))).resolves.toBeNull();
  });

  test('an empty drm dir is null', async () => {
    expect(await probeAmdLinux(root)).toBeNull();
  });
});

describe('gpu parsers (pure)', () => {
  const RAM = 64 * 1024 ** 3;

  test('nvidia-smi csv → dedicated card', () => {
    expect(parseNvidiaSmi('NVIDIA RTX PRO 6000 Blackwell, 98304', RAM))
      .toEqual({ name: 'NVIDIA RTX PRO 6000 Blackwell', vramGB: 96, unified: false, vendor: 'nvidia' });
  });

  test('unified silicon answers [N/A] and is reported as unified, never NaN', () => {
    const gpu = parseNvidiaSmi('NVIDIA GB10, [N/A]', RAM);
    expect(gpu).toMatchObject({ unified: true, vramGB: 64 });
    expect(Number.isNaN(gpu.vramGB)).toBe(false);
  });

  test('empty nvidia output is null', () => {
    expect(parseNvidiaSmi('', RAM)).toBeNull();
    expect(parseNvidiaSmi(undefined, RAM)).toBeNull();
  });

  test('sysfs parser refuses a non-AMD vendor', () => {
    expect(parseAmdSysfs({ vendor: '0x10de', vramBytes: String(8 * 1024 ** 3) })).toBeNull();
  });

  test('sysfs parser refuses junk without throwing', () => {
    expect(parseAmdSysfs({})).toBeNull();
    expect(parseAmdSysfs({ vendor: '0x1002', vramBytes: 'not-a-number' })).toBeNull();
    expect(parseAmdSysfs()).toBeNull();
  });

  // The probe's real output: Windows PowerShell 5.1's ConvertTo-Csv quotes
  // EVERY field, the number included.
  test('Windows AdapterRAM saturating at 4 GB yields UNKNOWN size, not a wrong number', () => {
    // The uint32 cap: a 24 GB card reports a value pinned at the top of the
    // field. Reporting 4 GB would send a capable rig to CPU on a lie.
    for (const pinned of ['4293918720', '4294967295']) {
      const gpu = parseWindowsVideoController(`"AMD Radeon RX 7900 XTX","${pinned}"`);
      expect(gpu.name).toBe('AMD Radeon RX 7900 XTX');
      expect(gpu.vramGB).toBeNull();
      expect(gpu.vendor).toBe('amd');
    }
  });

  test('Windows reports a real size when it fits in uint32', () => {
    expect(parseWindowsVideoController('"AMD Radeon RX 550","2147483648"'))
      .toMatchObject({ name: 'AMD Radeon RX 550', vramGB: 2, vendor: 'amd' });
  });

  test('a comma inside the adapter name does not break the split', () => {
    const gpu = parseWindowsVideoController('"Radeon RX 550, 2GB","2147483648"');
    expect(gpu.name).toBe('Radeon RX 550, 2GB');
    expect(gpu.vramGB).toBe(2);
  });

  test('an adapter that reports no AdapterRAM reads UNKNOWN size', () => {
    expect(parseWindowsVideoController('"Microsoft Basic Display Adapter",""').vramGB).toBeNull();
  });
});

describe('what an AMD owner is finally told', () => {
  const profile = (gpu, ramGB = 64) => ({
    gpu, memory: { totalGB: ramGB }, platform: { os: 'linux' },
  });

  test('a 24 GB Radeon is budgeted on the GPU, exactly like an equivalent NVIDIA card', () => {
    const amd = recommendSubstrate(profile({ name: 'AMD Radeon RX 7900 XTX', vramGB: 24, unified: false, vendor: 'amd' }));
    const nvidia = recommendSubstrate(profile({ name: 'NVIDIA RTX 4090', vramGB: 24, unified: false, vendor: 'nvidia' }));

    expect(amd.mode).toBe('gpu');
    expect(amd.budgetGB).toBe(24);
    // The whole point: the verdict is about the silicon's size, not its maker.
    expect(amd.model).toBe(nvidia.model);
    expect(amd.fit).toBe(nvidia.fit);
  });

  test('BEFORE this change that same machine fell to CPU — the regression this locks down', () => {
    // What the old nvidia-smi-only detector produced for a Radeon owner: null.
    const asDetectedBefore = recommendSubstrate(profile(null));
    expect(asDetectedBefore.mode).toBe('cpu');

    const asDetectedNow = recommendSubstrate(profile({ name: 'AMD Radeon RX 7900 XTX', vramGB: 24, unified: false, vendor: 'amd' }));
    // The win is the MODE — the model runs on the card instead of the
    // processor. On a 64 GB box the two budgets happen to tie, because the CPU
    // budget is capped at 24 GB; the difference a Radeon owner feels is speed,
    // not size, and asserting on budget alone would have missed that entirely.
    expect(asDetectedNow.mode).toBe('gpu');
    expect(asDetectedBefore.mode).toBe('cpu');
  });

  test('on a modest-RAM box the card also raises the budget, not just the speed', () => {
    // 16 GB RAM: the CPU path gets 16-4=12 GB, the 24 GB card gets 24.
    const before = recommendSubstrate(profile(null, 16));
    const now = recommendSubstrate(profile({ name: 'AMD Radeon RX 7900 XTX', vramGB: 24, unified: false, vendor: 'amd' }, 16));

    expect(before.mode).toBe('cpu');
    expect(now.mode).toBe('gpu');
    expect(now.budgetGB).toBeGreaterThan(before.budgetGB);
  });

  test('a GPU with unreadable VRAM falls to the CPU floor rather than guessing', () => {
    const rec = recommendSubstrate(profile({ name: 'AMD Radeon RX 7900 XTX', vramGB: null, unified: false, vendor: 'amd' }));
    expect(rec.mode).toBe('cpu');
    expect(Number.isFinite(rec.budgetGB)).toBe(true);
  });
});
