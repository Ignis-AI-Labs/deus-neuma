/**
 * RAM IN THE SUBSTRATE WINDOW (Design note, 2026-10-13: […]).
 * The machine's memory, the model server's own (where the parked prompt cache lives), and
 * the cache ceiling the RUNNING server was started with — read from the real /proc.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { parseRam, parseServerRam, getSubstrateTelemetry } from '../../backend/services/substrate-telemetry.js';

const MEMINFO = [
  'MemTotal:       131205680 kB',
  'MemFree:         2000000 kB',
  'MemAvailable:   77968636 kB',
  'SwapTotal:       8388604 kB',
  'SwapFree:           6040 kB',
].join('\n');

describe('parseRam — used is what the kernel cannot hand back', () => {
  test('reads total, used, available and swap from meminfo', () => {
    expect(parseRam(MEMINFO)).toEqual({
      totalMB: 128131, usedMB: 128131 - 76141, availableMB: 76141, swapTotalMB: 8192, swapUsedMB: 8186,
    });
  });

  test('without /proc it falls back to the platform totals, and swap is unknown rather than zero', () => {
    expect(parseRam(null, { totalBytes: 32 * 1073741824, freeBytes: 8 * 1073741824 })).toEqual({
      totalMB: 32768, usedMB: 24576, availableMB: 8192, swapTotalMB: null, swapUsedMB: null,
    });
    expect(parseRam(null)).toEqual({
      totalMB: null, usedMB: null, availableMB: null, swapTotalMB: null, swapUsedMB: null,
    });
  });
});

describe('parseServerRam — the server\'s own memory and its running cache ceiling', () => {
  test('anonymous memory (not the mapped model file) and --cache-ram from the real argv form', () => {
    const status = 'VmRSS:\t18630284 kB\nRssAnon:\t16399064 kB\nRssFile:\t 1528232 kB\n';
    const argv = ['llama-server', '-m', '/m.gguf', '--cache-ram', '32032', '--parallel', '4'].join('\0');
    expect(parseServerRam(status, argv)).toEqual({ anonMB: 16015, cacheLimitMB: 32032 });
  });

  test('a server started without --cache-ram, or no server at all, reads unknown', () => {
    expect(parseServerRam('RssAnon:\t1024 kB\n', 'llama-server\0-m\0x')).toEqual({ anonMB: 1, cacheLimitMB: null });
    expect(parseServerRam(null, null)).toEqual({ anonMB: null, cacheLimitMB: null });
  });
});

describe('the live snapshot carries RAM', () => {
  test('this machine\'s real memory reaches the telemetry', async () => {
    const tel = await getSubstrateTelemetry();
    expect(tel.ram.totalMB).toBeGreaterThan(0);
    expect(tel.ram.usedMB).toBeGreaterThan(0);
    expect(tel.ram.usedMB).toBeLessThanOrEqual(tel.ram.totalMB);
    if (existsSync('/proc/meminfo')) {
      const total = Number(readFileSync('/proc/meminfo', 'utf8').match(/^MemTotal:\s+(\d+)/m)[1]);
      expect(tel.ram.totalMB).toBe(Math.round(total / 1024));
    }
    expect(tel.ram.server).toHaveProperty('anonMB');
    expect(tel.ram.server).toHaveProperty('cacheLimitMB');
  }, 15000);
});
