/**
 * line-regex — which lines of a text a caller's regular expression matches, without ever holding the
 * backend's one thread (PR600 audit P6-125).
 *
 * `fs/search` with `regex: true` ran a being's own pattern on the main thread: `^(a+)+$` over one
 * 39-byte file stopped every lane, the wallet routes and the money watches until the process was
 * killed, and the file was still there after the restart. The pattern now runs in a worker
 * (line-regex-worker.js). One text that takes longer than the budget ends the worker and the search,
 * with words that say what to change.
 */
import { Worker } from 'worker_threads';

/** How long one text may take. A linear pattern reads a 4 MB file in milliseconds. */
export const LINE_REGEX_BUDGET_MS = 2000;

/**
 * Open a matcher for one pattern. An invalid pattern throws here, on the caller's thread.
 * impure — owns a worker thread from the first `matchingLines` until `close` (or a blown budget).
 * @param {string} pattern
 * @param {string} flags
 * @param {{budgetMs?: number}} [opts]
 * @returns {{matchingLines: (text: string, limit: number) => Promise<number[]>, close: () => Promise<void>}}
 *   matchingLines — the 0-based numbers of the first `limit` matching lines (split on \r?\n); one call at a time
 */
export const openLineRegex = (pattern, flags, { budgetMs = LINE_REGEX_BUDGET_MS } = {}) => {
  new RegExp(pattern, flags);
  let worker = null;
  let asked = 0;
  const close = async () => {
    const ending = worker;
    worker = null;
    if (ending) await ending.terminate();
  };
  const matchingLines = (text, limit) => new Promise((resolve, reject) => {
    if (!worker) {
      worker = new Worker(new URL('./line-regex-worker.js', import.meta.url), { workerData: { pattern, flags } });
      worker.unref();
    }
    const asking = worker;
    const id = ++asked;
    const settle = (finish, value) => {
      clearTimeout(timer);
      asking.off('message', onMessage).off('error', onError);
      finish(value);
    };
    const onMessage = (answer) => {
      if (answer.id !== id) return;
      if (answer.error) settle(reject, new Error(answer.error)); else settle(resolve, answer.hits);
    };
    const onError = (error) => { close().finally(() => settle(reject, error)); };
    const timer = setTimeout(() => {
      close().finally(() => settle(reject, new Error(
        `the regular expression did not finish one file within ${budgetMs / 1000} seconds and was stopped — `
        + 'it backtracks (a repeat inside a repeat, like (a+)+). Simplify it, or search plain text without regex.',
      )));
    }, budgetMs);
    asking.on('message', onMessage).on('error', onError);
    asking.postMessage({ id, text, limit });
  });
  return { matchingLines, close };
};
