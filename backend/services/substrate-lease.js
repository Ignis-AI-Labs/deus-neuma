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

// THE LINE'S WIDTH IS THE SLOTS THE SERVER RUNS (Design note, 2026-11-19, three shadow clones and his chat on a 4-slot
// server, one clone held […]: […]).
// The width used to be the capacity scan's knee for the model served (Design note, 2026-10-15: […]) — and the scan's knee wobbles: three scans of the
// T4 model within three minutes on 2026-11-10 read 4, 3, 3, so the line ran 3 on a server running 4 and the desk's
// SLOTS ring showed a free slot while a clone waited. Now every slot the server runs is used, never more (a chat
// past the slots would only queue inside the server); the measured knee still plans a team's width
// (team-coordinator.js resolveTeamCapacity) and still shows on the capacity screen. The house's own work keeps
// leaving the operator one (substrate-line.js): on 4 slots, 3 clones and the operator's chat run together. With no
// model served at all, or unmeasured, the width is what the server runs. The boot starts the watch.
let width = SERVING_PARALLEL_SLOTS;
const LINE_WIDTH_EVERY_MS = 60_000;

/** The one line in front of the house's local model server — the measured width. */
export const substrateLine = createSubstrateLine({ capacity: () => width });

// impure — read the served width now (a lazy import: the coordinator's graph is heavy)
const readWidth = async () => {
  const { resolveTeamCapacity } = await import('./team-coordinator.js');
  const next = (await resolveTeamCapacity()).servedSlots;
  if (Number.isInteger(next) && next >= 1) width = next;
  return width;
};

/** How many requests the server answers at once, as the line last read it. */
export const lineWidth = () => width;

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
    id: lease.id, release: lease.release, released: false, away: false, returning: null,
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
        held.id = lease.id;
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

/** The kind of place this route holds ('turn', 'member', 'wake'…), or null outside a lease. */
export const leaseKind = () => context.getStore()?.lease?.who?.kind ?? null;
/** Run work that takes its places as `kind` (e.g. 'background') — never riding a caller's lease. */
export const withLineKind = (kind, fn) => context.run({ kind }, fn);

/** Run work outside the line entirely — the capacity scan measures the server itself. */
export const withLineExempt = (fn) => context.run({ exempt: true }, fn);

/**
 * A place for ONE request: within a route that holds a lease, a PASS on it (substrate-line.js pass — counted as in
 * flight, and held back while a machine job takes the card, so a render goes in between rounds, never after whole
 * turns); for work that holds none, a lease of its own. Null only for exempt work. The caller releases it when the
 * answer is done (releasingWithBody).
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ release: () => void } | null>}
 */
export const leaseForRequest = async ({ signal } = {}) => {
  const store = context.getStore();
  if (store?.exempt) return null;
  const held = liveLease();
  if (held) return substrateLine.pass({ id: held.id, signal });
  return substrateLine.acquire({ kind: store?.kind || 'turn', label: store?.kind === 'background' ? 'background work' : 'a request', signal, request: true });
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
