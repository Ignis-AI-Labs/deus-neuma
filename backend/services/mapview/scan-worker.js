/**
 * mapview/scan-worker — the architecture scan, OFF the backend's event loop.
 *
 * A scan of this repo is ~4s of synchronous CPU (extract + assemble). On the
 * main thread that froze EVERY request and every streaming portal for as
 * long as it ran — opening REPO MAP stalled a being mid-sentence
 * (2026-09-28 smoothness pass). Here it runs in its own thread, and the
 * per-root memo (scan.js `opts.memo`) lives as long as the worker does, so a
 * repeat scan of an unchanged tree returns the graph already built.
 *
 * Message in: { id, kind: 'architecture'|'findings'|'check', root, opts }
 * Message out: { id, result } | { id, error }
 */
import { parentPort } from 'worker_threads';
import { scanArchitecture, checkFromGraph } from './scan.js';
import { buildFindings } from './findings.js';

const memos = new Map(); // absolute root → { digest, graph }
const memoFor = (root) => {
  if (!memos.has(root)) memos.set(root, { digest: null, graph: null });
  return memos.get(root);
};

// impure — scans the filesystem, answers the parent
const run = async ({ kind, root, opts }) => {
  const graph = await scanArchitecture(root, { ...opts, memo: memoFor(root) });
  if (kind === 'architecture') return graph;
  // The memoized graph is shared across calls; the reports read a copy so no
  // consumer can ever alter what the next scan returns.
  const copy = structuredClone(graph);
  return kind === 'findings' ? buildFindings(copy) : checkFromGraph(root, copy);
};

parentPort.on('message', async (msg) => {
  try {
    parentPort.postMessage({ id: msg.id, result: await run(msg) });
  } catch (err) {
    parentPort.postMessage({ id: msg.id, error: err?.message || String(err) });
  }
});
