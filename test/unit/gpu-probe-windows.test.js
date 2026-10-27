// The Windows card reading behind the model chosen at install (gpu-probe.js parseWindowsAdapters):
// the driver registry's true sizes, the largest card winning over integrated graphics.
import { describe, it, expect } from 'vitest';
import { parseNvidiaMemory, parseNvidiaSmi, parseWindowsAdapters } from '../../backend/services/gpu-probe.js';

const GB = 1024 ** 3;

describe('parseWindowsAdapters', () => {
  it('reads a 24 GB AMD card at its true size, past the 4 GB WMI ceiling', () => {
    expect(parseWindowsAdapters(`AMD Radeon RX 7900 XTX\t${24 * GB}\r\n`))
      .toEqual({ name: 'AMD Radeon RX 7900 XTX', vramGB: 24, unified: false, vendor: 'amd' });
  });

  it('takes a laptop\'s discrete card over its integrated graphics, in either order', () => {
    const intel = `Intel(R) UHD Graphics 770\t${GB}`;
    const nvidia = `NVIDIA GeForce RTX 4070 Laptop GPU\t${8 * GB}`;
    for (const out of [`${intel}\r\n${nvidia}\r\n`, `${nvidia}\r\n${intel}\r\n`]) {
      expect(parseWindowsAdapters(out)).toMatchObject({ name: 'NVIDIA GeForce RTX 4070 Laptop GPU', vramGB: 8, vendor: 'nvidia' });
    }
  });

  it('names an Intel Arc card as Intel', () => {
    expect(parseWindowsAdapters(`Intel(R) Arc(TM) A770 Graphics\t${16 * GB}`)).toMatchObject({ vramGB: 16, vendor: 'intel' });
  });

  it('gives no card for nothing, garbage, or only a sliver of shared memory', () => {
    expect(parseWindowsAdapters('')).toBeNull();
    expect(parseWindowsAdapters(undefined)).toBeNull();
    expect(parseWindowsAdapters('no tab here\nname\tnot-a-number')).toBeNull();
    expect(parseWindowsAdapters(`Microsoft Basic Display Adapter\t${128 * 1024 * 1024}`)).toBeNull();
  });
});

describe('the driver version, for the driver guard (gpu-driver-guard.js)', () => {
  test("the registry's DriverVersion rides along with the card that has the most memory", () => {
    const out = `Intel(R) UHD Graphics\t${GB}\t31.0.101.5333\r\nNVIDIA GeForce RTX 5070 Ti Laptop GPU\t${12 * GB}\t32.0.15.7270\r\n`;
    expect(parseWindowsAdapters(out)).toEqual({ name: 'NVIDIA GeForce RTX 5070 Ti Laptop GPU', vramGB: 12, unified: false, vendor: 'nvidia', driver: '32.0.15.7270' });
  });

  test("nvidia-smi's driver_version rides along; a line without one reads as before", () => {
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 5070 Ti Laptop GPU, 12227, 572.70', 32 * GB)).toMatchObject({ vramGB: 12, driver: '572.70' });
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 5070 Ti Laptop GPU, 12227', 32 * GB)).not.toHaveProperty('driver');
  });
});

describe("the card's free memory now (nvidia-smi memory.free,memory.total)", () => {
  test('MiB become bytes; unified memory ([N/A]) and nothing read give null', () => {
    expect(parseNvidiaMemory('10800, 12227')).toEqual({ freeBytes: 10800 * 1024 * 1024, totalBytes: 12227 * 1024 * 1024 });
    expect(parseNvidiaMemory('[N/A], [N/A]')).toBeNull();
    expect(parseNvidiaMemory('')).toBeNull();
  });
});
