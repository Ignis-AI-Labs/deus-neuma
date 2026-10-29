/**
 * MACHINE THERMALS (Design note, 2026-10-20: the machine's thermal and tuning readings,
 * flagged against each chip's OWN limits. Real outputs captured on this rig.
 */
import { describe, expect, test } from 'vitest';
import { nvmeChipOf, parseClockReasons, parseGpuRow, parseGpuTempLimits, parseSensors, thermalAlerts, thermalState } from '../../backend/services/machine-thermals.js';

// `sensors -j`, trimmed, this rig 2026-10-20 under an AA-Omniscience arm.
const SENSORS = {
  'spd5118-i2c-21-53': { Adapter: 'SMBus I801 adapter', temp1: { temp1_input: 68.75, temp1_max: 55.0, temp1_min: 0.0, temp1_crit: 85.0 } },
  'corsaircpro-hid-3-c': { Adapter: 'HID adapter', in0: { in0_input: 11.994 }, 'fan1 4pin': { fan1_input: 1654.0 } },
  'coretemp-isa-0000': { Adapter: 'ISA adapter', 'Package id 0': { temp1_input: 78.0, temp1_max: 85.0, temp1_crit: 105.0 } },
  'nvme-pci-0100': { Adapter: 'PCI adapter', Composite: { temp1_input: 57.9, temp1_max: 81.8, temp1_crit: 84.8 } },
  'acpitz-acpi-0': { Adapter: 'ACPI interface', temp1: { temp1_input: 27.8 } },
};
const GPU_ROW = 'NVIDIA RTX PRO 6000 Blackwell Workstation Edition, 100, 64, 428.85, 600.00, 600.00, 2730, 3090, 13365, 14001, 72, 53, 5, 5, 8, 16, P1, Disabled, 615.71.09';
const PERF = `GPU 00000000:02:00.0
    Performance State                                  : P1
    Clocks Event Reasons
        Idle                                           : Not Active
        SW Power Cap                                   : Not Active
        HW Slowdown                                    : Not Active
            HW Thermal Slowdown                        : Not Active
        SW Thermal Slowdown                            : Active
        Reliability                                    : Active
    Clocks Event Reasons Counters
        SW Power Capping                               : Active
`;

describe('machine thermals', () => {
  test('every sensor reads with its kind, its type and its own limits', () => {
    const r = parseSensors(SENSORS);
    const by = (chip, label) => r.find((x) => x.chip === chip && x.label === label);
    expect(by('spd5118-i2c-21-53', 'temp1')).toMatchObject({ kind: 'memory', type: 'temp', value: 68.75, high: 55, crit: 85, state: 'hot' });
    expect(by('corsaircpro-hid-3-c', 'fan1 4pin')).toMatchObject({ kind: 'cooling', type: 'fan', value: 1654 });
    expect(by('corsaircpro-hid-3-c', 'in0')).toMatchObject({ type: 'volt', value: 11.994 });
    expect(by('coretemp-isa-0000', 'Package id 0')).toMatchObject({ kind: 'cpu', state: 'ok' });
    expect(by('nvme-pci-0100', 'Composite')).toMatchObject({ kind: 'storage', state: 'ok' });
    expect(by('acpitz-acpi-0', 'temp1')).toMatchObject({ kind: 'board', high: null, state: 'ok' });
  });

  test('a reading is judged by its chip own marks: ok, hot, critical', () => {
    expect([thermalState(50, 55, 85), thermalState(60, 55, 85), thermalState(90, 55, 85), thermalState(NaN, 55, 85)])
      .toEqual(['ok', 'hot', 'critical', 'unknown']);
  });

  test('the GPU row reads every tuning fact, N/A as null', () => {
    const gpu = parseGpuRow(GPU_ROW);
    expect(gpu).toMatchObject({ fanPct: 100, tempC: 64, powerW: 428.85, powerLimitW: 600, smMHz: 2730, smMaxMHz: 3090, pstate: 'P1' });
    expect(gpu.pcie).toEqual({ gen: 5, genMax: 5, width: 8, widthMax: 16 });
    expect(parseGpuRow(GPU_ROW.replace('64', 'N/A')).tempC).toBeNull();
  });

  test('clock reasons are read from the reasons, never from their counters', () => {
    expect(parseClockReasons(PERF)).toEqual(['SW Thermal Slowdown', 'Reliability']);
  });

  test('alerts name what is past its own mark, and a real clock limit — never Reliability alone', () => {
    const alerts = thermalAlerts({ readings: parseSensors(SENSORS), clockReasons: ['SW Thermal Slowdown', 'Reliability'] });
    expect(alerts).toEqual([
      'memory DIMM temp1 (spd5118-i2c-21-53) at 68.8°C — past its high mark 55°C',
      'GPU clocks limited by: SW Thermal Slowdown',
    ]);
    expect(thermalAlerts({ readings: [], clockReasons: ['Reliability'] })).toEqual([]);
  });

  // `nvidia-smi -q -d PERFORMANCE,TEMPERATURE`, this rig 2026-10-24 (driver 615.71.09): the marks as T.Limit offsets.
  const TEMPS = `${PERF}    Temperature
        GPU Current Temp                               : 37 C
        GPU Current Max Temp                           : N/A
        GPU Current T.Limit Temp                       : 56 C
        GPU Shutdown T.Limit Temp Specification        : -5 C
        GPU Slowdown T.Limit Temp Specification        : -2 C
        GPU Max Operating T.Limit Temp Specification   : 0 C
        GPU Target Temperature Specification           : N/A
`;
  test('the GPU’s own temperature marks: T.Limit offsets from the live headroom, or °C as older drivers state them', () => {
    expect(parseGpuTempLimits(TEMPS)).toEqual({ maxOperatingC: 93, slowdownC: 95, shutdownC: 98 });
    expect(parseGpuTempLimits('        GPU Shutdown Temp                 : 96 C\n        GPU Slowdown Temp                 : 93 C\n        GPU Max Operating Temp            : 88 C\n'))
      .toEqual({ maxOperatingC: 88, slowdownC: 93, shutdownC: 96 });
    expect(parseGpuTempLimits(PERF)).toEqual({ maxOperatingC: null, slowdownC: null, shutdownC: null });
    // the counters section still ends the reasons when the temperatures follow it
    expect(parseClockReasons(TEMPS)).toEqual(['SW Thermal Slowdown', 'Reliability']);
  });
  test('an NVMe PCI address names the chip its temperatures arrive under', () => {
    expect(nvmeChipOf('0000:05:00.0')).toBe('nvme-pci-0500');
    expect(nvmeChipOf('0000:85:00.0')).toBe('nvme-pci-8500');
    expect(nvmeChipOf('0000:00:1f.4')).toBe('nvme-pci-00fc');
    expect(nvmeChipOf('nonsense')).toBeNull();
  });
});
