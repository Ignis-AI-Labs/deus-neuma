/**
 * SUBSTRATE LEGIBLE — the machine read in two seconds. The pure layer under
 * the health strip and the board panel, against this rig's recorded read
 * (test/fixtures/substrate/rig-snapshot.json, scripts/record-substrate-snapshot.mjs):
 * plain sensor names, which readings are not believed and why, each part's
 * level against its own marks — and the console itself rendered by react-dom.
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { NO_SENSE, SENSE, doubtIn, sensorName, trackSense } from '../../frontend/app/RelinkShell/machine-sense.js';
import { WARM_SHARE, gpuHealth, heatLevel, machineHealth, powerHealth, worse } from '../../frontend/app/RelinkShell/machine-health.js';
import { boardGroups, driveGroups, driveRows } from '../../frontend/app/RelinkShell/machine-view.js';
import { SubstrateConsole } from '../../frontend/app/RelinkShell/SubstrateConsole.jsx';
import { pushSample, sampleOf } from '../../frontend/app/RelinkShell/sample-history.js';
import '../../frontend/i18n/index.js';

const SNAPSHOT = JSON.parse(readFileSync(new URL('../fixtures/substrate/rig-snapshot.json', import.meta.url), 'utf8'));
const POLLS = SNAPSHOT.machine;
const LAST = POLLS.at(-1);
const SENSED = POLLS.reduce((m, p) => trackSense(m, p.readings), NO_SENSE);
const reading = (label, chip = 'nct6799-isa-0290') => LAST.readings.find((r) => r.chip === chip && r.label === label);
const temp = (label, value, chip = 'nct6799-isa-0290') => ({ chip, kind: 'board', label, type: 'temp', value, high: 80, crit: 125, state: 'ok' });

describe('sensor names — the part a reading sits on, only where the mapping is published', () => {
  test('the super-I/O labels and the lone-reading devices read as parts', () => {
    expect(sensorName(reading('SYSTIN'))).toBe('Motherboard');
    expect(sensorName(reading('CPUTIN'))).toBe('CPU socket');
    expect(sensorName(reading('PCH_CHIP_TEMP'))).toBe('Chipset');
    expect(sensorName(reading('PECI Agent 0'))).toBe('CPU (board)');
    expect(sensorName(reading('PECI/TSI Agent 0 Calibration'))).toBe('CPU calibration');
    expect(sensorName(reading('temp1', 'iwlwifi_1-virtual-0'))).toBe('Wi-Fi card');
    expect(sensorName(reading('temp1', 'r8169_0_8200:00-mdio-0'))).toBe('Network card');
    expect(sensorName(reading('temp1', 'acpitz-acpi-0'))).toBe('ACPI zone');
  });
  test('an input the chip leaves unlabelled is an input, never a guess', () => {
    expect(sensorName(reading('AUXTIN3'))).toBe('Input 3');
    expect(sensorName({ chip: 'mystery-isa-0', label: 'temp7' })).toBe('temp7');
  });
});

describe('belief — a reading that is not a temperature never reads as heat', () => {
  test('on this rig: the floating AUXTIN3 and the 0° chipset register, nothing else', () => {
    expect(SENSED.doubt).toEqual({ 'nct6799-isa-0290:AUXTIN3': 'swing', 'nct6799-isa-0290:PCH_CHIP_CPU_MAX_TEMP': 'floor' });
    // its neighbours on the same chip held still across the same polls
    for (const label of ['SYSTIN', 'CPUTIN', 'AUXTIN0', 'AUXTIN1', 'AUXTIN2', 'AUXTIN4', 'AUXTIN5']) expect(SENSED.swing[`nct6799-isa-0290:${label}`]).toBeLessThan(2);
    expect(doubtIn(SENSED, reading('AUXTIN3'))).toMatch(/^jumped \d+° between reads — input floating$/);
    expect(doubtIn(SENSED, reading('PCH_CHIP_CPU_MAX_TEMP'))).toBe('reads 0° — no sensor reports here');
    expect(doubtIn(SENSED, reading('SYSTIN'))).toBeNull();
  });
  test('the register ceiling is open on a single read; a swing needs two reads', () => {
    expect(doubtIn(NO_SENSE, temp('AUXTIN3', SENSE.CEILING_C))).toMatch(/ceiling — input open/);
    expect(doubtIn(NO_SENSE, temp('AUXTIN3', 109))).toBeNull();
    const once = trackSense(NO_SENSE, [temp('AUXTIN3', 40)]);
    expect(doubtIn(trackSense(once, [temp('AUXTIN3', 40 + SENSE.SWING_C - 1)]), temp('AUXTIN3', 59))).toBeNull();
    expect(doubtIn(trackSense(once, [temp('AUXTIN3', 40 + SENSE.SWING_C)]), temp('AUXTIN3', 60))).toMatch(/jumped 20°/);
  });
  test('a doubt holds for the session, so a floating input never flips back into a row', () => {
    let m = trackSense(NO_SENSE, [temp('AUXTIN3', 40)]);
    m = trackSense(m, [temp('AUXTIN3', 105)]);
    m = trackSense(m, [temp('AUXTIN3', 41)]);
    m = trackSense(m, [temp('AUXTIN3', 41)]);
    expect(doubtIn(m, temp('AUXTIN3', 41))).toMatch(/jumped 65°/);
  });
  test('only the board’s slow thermistor inputs are judged by swing — a CPU reading moves fast for real', () => {
    const peci = (v) => ({ ...temp('PECI Agent 0', v), high: 103, crit: null });
    const m = trackSense(trackSense(NO_SENSE, [peci(40)]), [peci(80)]);
    expect(doubtIn(m, peci(80))).toBeNull();
  });
});

describe('levels — each part against its own marks', () => {
  test('WARM within 10% of the high mark, HOT past it, FAULT past critical', () => {
    expect(WARM_SHARE).toBe(0.9);
    expect(heatLevel(49, 55, 85)).toBe('ok');
    expect(heatLevel(49.5, 55, 85)).toBe('warm');
    expect(heatLevel(55, 55, 85)).toBe('hot');
    expect(heatLevel(85, 55, 85)).toBe('fault');
    expect(heatLevel(60, null, null)).toBe('ok');
    expect(heatLevel(null, 55, 85)).toBe('unknown');
    expect(worse('ok', 'warm')).toBe('warm');
    expect(worse('fault', 'hot')).toBe('fault');
  });
  test('this rig: every part named with the number that decides it; the DIMMs sit warm near their 55° mark', () => {
    const cells = machineHealth(LAST, SNAPSHOT.telemetry.gpu, (r) => !doubtIn(SENSED, r));
    expect(cells.map((c) => c.part)).toEqual(['gpu', 'cpu', 'memory', 'storage', 'board', 'power']);
    const by = Object.fromEntries(cells.map((c) => [c.part, c]));
    expect(by.memory).toMatchObject({ level: 'warm', unit: '°' });
    expect(by.memory.what).toMatch(/^DIMM \d \+3 more · high 55°$/);
    expect(by.gpu).toMatchObject({ level: 'ok', value: SNAPSHOT.telemetry.gpu.tempC, what: 'max 93°' });
    // the board is judged by its own sensors — the floating input and the CPU's relayed PECI never decide it
    expect(by.board.what).toBe('CPU socket · high 80°');
    expect(by.power).toMatchObject({ level: 'ok', panel: 'board' });
  });
  test('believing the floating input would have cried wolf on the board', () => {
    const hot = { ...LAST, readings: LAST.readings.map((r) => (r.label === 'AUXTIN3' ? { ...r, value: 122 } : r)) };
    expect(machineHealth(hot, null).find((c) => c.part === 'board').level).toBe('hot');
    expect(machineHealth(hot, null, (r) => !doubtIn(SENSED, r)).find((c) => c.part === 'board').level).toBe('ok');
  });
  test('the GPU: past max operating HOT, past slowdown FAULT; a thermal clock limit is a FAULT, Reliability is quiet', () => {
    const g = (tempC, clockReasons = []) => ({ tempC, clockReasons, tempLimits: { maxOperatingC: 93, slowdownC: 95 } });
    expect(gpuHealth(g(36, ['Reliability'])).level).toBe('ok');
    expect(gpuHealth(g(94)).level).toBe('hot');
    expect(gpuHealth(g(95)).level).toBe('fault');
    expect(gpuHealth(g(60, ['SW Thermal Slowdown']))).toMatchObject({ level: 'fault', what: 'limited: sw thermal slowdown' });
    expect(gpuHealth(g(60, ['SW Power Cap'])).level).toBe('warm');
    expect(gpuHealth(null).level).toBe('unknown');
  });
  test('power: a rail past the ATX ±5% is a FAULT, past 4.5% WARM', () => {
    const rail = (in1) => [{ chip: 'corsaircpro-hid-3-b', label: 'in1', type: 'volt', value: in1 }];
    expect(powerHealth(rail(5.148))).toMatchObject({ level: 'ok', value: '+3.0' });
    expect(powerHealth(rail(5.23)).level).toBe('warm');
    expect(powerHealth(rail(5.3)).level).toBe('fault');
    expect(powerHealth([]).level).toBe('unknown');
  });
});

describe('drives and board, as the console groups them', () => {
  test('drives by device, grouped by model so a model is said once', () => {
    const rows = driveRows(LAST.readings, LAST.drives);
    expect(rows.map((r) => r.name)).toEqual(['nvme0', 'nvme1', 'nvme2', 'nvme3', 'nvme4', 'nvme5', 'nvme6']);
    expect(driveGroups(rows).map((g) => [g.model, g.rows.length])).toEqual([
      ['Samsung SSD 990 PRO 4TB', 1], ['KINGSTON SFYR2S4T0', 5], ['WD_BLACK SN850X 4000GB', 1],
    ]);
  });
  test('the board: named sensors, unlabelled inputs, and the doubted set apart — every reading in exactly one place', () => {
    const { named, inputs, doubted } = boardGroups(LAST.readings, (r) => doubtIn(SENSED, r));
    expect(named.map((r) => r.name)).toEqual(['Motherboard', 'CPU socket', 'CPU (board)', 'CPU calibration', 'Chipset', 'ACPI zone', 'Network card', 'Wi-Fi card']);
    expect(inputs.map((r) => r.name)).toEqual(['Input 0', 'Input 1', 'Input 2', 'Input 4', 'Input 5']);
    expect(doubted.map((r) => r.name)).toEqual(['Input 3', 'Chipset CPU max']);
    const all = LAST.readings.filter((r) => r.type === 'temp' && (r.kind === 'board' || r.kind === 'network'));
    expect(named.length + inputs.length + doubted.length).toBe(all.length);
  });
});

describe('the console, rendered', () => {
  const html = renderToStaticMarkup(createElement(SubstrateConsole, {
    tel: SNAPSHOT.telemetry, loaded: true, machine: LAST, sense: SENSED,
    history: pushSample([], sampleOf(SNAPSHOT.telemetry)), acting: false, act: async () => {},
  }));
  // what a person sees: the text, with every tag and its attributes (hover titles) stripped
  const seen = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  test('the health strip leads, one cell per part, each wearing its level', () => {
    expect(html.indexOf('class="hlth"')).toBeLessThan(html.indexOf('sub-grid'));
    expect(html.match(/class="hlth-cell cham is-(ok|warm|hot|fault|unknown)"/g)).toHaveLength(6);
    expect(html).toContain('hlth-cell cham is-warm');
  });
  test('plain names on screen; the chip codes only in hover titles', () => {
    for (const name of ['Motherboard', 'CPU socket', 'Chipset', 'Wi-Fi card', 'Network card', 'Samsung SSD 990 PRO 4TB', 'nvme5']) expect(seen).toContain(name);
    for (const code of ['SYSTIN', 'CPUTIN', 'AUXTIN', 'PCH_CHIP', 'iwlwifi', 'r8169', 'acpitz', 'nvme-pci']) expect(seen).not.toContain(code);
    expect(html).toContain('title="nct6799-isa-0290 SYSTIN');
  });
  test('the doubted readings are named apart with their reasons, and every panel wears its part', () => {
    expect(seen).toMatch(/NOT BELIEVED · Input 3, Chipset CPU max/);
    expect(seen).toMatch(/input floating/);
    for (const part of ['gpu', 'cpu', 'memory', 'storage', 'board']) expect(html).toContain(`data-part="${part}"`);
  });
});
