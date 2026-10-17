// Assess service — the portal handler's thin door onto the ledger's verdict
// paths: one id or many, one result shape either way, so the stream file
// (a baselined monolith) carries no batch mechanics of its own.

import { threatLedgerFor } from './threat-ledger.js';

/** How many threats one call may settle — a batch is triage, not a bulk edit. */
export const ASSESS_BATCH_CAP = 50;

/**
 * impure — settle one threat or a list of them with one verdict, in the
 * house's own ledger.
 * @param {{wallet: string, ids: string[], verdict: Object}} args
 * @returns {Promise<{ok: boolean, settled: Array<Object>, failed: Array<{id: string, error: string}>, error?: string}>}
 */
export const assessThreats = async ({ wallet, ids, verdict }) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, settled: [], failed: [], error: 'an assessment needs a threat id (id, or a list in ids)' };
  }
  if (ids.length > ASSESS_BATCH_CAP) {
    return { ok: false, settled: [], failed: [], error: `a batch settles at most ${ASSESS_BATCH_CAP} threats — split it` };
  }
  const threatLedger = await threatLedgerFor(wallet);
  if (ids.length === 1) {
    const single = await threatLedger.assess(ids[0], verdict);
    return single.ok
      ? { ok: true, settled: [single.entry], failed: [] }
      : { ok: false, settled: [], failed: [{ id: ids[0], error: single.error }], error: single.error };
  }
  return threatLedger.assessMany(ids, verdict);
};
