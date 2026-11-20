/**
 * line-regex-worker — a caller's own regular expression, run OFF the backend's one thread.
 *
 * A pattern someone else wrote can take longer than the universe has (`^(a+)+$` on forty characters),
 * and a regular expression cannot be interrupted from the thread it runs on. Here it runs in a thread
 * the parent can end (line-regex.js).
 *
 * Starts with workerData { pattern, flags }.
 * Message in: { id, text, limit } — message out: { id, hits } (0-based line numbers, in order) | { id, error }
 */
import { parentPort, workerData } from 'worker_threads';

const regex = new RegExp(workerData.pattern, workerData.flags);

// impure — answers the parent
parentPort.on('message', ({ id, text, limit }) => {
  try {
    const lines = text.split(/\r?\n/);
    const hits = [];
    for (let i = 0; i < lines.length && hits.length < limit; i += 1) if (regex.test(lines[i])) hits.push(i);
    parentPort.postMessage({ id, hits });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message || error) });
  }
});
