// substrate-lease — who holds a place in the line (substrate-line.js), carried with the work.
//
// A chat turn takes its place ONCE, before it starts, and every request it makes — each round,
// a re-ask, a settle pass — rides that one place (AsyncLocalStorage carries it through every
// await, so nothing below the turn has to pass it along). A request made outside any route takes
// a place of its own for exactly as long as its answer streams. Background work says so
// (withLineKind 'background'), and the capacity scan, which must measure the raw server, is the
// one exemption (withLineExempt).
//
// impure (the process's one line, async context).
import { AsyncLocalStorage } from 'node:async_hooks';
import { createSubstrateLine } from './substrate-line.js';
import { SERVING_PARALLEL_SLOTS } from './serving-launch-config.js';

// THE LINE'S WIDTH IS THE MEASURED ONE (Design note, 2026-10-15: […] — and never a cap on open tabs). The width is
// resolveTeamCapacity's: the measured ceiling for the model now served, never
// wider than the server's --parallel slots; unmeasured or stale, one. The boot
// starts the watch (server-boot.js); until it reads, and wherever no server
// booted (a test), the line is the server's slot count.
let width = SERVING_PARALLEL_SLOTS;
const LINE_WIDTH_EVERY_MS = 60_000;

/** The one line in front of the house's local model server — the measured width. */
export const substrateLine = createSubstrateLine({ capacity: () => width });

// impure — read the measured width now (a lazy import: the coordinator's graph is heavy)
const readWidth = async () => {
  const { resolveTeamCapacity } = await import('./team-coordinator.js');
  const next = (await resolveTeamCapacity()).maxParallel;
  if (Number.isInteger(next) && next >= 1) width = next;
  return width;
};

/** Start keeping the line at the measured width; returns the stop. impure. */
export const startLineWidthWatch = () => {
  const tick = () => readWidth().catch(() => {});
  tick();
  const timer = setInterval(tick, LINE_WIDTH_EVERY_MS);
  timer.unref?.();
  return () => clearInterval(timer);
};

const context = new AsyncLocalStorage();

/** An answer left unread this long gives its place back (releasingWithBody). */
export const ABANDONED_ANSWER_MS = 60_000;

/** The lease this work rides, if its route holds one that is still live and in line. */
const liveLease = () => {
  const lease = context.getStore()?.lease;
  return lease && !lease.released && !lease.away ? lease : null;
};

/**
 * Take a place in line for a whole route, run it, and give the place back — once — when it is
 * done, however it ends. A route already holding a place runs as it is (a turn inside a turn
 * never queues behind itself).
 * @param {{ kind?: 'turn'|'member'|'wake'|'background', label?: string, neumaId?: string|null,
 *   signal?: AbortSignal, onWait?: Function, onAdmit?: Function }} who
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export const withLease = async (who, fn) => {
  if (liveLease() || context.getStore()?.exempt) return fn();
  const lease = await substrateLine.acquire(who);
  const held = {
    release: lease.release, released: false, away: false, returning: null,
    who: { kind: who.kind, label: who.label, neumaId: who.neumaId },
  };
  who.onAdmit?.();
  try {
    return await context.run({ lease: held }, fn);
  } finally {
    // Stepped out, the release in hand is the one already given back — a release twice is once.
    held.released = true;
    held.release();
  }
};

/**
 * The route's place, as a handle that can step out of line and back in — null outside a lease.
 * A PARKED approval (tool-approval.js) waits for an operator whose portal closed, maybe for
 * hours; a wait nobody is watching must not hold a slot (live test 2026-10-16: a house wake
 * waited 15 minutes behind one, with no model call). An approval on a LIVE screen keeps its
 * place (Founder's ruling) and never steps out. Stepping back in waits in line like any lease.
 * @returns {{ away: () => boolean, stepOut: () => void,
 *   stepBackIn: (opts?: { signal?: AbortSignal }) => Promise<void> } | null}
 */
export const linePlace = () => {
  const held = context.getStore()?.lease;
  if (!held || held.released) return null;
  return {
    away: () => held.away,
    stepOut: () => {
      if (held.away || held.released) return;
      held.away = true;
      held.release();
    },
    stepBackIn: ({ signal } = {}) => {
      if (!held.away) return Promise.resolve();
      // Two answers at once take ONE place; a route that ended meanwhile gives it straight back.
      held.returning ??= substrateLine.acquire({ ...held.who, signal }).then((lease) => {
        held.returning = null;
        if (held.released) { lease.release(); return; }
        held.release = lease.release;
        held.away = false;
      }, (err) => {
        held.returning = null;
        throw err;
      });
      return held.returning;
    },
  };
};

/** Run work that takes its places as `kind` (e.g. 'background') — never riding a caller's lease. */
export const withLineKind = (kind, fn) => context.run({ kind }, fn);

/** Run work outside the line entirely — the capacity scan measures the server itself. */
export const withLineExempt = (fn) => context.run({ exempt: true }, fn);

/**
 * A place for ONE request, when its work holds none: null when the route's lease covers it (or
 * the work is exempt), else a lease the caller must release when the answer is done.
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ release: () => void } | null>}
 */
export const leaseForRequest = async ({ signal } = {}) => {
  const store = context.getStore();
  if (liveLease() || store?.exempt) return null;
  return substrateLine.acquire({ kind: store?.kind || 'turn', label: store?.kind === 'background' ? 'background work' : 'a request', signal });
};

/**
 * The same response, its place given back when the answer is fully read, cancelled, fails, or
 * is left unread for `abandonMs`. impure (a watchdog timer).
 * @param {Response} response
 * @param {{ release: () => void } | null} lease
 * @returns {Response}
 */
export const releasingWithBody = (response, lease, { abandonMs = ABANDONED_ANSWER_MS } = {}) => {
  if (!lease) return response;
  if (!response.body) { lease.release(); return response; }
  const reader = response.body.getReader();
  // An answer nobody reads would hold its place forever — one caller that threw before reading
  // would take a slot from the house for good. A read in flight is never idle (a long prompt
  // being read before the first token keeps its place); only an answer left unread gives it back.
  let reading = false;
  let lastTouch = Date.now();
  let watchdog = null;
  const done = () => { clearInterval(watchdog); lease.release(); };
  watchdog = setInterval(() => {
    if (!reading && Date.now() - lastTouch > abandonMs) done();
  }, Math.min(abandonMs, 10_000));
  watchdog.unref?.();
  const body = new ReadableStream({
    async pull(controller) {
      reading = true;
      try {
        const { done: end, value } = await reader.read();
        if (end) { done(); controller.close(); } else controller.enqueue(value);
      } catch (err) {
        done();
        controller.error(err);
      } finally {
        reading = false;
        lastTouch = Date.now();
      }
    },
    cancel(reason) {
      done();
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
};
