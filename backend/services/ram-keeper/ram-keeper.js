/**
 * THE RAM KEEPER — the machine's memory stays free for what is working (Design note, 2026-11-16: […]).
 *
 * Every two minutes it reads /proc/meminfo, and:
 *   - rests idle engines the desk does not own (idle-engines.js: a hand-started ComfyUI after 2 h);
 *   - once a day, and at once when memory runs short, moves stale /tmp leftovers to a holding folder on
 *     disk and empties holding folders older than a week (tmp-janitor.js);
 *   - when memory is still short after that, raises ONE card an hour naming the biggest users it may not
 *     touch. It never stops a user's app, a being's model, or anything a process is using.
 * A card also goes out whenever it stops an engine: an operator who started something sees why it went.
 *
 * Two desks run from one checkout and both boot this: a machine-wide lock (data root) lets one act.
 * Disabled with NEUMA_RAM_KEEPER=0.
 */
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { getDataRoot } from '../data-root.js';
import { createLogger } from '../logger.js';
import { pidAlive } from '../desk-parent-watch.js';
import { notifyOperator } from '../notification-bus.js';
import { readServed } from '../house-served.js';
import { installDeskHouse } from '../install-owner.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { comfySupervisorStatus, resolveComfyConfig } from '../image-forge/comfyui-supervisor.js';
import { purgeHolding, reclaimEntries, staleEntries, STALE_AFTER_MS, HOLD_FOR_MS } from './tmp-janitor.js';
import { restIdleEngines, ENGINE_IDLE_MS } from './idle-engines.js';

const log = createLogger('RamKeeper');

export const KEEPER = Object.freeze({
  tickMs: 2 * 60 * 1000,
  janitorEveryMs: 24 * 60 * 60 * 1000,
  janitorEnabled: false,
  noticeEveryMs: 60 * 60 * 1000,
  // Short when less than this share of RAM is available (and never less than floorMinBytes).
  floorFraction: 0.12,
  floorMinBytes: 8 * 1024 ** 3,
  lockStaleMs: 10 * 60 * 1000,
  tmpRoot: '/tmp',
  holdingBase: '/var/tmp',
  staleAfterMs: STALE_AFTER_MS,
  holdForMs: HOLD_FOR_MS,
  engineIdleMs: ENGINE_IDLE_MS,
});

const GB = 1024 ** 3;
const gb = (bytes) => `${(bytes / GB).toFixed(1)} GB`;

/**
 * impure — the machine's memory, in bytes.
 * @returns {Promise<{total: number, available: number, swapTotal: number, swapFree: number}>}
 */
export const readMemory = async (path = '/proc/meminfo') => {
  const text = await fs.readFile(path, 'utf8');
  const kb = (key) => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? 0) * 1024;
  return { total: kb('MemTotal'), available: kb('MemAvailable'), swapTotal: kb('SwapTotal'), swapFree: kb('SwapFree') };
};

/** pure — is memory short? */
export const memoryShort = (mem, cfg = KEEPER) => mem.available < Math.max(mem.total * cfg.floorFraction, cfg.floorMinBytes);

/**
 * impure — the biggest resident processes, for the card that names what the keeper may not touch.
 * @returns {Promise<Array<{pid: number, name: string, rssBytes: number}>>}
 */
export const biggestProcesses = async (n = 4, procRoot = '/proc') => {
  const rows = [];
  for (const pid of await fs.readdir(procRoot).catch(() => [])) {
    if (!/^\d+$/.test(pid)) continue;
    const status = await fs.readFile(join(procRoot, pid, 'status'), 'utf8').catch(() => '');
    const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) * 1024;
    if (rss > 0) rows.push({ pid: Number(pid), name: /^Name:\s+(.+)$/m.exec(status)?.[1] ?? '?', rssBytes: rss });
  }
  return rows.sort((a, b) => b.rssBytes - a.rssBytes).slice(0, n);
};

// --- the machine-wide lock: one keeper acts, whichever desk booted first ---

const lockPath = () => join(getDataRoot(), 'ram-keeper.lock');

/** impure — hold (or renew) the lock; false while another live keeper holds it. */
export const holdKeeperLock = async (now = Date.now(), path = lockPath(), cfg = KEEPER) => {
  const held = await fs.readFile(path, 'utf8').then(JSON.parse, () => null);
  const ours = held?.pid === process.pid;
  if (held && !ours && pidAlive(held.pid) && now - held.beat < cfg.lockStaleMs) return false;
  await fs.mkdir(join(path, '..'), { recursive: true });
  await fs.writeFile(path, JSON.stringify({ pid: process.pid, beat: now }));
  return true;
};

const releaseKeeperLock = async (path = lockPath()) => {
  const held = await fs.readFile(path, 'utf8').then(JSON.parse, () => null);
  if (held?.pid === process.pid) await fs.rm(path, { force: true });
};

// impure — every house this desk serves, plus the install's own desk house (security-scheduler's rule).
const houses = async () => {
  const served = (await readServed().catch(() => ({ houses: [] }))).houses;
  const desk = await installDeskHouse().catch(() => null);
  return desk && !served.includes(desk) ? [...served, desk] : [...served];
};

const tell = async (title, detail) => {
  for (const wallet of await houses()) {
    await notifyOperator({ wallet, kind: KIND.memoryKeeper, standing: STANDING.system, title, detail });
  }
};

/**
 * impure — one pass. State carries the clocks between passes.
 * @param {{lastJanitorAt?: number, lastNoticeAt?: number}} state
 * @param {object} [cfg]
 * @returns {Promise<{state: object, account: object}>}
 */
export const keeperPass = async (state = {}, cfg = KEEPER, now = Date.now()) => {
  const account = { at: new Date(now).toISOString(), before: await readMemory(), engines: [], tmp: null, short: false };

  // 1. Idle engines the supervisor does not own.
  const owned = await comfySupervisorStatus(resolveComfyConfig(process.env)).catch(() => null);
  account.engines = await restIdleEngines({ ownedPid: owned?.owned ? owned.pid : null, idleMs: cfg.engineIdleMs, now });
  for (const e of account.engines.filter((x) => x.stopped)) {
    log.info('idle engine rested', { pid: e.pid, port: e.port, idleHours: (e.idleMs / 3600000).toFixed(1), rss: gb(e.rssBytes) });
    await tell(`ComfyUI was idle ${(e.idleMs / 3600000).toFixed(1)} h — stopped to free ${gb(e.rssBytes)} of RAM`,
      `Started outside the desk (pid ${e.pid}${e.port ? `, port ${e.port}` : ''}). The image forge starts its own when it needs one.`);
  }

  // 2. Stale leftovers: daily, or now when memory is short.
  const shortBefore = memoryShort(account.before, cfg);
  if (cfg.janitorEnabled === true && (shortBefore || now - (state.lastJanitorAt ?? 0) >= cfg.janitorEveryMs)) {
    const holdingBase = cfg.holdingBase ?? join(getDataRoot(), 'tmp-reclaimed');
    const stale = await staleEntries({ root: cfg.tmpRoot, now, staleAfterMs: cfg.staleAfterMs });
    const moved = stale.length ? await reclaimEntries(stale, holdingBase, now) : { moved: [], failed: [], holding: null };
    const purged = await purgeHolding(holdingBase, now, cfg.holdForMs);
    account.tmp = { moved: moved.moved.length, failed: moved.failed.length, holding: moved.holding, purged: purged.length };
    if (moved.moved.length || purged.length) log.info('stale leftovers cleared', account.tmp);
    state = { ...state, lastJanitorAt: now };
  }

  // 3. Still short: say so once an hour, naming what is big and not the keeper's to stop.
  account.after = await readMemory();
  account.short = memoryShort(account.after, cfg);
  if (account.short && now - (state.lastNoticeAt ?? 0) >= cfg.noticeEveryMs) {
    const top = await biggestProcesses();
    await tell(`Memory is short: ${gb(account.after.available)} free of ${gb(account.after.total)}`,
      `Cleaned what was the keeper's to clean. Biggest now: ${top.map((p) => `${p.name} ${gb(p.rssBytes)}`).join(' · ')}. Closing one of these frees the rest.`);
    state = { ...state, lastNoticeAt: now };
  }
  return { state, account };
};

/**
 * impure — start the keeper on a timer (unref'd: it never holds the process open). Returns stop().
 */
export const startRamKeeper = ({ cfg = KEEPER } = {}) => {
  if (process.env.NEUMA_RAM_KEEPER === '0' || process.platform !== 'linux') return () => {};
  let state = {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (!(await holdKeeperLock(Date.now(), lockPath(), cfg))) return;
      ({ state } = await keeperPass(state, cfg));
    } catch (err) {
      log.warn('keeper pass failed — the next tick tries again', { err: err.message });
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, 30_000);
  const timer = setInterval(tick, cfg.tickMs);
  first.unref?.();
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); releaseKeeperLock().catch(() => {}); };
};
