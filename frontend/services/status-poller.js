// status-poller.js — ONE interval per poll key per renderer, N subscribers.
//
// The desk's status lights used to poll from EVERY stream instance (desk +
// each activated tab + each torn-out window), so a busy desk asked the
// backend the identical question N times per 15s — and the backend asked the
// UPSTREAM provider N times (the 429-storm shape relocated to the status
// lane; friction-map D1). The LOCAL substrate is one machine fact; a lane's
// route health is one lane fact. This module keeps exactly one timer per key
// while at least one subscriber exists, delivers each reading to every
// subscriber, gives a fresh subscriber the last reading instantly (and
// probes at once when there is none), and stops the timer on the last
// unsubscribe. Cross-WINDOW dedupe happens server-side (the status
// snapshot's own TTL) — windows are separate renderers.

/**
 * impure — a poller factory so tests can drive time and probes themselves.
 * A hidden desk asks nothing (2026-10-05): while `hidden()` says so a due
 * probe is skipped and the key marked owed; `wake()` (the desk shown again)
 * probes every owed key at once, so returning never shows a stale light.
 * @param {(key: string) => Promise<any>} probe - the per-key probe
 * @param {{hidden?: () => boolean}} [opts]
 * @returns {{
 *   subscribe: (key: string, fn: (reading: any) => void, intervalMs?: number) => () => void,
 *   subscriberCount: (key: string) => number,
 *   wake: () => void,
 * }}
 */
export const createStatusPoller = (probe, { hidden = () => false } = {}) => {
  const state = new Map(); // key -> { timer, subs: Set, last, intervalMs, probing, owed }

  const fire = async (key) => {
    const entry = state.get(key);
    if (!entry || entry.probing) return;
    if (hidden()) { entry.owed = true; return; }
    entry.owed = false;
    entry.probing = true;
    try {
      const reading = await probe(key);
      entry.last = reading;
      for (const fn of entry.subs) fn(reading);
    } catch {
      // A failed probe simply leaves the last reading standing — the
      // tri-state mappers upstream already render silence as CHECKING.
    } finally {
      entry.probing = false;
    }
  };

  const subscribe = (key, fn, intervalMs = 15000) => {
    let entry = state.get(key);
    if (!entry) {
      entry = { timer: null, subs: new Set(), last: null, intervalMs, probing: false, owed: false };
      state.set(key, entry);
    }
    entry.subs.add(fn);
    // A fresh subscriber wants a reading NOW: the last one if the poller has
    // it, an immediate probe when it does not (first subscriber on a key).
    if (entry.last !== null) fn(entry.last);
    else if (!entry.probing) fire(key);
    if (entry.timer === null) {
      entry.timer = setInterval(() => fire(key), entry.intervalMs);
    }
    return () => {
      const current = state.get(key);
      if (!current) return;
      current.subs.delete(fn);
      if (current.subs.size === 0) {
        clearInterval(current.timer);
        state.delete(key);
      }
    };
  };

  const subscriberCount = (key) => state.get(key)?.subs.size ?? 0;
  const wake = () => { for (const [key, entry] of state) if (entry.owed) fire(key); };
  return { subscribe, subscriberCount, wake };
};
