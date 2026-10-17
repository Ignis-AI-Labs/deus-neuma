/**
 * bench-receipt — the ONE door the desk reads a run's receipt through.
 *
 * The harness can invalidate a run after the fact (benchmarks
 * runtime/benchmark-store.js invalidateRun): it keeps receipt.json untouched
 * and writes runs/<id>/invalidation.json beside it — {runId, reason, by, at}.
 * The harness then reads that run as FAILED. The desk must read it the same
 * way, or an invalidated run keeps scoring in the Atlas, the Explorer, the
 * share cards and the RUNS ledger (2026-09-26: the 63 pre-stop-list-fix BARE
 * receipts, Founder: […]).
 *
 * Mirrors benchmark-store.js readReceipt: status 'failed', originalStatus
 * kept, the audit attached as `invalidation`, failure BENCHMARK_INVALIDATED
 * at stage 'review' carrying the reason. An audit that is present but
 * malformed still excludes the run — a record that meant to strike a run
 * must never let it score because it was badly written.
 */

import { readFile } from 'node:fs/promises';
import { resolveInside } from './bench-paths.js';

/**
 * A receipt as the harness reads it once its audit is applied. Pure.
 * @param {object} receipt the parsed receipt.json
 * @param {?object} audit the parsed invalidation.json, or null
 * @param {string} runId the run directory's id
 */
export const applyInvalidation = (receipt, audit, runId) => {
  if (!audit) return receipt;
  const wellFormed = audit.runId === runId && typeof audit.reason === 'string' && audit.reason.trim()
    && typeof audit.by === 'string' && audit.by.trim();
  const invalidation = wellFormed
    ? { runId: audit.runId, reason: audit.reason, by: audit.by, at: audit.at ?? null }
    : { runId, reason: 'The invalidation record for this run is malformed — excluded until it is repaired.', by: null, at: null };
  return {
    ...receipt,
    originalStatus: receipt.status ?? null,
    status: 'failed',
    invalidation,
    failure: { code: 'BENCHMARK_INVALIDATED', stage: 'review', message: invalidation.reason },
  };
};

/**
 * Read runs/<runId>/receipt.json with its invalidation applied. Throws when
 * the receipt is missing or unparseable (the callers skip those); an absent
 * invalidation.json is the ordinary case.
 * impure (filesystem reads)
 * @param {string} root the harness root
 * @param {string} runId
 */
export const readRunReceipt = async (root, runId) => {
  const receipt = JSON.parse(await readFile(resolveInside(root, 'runs', runId, 'receipt.json'), 'utf8'));
  let audit = null;
  try {
    audit = JSON.parse(await readFile(resolveInside(root, 'runs', runId, 'invalidation.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') audit = {}; // present but unreadable: malformed, still excludes
  }
  return applyInvalidation(receipt, audit, runId);
};
