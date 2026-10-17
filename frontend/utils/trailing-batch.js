// trailing-batch.js — one flush for a burst.
//
// The desk's live-watch bus can fire dozens of `neuma:files-changed` events a
// second when the tree is busy (agents, builds, checkouts), and the listeners
// that answered each one with a metered API call spent the 200/min bucket in
// seconds — the Explorer read TOO MANY REQUESTS and the tree stranded on
// LOADING (Founder, live 2026-08-27). Details that arrive within `waitMs` of each
// other collapse into ONE trailing flush carrying them all; a burst that
// never goes quiet still flushes every `maxWaitMs`, so the view never holds
// its breath under sustained churn.

/**
 * @param {(items: Array<*>) => void} flush - called once per burst with every detail
 * @param {number} [waitMs] - quiet window before the trailing flush
 * @param {number} [maxWaitMs] - longest a burst may hold its first item
 * @returns {{ push: (item: *) => void, cancel: () => void, pendingCount: () => number }}
 */
export const createTrailingBatch = (flush, waitMs = 400, maxWaitMs = 2000) => {
  let pending = [];
  let timer = null;
  let firstAt = 0;

  const fire = () => {
    timer = null;
    firstAt = 0;
    const batch = pending;
    pending = [];
    flush(batch);
  };

  const push = (item) => {
    pending.push(item);
    const now = Date.now();
    if (!firstAt) firstAt = now;
    if (timer) clearTimeout(timer);
    // The trailing edge, capped by the burst's age: the oldest detail never
    // waits past maxWaitMs no matter how busy the stream stays.
    const maxLeft = Math.max(firstAt + maxWaitMs - now, 0);
    timer = setTimeout(fire, Math.min(waitMs, maxLeft));
  };

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = [];
    firstAt = 0;
  };

  return { push, cancel, pendingCount: () => pending.length };
};
