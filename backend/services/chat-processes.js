// chat-processes — every process a chat started that is still running (Design note, 2026-11-19, a crawl and a downloader a
// being left running […]: […]).
//
// Every command a chat runs carries one mark in its environment (witness-coding-sandbox.js): NEUMA_STARTED_BY =
// wallet|lane|chat. An environment is the one thing a detached process keeps — nohup, setsid, a trailing & — so
// whatever a command started is found again by that mark, however it was let go, and grouped by its process group.
// Read from /proc (Linux, where the rig runs); elsewhere the list says it cannot look. A group stops only for the
// wallet whose chat started it. impure (the process table, signals).

import fs from 'node:fs/promises';
import process from 'node:process';

export const STARTED_BY = 'NEUMA_STARTED_BY';
const TICK_HZ = 100;

/** pure — the mark a chat's command carries: whose, which being, which chat. */
export const startedByOf = ({ wallet, laneId, sessionId }) => [String(wallet ?? '').toLowerCase(), laneId ?? '', sessionId ?? ''].join('|');
/** pure — the mark read back, or null. */
export const readMark = (value) => {
  const [wallet, laneId, sessionId] = String(value ?? '').split('|');
  return wallet && laneId ? { wallet, laneId, sessionId: sessionId || null } : null;
};

/** pure — one /proc/<pid>/stat line: its parent, process group and start (in clock ticks since boot). */
export const parseStat = (line) => {
  const after = String(line).slice(String(line).lastIndexOf(')') + 2).split(' ');
  return { state: after[0], ppid: Number(after[1]), pgid: Number(after[2]), startTicks: Number(after[19]) };
};

const read = (p) => fs.readFile(p, 'utf8').catch(() => null);

// impure — when the machine booted, to turn a process's start ticks into a time.
const bootedAt = async () => {
  const uptime = Number(String(await read('/proc/uptime') ?? '').split(' ')[0]);
  return Number.isFinite(uptime) ? Date.now() - uptime * 1000 : null;
};

/**
 * impure — every process still running that a chat started, one row a process group, newest first.
 * @param {{wallet?: string, laneId?: string, sessionId?: string, fresh?: boolean}} [only] narrow to one owner, one being, one chat (fresh: walk now)
 * @returns {Promise<{supported: boolean, groups: Array<{pgid: number, pids: number[], command: string, cwd: ?string, startedAt: ?string, laneId: string, sessionId: ?string}>}>}
 */
// Every open chat reads the list every few seconds: one walk of the process table serves them all for a moment.
const FRESH_MS = 2000;
let walked = null; // { at, found }

export const listChatProcesses = async (only = {}) => {
  if (process.platform !== 'linux') return { supported: false, groups: [] };
  if (!walked || Date.now() - walked.at > FRESH_MS || only.fresh) walked = { at: Date.now(), found: await walk() };
  const found = walked.found.filter((p) => (!only.wallet || p.wallet === String(only.wallet).toLowerCase())
    && (!only.laneId || p.laneId === only.laneId) && (!only.sessionId || p.sessionId === only.sessionId));
  return { supported: true, groups: groupsOf(found) };
};

// impure — every live process carrying a chat's mark.
const walk = async () => {
  const boot = await bootedAt();
  const pids = (await fs.readdir('/proc').catch(() => [])).filter((d) => /^\d+$/.test(d)).map(Number).filter((pid) => pid !== process.pid);
  const found = [];
  await Promise.all(pids.map(async (pid) => {
    const env = await read(`/proc/${pid}/environ`);
    if (!env || !env.includes(`${STARTED_BY}=`)) return;
    const mark = readMark(env.split('\0').find((kv) => kv.startsWith(`${STARTED_BY}=`))?.slice(STARTED_BY.length + 1));
    if (!mark) return;
    const stat = await read(`/proc/${pid}/stat`);
    if (!stat) return;
    const s = parseStat(stat);
    if (s.state === 'Z') return;
    const command = String(await read(`/proc/${pid}/cmdline`) ?? '').split('\0').filter(Boolean).join(' ').slice(0, 400);
    const cwd = await fs.readlink(`/proc/${pid}/cwd`).catch(() => null);
    const startedAt = boot && Number.isFinite(s.startTicks) ? new Date(boot + (s.startTicks / TICK_HZ) * 1000).toISOString() : null;
    found.push({ pid, ...s, command, cwd, startedAt, ...mark });
  }));
  return found;
};

// pure — one row a process group: its leader (or its oldest) names it; every member is counted. Newest first.
const groupsOf = (found) => {
  const byGroup = new Map();
  for (const p of found) {
    const g = byGroup.get(p.pgid) ?? { pgid: p.pgid, pids: [], members: [] };
    g.pids.push(p.pid);
    g.members.push(p);
    byGroup.set(p.pgid, g);
  }
  const groups = [...byGroup.values()].map((g) => {
    const lead = g.members.find((m) => m.pid === g.pgid) ?? [...g.members].sort((a, b) => a.startTicks - b.startTicks)[0];
    return { pgid: g.pgid, pids: g.pids.sort((a, b) => a - b), command: lead.command, cwd: lead.cwd, startedAt: lead.startedAt, laneId: lead.laneId, sessionId: lead.sessionId, wallet: lead.wallet };
  }).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return groups;
};

/**
 * impure — STOP a group a chat started: asked to end (SIGTERM), then made to (SIGKILL) if it is still there after a
 * moment. Only for the wallet whose chat started it.
 * @returns {Promise<{ok: true, stopped: number} | {ok: false, error: string}>}
 */
export const stopChatProcesses = async ({ wallet, pgid, graceMs = 3000 }) => {
  const group = (await listChatProcesses({ wallet, fresh: true })).groups.find((g) => g.pgid === Number(pgid));
  if (!group) return { ok: false, error: `no process group ${pgid} that one of your chats started is running` };
  // Never the backend's own group, nor init's: only a group a chat's command made.
  if (group.pgid <= 1 || group.pids.includes(process.pid)) return { ok: false, error: `process group ${pgid} is not one a chat may stop` };
  const signal = (sig) => { try { process.kill(-group.pgid, sig); return true; } catch { return false; } };
  signal('SIGTERM');
  await new Promise((r) => { setTimeout(r, graceMs); });
  const left = (await listChatProcesses({ wallet, fresh: true })).groups.find((g) => g.pgid === group.pgid);
  if (left) signal('SIGKILL');
  return { ok: true, stopped: group.pids.length };
};
