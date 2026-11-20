/**
 * MACHINE HOLDERS — who holds the GPU's memory, the system's memory and each
 * CPU core, by name (Design note, 2026-11-20: […]).
 *
 * One read for both doors: the SUBSTRATE window and a being's `machine_map`
 * tool. Read-only. On Linux every holder is a named process (/proc); on other
 * systems the totals are read and the per-process lists say they are not.
 * The naming and the folding are machine-holders-shape.js (pure).
 */
import { execFile } from 'child_process';
import { readFile, readdir, readlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { readClaim } from './substrate-claim-registry.js';
import {
  coreLoads, foldHolders, identifyProcess, parseCoreTimes, parseGpuHolders, parseMeminfo, parseProcStat, parseProcStatus,
} from './machine-holders-shape.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAMPLE_MS = 300;
const LIST = 12;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quiet = (promise, fallback = null) => promise.catch(() => fallback);

// impure — one nvidia-smi query, '' when there is no such tool or card.
const smi = async (args) => quiet(execFileAsync('nvidia-smi', args, { timeout: 4000, encoding: 'utf8' }).then((r) => r.stdout), '');

// impure — what one process is made of: its real program, arguments and folder,
// and — for a model server handed its model as an open file — that file.
const readProcess = async (pid, procRoot) => {
  const dir = path.join(procRoot, String(pid));
  const [cmdline, exe, cwd, comm] = await Promise.all([
    quiet(readFile(path.join(dir, 'cmdline'), 'utf8'), ''),
    quiet(readlink(path.join(dir, 'exe'))),
    quiet(readlink(path.join(dir, 'cwd'))),
    quiet(readFile(path.join(dir, 'comm'), 'utf8'), ''),
  ]);
  const argv = cmdline.split('\0').filter(Boolean);
  const i = argv.findIndex((a) => a === '--model' || a === '-m');
  const handle = i >= 0 ? /^\/proc\/self\/fd\/(\d+)$/.exec(argv[i + 1] || '') : null;
  const modelFile = handle ? await quiet(readlink(path.join(dir, 'fd', handle[1]))) : null;
  return { pid, argv, exe, cwd, comm: comm.trim() || null, modelFile };
};

// impure — every process's run time and last core, by pid.
const readRunTimes = async (pids, procRoot) => {
  const times = new Map();
  await Promise.all(pids.map(async (pid) => {
    const stat = parseProcStat(await quiet(readFile(path.join(procRoot, String(pid), 'stat'), 'utf8'), ''));
    if (stat) times.set(pid, stat);
  }));
  return times;
};

// impure — the cores one process's threads are busy on. A model server is dozens of threads, and the process's
// own "last core" names only one of them; so its threads are read twice a moment apart, and every thread that
// ran in between names its core with the share of a core it used.
const THREAD_MS = 150;
const readThreadCores = async (pids, procRoot) => {
  const snap = async () => new Map(await Promise.all(pids.map(async (pid) => {
    const dir = path.join(procRoot, String(pid), 'task');
    const tids = await quiet(readdir(dir), []);
    const rows = await Promise.all(tids.map(async (tid) => [tid, parseProcStat(await quiet(readFile(path.join(dir, tid, 'stat'), 'utf8'), ''))]));
    return [pid, new Map(rows.filter(([, stat]) => stat))];
  })));
  const a = await snap();
  await delay(THREAD_MS);
  const b = await snap();
  const hz = THREAD_MS / 10; // jiffies in the window at the kernel's usual 100 per second
  return new Map(pids.map((pid) => {
    const share = new Map();
    for (const [tid, after] of b.get(pid) || []) {
      const before = a.get(pid)?.get(tid);
      const ran = before ? after.jiffies - before.jiffies : 0;
      if (ran > 0 && Number.isInteger(after.core)) share.set(after.core, (share.get(after.core) || 0) + (ran / hz) * 100);
    }
    return [pid, share];
  }));
};

// impure — the pids this platform itself answers for: the mind its claim names.
const knownPids = async (enginePid) => {
  const claim = await quiet(Promise.resolve().then(() => readClaim()));
  const mindPids = [claim?.pid, claim?.serverPid].filter((p) => Number.isInteger(p));
  return { mindPids, enginePid: Number.isInteger(enginePid) ? enginePid : null, repoRoot: REPO_ROOT };
};

/**
 * Read the map.
 * @param {{procRoot?:string, enginePid?:(number|null), platform?:string}} [opts] - enginePid: the image
 *   engine this platform supervises, so it is told apart from one started by hand
 * @returns {Promise<{readAt:string, gpu:(Object|null), gpuWhy?:string, ram:Object, cpu:Object}>}
 */
export const readMachineHolders = async ({ procRoot = '/proc', enginePid = null, platform = process.platform } = {}) => {
  const linux = platform === 'linux';
  const known = await knownPids(enginePid);
  const [gpuCsv, appsCsv, coreText0, pids] = await Promise.all([
    smi(['--query-gpu=name,memory.used,memory.total,utilization.gpu', '--format=csv,noheader,nounits']),
    smi(['--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits']),
    linux ? quiet(readFile(path.join(procRoot, 'stat'), 'utf8'), '') : '',
    linux ? quiet(readdir(procRoot).then((names) => names.filter((n) => /^\d+$/.test(n)).map(Number)), []) : [],
  ]);
  const osCores0 = linux ? null : os.cpus().map((c) => ({ busy: c.times.user + c.times.nice + c.times.sys + c.times.irq, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
  const run0 = await readRunTimes(pids, procRoot);
  await delay(SAMPLE_MS);
  const [coreText1, run1, meminfo, statuses] = await Promise.all([
    linux ? quiet(readFile(path.join(procRoot, 'stat'), 'utf8'), '') : '',
    readRunTimes(pids, procRoot),
    linux ? quiet(readFile(path.join(procRoot, 'meminfo'), 'utf8'), '') : '',
    Promise.all(pids.map(async (pid) => [pid, parseProcStatus(await quiet(readFile(path.join(procRoot, String(pid), 'status'), 'utf8'), ''))])),
  ]);

  // CPU: each core's busy share over the sample, and each process's share of one core.
  const before = linux ? parseCoreTimes(coreText0) : osCores0;
  const after = linux ? parseCoreTimes(coreText1) : os.cpus().map((c) => ({ busy: c.times.user + c.times.nice + c.times.sys + c.times.irq, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
  const loads = coreLoads(before, after);
  const tick = after.reduce((a, c, i) => a + Math.max(0, (c?.total ?? 0) - (before[i]?.total ?? 0)), 0) / Math.max(1, after.length);
  const cpuOf = (pid) => {
    const a = run0.get(pid); const b = run1.get(pid);
    return a && b && tick > 0 ? Math.max(0, ((b.jiffies - a.jiffies) / tick) * 100) : 0;
  };

  // Only the processes that hold something are named: every GPU holder, and the heaviest by memory and by CPU.
  const ramOf = new Map(statuses);
  const gpuRows = parseGpuHolders(appsCsv);
  const heavy = (score) => [...pids].sort((a, b) => score(b) - score(a)).slice(0, 60);
  const wanted = new Set([...gpuRows.map((g) => g.pid), ...heavy((p) => ramOf.get(p)?.ramMB ?? 0), ...heavy(cpuOf).filter((p) => cpuOf(p) >= 1)]);
  const facts = new Map(await Promise.all([...wanted].map(async (pid) => [pid, linux ? await readProcess(pid, procRoot) : { pid, argv: [] }])));
  const vramOf = new Map(gpuRows.map((g) => [g.pid, g.vramMB]));
  const busiest = [...wanted].filter((pid) => cpuOf(pid) >= 2).sort((a, b) => cpuOf(b) - cpuOf(a)).slice(0, 16);
  const threadCores = linux ? await readThreadCores(busiest, procRoot) : new Map();
  const named = [...wanted].map((pid) => ({
    pid,
    identity: identifyProcess(facts.get(pid), known),
    vramMB: vramOf.get(pid) || 0,
    ramMB: ramOf.get(pid)?.ramMB || 0,
    swapMB: ramOf.get(pid)?.swapMB || 0,
    cpu: cpuOf(pid),
    cores: [...(threadCores.get(pid) || new Map()).entries()].filter(([, share]) => share >= 5).map(([core]) => core),
  }));

  const [name, usedMB, totalMB, loadPct] = gpuCsv.split('\n')[0].split(',').map((c) => c.trim());
  const gpuRead = /^\d+$/.test(totalMB || '');
  const gpuHolders = foldHolders(named, 'vramMB').map((h) => ({
    ...h,
    // What can return this memory, in the words of the tool that does it.
    ...(h.kind === 'image-engine' && h.ours ? { lever: 'forge_control {act: "unload"} returns it' } : {}),
  }));
  const ram = parseMeminfo(meminfo);
  const cpuHolders = foldHolders(named, 'cpu').filter((h) => h.cpu >= 1).slice(0, LIST);
  // The named process using the most of each core.
  const onCore = new Map();
  for (const p of named) {
    for (const [core, share] of threadCores.get(p.pid) || []) {
      if (share >= 10 && (onCore.get(core)?.share ?? 0) < share) onCore.set(core, { share, label: p.identity.label });
    }
  }
  const why = linux ? null : 'which processes hold it is read on Linux only';
  return {
    readAt: new Date().toISOString(),
    gpu: gpuRead ? {
      name: name || null,
      usedMB: Number(usedMB), totalMB: Number(totalMB), freeMB: Number(totalMB) - Number(usedMB),
      loadPct: /^\d+$/.test(loadPct || '') ? Number(loadPct) : null,
      holders: gpuHolders,
      unattributedMB: Math.max(0, Number(usedMB) - gpuHolders.reduce((a, h) => a + h.vramMB, 0)),
    } : null,
    ...(gpuRead ? {} : { gpuWhy: 'no NVIDIA card answered; other cards are sized in the flight check but not mapped by process yet' }),
    ram: linux
      ? { ...ram, holders: foldHolders(named, 'ramMB').slice(0, LIST) }
      : { totalMB: Math.round(os.totalmem() / 1048576), availableMB: Math.round(os.freemem() / 1048576), usedMB: Math.round((os.totalmem() - os.freemem()) / 1048576), swapTotalMB: null, swapUsedMB: null, holders: [], holdersWhy: why },
    cpu: {
      name: os.cpus()[0]?.model?.trim() || null,
      loadPct: loads.length ? Math.round(loads.reduce((a, b) => a + b, 0) / loads.length) : 0,
      load1: linux ? Math.round(os.loadavg()[0] * 10) / 10 : null,
      cores: loads.map((loadPct, core) => ({ core, loadPct, holder: onCore.get(core)?.label ?? null })),
      holders: cpuHolders,
      ...(why ? { holdersWhy: why } : {}),
    },
  };
};
