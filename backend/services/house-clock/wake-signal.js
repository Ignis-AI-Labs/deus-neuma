/**
 * THE WAKE SIGNAL — the one line a producer calls when a seat has work (Founder,
 * 2026-10-16: the house wakes itself for its own work). A house post landed
 * in an inbox, the Optio filed a charge, a team run ended, a check-in went to
 * the Optio: each producer says so here, in one line, and goes on.
 *
 * A leaf on purpose. The producers (house-post.js, dispatch-store.js, the team
 * run's end, its watch) sit low in the graph, and the clock that turns a
 * signal into a wake reaches the whole turn pipeline — so the clock registers
 * itself here at boot (setWakeSink), the way the chat-watch deliverer does.
 * No sink = no clock running = the signal is a no-op, and the work still waits
 * in the inbox for the seat's next turn exactly as before.
 *
 * A signal can never cost its producer: it never throws, never awaits, never
 * delays the post or the run that raised it.
 *
 * THE CHAIN. A post sent from inside a wake turn wakes its recipient, whose
 * reply wakes the sender back: two seats could thank each other until their
 * caps ran out. Every wake turn runs inside runInWake, which carries its depth
 * through every await of the turn (AsyncLocalStorage); a signal raised there is
 * one link deeper, and the queue refuses a chain past its limit.
 *
 * impure — module state (the sink, the async context).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createLogger } from '../logger.js';

const log = createLogger('HouseClock.Signal');
const context = new AsyncLocalStorage();

let sink = null;

/** The clock wires itself in at boot; null unwires it. */
export const setWakeSink = (fn) => { sink = typeof fn === 'function' ? fn : null; };

/** Run a wake turn so every signal it raises knows it came from a wake. */
export const runInWake = (wake, fn) => context.run({ depth: wake.depth ?? 0, wakeId: wake.wakeId ?? null }, fn);

/**
 * Run work that outlives the turn that started it (a team run, its watch)
 * outside any wake: its signals, hours later, start a chain of their own
 * rather than one link past the turn's.
 */
export const runOutsideWake = (fn) => context.exit(fn);

/**
 * A seat has work. Fire-and-forget.
 * @param {{seat: string, reason: string, ref: string, detail?: Object}} signal
 */
export const signalWake = (signal) => {
  if (!sink || !signal?.seat || !signal.reason || !signal.ref) return;
  const from = context.getStore();
  const stamped = { ...signal, depth: from ? from.depth + 1 : 0, cause: from?.wakeId ?? null };
  Promise.resolve()
    .then(() => sink(stamped))
    .catch((err) => log.warn('wake signal not taken', { seat: signal.seat, reason: signal.reason, error: err?.message }));
};
