/**
 * MACHINE THERMALS — every reading this machine offers that matters for
 * thermal control and performance tuning, for the SUBSTRATE window (Founder,
 * 2026-10-20: […]).
 *
 * Sources, all read-only: nvidia-smi (temperature, fans, power and its limits,
 * clocks against their maximums, PCIe link, and the driver's own clock-limit
 * reasons), `sensors -j` (every hwmon chip with its own high/critical limits:
 * CPU, memory DIMMs, NVMe, board, network, case fans, rails), cpufreq (governor,
 * energy preference, turbo), each NVMe drive's model (/sys/class/nvme) and the
 * bench-fans service. A reading at or past its
 * chip's own high mark is flagged — the limits are the hardware's, never ours.
 */
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PROBE_MS = 5000;
const BENCH_LOCK = '/workspace/repos/project-fuvofos/active.lock';

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.+-]/g, ''));
  return String(v ?? '').trim() === '' || /N\/A|Not Supported/i.test(String(v)) || !Number.isFinite(n) ? null : n;
};

/** pure — a reading's state against its own hardware limits. */
export const thermalState = (value, high, crit) => {
  if (!Number.isFinite(value)) return 'unknown';
  if (Number.isFinite(crit) && crit > 0 && value >= crit) return 'critical';
  if (Number.isFinite(high) && high > 0 && value >= high) return 'hot';
  return 'ok';
};

const KIND = [
  [/^coretemp|^k10temp|^zenpower/, 'cpu'],
  [/^spd5118|^jc42/, 'memory'],
  [/^nvme/, 'storage'],
  [/^acpitz|^asus|^nct|^it87/, 'board'],
  [/^r8169|^iwlwifi|^igc|^e1000/, 'network'],
  [/^corsair|^nzxt|^kraken/, 'cooling'],
];
const kindOf = (chip) => KIND.find(([re]) => re.test(chip))?.[1] ?? 'other';

/**
 * pure — `sensors -j` → flat readings {chip, kind, label, type, value, high, crit, state}.
 * Temperatures carry their chip's own max/crit; fans read RPM; rails read volts.
 */
export const parseSensors = (json) => {
  const out = [];
  for (const [chip, entries] of Object.entries(json ?? {})) {
    const kind = kindOf(chip);
    for (const [label, fields] of Object.entries(entries ?? {})) {
      if (label === 'Adapter' || !fields || typeof fields !== 'object') continue;
      const key = (suffix) => Object.keys(fields).find((k) => k.endsWith(suffix));
      const value = fields[key('_input')];
      if (!Number.isFinite(value)) continue;
      const type = /^fan/.test(key('_input')) ? 'fan' : /^in\d/.test(key('_input')) ? 'volt' : 'temp';
      const high = type === 'temp' ? fields[key('_max')] ?? null : null;
      const crit = type === 'temp' ? fields[key('_crit')] ?? null : null;
      out.push(Object.freeze({ chip, kind, label, type, value, high, crit, state: type === 'temp' ? thermalState(value, high, crit) : 'ok' }));
    }
  }
  return out;
};

export const GPU_FIELDS = Object.freeze([
  'name', 'fan.speed', 'temperature.gpu', 'power.draw', 'power.limit', 'power.max_limit',
  'clocks.sm', 'clocks.max.sm', 'clocks.mem', 'clocks.max.mem', 'utilization.gpu', 'utilization.memory',
  'pcie.link.gen.current', 'pcie.link.gen.max', 'pcie.link.width.current', 'pcie.link.width.max',
  'pstate', 'persistence_mode', 'driver_version',
]);

/** pure — one nvidia-smi csv row (GPU_FIELDS order, noheader) → the GPU's thermal and tuning facts. */
export const parseGpuRow = (row) => {
  const v = String(row ?? '').split(',').map((s) => s.trim());
  if (v.length < GPU_FIELDS.length) return null;
  const [name, fan, temp, power, limit, maxLimit, sm, smMax, mem, memMax, util, memUtil, gen, genMax, width, widthMax, pstate, persistence, driver] = v;
  return Object.freeze({
    name, fanPct: num(fan), tempC: num(temp),
    powerW: num(power), powerLimitW: num(limit), powerMaxW: num(maxLimit),
    smMHz: num(sm), smMaxMHz: num(smMax), memMHz: num(mem), memMaxMHz: num(memMax),
    utilPct: num(util), memUtilPct: num(memUtil),
    pcie: { gen: num(gen), genMax: num(genMax), width: num(width), widthMax: num(widthMax) },
    pstate, persistence, driver,
  });
};

/** pure — the clock-limit reasons the driver reports Active (`nvidia-smi -q -d PERFORMANCE`). */
export const parseClockReasons = (text) => {
  const section = String(text ?? '').split(/Clocks Event Reasons Counters|Clocks Throttle Reasons Counters/)[0];
  return [...section.matchAll(/^\s+([A-Za-z][A-Za-z /]+?)\s+:\s+Active\s*$/gm)].map((m) => m[1].trim());
};

/** pure — the alerts worth saying: anything at or past its own high mark, and any real clock limit. */
export const thermalAlerts = ({ readings = [], clockReasons = [] }) => {
  const alerts = readings.filter((r) => r.state === 'hot' || r.state === 'critical')
    .map((r) => `${r.kind === 'memory' ? 'memory DIMM' : r.kind} ${r.label} (${r.chip}) at ${r.value.toFixed(1)}°C — past its ${r.state === 'critical' ? 'critical' : 'high'} mark ${r.state === 'critical' ? r.crit : r.high}°C`);
  // Reliability is the GPU's normal voltage-reliability cap at high boost — information, not a fault.
  const limiting = clockReasons.filter((r) => !/^(Idle|Reliability|Applications Clocks Setting|Display Clock Setting)$/.test(r));
  if (limiting.length) alerts.push(`GPU clocks limited by: ${limiting.join(', ')}`);
  return alerts;
};

const degC = (text, label) => num(new RegExp(`^\\s*${label}\\s*:\\s*(-?[\\d.]+) C\\s*$`, 'm').exec(text)?.[1]);

/**
 * pure — the GPU's OWN temperature marks from `nvidia-smi -q -d TEMPERATURE`:
 * its max operating temperature (high) and its slowdown temperature (crit).
 * Current drivers state them as T.Limit offsets from the live headroom ([…] = 56° below max operating; slowdown spec -2 =
 * 2° past it); older drivers state them in °C outright. Null when unstated.
 */
export const parseGpuTempLimits = (text) => {
  const t = String(text ?? '');
  const now = degC(t, 'GPU Current Temp');
  const headroom = degC(t, 'GPU Current T\\.Limit Temp');
  const offset = (spec) => {
    const v = degC(t, `GPU ${spec} T\\.Limit Temp Specification`);
    return Number.isFinite(now) && Number.isFinite(headroom) && Number.isFinite(v) ? now + headroom - v : null;
  };
  const stated = (spec) => degC(t, `GPU ${spec} Temp`);
  return Object.freeze({
    maxOperatingC: offset('Max Operating') ?? stated('Max Operating'),
    slowdownC: offset('Slowdown') ?? stated('Slowdown'),
    shutdownC: offset('Shutdown') ?? stated('Shutdown'),
  });
};

/** pure — an NVMe PCI address (0000:05:00.0) → the chip name `sensors` gives its hwmon (nvme-pci-0500: bus, then device<<3|function). */
export const nvmeChipOf = (address) => {
  const m = /^[0-9a-f]{4}:([0-9a-f]{2}):([0-9a-f]{2})\.([0-7])$/i.exec(String(address ?? '').trim());
  if (!m) return null;
  const devfn = (parseInt(m[2], 16) << 3) | Number(m[3]);
  return `nvme-pci-${m[1].toLowerCase()}${devfn.toString(16).padStart(2, '0')}`;
};

const run = (bin, args) => execFileAsync(bin, args, { timeout: PROBE_MS, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  .then(({ stdout }) => stdout).catch(() => null);
const readText = (path) => readFile(path, 'utf8').then((s) => s.trim()).catch(() => null);

/** impure — the CPU's frequency and tuning: model, governor, energy preference, turbo, clocks, load. */
const readCpu = async () => {
  const [cpuinfo, governor, epp, noTurbo, loadavg] = await Promise.all([
    readText('/proc/cpuinfo'),
    readText('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor'),
    readText('/sys/devices/system/cpu/cpu0/cpufreq/energy_performance_preference'),
    readText('/sys/devices/system/cpu/intel_pstate/no_turbo'),
    readText('/proc/loadavg'),
  ]);
  const mhz = [...String(cpuinfo ?? '').matchAll(/^cpu MHz\s*:\s*([\d.]+)/gm)].map((m) => Number(m[1]));
  const maxKHz = await readText('/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq');
  return Object.freeze({
    model: String(cpuinfo ?? '').match(/^model name\s*:\s*(.+)$/m)?.[1] ?? null,
    threads: mhz.length || null,
    avgMHz: mhz.length ? Math.round(mhz.reduce((a, b) => a + b, 0) / mhz.length) : null,
    peakMHz: mhz.length ? Math.round(Math.max(...mhz)) : null,
    maxMHz: num(maxKHz) ? Math.round(num(maxKHz) / 1000) : null,
    governor, energyPreference: epp,
    turbo: noTurbo === null ? null : noTurbo === '0',
    load: loadavg ? loadavg.split(' ').slice(0, 3).map(Number) : null,
  });
};

/** impure — each NVMe drive's model, keyed by the chip name its temperatures arrive under. */
const readDrives = async () => {
  const names = await readdir('/sys/class/nvme').catch(() => []);
  const drives = await Promise.all(names.filter((n) => /^nvme\d+$/.test(n)).map(async (device) => {
    const [model, address] = await Promise.all([readText(`/sys/class/nvme/${device}/model`), readText(`/sys/class/nvme/${device}/address`)]);
    const chip = nvmeChipOf(address);
    return chip ? Object.freeze({ chip, device, model: model || null }) : null;
  }));
  return drives.filter(Boolean);
};

/** impure — the bench-fans service: running, and whether it is holding the fans at full now. */
const readFanService = async () => {
  const active = (await run('systemctl', ['is-active', 'bench-fans.service']))?.trim() ?? null;
  return Object.freeze({ active: active === 'active', benchRunning: existsSync(BENCH_LOCK) });
};

/** impure — the whole machine, read live. Fields a machine cannot answer read null. */
export const readMachineThermals = async () => {
  const [gpuCsv, perf, sensorsJson, cpu, fanService, drives] = await Promise.all([
    run('nvidia-smi', [`--query-gpu=${GPU_FIELDS.join(',')}`, '--format=csv,noheader,nounits']),
    // One spawn for both: the clock-limit reasons and the GPU's own temperature marks.
    run('nvidia-smi', ['-q', '-d', 'PERFORMANCE,TEMPERATURE']),
    run('sensors', ['-j']),
    readCpu(),
    readFanService(),
    readDrives(),
  ]);
  let json;
  try { json = sensorsJson ? JSON.parse(sensorsJson) : null; } catch { json = null; }
  const readings = parseSensors(json);
  const gpu = gpuCsv ? parseGpuRow(gpuCsv.split('\n')[0]) : null;
  const clockReasons = perf ? parseClockReasons(perf) : [];
  return Object.freeze({
    at: new Date().toISOString(),
    gpu: gpu ? { ...gpu, clockReasons, tempLimits: parseGpuTempLimits(perf) } : null,
    cpu,
    readings,
    drives,
    fanService,
    alerts: thermalAlerts({ readings, clockReasons }),
  });
};
