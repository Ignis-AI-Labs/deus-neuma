// Procedural layer — […] Retrieval over the procedural log: the
// methods / how-to / learned procedures a being accumulates and refines.
//
// This is JUST a memory layer (Design note, 2026-06-24 — it stores how-to records the
// same way episodic stores events. It is NOT the skills system: a skill (#22) is
// its own thing (a custom-function + context-management capability a being picks
// up); procedural memory is where raw methods live. They compose; they are not
// the same store.
//
// Retrieval differs from episodic in emphasis. An episode is recalled by
// relevance fused with recency (you want recent + relevant moments). A procedure
// is recalled by RELEVANCE FIRST — you want the best-matching method for a goal —
// with recency only as a tiebreak (among equally-relevant procedures, the latest
// refinement wins). Supersede-not-delete already keeps only the current version
// of a refined procedure in the folded view, so recall surfaces live methods, not
// every past revision.
//
// Procedures are usually GENERAL (a method like […]
// applies across projects), so space is OPTIONAL here and defaults to all spaces
// — unlike episodic, which is space-scoped by default. Pass a space to narrow to
// project-specific procedures.
//
// Dependency-free (reuses the pure BM25 engine), so it runs in the portable skill
// over any StoreAdapter. See docs/planning/proposals/memory/continuity-ecosystem.md.

import { createBM25Index, bm25Search } from '../../memory/bm25-engine.js';
import { recordToText, byRecencyDesc } from './record-util.js';

const DEFAULT_K = 5;

/**
 * Recall procedures relevant to a goal. Relevance (BM25) is primary; recency
 * (latest refinement) breaks ties. Space is optional — omit to search all
 * procedures (the general case), pass one to narrow to a project. Impure (reads
 * the adapter).
 *
 * @param {Object} adapter - a StoreAdapter
 * @param {string} goal - what the being is trying to do
 * @param {Object} [opts]
 * @param {number} [opts.k=5] - max procedures returned (budget)
 * @param {string} [opts.space] - narrow to a project space (default: all spaces)
 * @param {string} [opts.asOf] - time-travel
 * @returns {Promise<Array<{record: Object, score: number}>>}
 */
// impure — reads the adapter (disk IO)
export async function recallProcedure(adapter, goal, opts = {}) {
  opts = opts || {};
  if (typeof goal !== 'string' || !goal.trim()) return [];
  const k = Number.isInteger(opts.k) && opts.k > 0 ? opts.k : DEFAULT_K;

  const records = await adapter.list('procedural', { space: opts.space, asOf: opts.asOf });
  if (!records.length) return [];
  const byId = new Map(records.map((r) => [r.id, r]));
  const index = createBM25Index(records.map((r) => ({ id: r.id, text: recordToText(r) })));
  const hits = bm25Search(index, goal, records.length); // every scoring procedure
  if (hits.length === 0) return [];

  // relevance is primary; among equally-relevant procedures the latest refinement
  // (newest recordedAt) wins — NOT a recency fusion like episodic.
  const ranked = hits
    .map((h) => ({ record: byId.get(h.id), score: h.score }))
    .sort((a, b) => {
      const d = b.score - a.score;
      if (Math.abs(d) > 1e-9) return d;
      return byRecencyDesc(a.record, b.record);
    });
  return ranked.slice(0, k);
}

/**
 * List the current (live, non-superseded) procedures, newest refinement first.
 * Space optional (default: all). Impure (reads the adapter).
 * @param {Object} adapter - a StoreAdapter
 * @param {Object} [opts]
 * @param {string} [opts.space]
 * @param {string} [opts.asOf]
 * @returns {Promise<Object[]>}
 */
// impure — reads the adapter (disk IO)
export async function listProcedures(adapter, opts = {}) {
  opts = opts || {};
  const records = await adapter.list('procedural', { space: opts.space, asOf: opts.asOf });
  return [...records].sort(byRecencyDesc);
}
