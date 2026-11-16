/**
 * IDLE ENGINES REST — an engine nobody is using shuts itself down (Design note, 2026-11-16: […]).
 *
 * The image-forge supervisor already reaps the ComfyUI it launched (free at 10 min, stop at 30). This
 * covers every OTHER ComfyUI on the machine: one started by hand or by a session, on any port, that the
 * supervisor never owned. Found 2026-11-16: one started from a VS Code terminal 13 days earlier, idle
 * since 11-05, holding 10 GB of RAM and 4.3 GB of swap — on 0.0.0.0, so the supervisor refused to adopt
 * it and nothing ever stopped it.
 *
 * An engine is found by WHAT it is (a `main.py` process whose working directory holds ComfyUI's
 * `comfy/` and `comfy_extras/`), never by port. It is idle from its last finished job (ComfyUI's own
 * history) or, with no history, from its start; a non-empty queue is never idle. Past `idleMs` it gets
 * SIGTERM — its exact pid, nothing else.
 */
import fs from 'node:fs/promises';
import { join } from 'node:path';

export const ENGINE_IDLE_MS = 2 * 60 * 60 * 1000;
const HTTP_TIMEOUT_MS = 4000;
const CLOCK_TICKS = 100; // USER_HZ on Linux x86_64

// impure — does this pid run ComfyUI? (main.py, cwd holding comfy/ and comfy_extras/)
export const isComfyProcess = async (pid, procRoot = '/proc') => {
  const argv = (await fs.readFile(join(procRoot, String(pid), 'cmdline'), 'utf8').catch(() => '')).split('\0');
  if (!argv.some((a) => a === 'main.py' || a.endsWith('/main.py'))) return false;
  const cwd = await fs.readlink(join(procRoot, String(pid), 'cwd')).catch(() => null);
  if (!cwd) return false;
  const has = (d) => fs.stat(join(cwd, d)).then((s) => s.isDirectory(), () => false);
  return (await has('comfy')) && (await has('comfy_extras'));
};

// impure — the TCP ports a pid listens on (IPv4 and IPv6), from /proc/net and its socket fds.
export const listeningPorts = async (pid, procRoot = '/proc') => {
  const inodes = new Set();
  for (const fd of await fs.readdir(join(procRoot, String(pid), 'fd')).catch(() => [])) {
    const link = await fs.readlink(join(procRoot, String(pid), 'fd', fd)).catch(() => '');
    const m = /^socket:\[(\d+)\]$/.exec(link);
    if (m) inodes.add(m[1]);
  }
  const ports = new Set();
  for (const table of ['tcp', 'tcp6']) {
    const text = await fs.readFile(join(procRoot, 'net', table), 'utf8').catch(() => '');
    for (const line of text.split('\n').slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length > 9 && f[3] === '0A' && inodes.has(f[9])) ports.add(parseInt(f[1].split(':').pop(), 16));
    }
  }
  return [...ports];
};

// impure — when a pid started, in ms since the epoch.
export const processStartMs = async (pid, procRoot = '/proc') => {
  const stat = await fs.readFile(join(procRoot, String(pid), 'stat'), 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const btime = Number(/^btime (\d+)$/m.exec(await fs.readFile(join(procRoot, 'stat'), 'utf8'))[1]);
  return (btime + Number(fields[19]) / CLOCK_TICKS) * 1000;
};

// pure — the newest `timestamp` (ms) anywhere in a value, or null.
export const newestTimestamp = (value) => {
  let best = null;
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'timestamp' && Number.isFinite(x)) best = Math.max(best ?? 0, x);
        else walk(x);
      }
    }
  };
  walk(value);
  return best;
};

/**
 * pure — should this engine rest now?
 * @param {{queueBusy: boolean, lastJobAt: ?number, startedAt: number, now: number, idleMs: number}} input
 * @returns {{stop: boolean, idleMs: number}}
 */
export const decideEngineRest = ({ queueBusy, lastJobAt, startedAt, now, idleMs }) => {
  const idleFrom = Math.max(lastJobAt ?? 0, startedAt ?? 0);
  const idle = now - idleFrom;
  return { stop: !queueBusy && idleFrom > 0 && idle >= idleMs, idleMs: idle };
};

const getJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
};

// impure — what a ComfyUI on this port is doing: its queue, and when its last job settled.
const engineActivity = async (port) => {
  const base = `http://127.0.0.1:${port}`;
  const queue = await getJson(`${base}/queue`);
  const queueBusy = (queue?.queue_running?.length ?? 0) + (queue?.queue_pending?.length ?? 0) > 0;
  const history = await getJson(`${base}/history?max_items=1`).catch(() => null);
  return { queueBusy, lastJobAt: newestTimestamp(history) };
};

/**
 * impure — every ComfyUI on this machine the supervisor does not own, judged and, past its idle time,
 * stopped by exact pid. An engine whose activity cannot be read is left running (never a guess).
 * @param {{ownedPid?: ?number, idleMs?: number, now?: number, procRoot?: string}} [opts]
 * @returns {Promise<Array<{pid: number, port: ?number, idleMs: ?number, rssBytes: number, stopped: boolean, reason: string}>>}
 */
export const restIdleEngines = async ({ ownedPid = null, idleMs = ENGINE_IDLE_MS, now = Date.now(), procRoot = '/proc' } = {}) => {
  const out = [];
  for (const entry of await fs.readdir(procRoot).catch(() => [])) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === ownedPid || pid === process.pid || !(await isComfyProcess(pid, procRoot))) continue;
    const rssKb = Number(/VmRSS:\s+(\d+)/.exec(await fs.readFile(join(procRoot, entry, 'status'), 'utf8').catch(() => ''))?.[1] ?? 0);
    const ports = await listeningPorts(pid, procRoot);
    let activity = null;
    for (const port of ports) {
      activity = await engineActivity(port).then((a) => ({ ...a, port }), () => null);
      if (activity) break;
    }
    if (!activity) { out.push({ pid, port: ports[0] ?? null, idleMs: null, rssBytes: rssKb * 1024, stopped: false, reason: 'activity unreadable — left running' }); continue; }
    const startedAt = await processStartMs(pid, procRoot).catch(() => 0);
    const verdict = decideEngineRest({ queueBusy: activity.queueBusy, lastJobAt: activity.lastJobAt, startedAt, now, idleMs });
    let stopped = false;
    if (verdict.stop) {
      try { process.kill(pid, 'SIGTERM'); stopped = true; } catch { stopped = false; }
    }
    out.push({ pid, port: activity.port, idleMs: verdict.idleMs, rssBytes: rssKb * 1024, stopped, reason: activity.queueBusy ? 'working' : (verdict.stop ? 'idle past its time' : 'idle, within its time') });
  }
  return out;
};
