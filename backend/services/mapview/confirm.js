/**
 * mapview/confirm — the CONFIRMATION TIER (MAPVIEW-013, #393): a static
 * finding is a hypothesis, and a hypothesis can earn a verdict.
 *
 * The 2026-08-20 dead-code purge triaged 63 findings by hand — four
 * verification agents, per-finding receipts — and every verdict lived only in
 * an issue comment. This module makes that work a first-class lane: verdicts
 * live in `.mapview/confirmations.json`, keyed by the SAME stable fingerprint
 * the baseline uses (delta.js — kind + line-stripped label + implicated
 * files), and every scan wears them. A finding with a verdict is MARKED, so a
 * reader always knows which tier they are looking at: believed (static
 * signal) or known (verified, with the receipt saying how).
 *
 * Verdicts:
 *   confirmed-live — the finding is a scanner blind spot; the code IS used.
 *   confirmed-dead — verified true; acting on it is cut-ready work.
 *   held           — verified, but the DECISION belongs to the operator
 *                    (staged features, scope calls, doctrine holds).
 *
 * A row records verdict, method, receipt (the evidence itself — file:line,
 * probe output, issue link), by, and at. No verdict is ever inferred: rows
 * are written by someone who verified, via `mapview confirm` or by hand.
 * Pure — scan.js reads the ledger file and hands rows in.
 */

import { fingerprintOf } from './delta.js';

export const CONFIRMATION_VERDICTS = Object.freeze(['confirmed-live', 'confirmed-dead', 'held']);

/**
 * Overlay ledger rows onto anomalies: a matching fingerprint attaches the
 * verdict as `confirmation`. Unmatched rows are returned as `stale` — a
 * verdict whose finding no longer occurs (fixed, or the label drifted) so
 * the ledger can be groomed instead of rotting silently. Pure.
 * @param {object[]} anomalies
 * @param {object[]|null} rows - the ledger's entries
 * @returns {{anomalies: object[], confirmed: number, stale: string[]}}
 */
export const annotateConfirmations = (anomalies, rows) => {
  const usable = (Array.isArray(rows) ? rows : []).filter(
    (r) => r && typeof r.fingerprint === 'string' && CONFIRMATION_VERDICTS.includes(r.verdict),
  );
  if (!usable.length) return { anomalies, confirmed: 0, stale: [] };
  const byFp = new Map(usable.map((r) => [r.fingerprint, r]));
  const seen = new Set();
  let confirmed = 0;
  const annotated = anomalies.map((a) => {
    const row = byFp.get(fingerprintOf(a));
    if (!row) return a;
    seen.add(row.fingerprint);
    confirmed += 1;
    return {
      ...a,
      confirmation: {
        verdict: row.verdict,
        method: row.method || 'manual-verification',
        receipt: row.receipt || '',
        by: row.by || '',
        at: row.at || '',
      },
    };
  });
  return {
    anomalies: annotated,
    confirmed,
    stale: usable.map((r) => r.fingerprint).filter((fp) => !seen.has(fp)).sort(),
  };
};
