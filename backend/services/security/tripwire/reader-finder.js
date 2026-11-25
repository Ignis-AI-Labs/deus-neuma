// Reader finder — who has a decoy open, and who else was running when it was
// read. Everything comes from /proc as this user sees it: no root, no ptrace.
//
// What this can and cannot prove, stated once: a process caught HOLDING a
// decoy open is the reader, with certainty. A reader that opened, read and
// closed before the scan ran is not named — the kernel does not say who
// opened a file after the fact without root. Those reads are still seen and
// reported; the processes that had just started are listed as candidates,
// never as a verdict.
//
// A finding never carries a command line: arguments hold tokens and
// passwords. It carries the executable and, for a script runtime, the script
// path.

import fs from 'fs/promises';
import { basename } from 'path';

const TICKS_PER_SECOND = 100; // USER_HZ, fixed at 100 on every Linux ABI
const SCRIPT_RUNTIMES = new Set(['node', 'python', 'python3', 'bun', 'deno', 'ruby', 'perl', 'php', 'bash', 'sh', 'java']);

/**
 * pure — the fields of /proc/<pid>/stat this module reads. The command name
 * sits in parentheses and may itself hold spaces or parentheses, so the split
 * is taken after the LAST closing one.
 * @returns {?{comm: string, state: string, ppid: number, startTicks: number}}
 */
export const parseProcStat = (text) => {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  const rest = text.slice(close + 2).trim().split(' ');
  const ppid = Number(rest[1]);
  const startTicks = Number(rest[19]);
  if (!Number.isFinite(ppid) || !Number.isFinite(startTicks)) return null;
  return { comm: text.slice(open + 1, close), state: rest[0], ppid, startTicks };
};

/** pure — the machine's boot time (epoch ms) from /proc/stat, or null. */
export const parseBootTimeMs = (text) => {
  const match = /^btime\s+(\d+)$/m.exec(text);
  return match ? Number(match[1]) * 1000 : null;
};

/**
 * pure — the script a runtime is running: its first argument that is an
 * absolute path. Never any other argument.
 */
export const scriptOf = (exe, args) => {
  if (!SCRIPT_RUNTIMES.has(basename(exe || '').replace(/[\d.]+$/, ''))) return null;
  const script = args.slice(1).find((a) => a.startsWith('/'));
  return script ? script.slice(0, 200) : null;
};

const read = (path) => fs.readFile(path, 'utf8').catch(() => null);

// impure — every numeric entry of /proc.
const listPids = async () => (await fs.readdir('/proc')).filter((n) => /^\d+$/.test(n)).map(Number);

// impure — boot time, read once.
let bootTimeMs = null;
const bootTime = async () => {
  if (bootTimeMs === null) bootTimeMs = parseBootTimeMs(await read('/proc/stat') || '') || 0;
  return bootTimeMs;
};

/**
 * One process as a finding may describe it, or null when it is gone or not
 * ours to read. impure.
 * @returns {Promise<?{pid: number, comm: string, exe: ?string, script: ?string, ppid: number, state: string, startedAtMs: number}>}
 */
export const describeProcess = async (pid) => {
  const stat = parseProcStat(await read(`/proc/${pid}/stat`) || '');
  if (!stat) return null;
  const exe = await fs.readlink(`/proc/${pid}/exe`).catch(() => null);
  const args = (await read(`/proc/${pid}/cmdline`) || '').split('\0').filter(Boolean);
  return {
    pid,
    comm: stat.comm,
    exe,
    script: scriptOf(exe, args),
    ppid: stat.ppid,
    state: stat.state,
    startedAtMs: (await bootTime()) + (stat.startTicks / TICKS_PER_SECOND) * 1000,
  };
};

/**
 * Every process holding one of `paths` open right now. impure.
 * @param {Iterable<string>} paths absolute file paths
 * @param {{skip?: Set<number>}} [opts] pids never reported (this process)
 * @returns {Promise<Array<{pid: number, path: string}>>}
 */
export const holdersOf = async (paths, { skip = new Set() } = {}) => {
  const wanted = new Set(paths);
  const found = [];
  await Promise.all((await listPids()).filter((pid) => !skip.has(pid)).map(async (pid) => {
    const fds = await fs.readdir(`/proc/${pid}/fd`).catch(() => []);
    await Promise.all(fds.map(async (fd) => {
      const target = await fs.readlink(`/proc/${pid}/fd/${fd}`).catch(() => null);
      if (target && wanted.has(target) && !found.some((f) => f.pid === pid && f.path === target)) {
        found.push({ pid, path: target });
      }
    }));
  }));
  return found;
};

/**
 * The chain of parents above `pid`, nearest first. impure.
 * @returns {Promise<number[]>}
 */
export const ancestorsOf = async (pid, limit = 16) => {
  const chain = [];
  let current = pid;
  while (chain.length < limit) {
    const stat = parseProcStat(await read(`/proc/${current}/stat`) || '');
    if (!stat || stat.ppid <= 0) break;
    chain.push(stat.ppid);
    current = stat.ppid;
  }
  return chain;
};

/**
 * Processes of this user that started within `withinMs` of `atMs` — the
 * candidates listed beside a read whose reader was not caught. impure.
 * @returns {Promise<Array<Object>>} youngest first, at most `limit`
 */
export const recentProcesses = async ({ atMs = Date.now(), withinMs = 120000, limit = 12, skip = new Set() } = {}) => {
  const described = await Promise.all((await listPids()).filter((pid) => !skip.has(pid)).map(describeProcess));
  return described
    .filter((p) => p && p.exe && atMs - p.startedAtMs <= withinMs)
    .sort((a, b) => b.startedAtMs - a.startedAtMs)
    .slice(0, limit);
};
