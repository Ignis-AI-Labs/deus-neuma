// Who holds the machine — naming a process by what it is, the parsers, the
// folding, and the read itself against this machine's own /proc and against a
// written-out process table. The facts in the naming cases are the ones the
// rig showed on 2026-11-20, when the mind read as "/proc/self/fd/3". RULE 0.
/* global process */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  argAfter, coreLoads, foldHolders, identifyProcess, parseCoreTimes, parseGpuHolders, parseMeminfo, parseProcStat,
  parseProcStatus, shapeMachineHolders,
} from '../../backend/services/machine-holders-shape.js';
import { readMachineHolders } from '../../backend/services/machine-holders.js';
import { MACHINE_MAP_TOOL, handleSubstrateFactsTool, isSubstrateFactsTool } from '../../backend/services/substrate-facts-being-tool.js';

const REPO = '/workspace/repos/neuma';
const MIND = {
  pid: 16486, exe: '/opt/llama.cpp/build-cuda/bin/llama-server', cwd: REPO, comm: '3',
  argv: ['/proc/self/fd/3', '--model', '/proc/self/fd/4', '-c', '665856', '--host', '127.0.0.1', '--port', '8089'],
  modelFile: '/models/neuma/qwen3.8-27B-Neuma-T4-Q6_K.gguf',
};

describe('naming a process by what it is', () => {
  it('the mind, launched through a passed handle, is named with the model file it serves', () => {
    expect(identifyProcess(MIND, { mindPids: [16486] })).toEqual({
      kind: 'mind', label: 'The mind (language model)', detail: 'qwen3.8-27B-Neuma-T4-Q6_K.gguf · port 8089', ours: true,
    });
    // The same program, not the one this platform claims: a model server, not the mind.
    expect(identifyProcess(MIND, { mindPids: [] })).toMatchObject({ kind: 'model-server', ours: false });
    // With no handle to resolve, the passed-handle path is never shown as if it were a file.
    expect(identifyProcess({ ...MIND, modelFile: null }, { mindPids: [16486] }).detail).toBe('port 8089');
  });

  it('the image engine: this platform\'s own, or one started by hand', () => {
    const engine = { pid: 31, exe: '/mnt/external/comfyui/app/.venv/bin/python', cwd: '/mnt/external/comfyui/app', argv: ['/mnt/external/comfyui/app/.venv/bin/python', '/mnt/external/comfyui/app/main.py', '--port', '8190'] };
    expect(identifyProcess(engine, { enginePid: 31 })).toEqual({ kind: 'image-engine', label: 'Image engine (ComfyUI)', detail: 'port 8190', ours: true });
    expect(identifyProcess(engine, { enginePid: 99 })).toMatchObject({ detail: 'port 8190 · not started by this platform', ours: false });
  });

  it('voice, dictation, the platform, the desktop, and a program installed under its version number', () => {
    const py = (script) => ({ pid: 1, exe: '/x/.venv/bin/python3', argv: ['/x/.venv/bin/python3', script] });
    expect(identifyProcess(py(`${REPO}/voice-engines/whisper/server.py`))).toMatchObject({ kind: 'voice', label: 'Voice engine (whisper)', ours: true });
    expect(identifyProcess(py('/workspace/repos/project-pabamir/ears/plugins/ears/daemon/ptt.py'))).toMatchObject({ kind: 'dictation', label: 'Dictation (ears)', ours: false });
    expect(identifyProcess(py('/home/u/tools/download.py'))).toMatchObject({ kind: 'other', label: 'python · download.py' });
    expect(identifyProcess({ pid: 2, exe: '/usr/bin/node', cwd: REPO, argv: ['node', 'backend/server.js'] }, { repoRoot: REPO })).toMatchObject({ kind: 'platform', label: 'This platform', detail: 'server.js', ours: true });
    expect(identifyProcess({ pid: 3, exe: `${REPO}/node_modules/electron/dist/electron`, cwd: REPO, argv: ['electron', '.'] }, { repoRoot: REPO })).toMatchObject({ label: 'This platform (desk window)', ours: true });
    expect(identifyProcess({ pid: 4, exe: '/usr/bin/kwin_wayland', argv: ['/usr/bin/kwin_wayland'] })).toMatchObject({ kind: 'desktop', label: 'Desktop (window compositor)' });
    expect(identifyProcess({ pid: 5, exe: '/opt/brave.com/brave/brave', argv: ['/opt/brave.com/brave/brave', '--type=gpu-process'] }).label).toBe('Brave browser');
    expect(identifyProcess({ pid: 6, exe: '/home/u/.local/share/claude/versions/2.1.322', comm: 'claude', argv: ['claude'] }).label).toBe('claude');
    expect(identifyProcess({ pid: 7 }).label).toBe('pid 7');
    expect(argAfter(['a', '--port', '9'], '--port', '-p')).toBe('9');
    expect(argAfter(['a', '--port'], '--port')).toBeNull();
  });
});

describe('the parsers', () => {
  it('the driver\'s process list, the memory file, the core times and a process\'s own lines', () => {
    expect(parseGpuHolders('3298, 419\n16486, 68888\nnot a row\n')).toEqual([{ pid: 3298, vramMB: 419 }, { pid: 16486, vramMB: 68888 }]);
    expect(parseMeminfo('MemTotal:       131072000 kB\nMemAvailable:   65536000 kB\nSwapTotal:       8388608 kB\nSwapFree:        4194304 kB\n'))
      .toEqual({ totalMB: 128000, availableMB: 64000, usedMB: 64000, swapTotalMB: 8192, swapUsedMB: 4096 });
    expect(parseMeminfo('')).toMatchObject({ totalMB: null, usedMB: null, swapUsedMB: null });
    const before = parseCoreTimes('cpu  10 0 10 80 0 0 0 0\ncpu0 5 0 5 40 0 0 0 0\ncpu1 5 0 5 40 0 0 0 0\n');
    const after = parseCoreTimes('cpu  10 0 10 80 0 0 0 0\ncpu0 55 0 5 90 0 0 0 0\ncpu1 5 0 5 140 0 0 0 0\n');
    expect(coreLoads(before, after)).toEqual([50, 0]);
    // A name with spaces and brackets must not shift the fields.
    const stat = `77 (Web Content (x) y) S ${Array.from({ length: 40 }, (_, i) => (i === 10 ? 300 : i === 11 ? 200 : i === 35 ? 6 : 0)).join(' ')}`;
    expect(parseProcStat(stat)).toEqual({ jiffies: 500, core: 6 });
    expect(parseProcStat('garbage')).toBeNull();
    expect(parseProcStatus('Name:\tx\nVmRSS:\t  2097152 kB\nVmSwap:\t   1024 kB\n')).toEqual({ ramMB: 2048, swapMB: 1 });
    expect(parseProcStatus('Name:\tkthreadd\n')).toEqual({ ramMB: 0, swapMB: 0 });
  });
});

describe('folding processes into holders', () => {
  const browser = { kind: 'desktop', label: 'Brave browser', detail: null, ours: false };
  const procs = [
    { pid: 9, identity: browser, ramMB: 300, cpu: 4, cores: [2] },
    { pid: 8, identity: browser, ramMB: 500, vramMB: 339, cpu: 1.26, cores: [5] },
    { pid: 1, identity: identifyProcess(MIND, { mindPids: [16486] }), ramMB: 21000, vramMB: 68888, swapMB: 700, cpu: 83, cores: [4] },
  ];

  it('one holder per thing, its figures summed, largest first', () => {
    const byRam = foldHolders(procs, 'ramMB');
    expect(byRam.map((h) => [h.label, h.ramMB, h.pids])).toEqual([['The mind (language model)', 21000, [1]], ['Brave browser', 800, [8, 9]]]);
    expect(byRam[1]).toMatchObject({ vramMB: 339, cpu: 5.3, cores: [2, 5] });
    expect(foldHolders(procs, 'vramMB').map((h) => h.vramMB)).toEqual([68888, 339]);
    expect(foldHolders([{ pid: 1, identity: browser, ramMB: 5 }], 'vramMB')).toEqual([]);
  });

  it('reads out as three lists a being can act on', () => {
    const text = shapeMachineHolders({
      readAt: '2026-11-20T09:00:00.000Z',
      gpu: { name: 'RTX PRO 6000', usedMB: 80000, totalMB: 97887, freeMB: 17887, loadPct: 16, unattributedMB: 4000, holders: [{ ...foldHolders(procs, 'vramMB')[0] }, { kind: 'image-engine', label: 'Image engine (ComfyUI)', detail: 'port 8190', ours: true, pids: [3], vramMB: 15000, lever: 'forge_control {act: "unload"} returns it' }] },
      ram: { totalMB: 128000, availableMB: 64000, usedMB: 64000, swapUsedMB: 8192, holders: foldHolders(procs, 'ramMB') },
      cpu: { name: 'Core Ultra 9', loadPct: 27, load1: 10.5, cores: [{ core: 0, loadPct: 3, holder: null }, { core: 4, loadPct: 100, holder: 'The mind (language model)' }], holders: foldHolders(procs, 'cpu') },
    });
    expect(text).toContain('GPU — RTX PRO 6000: 78.1 GB of 95.6 GB held, 17.5 GB free, 16% busy.');
    expect(text).toContain('1. 67.3 GB — The mind (language model) (qwen3.8-27B-Neuma-T4-Q6_K.gguf · port 8089) · this platform\'s');
    expect(text).toContain('2. 14.6 GB — Image engine (ComfyUI) (port 8190) · this platform\'s · forge_control {act: "unload"} returns it');
    expect(text).toContain('3.9 GB held by nothing the driver names');
    expect(text).toContain('MEMORY — 62.5 GB of 125.0 GB in use, 62.5 GB available, 8.0 GB in swap.');
    expect(text).toContain('2. 0.8 GB — Brave browser · 2 processes');
    expect(text).toContain('Busy cores (50% or more): #4 100% The mind (language model).');
    expect(text).toContain('1. 83% of one core — The mind (language model)');
    expect(shapeMachineHolders({ readAt: 'x', gpu: null, gpuWhy: 'no NVIDIA card answered', ram: null, cpu: null })).toContain('GPU — no NVIDIA card answered.');
  });
});

describe('the read', () => {
  it.runIf(process.platform === 'linux')('on this machine: every core, the memory total, and this test named among the holders', async () => {
    const map = await readMachineHolders();
    expect(map.cpu.cores).toHaveLength(os.cpus().length);
    expect(map.cpu.cores.every((c) => c.loadPct >= 0 && c.loadPct <= 100)).toBe(true);
    expect(Math.abs(map.ram.totalMB - os.totalmem() / 1048576)).toBeLessThan(64);
    expect(map.ram.holders.length).toBeGreaterThan(0);
    expect(map.ram.holders.every((h) => h.label && h.ramMB > 0 && h.pids.length > 0)).toBe(true);
    const sorted = map.ram.holders.map((h) => h.ramMB);
    expect(sorted).toEqual([...sorted].sort((a, b) => b - a));
    if (map.gpu) expect(map.gpu.usedMB + map.gpu.freeMB).toBe(map.gpu.totalMB);
  }, 20000);

  it('a written-out process table: the handle a model server was given is followed to its file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'machine-holders-'));
    try {
      const model = path.join(root, 'tiny-model.gguf');
      await fs.writeFile(model, 'x');
      const stat = (ran) => `41 (llama-server) S ${Array.from({ length: 40 }, (_, i) => (i === 10 ? ran : i === 35 ? 0 : 0)).join(' ')}`;
      await fs.mkdir(path.join(root, '41', 'fd'), { recursive: true });
      await fs.mkdir(path.join(root, '41', 'task', '41'), { recursive: true });
      await fs.writeFile(path.join(root, '41', 'cmdline'), ['/proc/self/fd/3', '--model', '/proc/self/fd/4', '--port', '8089', ''].join('\0'));
      await fs.symlink('/opt/llama/bin/llama-server', path.join(root, '41', 'exe'));
      await fs.symlink(model, path.join(root, '41', 'fd', '4'));
      await fs.writeFile(path.join(root, '41', 'comm'), '3\n');
      await fs.writeFile(path.join(root, '41', 'stat'), stat(10));
      await fs.writeFile(path.join(root, '41', 'task', '41', 'stat'), stat(10));
      await fs.writeFile(path.join(root, '41', 'status'), 'VmRSS:\t 4194304 kB\nVmSwap:\t 0 kB\n');
      await fs.writeFile(path.join(root, 'stat'), 'cpu0 1 0 1 98 0 0 0 0\n');
      await fs.writeFile(path.join(root, 'meminfo'), 'MemTotal: 16777216 kB\nMemAvailable: 8388608 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n');
      const map = await readMachineHolders({ procRoot: root, platform: 'linux' });
      expect(map.ram).toMatchObject({ totalMB: 16384, usedMB: 8192 });
      expect(map.ram.holders).toHaveLength(1);
      expect(map.ram.holders[0]).toMatchObject({ kind: 'model-server', detail: 'tiny-model.gguf · port 8089', ramMB: 4096, pids: [41] });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 20000);
});

describe('machine_map, the being\'s read of it', () => {
  it('answers by either spelling with the three lists, and leaves substrate_facts its own answer', async () => {
    expect(MACHINE_MAP_TOOL.name).toBe('machine_map');
    expect(isSubstrateFactsTool({ toolName: 'machine_map' })).toBe(true);
    expect(isSubstrateFactsTool({ tool: 'coding/machine_map' })).toBe(true);
    expect(isSubstrateFactsTool({ tool: 'coding/inspect' })).toBe(false);
    const read = await handleSubstrateFactsTool(null, {}, { tool: 'coding/machine_map' });
    expect(read).toMatchObject({ tool: 'coding/machine_map', status: 'ok' });
    expect(read.content).toMatch(/^GPU — /);
    expect(read.content).toContain('MEMORY — ');
    expect(read.content).toContain('CPU — ');
    expect((await handleSubstrateFactsTool(null, {}, { toolName: 'substrate_facts' })).tool).toBe('coding/substrate_facts');
  }, 20000);
});
