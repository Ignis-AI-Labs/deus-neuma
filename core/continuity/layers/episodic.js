// Episodic layer — […] Retrieval over the episodic log.
//
// Episodes are observations scoped to a SPACE (a project / working context).
// Re-entering a space recalls THAT space's relevant + recent episodes, not
// everything the being has ever lived — resolution control is the whole point.
//
// Retrieval is dependency-free (reuses the pure BM25 engine, no `natural`), so
// it runs inside a portable skill over any StoreAdapter — a neuma's encrypted
// workspace or Claude's plain /memory directory alike.
//
// Two signals, fused by Reciprocal Rank Fusion:
//   1. relevance — BM25 over the query
//   2. recency   — the SAME relevant set re-ranked by recordedAt (newest first)
// Recency only re-orders the relevant set; it never injects an off-topic episode.
// (TF-IDF and graph-proximity are ready to fuse as further RRF inputs later —
// the design's full hybrid — but BM25 + recency is the dependency-light spine.)
//
// See docs/planning/proposals/memory/continuity-ecosystem.md and experiential-graph.md (Layer 1).

import { createBM25Index, bm25Search } from '../../memory/bm25-engine.js';
import { reciprocalRankFusionMany } from '../../memory/rank-fusion.js';
import { GENERAL_SPACE } from '../record.js';
import { recordToText, byRecencyDesc } from './record-util.js';

const RRF_K = 60;            // RRF constant (matches the legacy recall engine)
const DEFAULT_K = 5;         // default resolution budget — episodes per recall

/**
 * Recall episodes relevant to a query, scoped to a space and bounded by a
 * budget. Relevance (BM25) is fused with recency (recordedAt) over the relevant
 * set. When in-space hits are thin, optionally pad with cross-space relevance so
 * a cold space still gets context. Impure (reads the adapter).
 *
 * @param {Object} adapter - a StoreAdapter (must implement list('episodic', opts))
 * @param {string} query - the recall query
 * @param {Object} [opts]
 * @param {string} [opts.space='general'] - the active space
 * @param {number} [opts.k=5] - max episodes returned (resolution budget)
 * @param {string} [opts.asOf] - time-travel: recall as the record set stood then
 * @param {boolean} [opts.fallbackCrossSpace=true] - pad from other spaces when thin
 * @returns {Promise<Array<{record: Object, score: number, scope: 'in-space'|'cross-space'}>>}
 */
// impure — reads the adapter (disk IO)
export async function recallEpisodic(adapter, query, opts = {}) {
  const space = typeof opts.space === 'string' && opts.space ? opts.space : GENERAL_SPACE;
  const k = Number.isInteger(opts.k) && opts.k > 0 ? opts.k : DEFAULT_K;
  const fallbackCrossSpace = opts.fallbackCrossSpace !== false;
  if (typeof query !== 'string' || !query.trim()) return [];

  const inSpace = await adapter.list('episodic', { space, asOf: opts.asOf });
  const ranked = rankByRelevanceAndRecency(inSpace, query, k);
  const result = ranked.map((r) => ({ ...r, scope: 'in-space' }));

  if (result.length < k && fallbackCrossSpace) {
    const seen = new Set(result.map((r) => r.record.id));
    const all = await adapter.list('episodic', { asOf: opts.asOf });
    const others = all.filter((rec) => rec.space !== space && !seen.has(rec.id));
    const pad = rankByRelevanceAndRecency(others, query, k - result.length);
    for (const r of pad) result.push({ ...r, scope: 'cross-space' });
  }

  return result;
}

/**
 * Most-recent episodes in a space, regardless of query — the always-loaded
 * […] tail (the design's in-space recent ≤ R).
 * Impure (reads the adapter).
 * @param {Object} adapter - a StoreAdapter
 * @param {Object} [opts]
 * @param {string} [opts.space='general']
 * @param {number} [opts.limit=5]
 * @param {string} [opts.asOf]
 * @returns {Promise<Object[]>} records, newest first
 */
// impure — reads the adapter (disk IO)
export async function recentEpisodes(adapter, opts = {}) {
  const space = typeof opts.space === 'string' && opts.space ? opts.space : GENERAL_SPACE;
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : DEFAULT_K;
  const inSpace = await adapter.list('episodic', { space, asOf: opts.asOf });
  return [...inSpace].sort(byRecencyDesc).slice(0, limit);
}

// pure — fuse BM25 relevance with recency (over the relevant set only) and
// return the top-k as [{record, score}]. Returns [] when nothing scores.
function rankByRelevanceAndRecency(records, query, k) {
  if (!records.length) return [];
  const byId = new Map(records.map((r) => [r.id, r]));
  const index = createBM25Index(records.map((r) => ({ id: r.id, text: recordToText(r) })));
  const relevance = bm25Search(index, query, records.length); // every scoring doc
  if (relevance.length === 0) return [];
  // recency = the SAME relevant set, re-ordered newest-first (no off-topic injection)
  const recency = relevance
    .map((hit) => byId.get(hit.id))
    .sort(byRecencyDesc)
    .map((rec) => ({ id: rec.id }));
  // Fuse without pre-slicing, then apply the budget. Symmetric RRF ties when
  // relevance is equal (rank0+rank1 == rank1+rank0), so recency is the explicit
  // tiebreak — honoring […].
  const fused = reciprocalRankFusionMany([relevance, recency], { k: RRF_K, limit: relevance.length })
    .map((hit) => ({ record: byId.get(hit.id), score: hit.score }))
    .sort((a, b) => {
      const d = b.score - a.score;
      if (Math.abs(d) > 1e-9) return d;
      return byRecencyDesc(a.record, b.record);
    });
  return fused.slice(0, k);
}

