// abortable-wait.js — a wait that a barge-in (AbortSignal) cuts short, for
// the uploaders' retry backoff and the publish-status poll.

/**
 * Resolve after `ms`, or reject with an AbortError when the signal fires.
 * impure — timer.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export const abortableWait = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
});
