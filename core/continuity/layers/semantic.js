// Semantic layer — […] The distilled through-line
// of a being's experience, consolidated from its episodes.
//
// Consolidation is two-phase, by design:
//   1. DETERMINISTIC clustering — group related episodes (community-detection,
//      pure, no model).
//   2. LLM summarization — write each cluster's through-line in the being's own
//      voice. The summarizer is INJECTED (`summarize(snippets, ctx) => text`), so
//      the engine is model-agnostic: a neuma plugs its own conduit, the portable
//      skill plugs the host model, a rig plugs a small local model (gemma-3-4b).
//      The engine is provable end-to-end with a deterministic summarizer (the
//      injection seam IS the contract — not a mock of an execution boundary); the
//      LLM half is proven separately against a real model.
//
// Idempotence + refinement (supersede-not-delete):
//   - each semantic record carries meta.memberHash (stable cluster identity) and
//     meta.memberIds (the episodes it summarizes).
//   - a cluster whose member set is UNCHANGED (same hash) is skipped — no
//     re-summarization, no churn.
//   - a cluster that EVOLVED (shares a majority of members with a prior semantic
//     record but isn't identical) SUPERSEDES that prior record — the old
//     through-line is retired, never deleted.
//
// Dependency-light: reuses the pure community-detection + BM25 engines. See
// docs/planning/proposals/memory/continuity-ecosystem.md and experiential-graph.md (Stage C).

import { createHash } from 'crypto';
import { buildCommunities } from '../../memory/community-detection.js';
import { createBM25Index, bm25Search } from '../../memory/bm25-engine.js';
import { makeRecord } from '../record.js';
import { recordToText, byRecencyDesc } from './record-util.js';

const DEFAULT_K = 5;
const MIN_CLUSTER_SIZE = 2;          // a through-line needs ≥2 episodes
const SUPERSEDE_OVERLAP = 0.5;       // share >50% of members ⇒ the same evolving cluster

/** Stable identity of a cluster: sha256 of its sorted member ids (short).
 *  Internal — pure. */
function memberHash(memberIds) {
  const canonical = [...memberIds].map(String).sort().join('|');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/** Overlap coefficient |A∩B| / min(|A|,|B|) between two id lists. Pure. */
function overlap(a, b) {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let inter = 0;
  for (const x of a) if (setB.has(x)) inter += 1;
  return inter / Math.min(a.length, b.length);
}

// impure — the CURRENT semantic records: superseded ones removed via their
// `supersedes` links, regardless of adapter behavior. A conforming StoreAdapter
// already excludes retired records (the supersededIds set is then empty → no-op),
// but the continuity engine is explicitly adapter-portable, so consolidate /
// biography / recallSemantic must NOT silently depend on list() excluding
// superseded records — we derive the current set here so they stay correct even
// for an adapter that returns retired records.
async function currentSemantic(adapter, opts) {
  const all = await adapter.list('semantic', opts);
  const supersededIds = new Set(all.map((r) => r.supersedes).filter(Boolean));
  return all.filter((r) => !supersededIds.has(r.id));
}

/**
 * Consolidate episodes into semantic through-lines. Clusters deterministically,
 * summarizes each NEW or EVOLVED cluster via the injected summarizer, and writes
 * the result as a semantic record (superseding a prior through-line when a
 * cluster evolved). Unchanged clusters are skipped (idempotent). Impure (reads +
 * writes the adapter, calls the summarizer).
 *
 * @param {Object} adapter - a StoreAdapter
 * @param {Object} opts
 * @param {(snippets: string[], ctx: {label: string}) => Promise<string>} opts.summarize
 *   REQUIRED. Given a cluster's episode snippets (and its keyword label), returns
 *   its through-line text.
 * @param {string} [opts.space] - scope the episodes/semantics to a space
 * @param {number} [opts.minClusterSize=2]
 * @param {number} [opts.threshold=0.1] - community-detection similarity threshold
 * @param {string} [opts.now] - injectable timestamp (deterministic tests)
 * @returns {Promise<{written: Object[], skipped: Array<{reason: string, hash: string}>, clusters: number}>}
 */
// impure — reads + writes the adapter and calls the injected summarizer
export async function consolidate(adapter, opts = {}) {
  opts = opts || {};
  const { summarize, space, now } = opts;
  if (typeof summarize !== 'function') {
    throw new Error('consolidate: a summarize(snippets, ctx) => text function is required');
  }
  const minClusterSize = Number.isInteger(opts.minClusterSize) && opts.minClusterSize > 0 ? opts.minClusterSize : MIN_CLUSTER_SIZE;
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : 0.1;

  const episodes = await adapter.list('episodic', { space });
  const byId = new Map(episodes.map((e) => [e.id, e]));
  const docs = episodes.map((e) => ({ id: e.id, text: recordToText(e) })).filter((d) => d.text);
  if (!docs.length) return { written: [], skipped: [], clusters: 0 };

  const clusters = buildCommunities(docs, { threshold }).filter((c) => c.size >= minClusterSize);

  // current (non-superseded) semantic records, indexed by cluster hash for idempotence
  const existing = (await currentSemantic(adapter, { space })).filter((r) => r.meta && r.meta.memberHash);
  const byHash = new Map(existing.map((r) => [r.meta.memberHash, r]));

  const written = [];
  const skipped = [];
  for (const cluster of clusters) {
    const hash = memberHash(cluster.memberIds);
    if (byHash.has(hash)) { skipped.push({ reason: 'unchanged', hash }); continue; } // idempotent

    const snippets = cluster.memberIds.map((id) => recordToText(byId.get(id))).filter(Boolean);
    if (!snippets.length) { skipped.push({ reason: 'no-text', hash }); continue; }

    const summary = String(await summarize(snippets, { label: cluster.label }) || '').trim();
    if (!summary) { skipped.push({ reason: 'empty-summary', hash }); continue; }

    // an evolved cluster (majority-overlap with a prior through-line) supersedes it
    const prior = existing.find((r) => overlap(cluster.memberIds, r.meta.memberIds || []) > SUPERSEDE_OVERLAP);
    const rec = makeRecord({
      layer: 'semantic',
      content: summary,
      space,
      supersedes: prior ? prior.id : undefined,
      meta: { memberHash: hash, memberIds: cluster.memberIds, label: cluster.label },
    }, { now });
    await adapter.append(rec);
    written.push(rec);
  }

  return { written, skipped, clusters: clusters.length };
}

/**
 * Recall semantic through-lines relevant to a query (BM25 over the distilled
 * summaries). Impure (reads the adapter).
 * @param {Object} adapter
 * @param {string} query
 * @param {{k?: number, space?: string, asOf?: string}} [opts]
 * @returns {Promise<Array<{record: Object, score: number}>>}
 */
// impure — reads the adapter
export async function recallSemantic(adapter, query, opts = {}) {
  opts = opts || {};
  if (typeof query !== 'string' || !query.trim()) return [];
  const k = Number.isInteger(opts.k) && opts.k > 0 ? opts.k : DEFAULT_K;
  const records = await currentSemantic(adapter, { space: opts.space, asOf: opts.asOf });
  if (!records.length) return [];
  const byId = new Map(records.map((r) => [r.id, r]));
  const index = createBM25Index(records.map((r) => ({ id: r.id, text: recordToText(r) })));
  const hits = bm25Search(index, query, k);
  return hits.map((h) => ({ record: byId.get(h.id), score: h.score }));
}

/**
 * The biographical arc — the always-on through-line (the current semantic
 * records, newest first), bounded. This is the cheap, always-loaded layer that
 * answers […] without dumping history. Impure (reads the adapter).
 * @param {Object} adapter
 * @param {{space?: string, limit?: number, asOf?: string}} [opts]
 * @returns {Promise<Object[]>}
 */
// impure — reads the adapter
export async function biography(adapter, opts = {}) {
  opts = opts || {};
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 10;
  const records = await currentSemantic(adapter, { space: opts.space, asOf: opts.asOf });
  return [...records].sort(byRecencyDesc).slice(0, limit);
}
