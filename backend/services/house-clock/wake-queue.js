/**
 * THE WAKE QUEUE — the house's waiting work, kept on disk so a restart never
 * forgets it (Design note, 2026-10-16: the house wakes itself for work, under the
 * operator's control and in their view).
 *
 * A signal (wake-signal.js) the charter takes becomes a queued wake
 * {seat, reason, ref}; the same seat + reason + ref never queues twice. The
 * queue moves seat by seat:
 *   - ONE WAKE AT A TIME PER SEAT. A seat's wake takes EVERY item waiting for
 *     it at that moment — a charge's delivery post and the charge itself are
 *     one piece of work, read in one turn, never two turns back to back.
 *   - A moment's settle before it moves (WAKE_SETTLE_MS), so work that lands
 *     together (a post, then its charge) is taken together.
 *   - A wake that may not run now (paused, quiet hours, cap spent) HOLDS, in
 *     view, until it may.
 *   - A wake whose process died mid-turn is written to the ledger as LOST and
 *     its work runs again: the work was never done on the record.
 *
 * The runner — the real wake turn — is wired at boot (setWakeRunner), so this
 * module never imports the turn pipeline. Unwired, wakes wait.
 *
 * TWO BACKENDS, ONE REALM (Design note, 2026-10-16: two houses on one machine are
 * never confused). Every read-modify-write of a house's queue holds a
 * cross-process file lock beside it (file-lock.js, the post queue's lock), so
 * two processes can never claim the same wake; and a backend moves only the
 * queue of a house it serves, starting only seats that are that house's
 * lanes on its own grounds (house-served.js). A backend's running wake is
 * never misread as LOST by another while its process lives.
 *
 * impure — the realm disk, timers, the runner.
 */
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { writeJsonAtomic } from '../user-realm.js';
import { createWriteChain } from '../write-chain.js';
import { withFileLock } from '../file-lock.js';
import { readServed, servedWallet, laneHouse } from '../house-served.js';
import { createLogger } from '../logger.js';
import { readCharter } from './charter-store.js';
import { takeGate, runGate, wakeKey, localDay } from './wake-gate.js';
import { clockDir, appendWakeRow, actsDuring } from './wake-ledger.js';

const log = createLogger('HouseClock.Queue');

/** How long the queue lets work settle before it moves. */
export const WAKE_SETTLE_MS = 3000;
/** How many finished keys are remembered, so finished work never re-queues. */
const RECENT_KEYS_MAX = 500;
const DETAIL_MAX = 400;

let settleMs = WAKE_SETTLE_MS;
let runner = null;
const live = new Set(); // wake ids this process is running
const settling = new Map(); // wallet → { timer, waiters }
const idle = new Map(); // wallet → Set<Promise>

/** The boot wires the real wake turn here; null unwires it. */
export const setWakeRunner = (fn) => { runner = typeof fn === 'function' ? fn : null; };

/** Test door: the settle before the queue moves (0 = move on the next tick). */
export const configureWakeQueue = ({ settleMs: ms } = {}) => { if (Number.isInteger(ms) && ms >= 0) settleMs = ms; };

const queueFile = (wallet) => path.join(clockDir(wallet), 'queue.json');
const chain = createWriteChain();
// impure — one read-modify-write of a house's queue: in-process order AND the
// cross-process lock, so no other backend reads between our read and write
const serialize = (wallet, fn) => chain(() => withFileLock(`${queueFile(wallet)}.lock`, fn));
const emptyState = () => ({ v: 1, items: [], running: {}, day: null, counts: {}, recentKeys: [] });

// impure — the house's queue; a missing file is an empty queue. A corrupt one
// throws: read as empty it would silently drop the house's waiting work.
const load = async (wallet) => {
  try {
    return { ...emptyState(), ...JSON.parse(await fs.readFile(queueFile(wallet), 'utf8')) };
  } catch (err) {
    if (err.code === 'ENOENT') return emptyState();
    throw err;
  }
};
const save = (wallet, state) => writeJsonAtomic(queueFile(wallet), state);

// pure — a detail bounded so a queue row is a label, never a document
const boundDetail = (detail) => {
  if (!detail || typeof detail !== 'object') return null;
  const text = JSON.stringify(detail);
  return text.length <= DETAIL_MAX ? detail : { note: `${text.slice(0, DETAIL_MAX - 1)}…` };
};

// impure — is the process that started this running wake still alive?
const hostAlive = (host, wakeId) => {
  if (!Number.isInteger(host?.pid)) return false;
  if (host.pid === process.pid) return live.has(wakeId);
  try { process.kill(host.pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
};

/**
 * Take a signal into the house's queue, if the charter takes it. impure.
 * @param {string} wallet - the house
 * @param {{seat: string, reason: string, ref: string, detail?: Object, depth?: number, cause?: ?string}} signal
 * @returns {Promise<{queued: boolean, why?: string, item?: Object}>}
 */
export const enqueueWake = async (wallet, signal) => {
  const charter = await readCharter(wallet);
  const gate = takeGate({ charter, seat: signal.seat, depth: signal.depth ?? 0 });
  if (!gate.ok) {
    log.info('wake not taken', { seat: signal.seat, reason: signal.reason, why: gate.why });
    return { queued: false, why: gate.why };
  }
  const result = await serialize(wallet, async () => {
    const state = await load(wallet);
    const key = wakeKey(signal);
    if (state.items.some((i) => wakeKey(i) === key) || state.recentKeys.includes(key)) {
      return { queued: false, why: 'this work is already queued or done' };
    }
    const item = {
      id: randomUUID(),
      seat: signal.seat,
      reason: signal.reason,
      ref: String(signal.ref),
      detail: boundDetail(signal.detail),
      depth: signal.depth ?? 0,
      cause: signal.cause ?? null,
      queuedAt: new Date().toISOString(),
    };
    state.items.push(item);
    await save(wallet, state);
    return { queued: true, item };
  });
  if (result.queued) {
    log.info('wake queued', { seat: signal.seat, reason: signal.reason, ref: signal.ref });
    schedulePump(wallet);
  }
  return result;
};

// impure — one finished wake: its row on the ledger, its work off the queue
const finish = async (wallet, wake, outcome) => {
  const endedAt = new Date().toISOString();
  const acts = await actsDuring(wake.seat, wake.startedAt, endedAt).catch(() => []);
  const first = wake.items[0];
  await appendWakeRow(wallet, {
    id: wake.wakeId,
    seat: wake.seat,
    reason: first.reason,
    ref: first.ref,
    items: wake.items.map(({ reason, ref, queuedAt, detail }) => ({ reason, ref, queuedAt, detail })),
    queuedAt: first.queuedAt,
    startedAt: wake.startedAt,
    endedAt,
    outcome: outcome.outcome,
    sessionId: outcome.sessionId ?? null,
    acts,
    escalations: outcome.escalations ?? [],
    ...(outcome.note ? { note: String(outcome.note).slice(0, DETAIL_MAX) } : {}),
    ...(outcome.error ? { error: String(outcome.error).slice(0, DETAIL_MAX) } : {}),
  });
  await serialize(wallet, async () => {
    const state = await load(wallet);
    const done = new Set(wake.items.map((i) => i.id));
    state.items = state.items.filter((i) => !done.has(i.id));
    if (state.running[wake.seat]?.wakeId === wake.wakeId) delete state.running[wake.seat];
    state.recentKeys = [...state.recentKeys, ...wake.items.map(wakeKey)].slice(-RECENT_KEYS_MAX);
    await save(wallet, state);
  });
};

// impure — one fact about the running wake, on view while it runs; never throws past a log line
const markRun = (wallet, wake, what, change) => serialize(wallet, async () => {
  const state = await load(wallet);
  const run = state.running[wake.seat];
  if (run?.wakeId !== wake.wakeId) return;
  change(run);
  await save(wallet, state);
}).catch((err) => log.warn(`a running wake's ${what} could not be recorded`, { wakeId: wake.wakeId, error: err.message }));

// impure — the running wake's sitting, on view while it runs (the operator can open it live)
const markSitting = (wallet, wake, sessionId) => (typeof sessionId === 'string'
  ? markRun(wallet, wake, 'sitting', (run) => { run.sessionId = sessionId; })
  : Promise.resolve());

// impure — the wake has its place in the model line: from here it runs, before it waited
// (live test 2026-10-16: a wake waiting 15 minutes behind a parked card read as RUNNING)
const markAdmitted = (wallet, wake) => markRun(wallet, wake, 'place in line', (run) => { delete run.waitingForLine; });

// impure — run one seat's wake off the queue's own chain; settles into the ledger, never throws
const launch = (wallet, wake, charter) => {
  live.add(wake.wakeId);
  const onSitting = (sessionId) => markSitting(wallet, wake, sessionId);
  const onAdmit = () => { markAdmitted(wallet, wake); };
  const run = Promise.resolve()
    .then(() => runner({ wallet, seat: wake.seat, items: wake.items, charter, wakeId: wake.wakeId, depth: wake.depth, onSitting, onAdmit }))
    .catch((err) => ({ outcome: 'failed', error: err?.message || 'the wake turn failed' }))
    .then((outcome) => finish(wallet, wake, outcome || { outcome: 'done' }))
    .catch((err) => log.error('a finished wake could not be recorded', { wakeId: wake.wakeId, error: err.message }))
    .finally(() => {
      live.delete(wake.wakeId);
      idle.get(wallet)?.delete(run);
      schedulePump(wallet, 0);
    });
  if (!idle.has(wallet)) idle.set(wallet, new Set());
  idle.get(wallet).add(run);
};

/**
 * Move the house's queue: record lost wakes, start every seat that may run.
 * impure. Never throws past a log line.
 * @param {string} wallet
 * @param {number} [now] - epoch ms
 * @returns {Promise<{started: string[], held: Array<{seat: string, why: string}>}>}
 */
export const pumpHouse = async (wallet, now = Date.now()) => {
  const served = await readServed();
  if (!servedWallet(served, wallet)) return { started: [], held: [] }; // another backend's house: never ours to move
  const charter = await readCharter(wallet);
  const lost = [];
  const result = await serialize(wallet, async () => {
    const state = await load(wallet);
    const started = [];
    const held = [];
    for (const [seat, run] of Object.entries(state.running)) {
      if (hostAlive(run.host, run.wakeId)) continue;
      delete state.running[seat];
      // Its work runs again as the next wake, which is counted when it starts; this attempt is
      // given back, so one piece of work counts ONCE against the daily cap (live test: signal 2
      // after one real wake). Honest even if it got partway: its work is not done on the record.
      // Only today's count gives back — a wake lost on an earlier day was counted on that day.
      if (state.day === localDay(Date.parse(run.startedAt)) && state.counts[seat] > 0) state.counts[seat] -= 1;
      lost.push({ ...run, seat, items: state.items.filter((i) => run.itemIds.includes(i.id)) });
    }
    const day = localDay(now);
    if (state.day !== day) { state.day = day; state.counts = {}; }
    const seats = [...new Set(state.items.map((i) => i.seat))];
    const toLaunch = [];
    for (const seat of seats) {
      if (state.running[seat]) continue;
      if (!runner) { held.push({ seat, why: 'the house clock is not running' }); continue; }
      if (!laneHouse(served, seat, wallet)) { held.push({ seat, why: 'this seat is not a lane of this house on this backend' }); continue; }
      const gate = runGate({ charter, seat, now, count: state.counts[seat] ?? 0 });
      if (!gate.ok) { held.push({ seat, why: gate.why }); continue; }
      const items = state.items.filter((i) => i.seat === seat);
      const wake = {
        wakeId: randomUUID(),
        seat,
        items,
        depth: Math.max(...items.map((i) => i.depth ?? 0)),
        startedAt: new Date(now).toISOString(),
      };
      state.running[seat] = {
        wakeId: wake.wakeId, startedAt: wake.startedAt, itemIds: items.map((i) => i.id), host: { pid: process.pid },
        waitingForLine: true, // until the turn's lease is granted (markAdmitted)
      };
      state.counts[seat] = (state.counts[seat] ?? 0) + 1;
      toLaunch.push(wake);
      started.push(wake.wakeId);
    }
    await save(wallet, state);
    toLaunch.forEach((wake) => launch(wallet, wake, charter));
    return { started, held };
  });
  for (const run of lost) {
    log.warn('a wake was lost to a stopped backend — its work runs again', { seat: run.seat, wakeId: run.wakeId });
    await appendWakeRow(wallet, {
      id: run.wakeId, seat: run.seat, reason: run.items[0]?.reason ?? null, ref: run.items[0]?.ref ?? null,
      items: run.items.map(({ reason, ref, queuedAt }) => ({ reason, ref, queuedAt })),
      queuedAt: run.items[0]?.queuedAt ?? null, startedAt: run.startedAt, endedAt: new Date(now).toISOString(),
      outcome: 'lost', sessionId: null, acts: [], escalations: [],
      note: 'the backend running this wake stopped before it ended; its work is queued again',
    }).catch((err) => log.error('a lost wake could not be recorded', { error: err.message }));
  }
  return result;
};

// impure — move the queue after the settle; a burst of signals moves it once
function schedulePump(wallet, delay = settleMs) {
  const pending = settling.get(wallet);
  if (pending) return;
  const timer = setTimeout(() => {
    settling.delete(wallet);
    pumpHouse(wallet).catch((err) => log.error('the wake queue could not move', { error: err.message }));
  }, delay);
  timer.unref?.();
  settling.set(wallet, timer);
}

/**
 * The house's queue as the operator sees it: what waits, what runs, and why a
 * held seat is held. impure (reads).
 * @param {string} wallet
 * @param {number} [now]
 */
export const readWakeQueue = async (wallet, now = Date.now()) => {
  const [state, charter] = await Promise.all([load(wallet), readCharter(wallet)]);
  const counts = state.day === localDay(now) ? state.counts : {};
  const held = [...new Set(state.items.map((i) => i.seat))]
    .filter((seat) => !state.running[seat])
    .map((seat) => ({ seat, ...runGate({ charter, seat, now, count: counts[seat] ?? 0 }) }))
    .filter((g) => !g.ok)
    .map(({ seat, why }) => ({ seat, why }));
  return { items: state.items, running: state.running, today: counts, held };
};

/** Resolves once no wake of this house is running in this process. impure. */
export const whenHouseIdle = async (wallet) => {
  for (;;) {
    const runs = [...(idle.get(wallet) ?? [])];
    if (!runs.length) return;
    await Promise.allSettled(runs);
  }
};
