// network-recorder — the pass that keeps the network's history: every few seconds the watch is read and what
// changed is written to the log (network-log.js). Started at boot; the timer never holds the process open. It reads
// this machine's own socket table and writes to this machine's own disk: nothing it does goes out. impure.
import { readNetwork } from './network-watch.js';
import { standing, changes, keepEvents, prune } from './network-log.js';
import { createLogger } from '../logger.js';

const log = createLogger('NetworkRecorder');
export const RECORD_EVERY_MS = 5000;
const PRUNE_EVERY_MS = 6 * 3600 * 1000;

/**
 * Start recording; returns the stop.
 * @param {{intervalMs?: number, read?: () => Promise<object>, now?: () => number}} [o]
 */
export const startNetworkRecorder = ({ intervalMs = RECORD_EVERY_MS, read = readNetwork, now = () => Date.now() } = {}) => {
  let before = new Map();
  let first = true;
  let busy = false;
  let pruned = 0;
  keepEvents([{ type: 'began', at: new Date(now()).toISOString() }], now());
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const net = await read();
      if (!net?.measured) return;
      const at = now();
      const { events, next } = changes(before, standing(net), at, { baseline: first });
      before = next;
      first = false;
      await keepEvents(events, at);
      if (at - pruned > PRUNE_EVERY_MS) { pruned = at; await prune(at).catch(() => 0); }
    } catch (err) {
      log.warn('a network reading was not kept', { error: err.message });
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return () => { clearInterval(timer); keepEvents([{ type: 'stopped', at: new Date(now()).toISOString() }], now()); };
};
