/**
 * mapview/scan-offthread — ask the scan worker; never block the event loop.
 *
 * One long-lived worker (its memo is the point), started on first use and
 * unref'd so it never holds the process open. A worker that dies rejects
 * what it owed and is replaced on the next ask. Same answers as scan.js —
 * `scanArchitecture`, `scanFindings`, `scanCheck` — resolved in a thread.
 */
import path from 'path';
import { Worker } from 'worker_threads';

let worker = null;
let seq = 0;
const pending = new Map();

// impure — the worker's lifecycle
const failAll = (message) => {
  for (const { reject } of pending.values()) reject(new Error(message));
  pending.clear();
  worker = null;
};
const ensureWorker = () => {
  if (worker) return worker;
  worker = new Worker(new URL('./scan-worker.js', import.meta.url));
  worker.unref();
  worker.on('message', ({ id, result, error }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new Error(error)); else p.resolve(result);
  });
  worker.on('error', (err) => failAll(`map scan worker failed: ${err?.message || err}`));
  worker.on('exit', (code) => { if (pending.size) failAll(`map scan worker exited (${code})`); else worker = null; });
  return worker;
};

// impure — posts to the worker
const ask = (kind, root, opts = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ensureWorker().postMessage({ id, kind, root: path.resolve(root), opts });
});

export const scanArchitectureOffThread = (root, opts) => ask('architecture', root, opts);
export const scanFindingsOffThread = (root, opts) => ask('findings', root, opts);
export const scanCheckOffThread = (root, opts) => ask('check', root, opts);
