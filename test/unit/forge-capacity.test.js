/**
 * The forge's ceiling and capacity verdict (image-forge/forge-capacity.js) and
 * the mind-by-claim measurement (machine-probe.js) — pure law called with real
 * inputs. No mocks (RULE 0). The first machine is THIS rig's live probe on
 * 2026-10-18 (RTX PRO 6000, 52.4 GB mind, 99 GB RAM free); the processes are
 * its real `nvidia-smi` rows, where the supervised llama-server reads as `3`.
 */

import { describe, test, expect } from 'vitest';
import {
  comfyHeadroomGb, engineRamCeilingGb, forgeCapacity, IMAGE_RAM_GB, MIN_ENGINE_VRAM_GB,
  SAFETY_HEADROOM_GB, SYSTEM_RAM_RESERVE_GB, VIDEO_RAM_GB,
} from '../../backend/services/image-forge/forge-capacity.js';
import { boxedLaunch } from '../../backend/services/image-forge/engine-memory-scope.js';
import { measuredMindGB } from '../../backend/services/machine-probe.js';

const card = (vramGB, unified = false) => ({ name: 'card', vendor: 'nvidia', vramGB, unified });
const RIG = Object.freeze({ gpu: card(96), mindGB: 51.2, mindSource: 'measured', ram: { totalGB: 125.1, availableGB: 99.2 } });

describe('measuredMindGB — the mind found by name OR by its claimed pid', () => {
  const RIG_PROCESSES = [
    { pid: 3630, name: 'kwin_wayland', memMB: 158 },
    { pid: 4155, name: 'python', memMB: 2674 },
    { pid: 13237, name: '3', memMB: 52392 },
  ];

  test('a name-only match misses the fd-exec server (the 2026-10-18 bug)', () => {
    expect(measuredMindGB(RIG_PROCESSES)).toBe(null);
  });

  test('the claimed pid counts the mind whatever nvidia-smi names it', () => {
    expect(measuredMindGB(RIG_PROCESSES, [13237])).toBe(51.2);
  });

  test('a llama-server by name and a claimed pid are not double counted', () => {
    expect(measuredMindGB([{ pid: 9, name: 'llama-server', memMB: 2048 }], [9])).toBe(2);
  });
});

describe('comfyHeadroomGb — what the engine must leave free', () => {
  test('a measured mind is already on the card: only the safety margin', () => {
    expect(comfyHeadroomGb(RIG)).toBe(SAFETY_HEADROOM_GB);
  });

  test('a mind not yet on the card is reserved in full, so it can still relight', () => {
    expect(comfyHeadroomGb({ gpu: card(24), mindGB: 17.3, mindSource: 'recommended' })).toBe(19.5);
  });

  test('nothing known: never zero', () => {
    expect(comfyHeadroomGb(null)).toBe(SAFETY_HEADROOM_GB);
  });
});

describe('forgeCapacity — what this machine can make', () => {
  test('this rig: images and video, the engine bounded beside the mind', () => {
    const c = forgeCapacity(RIG);
    expect(c.engineGB).toBe(42.8);
    expect(c.image.ok).toBe(true);
    expect(c.video.ok).toBe(true);
    expect(c.video.why).toMatch(/slower/);
  });

  test('a 32 GB-RAM desktop: images yes, video no — and says why in numbers', () => {
    const c = forgeCapacity({ gpu: card(24), mindGB: 17.3, mindSource: 'measured', ram: { totalGB: 31.3, availableGB: 22.0 } });
    expect(c.image.ok).toBe(false);
    expect(c.engineGB).toBe(4.7);
    expect(c.image.why).toContain(`${MIN_ENGINE_VRAM_GB} GB`);
    expect(c.video.ok).toBe(false);
  });

  test('room on the card but not in RAM: video refused on memory, not on the GPU', () => {
    const c = forgeCapacity({ gpu: card(48), mindGB: 17.3, mindSource: 'measured', ram: { totalGB: 31.3, availableGB: 20.0 } });
    expect(c.image.ok).toBe(true);
    expect(c.video.ok).toBe(false);
    expect(c.video.why).toBe(`needs ${VIDEO_RAM_GB} GB of free system memory for the engine, ${20 - SYSTEM_RAM_RESERVE_GB} GB can be spared`);
  });

  test('a 64 GB machine with 40 GB free can render video (the measured 16 GB floor)', () => {
    const c = forgeCapacity({ gpu: card(48), mindGB: 17.3, mindSource: 'measured', ram: { totalGB: 62.7, availableGB: 40 } });
    expect(c.video.ok).toBe(true);
  });

  test('unified memory: video staging must fit the one shared pool', () => {
    const small = forgeCapacity({ gpu: card(48, true), mindGB: 32.4, mindSource: 'measured', ram: { totalGB: 48, availableGB: 14 } });
    expect(small.video.ok).toBe(false);
    const big = forgeCapacity({ gpu: card(128, true), mindGB: 32.4, mindSource: 'measured', ram: { totalGB: 128, availableGB: 90 } });
    expect(big.video.ok).toBe(true);
  });

  test('an unreadable GPU size is a plain no, never a guess', () => {
    const c = forgeCapacity({ gpu: { name: 'card', vramGB: null }, mindGB: 8, mindSource: 'recommended', ram: null });
    expect(c.engineGB).toBe(null);
    expect(c.image).toEqual({ ok: false, why: 'the GPU memory size cannot be read on this machine' });
    expect(forgeCapacity({ gpu: null, mindGB: 0, mindSource: 'recommended', ram: null }).video.why).toBe('no GPU detected');
  });
});

describe('engineRamCeilingGb — the memory box the engine launches in', () => {
  test('this rig: what is spare now, after the machine keeps its reserve', () => {
    expect(engineRamCeilingGb(RIG)).toBe(Math.floor(99.2 - SYSTEM_RAM_RESERVE_GB));
  });

  test('a busy machine still gets the image floor, never a box too small for a still', () => {
    expect(engineRamCeilingGb({ ram: { totalGB: 31.3, availableGB: 9 } })).toBe(IMAGE_RAM_GB);
  });

  test('never above the machine less its reserve', () => {
    expect(engineRamCeilingGb({ ram: { totalGB: 12, availableGB: 11 } })).toBe(12 - SYSTEM_RAM_RESERVE_GB);
  });

  test('unreadable RAM: no box rather than a guessed one', () => {
    expect(engineRamCeilingGb({ ram: null })).toBe(null);
  });
});

describe('boxedLaunch — the launch line inside the box', () => {
  test('a ceiling wraps the engine in a no-swap systemd scope, the engine argv untouched', () => {
    expect(boxedLaunch('/venv/python', ['main.py', '--port', '8190'], 93)).toEqual({
      cmd: 'systemd-run',
      args: ['--user', '--scope', '-q', '-p', 'MemoryMax=93G', '-p', 'MemorySwapMax=0', '--', '/venv/python', 'main.py', '--port', '8190'],
    });
  });

  test('no ceiling: the plain launch line', () => {
    expect(boxedLaunch('/venv/python', ['main.py'], null)).toEqual({ cmd: '/venv/python', args: ['main.py'] });
  });
});
