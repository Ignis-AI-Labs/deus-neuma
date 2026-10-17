/**
 * GPU telemetry vs real silicon shapes — the exact rows two machines answer:
 * a discrete card (workshop RTX) and unified-memory silicon (this GB10,
 * whose nvidia-smi says "[N/A]" for the VRAM trio while util/temp/power are
 * real — the all-dash panel witnessed 2026-07-19). Pure functions, real rows.
 */
import { describe, test, expect } from 'vitest';
import { parseGpu, withUnifiedMemory } from '../../backend/services/substrate-telemetry.js';

// Verbatim GB10 answer (probed live on this rig, 2026-07-19):
const GB10_ROW = '[N/A], [N/A], 5, 49, 13.63';
// A discrete card's shape:
const RTX_ROW = '20480, 32768, 87, 66, 412.50';
// Verbatim /proc/meminfo head from this rig:
const MEMINFO = 'MemTotal:       125509700 kB\nMemAvailable:   55639112 kB\n';

describe('parseGpu — no field death, no row death', () => {
  test('unified silicon keeps its real readings; unknowns are null, never NaN', () => {
    const gpu = parseGpu(GB10_ROW);
    expect(gpu).toMatchObject({ usedMB: null, totalMB: null, freeMB: null, unified: false });
    expect(gpu.utilPct).toBe(5);
    expect(gpu.tempC).toBe(49);
    expect(gpu.powerW).toBe(13.63);
  });

  test('a discrete card parses exactly as before', () => {
    expect(parseGpu(RTX_ROW)).toMatchObject({
      usedMB: 20480, totalMB: 32768, freeMB: 12288, utilPct: 87, tempC: 66, powerW: 412.5,
    });
  });

  test('empty input is honestly null', () => {
    expect(parseGpu('')).toBeNull();
    expect(parseGpu(null)).toBeNull();
  });
});

describe('withUnifiedMemory — the machine states its own memory truth', () => {
  test('fills the trio from meminfo and says so', () => {
    const gpu = withUnifiedMemory(parseGpu(GB10_ROW), MEMINFO);
    expect(gpu.unified).toBe(true);
    expect(gpu.totalMB).toBe(Math.round(125509700 / 1024));
    expect(gpu.usedMB).toBe(Math.round((125509700 - 55639112) / 1024));
    expect(gpu.freeMB).toBe(gpu.totalMB - gpu.usedMB);
    // the driver's real readings survive the merge
    expect(gpu.utilPct).toBe(5);
  });

  test('never overwrites a discrete card\'s real numbers', () => {
    const gpu = withUnifiedMemory(parseGpu(RTX_ROW), MEMINFO);
    expect(gpu.totalMB).toBe(32768);
    expect(gpu.unified).toBe(false);
  });

  test('no meminfo → the honest nulls stand', () => {
    const gpu = withUnifiedMemory(parseGpu(GB10_ROW), null);
    expect(gpu.totalMB).toBeNull();
    expect(withUnifiedMemory(null, MEMINFO)).toBeNull();
  });
});
