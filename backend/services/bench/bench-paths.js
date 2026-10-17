/**
 * bench-paths — the ONE resolution point for everything the bench plane
 * reaches for: where the sovereign harness lives, where the serving endpoint
 * answers, and where the platform-side watch journal is written.
 *
 * The harness is the sibling checkout (`/workspace/repos/project-fuvofos`) — it
 * stays sovereign: this plane READS its files and SPAWNS its verbs, and never
 * writes into it. `NEUMA_BENCH_HARNESS_PATH` re-points the root (tests point
 * it at a fixture tree); `NEUMA_BENCH_SERVING_URL` re-points the endpoint
 * probe. Both are read AT CALL TIME so launch-scoped env isolation keeps
 * working, the same law data-root.js follows.
 *
 * `available()` is the disabled-mode probe (the chain-reader idiom): an
 * operator with no harness checkout gets routes that answer 503
 * BENCH_HARNESS_ABSENT, never an exception. The probe result is cached per
 * resolved root for a few seconds so a polling desk does not stat the disk
 * on every call.
 */

import { existsSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { getDataRoot } from '../data-root.js';

const DEFAULT_HARNESS_ROOT = '/workspace/repos/project-fuvofos';
const DEFAULT_SERVING_URL = 'http://127.0.0.1:8089';
const PROBE_TTL_MS = 5000;

/**
 * The harness root: NEUMA_BENCH_HARNESS_PATH else the sibling checkout.
 * @returns {string}
 */
// impure (reads process.env)
export const harnessRoot = () =>
  process.env.NEUMA_BENCH_HARNESS_PATH || DEFAULT_HARNESS_ROOT;

/**
 * The serving endpoint base URL the status probe reads (read-only GETs).
 * @returns {string}
 */
// impure (reads process.env)
export const servingUrl = () =>
  process.env.NEUMA_BENCH_SERVING_URL || DEFAULT_SERVING_URL;

/**
 * The platform-side watch journal (the alerter's durable record). Lives under
 * the writable data root — never inside the sovereign harness.
 * NEUMA_BENCH_WATCH_PATH is the launch-scoped isolation door for tests.
 * @returns {string}
 */
// impure (reads process.env via getDataRoot)
export const benchWatchJournalPath = () =>
  process.env.NEUMA_BENCH_WATCH_PATH
  || join(getDataRoot(), 'benchmarks', 'watch', 'incidents.jsonl');

/**
 * The directory launch journals are appended into.
 * @returns {string}
 */
// impure (reads process.env via getDataRoot)
export const benchLaunchLogDir = () =>
  join(getDataRoot(), 'benchmarks', 'launch');

// Probe cache, keyed by the resolved root so an env flip (tests) never reads
// a stale verdict for a different tree.
const probeCache = new Map();

/**
 * Is a harness standing at the resolved root? True when the directory exists
 * AND carries a bench.mjs — the one file every verb spawns through. Cached
 * per root for PROBE_TTL_MS; never throws (a vanished mount reads as absent).
 * @param {string} [root]
 * @returns {boolean}
 */
// impure (filesystem stat)
export const available = (root = harnessRoot()) => {
  const now = Date.now();
  const hit = probeCache.get(root);
  if (hit && now - hit.at < PROBE_TTL_MS) return hit.ok;
  let ok;
  try {
    ok = statSync(root).isDirectory() && existsSync(join(root, 'bench.mjs'));
  } catch {
    ok = false;
  }
  probeCache.set(root, { at: now, ok });
  return ok;
};

/**
 * Join path segments INSIDE a root, refusing traversal. Every read this plane
 * makes against the harness flows through here so a crafted id can never walk
 * out of the harness tree — the refusal is total, not a sanitization.
 * @param {string} root
 * @param {...string} segments
 * @returns {string}
 */
export const resolveInside = (root, ...segments) => {
  const base = resolve(root);
  const target = resolve(base, ...segments);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`bench-paths: path escapes the harness root — ${segments.join('/')}`);
  }
  return target;
};
