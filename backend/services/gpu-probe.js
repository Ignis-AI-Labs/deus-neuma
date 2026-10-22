// GPU probe — name and VRAM, whoever made the card.
//
// WHY THIS EXISTS (ruling, 2026-08-02): […] The detector shelled out to `nvidia-smi` and returned
// null on failure — a branch whose own comment read […]. So a person with a Radeon and 24 GB of VRAM was
// told, in the first-run flight check, `no GPU detected`. Not a crash: a
// quieter failure, where the app is confidently wrong about the machine and
// steers a perfectly capable rig toward CPU inference.
//
// THE DESIGN IS ADDITIVE AND FAIL-SAFE. Every probe returns null rather than
// throwing, and they are tried in order. If the AMD path is wrong on some
// machine, the worst case is the null we already returned — this can report
// more than before, never less.
//
// Linux AMD is read from sysfs rather than `rocm-smi`, deliberately: sysfs is
// populated by the amdgpu kernel driver, so it answers on a stock desktop with
// no ROCm toolchain installed. Requiring ROCm would have meant "detected" only
// for people who had already done the hard part.
//
// impure at the edges (exec, fs); every parser below is pure.

import { readFile, readdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import { boundedExec } from './bounded-exec.js';

// Each probe answers within its bound with its whole process tree killed at
// the deadline (bounded-exec.js), so a hung nvidia-smi or CIM query on Windows
// is never left running behind the first-run flight check.
const PROBE_MS = 5000;
const WINDOWS_PROBE_MS = 8000;

/** PCI vendor id for AMD/ATI. Intel is 0x8086, NVIDIA 0x10de. */
const AMD_VENDOR = '0x1002';
const BYTES_PER_GB = 1024 ** 3;

/**
 * `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits`
 * → one GPU, or null. Pure.
 *
 * Unified-memory silicon (GB10, Jetson) answers "[N/A]" for memory.total
 * because its GPU memory IS system memory — say that, never "NaN GB".
 * @param {string} stdout
 * @param {number} systemRamBytes
 * @returns {{name:string, vramGB:number, unified:boolean, vendor:string}|null}
 */
export const parseNvidiaSmi = (stdout, systemRamBytes) => {
  const line = String(stdout ?? '').trim().split('\n')[0];
  if (!line) return null;
  const [name, vramMB] = line.split(',').map((s) => s.trim());
  if (!name) return null;
  const dedicated = Number.parseInt(vramMB, 10);
  return Number.isFinite(dedicated)
    ? { name, vramGB: Math.round(dedicated / 1024), unified: false, vendor: 'nvidia' }
    : { name, vramGB: Math.round(systemRamBytes / BYTES_PER_GB), unified: true, vendor: 'nvidia' };
};

/**
 * One AMD card's sysfs triple → a GPU record, or null. Pure.
 *
 * `mem_info_vram_total` is bytes. A card reporting 0 (or nothing) is not a
 * usable answer — an APU with no carve-out reads that way — so it is refused
 * rather than reported as a 0 GB GPU.
 * @param {{vendor?:string, vramBytes?:string, productName?:string, cardLabel?:string}} raw
 * @returns {{name:string, vramGB:number, unified:boolean, vendor:string}|null}
 */
export const parseAmdSysfs = ({ vendor, vramBytes, productName, cardLabel } = {}) => {
  if (String(vendor ?? '').trim().toLowerCase() !== AMD_VENDOR) return null;
  const bytes = Number.parseInt(String(vramBytes ?? '').trim(), 10);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const named = String(productName ?? '').trim();
  return {
    // product_name is absent on plenty of kernels; the card label keeps the
    // line honest instead of printing an empty name.
    name: named || `AMD GPU (${cardLabel || 'amdgpu'})`,
    vramGB: Math.round(bytes / BYTES_PER_GB),
    unified: false,
    vendor: 'amd',
  };
};

/**
 * Windows `Get-CimInstance Win32_VideoController` CSV → GPU, or null. Pure.
 *
 * The probe's `ConvertTo-Csv` (Windows PowerShell 5.1) QUOTES every field —
 * `[…],"4293918720"` — so both fields are unquoted
 * before they are read; a quoted number parsed as NaN and every card's VRAM
 * read unknown.
 *
 * AdapterRAM is a uint32 and therefore SATURATES AT 4 GB — an 8 GB card and a
 * 24 GB card both report a value pinned at the top of the field (4293918720
 * or 4294967295). Reporting 4 GB for a 24 GB card would be a confident lie
 * that sends a capable rig to CPU, so a saturated value yields a null VRAM:
 * the name is known, the size is not, and the caller says so.
 * @param {string} stdout
 * @returns {{name:string, vramGB:number|null, unified:boolean, vendor:string}|null}
 */
export const parseWindowsVideoController = (stdout) => {
  const line = String(stdout ?? '').trim().split('\n').map((l) => l.trim()).filter(Boolean)[0];
  if (!line) return null;
  const idx = line.lastIndexOf(',');
  if (idx === -1) return null;
  const unquote = (field) => field.trim().replace(/^"|"$/g, '').replace(/""/g, '"');
  const name = unquote(line.slice(0, idx));
  const ram = Number.parseInt(unquote(line.slice(idx + 1)), 10);
  if (!name) return null;
  // The field cannot hold 4 GB: anything at the 4095 MB mark or above is the
  // ceiling, not a size.
  const SATURATION_FLOOR = 0xFFF00000;
  const saturated = !Number.isFinite(ram) || ram <= 0 || ram >= SATURATION_FLOOR;
  const vendor = /amd|radeon|ati/i.test(name) ? 'amd' : /nvidia|geforce|quadro|rtx/i.test(name) ? 'nvidia' : 'unknown';
  return { name, vramGB: saturated ? null : Math.round(ram / BYTES_PER_GB), unified: false, vendor };
};

/**
 * Windows display adapters from the driver registry → the card with the most memory, or null. Pure.
 *
 * One `name<TAB>bytes` line per adapter, from the display class key's
 * `HardwareInformation.qwMemorySize` (64-bit: the true size of a 16 or 24 GB card, where WMI's
 * AdapterRAM stops at 4 GB) or `HardwareInformation.MemorySize`. Every adapter is read and the
 * largest wins, so a laptop's integrated graphics never stand in for its discrete card.
 * @param {string} stdout
 * @returns {{name:string, vramGB:number, unified:boolean, vendor:string}|null}
 */
export const parseWindowsAdapters = (stdout) => {
  const cards = String(stdout ?? '').split(/\r?\n/).map((line) => {
    const tab = line.lastIndexOf('\t');
    if (tab <= 0) return null;
    const name = line.slice(0, tab).trim();
    const bytes = Number(line.slice(tab + 1).trim());
    return name && Number.isFinite(bytes) && bytes > 0 ? { name, bytes } : null;
  }).filter(Boolean);
  const best = cards.reduce((a, c) => (!a || c.bytes > a.bytes ? c : a), null);
  if (!best || best.bytes < BYTES_PER_GB / 2) return null;
  const vendor = /amd|radeon|ati\b/i.test(best.name) ? 'amd'
    : /nvidia|geforce|quadro|rtx/i.test(best.name) ? 'nvidia'
      : /intel|arc/i.test(best.name) ? 'intel' : 'unknown';
  return { name: best.name, vramGB: Math.round(best.bytes / BYTES_PER_GB), unified: false, vendor };
};

/** impure — one sysfs attribute, or undefined. Never throws. */
const readAttr = async (dir, attr) => {
  try {
    return (await readFile(path.join(dir, attr), 'utf8')).trim();
  } catch {
    return undefined;
  }
};

/**
 * Walk /sys/class/drm for an AMD card. impure (fs). Never throws.
 *
 * The root is injectable so this can be exercised against a real directory
 * tree shaped like sysfs — a real filesystem read, not a stubbed one.
 * @param {string} [root]
 * @returns {Promise<object|null>}
 */
export const probeAmdLinux = async (root = '/sys/class/drm') => {
  try {
    const entries = await readdir(root);
    // card0, card1 … but not the card0-DP-1 connector nodes.
    const cards = entries.filter((e) => /^card\d+$/.test(e)).sort();
    for (const card of cards) {
      const device = path.join(root, card, 'device');
      const gpu = parseAmdSysfs({
        vendor: await readAttr(device, 'vendor'),
        vramBytes: await readAttr(device, 'mem_info_vram_total'),
        productName: await readAttr(device, 'product_name'),
        cardLabel: card,
      });
      if (gpu) return gpu; // first AMD card with real VRAM wins
    }
    return null;
  } catch {
    return null;
  }
};

/** impure — NVIDIA via nvidia-smi. Never throws. */
const probeNvidia = async () => {
  const r = await boundedExec('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeoutMs: PROBE_MS });
  return r.ok ? parseNvidiaSmi(r.stdout, os.totalmem()) : null;
};

/** impure — Windows, any vendor, via CIM. Never throws. */
const probeWindows = async () => {
  if (process.platform !== 'win32') return null;
  const r = await boundedExec('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Csv -NoTypeInformation | Select-Object -Skip 1',
  ], { timeoutMs: WINDOWS_PROBE_MS });
  return r.ok ? parseWindowsVideoController(r.stdout) : null;
};

// The registry read behind parseWindowsAdapters (Windows PowerShell 5.1, no modules)
const WINDOWS_ADAPTERS_PS = [
  "Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue |",
  'ForEach-Object { $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue;',
  "$b = $p.'HardwareInformation.qwMemorySize'; if (-not $b) { $b = $p.'HardwareInformation.MemorySize' };",
  'if ($b -is [byte[]]) { $b = [BitConverter]::ToUInt32($b, 0) };',
  // no double quotes: Node escapes them on a Windows command line and PowerShell 5.1 reads that unevenly
  'if ($p.DriverDesc -and $b) { $p.DriverDesc + [char]9 + $b } }',
].join(' ');

/** impure — Windows, every adapter's true memory from the driver registry. Never throws. */
const probeWindowsAdapters = async () => {
  if (process.platform !== 'win32') return null;
  const r = await boundedExec('powershell', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_ADAPTERS_PS], { timeoutMs: WINDOWS_PROBE_MS });
  return r.ok ? parseWindowsAdapters(r.stdout) : null;
};

// impure — one full probe, in vendor order. On Windows both probes run at once
// (nvidia-smi still wins when it answers), so the slower one never adds to the wait.
const probeOnce = async () => {
  if (process.platform === 'win32') {
    const [nvidia, adapters, windows] = await Promise.all([probeNvidia(), probeWindowsAdapters(), probeWindows()]);
    return nvidia ?? adapters ?? windows;
  }
  const nvidia = await probeNvidia();
  if (nvidia) return nvidia;
  return process.platform === 'linux' ? probeAmdLinux() : null;
};

// The card's name and VRAM cannot change under a running process, yet every
// RECORD open, flight check and substrate read spawned nvidia-smi again
// (~40 ms each, 2026-10-05). A FOUND card is remembered for the process's
// life; a miss is never remembered — a driver mid-reset answers null, and the
// next ask probes again. Concurrent asks share one probe.
let knownGpu = null;
let probing = null;

/**
 * The machine's GPU, whoever made it. impure. Never throws.
 *
 * NVIDIA first because nvidia-smi is the most precise answer available and
 * costs one exec; then AMD via sysfs on Linux; then the generic Windows probe,
 * which covers an AMD card on Windows and any vendor sysfs cannot see.
 * @returns {Promise<{name:string, vramGB:number|null, unified:boolean, vendor:string}|null>}
 */
export const detectGpu = async () => {
  if (knownGpu) return knownGpu;
  probing ??= probeOnce().finally(() => { probing = null; });
  const found = await probing;
  if (found) knownGpu = Object.freeze(found); // shared by every caller — never altered
  return knownGpu ?? found;
};
