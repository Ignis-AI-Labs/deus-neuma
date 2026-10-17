/**
 * One read, shared. Wraps an expensive async snapshot so every caller inside
 * a short window gets the same answer: concurrent callers join the one
 * in-flight read, and a settled read is reused for `ttlMs`. A failed read is
 * never cached, so the next caller tries again.
 *
 * Born for the SUBSTRATE lens: each poll fanned out to three model-server
 * reads and two `nvidia-smi` spawns, 40 polls a minute per open window
 * (live 2026-09-25). Two windows or two desks paid twice.
 *
 * @template T
 * @param {() => Promise<T>} read
 * @param {number} ttlMs
 * @param {() => number} [now]
 * @returns {() => Promise<T>}
 */
export const createSharedSnapshot = (read, ttlMs, now = Date.now) => {
  let settled = null; // { at, value }
  let pending = null;
  return () => {
    if (settled && now() - settled.at < ttlMs) return Promise.resolve(settled.value);
    if (pending) return pending;
    pending = read().then((value) => {
      settled = { at: now(), value };
      return value;
    }).finally(() => { pending = null; });
    return pending;
  };
};
