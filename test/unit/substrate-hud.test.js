/**
 * SUBSTRATE HUD — the substrate window as instruments: the pure
 * layer under the instruments. SHINKEI — a dial sweeps exactly its ratio, a
 * trace's top is the number its label states, a missing sample breaks the
 * line — and the machine's readings shaped into each panel, from `sensors -j`
 * captured on this rig 2026-10-21 through the real backend parser.
 */
import { describe, expect, test } from 'vitest';
import { parseSensors } from '../../backend/services/machine-thermals.js';
import { DIAL_START, DIAL_SWEEP, arcBetween, dialArc, niceCeil, ratioOf, ringSegments, traceMax, tracePath } from '../../frontend/app/RelinkShell/hud-geometry.js';
import { HISTORY_CAP, pushSample, sampleOf, seriesOf } from '../../frontend/app/RelinkShell/sample-history.js';
import { boardRows, chipName, cpuView, dimmRows, driveRows, fanGroups, railView, ramParts, tempLine, thermalAxis, vramParts } from '../../frontend/app/RelinkShell/machine-view.js';
import { cardParts } from '../../frontend/app/RelinkShell/ServingFitCard.jsx';

// `sensors -j`, trimmed, this rig 2026-10-21 (DIMMs past their 55°C mark).
const SENSORS = {
  'spd5118-i2c-21-53': { Adapter: 'SMBus I801 adapter', temp1: { temp1_input: 61.5, temp1_max: 55.0, temp1_crit: 85.0 } },
  'spd5118-i2c-21-50': { Adapter: 'SMBus I801 adapter', temp1: { temp1_input: 54.0, temp1_max: 55.0, temp1_crit: 85.0 } },
  'corsaircpro-hid-3-c': {
    Adapter: 'HID adapter',
    in0: { in0_input: 12.0 }, in1: { in1_input: 5.157 }, in2: { in2_input: 3.367 },
    'fan1 4pin': { fan1_input: 1657.0 }, 'fan2 4pin': { fan2_input: 1659.0 },
  },
  'nct6799-isa-0290': {
    Adapter: 'ISA adapter',
    in0: { in0_input: 1.224 },
    fan1: { fan1_input: 0.0 }, fan2: { fan2_input: 0.0 },
    SYSTIN: { temp1_input: 40.0, temp1_max: 80.0, temp1_crit: 125.0 },
  },
  'coretemp-isa-0000': {
    Adapter: 'ISA adapter',
    'Package id 0': { temp1_input: 74.0, temp1_max: 85.0, temp1_crit: 105.0 },
    'Core 10': { temp2_input: 56.0, temp2_max: 85.0, temp2_crit: 105.0 },
    'Core 4': { temp3_input: 74.0, temp3_max: 85.0, temp3_crit: 105.0 },
  },
  'nvme-pci-8500': { Adapter: 'PCI adapter', Composite: { temp1_input: 52.85, temp1_max: 82.85, temp1_crit: 84.85 }, 'Sensor 1': { temp2_input: 52.85, temp2_max: 65261.85 } },
  'nvme-pci-0100': { Adapter: 'PCI adapter', Composite: { temp1_input: 50.85, temp1_max: 81.85, temp1_crit: 84.85 } },
  'r8169_0_8200:00-mdio-0': { Adapter: 'MDIO adapter', temp1: { temp1_input: 54.0, temp1_max: 120.0 } },
};
const READINGS = parseSensors(SENSORS);

const sweepOf = (path) => {
  // the arc's end point → its angle on the dial, back to a ratio
  const [, , , , , , , , , x, y] = path.split(' ').map(Number);
  let deg = (Math.atan2(y - 36, x - 36) * 180) / Math.PI;
  while (deg < DIAL_START - 1e-6) deg += 360;
  return (deg - DIAL_START) / DIAL_SWEEP;
};

describe('hud geometry — SHINKEI', () => {
  test('a dial sweeps exactly its ratio', () => {
    for (const r of [0.05, 0.25, 0.5, 0.79, 0.94, 1]) expect(sweepOf(dialArc(36, 36, 28, r))).toBeCloseTo(r, 3);
  });
  test('an unmeasured ratio draws nothing, never a zero sweep', () => {
    expect(ratioOf(null, 100)).toBeNull();
    expect(ratioOf(5, 0)).toBeNull();
    expect(dialArc(36, 36, 28, null)).toBe('');
    expect(arcBetween(36, 36, 28, 90, 90)).toBe('');
  });
  test('a ratio past the scale is held at the scale', () => {
    expect(ratioOf(120, 100)).toBe(1);
    expect(ratioOf(-3, 100)).toBe(0);
  });
  test('the large-arc flag turns exactly past 180°', () => {
    expect(dialArc(36, 36, 28, 170 / 270)).toContain(' 0 0 1 ');
    expect(dialArc(36, 36, 28, 190 / 270)).toContain(' 0 1 1 ');
  });
  test('slots read as one segment each, from 12 o’clock', () => {
    const segs = ringSegments(4);
    expect(segs).toHaveLength(4);
    expect(segs[0][0]).toBeCloseTo(-87, 6);
    expect(ringSegments(0)).toEqual([]);
    expect(ringSegments(1)).toEqual([[-90, 270]]);
  });
  test('a trace’s top is a nameable 1·2·5 step at or above what it holds', () => {
    expect(niceCeil(82)).toBe(100);
    expect(niceCeil(17)).toBe(20);
    expect(niceCeil(5)).toBe(5);
    expect(traceMax([null, 31, 64], 50)).toBe(100);
    expect(traceMax([], 50)).toBe(50);
  });
  test('the newest sample sits on the right edge; a missing one breaks the line', () => {
    const p = tracePath([10, null, 20, 40], 5, 160, 40, 40);
    expect(p).toBe('M 40 30 M 120 20 L 160 0');
    expect(tracePath([], 5, 160, 40, 40)).toBe('');
  });
});

describe('sample history', () => {
  test('keeps the last HISTORY_CAP polls, oldest dropped', () => {
    let h = [];
    for (let i = 0; i < HISTORY_CAP + 5; i += 1) h = pushSample(h, sampleOf({ activity: { genTokPerSec: i } }));
    expect(h).toHaveLength(HISTORY_CAP);
    expect(seriesOf(h, 'gen')[0]).toBe(5);
    expect(seriesOf(h, 'gpuTemp').every((v) => v === null)).toBe(true);
  });
});

describe('machine view — this rig’s readings, by part', () => {
  test('DIMMs by slot, each against its own marks', () => {
    const d = dimmRows(READINGS);
    expect(d.map((r) => r.name)).toEqual(['DIMM 1', 'DIMM 4']);
    expect(d[1]).toMatchObject({ value: 61.5, high: 55, crit: 85, state: 'hot' });
    expect(thermalAxis(d)).toBe(90);
  });
  test('the CPU’s cores in core order, the package apart', () => {
    const { pkg, cores } = cpuView(READINGS);
    expect(pkg).toMatchObject({ name: 'Package', value: 74, high: 85, crit: 105 });
    expect(cores.map((c) => c.name)).toEqual(['C4', 'C10']);
  });
  test('each drive by its Composite only (by PCI address when no model was read) — the bogus 65261 °C sensor mark never reaches an axis', () => {
    const d = driveRows(READINGS);
    expect(d.map((r) => r.name)).toEqual(['nvme 0100', 'nvme 8500']);
    expect(thermalAxis(d)).toBe(90);
  });
  test('board and network temperatures by plain name: the chip label mapped, a lone temp1 named for its device', () => {
    expect(boardRows(READINGS).map((r) => r.name)).toEqual(['Motherboard', 'Network card']);
  });
  test('fans by controller; a 0 rpm header is counted, not drawn', () => {
    expect(fanGroups(READINGS)).toEqual([
      { source: 'CORSAIR', spinning: [{ key: 'corsaircpro-hid-3-c:fan1 4pin', name: 'FAN1', rpm: 1657 }, { key: 'corsaircpro-hid-3-c:fan2 4pin', name: 'FAN2', rpm: 1659 }], idle: 0 },
      { source: 'BOARD', spinning: [], idle: 2 },
    ]);
  });
  test('Corsair rails carry their drift from nominal; unlabelled inputs make no claim', () => {
    const { named, bare } = railView(READINGS);
    expect(named.map((r) => r.name)).toEqual(['12 V', '5 V', '3.3 V']);
    expect(named[1].drift).toBeCloseTo(0.0314, 3);
    expect(bare).toEqual([{ key: 'nct6799-isa-0290:in0', name: 'IN0', value: 1.224 }]);
  });
  test('names and lines stay as the card has always said them', () => {
    expect(chipName('spd5118-i2c-21-50')).toBe('DIMM 1');
    expect(tempLine({ value: 68.8, high: 55, crit: 85 })).toBe('68.8°C (high 55 · crit 85)');
  });
});

describe('memory as parts of a whole', () => {
  test('RAM parts sum to the total', () => {
    const parts = ramParts({ totalMB: 128000, usedMB: 60000, server: { anonMB: 20000 } });
    expect(parts.map((p) => p.value)).toEqual([20000, 40000, 68000]);
    expect(ramParts({})).toEqual([]);
  });
  test('VRAM: three largest holders, the rest folded, the unlisted remainder, free — summing to the card', () => {
    const procs = [{ pid: 4046872, name: '3', memMB: 80000 }, { pid: 2, name: 'a', memMB: 300 }, { pid: 3, name: 'b', memMB: 200 }, { pid: 4, name: 'c', memMB: 100 }];
    const parts = vramParts({ totalMB: 97887, usedMB: 81000 }, procs);
    // the model server exec'd from /proc/self/fd/3 reaches the driver as "3": it is named by its PID
    expect(parts.map((p) => p.label)).toEqual(['PID 4046872', 'A', 'B', '1 MORE', 'UNLISTED', 'FREE']);
    expect(parts.reduce((a, p) => a + p.value, 0)).toBe(97887);
  });
  test('the GPU share is a mark at share × the card', () => {
    const c = cardParts({ gpu: { totalMiB: 100000, usedMiB: 70000 }, serverMiB: 65000 }, 90);
    expect(c.parts.map((p) => p.value)).toEqual([65000, 5000, 30000]);
    expect(c.marks[0].at).toBe(90000);
    expect(cardParts({ gpu: null }, 90)).toBeNull();
  });
});
