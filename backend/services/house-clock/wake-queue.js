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
 *   - A wake that FAILED is tried again after a short backoff, up to
 *     WAKE_ATTEMPTS_MAX attempts in all, a ledger row for each; when the last
 *     fails, the operator gets ONE tray card naming the seat, what woke it
 *     and the error (2026-10-18 audit: a failed wake used to drop its work).
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
import { readFileSync } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { writeJsonAtomic } from '../user-realm.js';
import { createWriteChain } from '../write-chain.js';
import { withFileLock } from '../file-lock.js';
import { readServed, servedWallet, laneHouse } from '../house-served.js';
import { createLogger } from '../logger.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { wakeReasonWords } from '../staff/wake-activity.js';
import { readCharter } from './charter-store.js';
import { takeGate, runGate, retryGate, wakeKey, localDay, answersOnly, WAKE_ATTEMPTS_MAX } from './wake-gate.js';
import { clockDir, appendWakeRow, actsDuring } from './wake-ledger.js';
import { seatName } from './wake-plan.js';

const log = createLogger('HouseClock.Queue');

/** How long the queue lets work settle before it moves. */
export const WAKE_SETTLE_MS = 3000;
/** The wait before a failed wake's work is tried again; doubled for the attempt after. */
export const WAKE_RETRY_MS = 60_000;
/** How many finished keys are remembered, so finished work never re-queues. */
const RECENT_KEYS_MAX = 500;
const DETAIL_MAX = 400;

let settleMs = WAKE_SETTLE_MS;
let retryMs = WAKE_RETRY_MS;
let runner = null;
const live = new Set(); // wake ids this process is running
const settling = new Map(); // wallet → { timer, waiters }
const idle = new Map(); // wallet → Set<Promise>

/** The boot wires the real wake turn here; null unwires it. */
export const setWakeRunner = (fn) => { runner = typeof fn === 'function' ? fn : null; };

/** Test door: the settle before the queue moves (0 = move on the next tick), and a failed wake's first backoff. */
export const configureWakeQueue = ({ settleMs: ms, retryMs: back } = {}) => {
  if (Number.isInteger(ms) && ms >= 0) settleMs = ms;
  if (Number.isInteger(back) && back >= 0) retryMs = back;
};

const queueFile = (wallet) => path.join(clockDir(wallet), 'queue.json');
const chain = createWriteChain();
// impure — one read-modify-write of a house's queue: in-process order AND the
// cross-process lock, so no other backend reads between our read and write
const serialize = (wallet, fn) => chain(() => withFileLock(`${queueFile(wallet)}.lock`, fn));
const emptyState = () => ({ v: 1, items: [], running: {}, day: null, counts: {}, recentKeys: [], lastTickAt: null });

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

// Give back one start's count against today's cap: its work runs again and is counted when it
// starts, so one piece of work counts ONCE (live test: signal 2 after one real wake). Only today's
// count gives back — a wake started on an earlier day was counted on that day. Changes `state` in hand.
const giveBack = (state, seat, run) => {
  if (!run.uncounted && state.day === localDay(Date.parse(run.startedAt)) && state.counts[seat] > 0) state.counts[seat] -= 1;
};

// impure — when a process began, in clock ticks since boot (Linux /proc/<pid>/stat field 22), or
// null where it cannot be read. The command name may hold spaces and parens: count from its last ')'.
const processStart = (pid) => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;
  } catch {
    return null;
  }
};

// impure — this machine's boot, in epoch ms (whole seconds: uptime drifts by a fraction between reads)
const bootedAt = () => Math.floor(Date.now() / 1000 - os.uptime()) * 1000;
const BOOT_SLACK_MS = 5000;

// This process, as a running wake records its host: a pid alone is reused, by another process or after
// a reboot, and a reused pid must never keep a seat RUNNING for good (2026-10-19 audit).
const SELF = Object.freeze({ pid: process.pid, start: processStart(process.pid) });

// impure — is the process that started this running wake still alive? Never one that began after it:
// a wake started before this machine booted, or a pid now held by a process that started since.
const hostAlive = ({ host, wakeId, startedAt }) => {
  if (!Number.isInteger(host?.pid)) return false;
  if (host.pid === process.pid) return live.has(wakeId);
  if (Date.parse(startedAt) < bootedAt() - BOOT_SLACK_MS) return false;
  if (host.start && processStart(host.pid) !== host.start) return false;
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
    // A review cadence still waiting (behind quiet hours, a cap, a restart) is superseded by the next
    // window's: one review looks over the house as it stands, never a stack of stale ones
    // (2026-10-18: four overnight windows woke the Optio as one wake carrying five reviews).
    if (item.reason === 'cadence') {
      const inWake = new Set(Object.values(state.running).flatMap((r) => r.itemIds ?? []));
      const stale = state.items.filter((i) => i.seat === item.seat && i.reason === 'cadence' && !inWake.has(i.id));
      state.items = state.items.filter((i) => !stale.includes(i));
      state.recentKeys = [...state.recentKeys, ...stale.map(wakeKey)].slice(-RECENT_KEYS_MAX);
    }
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

// impure — the operator told, once, that a wake's work failed its last attempt; never throws
const tellFailed = async (wallet, wake, spent, outcome) => {
  const name = await seatName(wake.seat).catch(() => wake.seat);
  const woke = [...new Set(spent.map((i) => wakeReasonWords(i.reason)))].join(', ');
  await notifyOperator({
    wallet,
    kind: KIND.houseWake,
    standing: STANDING.neuma,
    title: `${name}'s wake failed ${WAKE_ATTEMPTS_MAX} times — its work was not done`,
    detail: `Woken for: ${woke}. Error: ${outcome.error || 'the wake turn failed'}`,
    actor: { id: wake.seat, name },
    ref: { wakeId: wake.wakeId, ...(outcome.sessionId ? { sessionId: outcome.sessionId } : {}) },
  }).catch((err) => log.error('a failed wake could not be raised', { wakeId: wake.wakeId, error: err.message }));
};

// pure — a failed wake's ledger note, as the operator reads it: which attempt, what comes of its work, the error
const attemptNote = (attempt, retryAt, error) => `attempt ${attempt} of ${WAKE_ATTEMPTS_MAX} failed — `
  + (retryAt ? `its work is tried again at ${new Date(retryAt).toTimeString().slice(0, 5)}` : 'its work is not tried again; the operator is told')
  + `. The error: ${error || 'the wake turn failed'}`;

// impure — one finished wake: its row on the ledger, its work off the queue — or, failed, back on it
const finish = async (wallet, wake, outcome) => {
  const endedAt = new Date().toISOString();
  const acts = await actsDuring(wake.seat, wake.startedAt, endedAt).catch(() => []);
  const first = wake.items[0];
  const failed = outcome.outcome === 'failed';
  const tries = (i) => (i.attempts ?? 0) + 1;
  // A failed wake's work is tried again — save a plan review, which the failed turn already sent to
  // the operator (wake-plan.js settlePlanReviews).
  const again = failed ? wake.items.filter((i) => i.reason !== 'plan-review' && tries(i) < WAKE_ATTEMPTS_MAX) : [];
  const spent = failed ? wake.items.filter((i) => i.reason !== 'plan-review' && !again.includes(i)) : [];
  const attempt = Math.max(...wake.items.map(tries));
  const retryAt = again.length
    ? new Date(Date.parse(endedAt) + retryMs * 2 ** (Math.max(...again.map(tries)) - 1)).toISOString()
    : null;
  const note = [failed ? attemptNote(attempt, retryAt, outcome.error) : null, outcome.note].filter(Boolean).join('; ');
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
    ...(note ? { note: note.slice(0, DETAIL_MAX) } : {}),
    ...(outcome.error ? { error: String(outcome.error).slice(0, DETAIL_MAX) } : {}),
  });
  await serialize(wallet, async () => {
    const state = await load(wallet);
    const retried = new Set(again.map((i) => i.id));
    const done = wake.items.filter((i) => !retried.has(i.id));
    const doneIds = new Set(done.map((i) => i.id));
    state.items = state.items.filter((i) => !doneIds.has(i.id))
      .map((i) => (retried.has(i.id) ? { ...i, attempts: tries(i), retryAt } : i));
    const run = state.running[wake.seat];
    if (run?.wakeId === wake.wakeId) {
      delete state.running[wake.seat];
      // Tried again as a lost wake is: this attempt is given back, the next is counted when it starts.
      if (again.length) giveBack(state, wake.seat, run);
    }
    state.recentKeys = [...state.recentKeys, ...done.map(wakeKey)].slice(-RECENT_KEYS_MAX);
    await save(wallet, state);
  });
  if (spent.length) await tellFailed(wallet, wake, spent, outcome);
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

// pure — may this seat's waiting work run now: the charter's gate, then a failed wake's backoff
const seatGate = ({ charter, seat, now, items, count }) => {
  const gate = runGate({ charter, seat, now, count });
  return gate.ok ? retryGate(items, now) : gate;
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
      if (hostAlive(run)) continue;
      delete state.running[seat];
      // Its work runs again as the next wake: this attempt is given back. Honest even if it got
      // partway: its work is not done on the record.
      giveBack(state, seat, run);
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
      const items = state.items.filter((i) => i.seat === seat);
      // The operator's answers are their own act: they never spend the seat's daily cap.
      const uncounted = answersOnly(items);
      const gate = seatGate({ charter, seat, now, items, count: uncounted ? 0 : state.counts[seat] ?? 0 });
      if (!gate.ok) { held.push({ seat, why: gate.why }); continue; }
      const wake = {
        wakeId: randomUUID(),
        seat,
        items,
        depth: Math.max(...items.map((i) => i.depth ?? 0)),
        startedAt: new Date(now).toISOString(),
      };
      state.running[seat] = {
        wakeId: wake.wakeId, startedAt: wake.startedAt, itemIds: items.map((i) => i.id), host: SELF,
        waitingForLine: true, // until the turn's lease is granted (markAdmitted)
        ...(uncounted ? { uncounted } : {}),
      };
      if (!uncounted) state.counts[seat] = (state.counts[seat] ?? 0) + 1;
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
    .map((seat) => {
      const items = state.items.filter((i) => i.seat === seat);
      return { seat, ...seatGate({ charter, seat, now, items, count: answersOnly(items) ? 0 : counts[seat] ?? 0 }) };
    })
    .filter((g) => !g.ok)
    .map(({ seat, why }) => ({ seat, why }));
  return { items: state.items, running: state.running, today: counts, held };
};

/**
 * When the clock last looked over this house's calendar (schedule-tick.js),
 * epoch ms, or null before its first look. impure (reads).
 * @param {string} wallet
 * @returns {Promise<?number>}
 */
export const readLastTick = async (wallet) => {
  const at = Date.parse((await load(wallet)).lastTickAt ?? '');
  return Number.isFinite(at) ? at : null;
};

/**
 * Record the clock's look over this house's calendar at `now`; it only moves
 * forward. impure.
 * @param {string} wallet
 * @param {number} now - epoch ms
 */
export const stampTick = (wallet, now) => serialize(wallet, async () => {
  const state = await load(wallet);
  if (Date.parse(state.lastTickAt ?? '') >= now) return;
  state.lastTickAt = new Date(now).toISOString();
  await save(wallet, state);
});

/** Resolves once no wake of this house is running in this process. impure. */
export const whenHouseIdle = async (wallet) => {
  for (;;) {
    const runs = [...(idle.get(wallet) ?? [])];
    if (!runs.length) return;
    await Promise.allSettled(runs);
  }
};
