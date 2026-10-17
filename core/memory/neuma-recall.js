// Neuma Recall — sovereign per-neuma memory retrieval.
//
// Source of truth is the neuma's OWN encrypted workspace observations
// (workspaces/<neumaId>/memory/observations/*.json), NOT the legacy global
// plaintext data/memory-store. Recall is keyed by neumaId so a neuma actually
// remembers the moments it crystallized — closing the write-but-never-recall
// gap where crystallizeObservation wrote to the workspace while recall read a
// different, empty store.
//
// Hybrid retrieval: TF-IDF + BM25 fused via Reciprocal Rank Fusion — the same
// proven machinery as the legacy engine, re-pointed at the sovereign store.
//
// This is Stage A of the memory architecture: the graph spine. Bi-temporal
// validity (occurredAt/recordedAt, supersede-not-delete) and GraphRAG-style
// community summarization layer on top of this without changing the contract.

import natural from 'natural';
import neumaWorkspace, { getWorkspacesRoot } from '../workspace/neuma-workspace.js';
import { createBM25Index, bm25Search, appendBM25Doc } from './bm25-engine.js';
import { recallQuery } from './query-words.js';
import { reciprocalRankFusionMany } from './rank-fusion.js';
import { buildCommunities } from './community-detection.js';
import { normalizeSpace } from './space.js';
import { WorkspaceAdapter } from '../continuity/adapters/workspace.js';
import { observationFromEpisode } from '../continuity/integration/crystallize-bridge.js';
import { RECALL_BUDGET_K } from './recall-budgets.js';
import { eligibleRecallDocs, isValidAt, stableRecallId } from './recall-eligibility.js';
import {
  GRAPH_MAX_COMMUNITIES,
  GRAPH_MAX_RECORDS,
  rankGraphRecall,
} from './recall-graph.js';
import { compareRecallRanks, resolveGraphRecallMode } from './recall-shadow.js';
import { readBoundedRecallCommunities } from './recall-graph-snapshot.js';

export { isValidAt } from './recall-eligibility.js';
// The pure doc shapes live in their own leaf (recall-docs.js — size law +
// decomposition-first, T2); re-exported here so every path-pinned importer
// is unaffected. Dependency direction: this engine imports the leaf, never
// the reverse.
export { observationToText, observationToMemory, buildDocs, recentInSpace } from './recall-docs.js';
import { buildDocs, recentInSpace } from './recall-docs.js';

const CONTEXT_LIMIT = 5; // memories considered per recall (retrieval pool, not the surfaced budget)
const RRF_K = 60;        // Reciprocal Rank Fusion constant (matches legacy engine)

// impure — per-neuma hybrid recall index over the sovereign workspace
class NeumaRecall {
  #shadowMetrics = [];

  constructor() {
    this.indexes = new Map(); // neumaId -> { tfidf, bm25, docs, graphSnapshot }
    // Telemetry, not state: how many full index BUILDS this process has run
    // (per neuma, keyed alongside the indexes). The append lane below exists
    // so crystallization stops costing a rebuild — this count is how tests
    // and operators SEE that law holding (harness-friction-map T2).
    this.buildCounts = new Map(); // neumaId -> number of _build invocations
  }

  // impure — read the recall source records: the observation store (shipped
  // default), or the continuity episodic lane (U1 slice 3 — the same moments
  // dual-written by the crystallize bridge, plus continuity-only episodes
  // like the birth record). The lane is chosen by NEUMA_RECALL_SOURCE
  // ('continuity' opts in; anything else stays on observations) so the
  // operator and the beings validate the switch together before it becomes
  // the default — memory recall is identity-affecting, never a silent swap.
  async _loadSourceRecords(neumaId) {
    if (process.env.NEUMA_RECALL_SOURCE === 'continuity') {
      const adapter = new WorkspaceAdapter(neumaId, { workspace: neumaWorkspace });
      const continuityRecords = await adapter.list('episodic', { includeRetired: true });
      return {
        observations: continuityRecords.map(observationFromEpisode),
        continuityRecords: continuityRecords.slice(0, GRAPH_MAX_RECORDS),
      };
    }
    return { observations: await neumaWorkspace.listObservations(neumaId), continuityRecords: null };
  }

  // impure — build (or rebuild) one neuma's index from its encrypted workspace
  async _build(neumaId) {
    const source = await this._loadSourceRecords(neumaId);
    const docs = buildDocs(source.observations);

    const tfidf = new natural.TfIdf();
    for (const doc of docs) tfidf.addDocument(doc.text, doc);

    let graphSnapshot = null;
    if (resolveGraphRecallMode(process.env.NEUMA_GRAPH_RECALL_MODE) === 'shadow') {
      try {
        graphSnapshot = await this._loadGraphSnapshot(neumaId, source.continuityRecords);
      } catch {
        graphSnapshot = null;
      }
    }
    // The index remembers the root it was read from (#553): the cache is
    // process-wide and keyed by neumaId, so a benchmark that re-points the
    // workspaces root per sample (a fresh lane snapshot each) must never be
    // served — or extended — by an index built under another root.
    const index = { tfidf, bm25: createBM25Index(docs), docs, graphSnapshot, root: getWorkspacesRoot() };
    this.indexes.set(neumaId, index);
    this.buildCounts.set(neumaId, (this.buildCounts.get(neumaId) || 0) + 1);
    return index;
  }

  async _ensure(neumaId) {
    const hot = this.indexes.get(neumaId);
    return hot?.root === getWorkspacesRoot() ? hot : this._build(neumaId);
  }
  async _loadGraphSnapshot(neumaId, continuityRecords = null) {
    const communities = await readBoundedRecallCommunities(neumaWorkspace, neumaId);
    return {
      continuityRecords: Array.isArray(continuityRecords)
        ? continuityRecords.slice(0, GRAPH_MAX_RECORDS)
        : [],
      communities: Array.isArray(communities)
        ? communities.slice(0, GRAPH_MAX_COMMUNITIES)
        : [],
    };
  }

  #rememberShadow(metrics) {
    if (this.#shadowMetrics.length >= 32) this.#shadowMetrics.shift();
    this.#shadowMetrics.push(metrics);
  }

  _compareShadow(index, lexicalLists, fused, opts) {
    if (
      resolveGraphRecallMode(process.env.NEUMA_GRAPH_RECALL_MODE) !== 'shadow' ||
      !index.graphSnapshot
    ) return;
    try {
      const eligible = eligibleRecallDocs(index.docs, opts);
      const activeId = normalizeSpace(opts.space).id;
      const activeIds = new Set();
      const generalIds = new Set();
      for (const [id, doc] of eligible) {
        (doc.space.id === activeId ? activeIds : generalIds).add(id);
      }
      const partitions = [activeIds];
      if (opts.fallbackToGeneral !== false && activeId !== 'general') partitions.push(generalIds);
      const stableByTransient = new Map();
      for (const doc of index.docs) {
        const stableId = stableRecallId(doc);
        if (stableId) stableByTransient.set(doc.id, stableId);
      }
      const stableLists = lexicalLists.map((list) => {
        const mapped = [];
        for (const hit of list) {
          const id = stableByTransient.get(hit.id);
          if (id) mapped.push({ id, score: hit.score });
        }
        return mapped;
      });
      const anchorIds = fused
        .map((hit) => stableByTransient.get(hit.id))
        .filter(Boolean);
      const graph = rankGraphRecall({
        docs: index.docs,
        continuityRecords: index.graphSnapshot.continuityRecords,
        communities: index.graphSnapshot.communities,
        anchorIds,
      }, opts);
      const comparison = compareRecallRanks({
        lexicalLists: stableLists,
        graphList: graph.results,
        eligibleIds: new Set(eligible.keys()),
        partitions,
        resultLimit: opts.limit ?? Number.POSITIVE_INFINITY,
      }, { k: RRF_K, limit: index.docs.length });
      this.#rememberShadow({ ...graph.metrics, ...comparison.metrics });
    } catch {
      // Shadow failure is fail-closed: live callers still receive the baseline.
    }
  }

  /**
   * Drop a neuma's cached index so the next recall reflects newly crystallized
   * memory. Called after addObservation. Cheap — the index rebuilds lazily.
   * @param {string} neumaId
   */
  invalidate(neumaId) {
    this.indexes.delete(neumaId);
  }

  /**
   * Append ONE just-written observation to the cached index when one is hot —
   * the incremental lane of invalidate (harness-friction-map T2). Every
   * crystallizing turn used to DROP the index, making the NEXT turn pay a
   * full decrypt + re-tokenization of the being's lifetime memory just to
   * see the one new moment; appending keeps the hot index hot at the cost of
   * tokenizing that single record. Only PURE ADDS may take this lane — a
   * write that supersedes, pins, or compacts EXISTING records changes docs an
   * append cannot express, and those callers keep invalidate(). The record
   * passed must be the one the STORE returned (ids and timestamps as on
   * disk), so the appended doc is byte-identical to what a rebuild would read.
   * No hot index: a no-op — the next _ensure builds with the record included.
   * The graph snapshot (shadow lane) is deliberately NOT extended: shadow
   * comparison is fail-closed and simply does not rank the new moment yet.
   * @param {string} neumaId
   * @param {Object} observation - the stored record exactly as written
   */
  appendObservation(neumaId, observation) {
    const index = this.indexes.get(neumaId);
    if (!index || index.root !== getWorkspacesRoot()) return;
    if (observation?.id != null && index.docs.some((doc) => doc.obsId === observation.id)) return;
    const [doc] = buildDocs([observation]);
    if (!doc) return; // no searchable text — a rebuild would drop it too
    doc.id = index.docs.length;
    index.docs.push(doc);
    index.tfidf.addDocument(doc.text, doc);
    index.bm25 = appendBM25Doc(index.bm25, doc);
  }

  /**
   * The being's full doc list (same cache the fusion rides) — the derivation
   * input for the read-time relation web (FR-P3-01 amended: edges are a
   * derived view, never stored rows).
   * @param {string} neumaId
   * @returns {Promise<Array>}
   */
  async docsFor(neumaId) {
    if (!neumaId) return [];
    return (await this._ensure(neumaId)).docs;
  }

  /**
   * Retrieve memories relevant to a query for one neuma, fusing TF-IDF + BM25,
   * filtered to those valid at `asOf` (default: now — superseded memories drop).
   *
   * Space scoping (CORE-005): when an active `space` is given, project memory
   * is isolated on READ the same way it is on WRITE — a project chat sees its
   * OWN space first, then (unless disabled) a bounded pad of GENERAL memory so
   * cross-cutting recall (identity, the operator, general history) still
   * surfaces. It never pads from a DIFFERENT project — that is the leak this
   * closes. A general active space makes in-space === general, so the pad is a
   * no-op and general chats behave exactly as before. The pool is still ranked
   * by fusion and gated by validity in both partitions.
   * @param {string} neumaId
   * @param {string} query
   * @param {{limit?:number, asOf?:(string|number|Date|null), space?:Object, fallbackToGeneral?:boolean}} [opts]
   * @returns {Promise<Array<{score:number,memory:string,timestamp:(string|null),occurredAt:(string|null),emotion:(string|null)}>>}
   */
  // pure over its inputs — the shared TF-IDF + BM25 → RRF fusion both recall
  // lanes ride (the prompt lane and the sovereign search lane), so the two
  // can never rank-drift apart.
  _fuse(tfidf, bm25, docs, rawQuery) {
    // The ask's filler never ranks a memory (query-words.js) — rare filler had
    // pulled unrelated sessions up.
    const query = recallQuery(rawQuery);
    const tfidfList = [];
    tfidf.tfidfs(query, (i, measure, keyDoc) => {
      if (measure > 0 && keyDoc) tfidfList.push({ id: keyDoc.id, score: measure });
    });
    tfidfList.sort((a, b) => b.score - a.score);

    const bm25List = bm25Search(bm25, query, docs.length).map((r) => ({ id: r.id, score: r.score }));

    // Fuse the FULL candidate lists, then let callers apply validity + space
    // + limits — so a superseded memory near the top can never starve a
    // still-valid one below.
    const lexicalLists = [tfidfList, bm25List];
    const fused = tfidfList.length > 0 && bm25List.length > 0
      ? reciprocalRankFusionMany(lexicalLists, { k: RRF_K, limit: docs.length })
      : (tfidfList.length > 0 ? tfidfList : bm25List);
    return { fused, lexicalLists };
  }

  async getRelevantMemories(neumaId, query, { limit = CONTEXT_LIMIT, asOf = null, space = null, fallbackToGeneral = true } = {}) {
    if (!neumaId || !query) return [];
    const index = await this._ensure(neumaId);
    const { tfidf, bm25, docs } = index;
    if (docs.length === 0) return [];

    const { fused, lexicalLists } = this._fuse(tfidf, bm25, docs, query);
    this._compareShadow(index, lexicalLists, fused, { space, asOf, fallbackToGeneral, limit });
    const byId = new Map(docs.map((d) => [d.id, d]));
    const activeId = normalizeSpace(space).id;
    // anchor/noteRef ride so a surfaced memory can be offered as a mem_ link
    // (memory links, mind-gate-settings.js) — additive; the text render ignores them.
    const shape = (d, score) => ({ score, memory: d.memory, timestamp: d.timestamp, occurredAt: d.occurredAt, emotion: d.emotion, anchor: d.anchor || null, noteRef: d.noteRef || null });

    // Pass 1 — the active space (validity-gated), in fusion order.
    const results = [];
    for (const { id, score } of fused) {
      const d = byId.get(id);
      if (!d || !isValidAt(d, asOf)) continue;
      if (d.space.id !== activeId) continue;
      results.push(shape(d, score));
      if (results.length >= limit) return results;
    }

    // Pass 2 — pad from GENERAL only (never another project), when short and
    // the active space is itself a non-general (project) space.
    if (fallbackToGeneral && activeId !== 'general') {
      for (const { id, score } of fused) {
        const d = byId.get(id);
        if (!d || !isValidAt(d, asOf)) continue;
        if (d.space.id !== 'general') continue;
        results.push(shape(d, score));
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  /**
   * The sovereign search lane (Phase 2 — a being's OWN query over its own
   * crystallized past). Same index, same fusion, same validity and
   * space-isolation law as getRelevantMemories; differs only in what the
   * hits carry (obsId + anchor + space, so mem_ refs can be minted) and in
   * the optional before/after time fence. The prompt lane's budgets are
   * untouched — this is a sibling, not a replacement.
   * @param {string} neumaId
   * @param {string} query
   * @param {{limit?:number, asOf?:(string|number|Date|null), space?:Object,
   *   before?:(string|null), after?:(string|null), fallbackToGeneral?:boolean}} [opts]
   * @returns {Promise<{hits:Array, totalMatched:number}>} hits bounded by
   *   limit; totalMatched counts EVERY match past the limit so the caller
   *   can say […] honestly.
   */
  async searchDocs(neumaId, query, { limit = 10, asOf = null, space = null, before = null, after = null, fallbackToGeneral = true } = {}) {
    if (!neumaId || !query) return { hits: [], totalMatched: 0 };
    const index = await this._ensure(neumaId);
    const { tfidf, bm25, docs } = index;
    if (docs.length === 0) return { hits: [], totalMatched: 0 };

    const { fused, lexicalLists } = this._fuse(tfidf, bm25, docs, query);
    const byId = new Map(docs.map((d) => [d.id, d]));
    const activeId = normalizeSpace(space).id;

    const beforeT = before != null ? Date.parse(before) : null;
    const afterT = after != null ? Date.parse(after) : null;
    const inWindow = (d) => {
      if (beforeT == null && afterT == null) return true;
      const t = Date.parse(d.occurredAt || d.timestamp || '');
      if (Number.isNaN(t)) return false; // fenced search: undatable memories fall outside any fence
      if (beforeT != null && !Number.isNaN(beforeT) && t >= beforeT) return false;
      if (afterT != null && !Number.isNaN(afterT) && t <= afterT) return false;
      return true;
    };
    this._compareShadow(index, lexicalLists, fused, { space, asOf, fallbackToGeneral, limit });

    const shape = (d, score) => ({
      score,
      obsId: d.obsId,
      memory: d.memory,
      timestamp: d.timestamp,
      occurredAt: d.occurredAt,
      emotion: d.emotion,
      space: d.space.id,
      anchor: d.anchor || null,
      noteRef: d.noteRef || null,
      type: d.type || null,
      source: d.source || null,
    });

    // Same two-pass space law as getRelevantMemories: active space first,
    // then a general pad (never another project).
    const spacePasses = (fallbackToGeneral && activeId !== 'general') ? [activeId, 'general'] : [activeId];
    const hits = [];
    let totalMatched = 0;
    for (const spaceId of spacePasses) {
      for (const { id, score } of fused) {
        const d = byId.get(id);
        if (!d || !isValidAt(d, asOf) || !inWindow(d)) continue;
        if (d.space.id !== spaceId) continue;
        totalMatched += 1;
        if (hits.length < limit) hits.push(shape(d, score));
      }
    }
    return { hits, totalMatched };
  }

  /**
   * Build the memory context object consumed by the prompt assembler. Mirrors
   * the legacy engine's shape; the CORE-005 B2 fields (`space`, `spaceHistory`)
   * are additive and optional (docs/planning/proposals/memory/experiential-graph.md §8) — callers that
   * ignore them are unaffected.
   * @param {string} neumaId
   * @param {string} query
   * @param {{asOf?:(string|number|Date|null), space?:Object, fallbackToGeneral?:boolean}} [opts] - Point-in-time instant + active space
   * @returns {Promise<{relevantMemories:Array,crystallizedEmotions:Object,memoryCount:number,space:Object,spaceHistory:Array}>}
   */
  async getContextForResponse(neumaId, query, { asOf = null, space = null, fallbackToGeneral = true } = {}) {
    const relevant = await this.getRelevantMemories(neumaId, query, { asOf, space, fallbackToGeneral });
    const crystallizedEmotions = {};
    for (const m of relevant) {
      if (m.emotion) crystallizedEmotions[m.emotion] = (crystallizedEmotions[m.emotion] || 0) + 1;
    }
    // Surfaced budget K, then the in-space recent lane (budget R) deduped
    // against what the relevant lane already shows — a memory never renders
    // twice in one prompt. General active space ⇒ no lane at all.
    const active = normalizeSpace(space);
    const surfaced = relevant.slice(0, RECALL_BUDGET_K);
    const spaceHistory = (!neumaId || active.id === 'general')
      ? []
      : recentInSpace((await this._ensure(neumaId)).docs, active.id, { asOf, exclude: surfaced });
    return {
      relevantMemories: surfaced,
      crystallizedEmotions,
      memoryCount: relevant.length,
      space: active,
      spaceHistory,
    };
  }

  /**
   * Compact a neuma's memory into navigable communities (deterministic GraphRAG
   * step) and persist them. memberIds reference real observation ids. The
   * per-community LLM summary is filled separately (heartbeat-driven half).
   * @param {string} neumaId
   * @param {{threshold?:number, passes?:number}} [opts]
   * @returns {Promise<Array<{id:number,label:string,memberIds:Array,size:number,summary:(string|null)}>>}
   */
  async compact(neumaId, opts = {}) {
    if (!neumaId) return [];
    const observations = await neumaWorkspace.listObservations(neumaId);
    const docs = buildDocs(observations);
    const docToObs = new Map(docs.map((d) => [d.id, d.obsId]));
    const communities = buildCommunities(docs, opts).map((c) => ({
      ...c,
      memberIds: c.memberIds.map((id) => docToObs.get(id)).filter((x) => x != null),
    }));
    await neumaWorkspace.writeCommunities(neumaId, communities);
    return communities;
  }

  /**
   * Compact only when the observation store has drifted from the cached
   * communities (MEM-007 #194). The heartbeat calls this every cycle; a quiet
   * being costs no rewrite. Drift = the cached memberIds no longer exactly
   * cover the obsId universe compact() itself would map, so the gate and the
   * writer can never disagree about what "fresh" means.
   * @param {string} neumaId
   * @returns {Promise<boolean>} true when a compaction was written
   */
  async compactIfDrifted(neumaId) {
    if (!neumaId) return false;
    const observations = await neumaWorkspace.listObservations(neumaId);
    const currentIds = buildDocs(observations).map((d) => d.obsId).filter((x) => x != null).sort();
    const cached = await neumaWorkspace.readCommunities(neumaId);
    const cachedIds = cached.flatMap((c) => (Array.isArray(c.memberIds) ? c.memberIds : [])).sort();
    if (currentIds.length === cachedIds.length && currentIds.every((id, i) => id === cachedIds[i])) {
      return false;
    }
    await this.compact(neumaId);
    return true;
  }
}

// Singleton — one recall engine across the process, cache keyed by neumaId.
export const neumaRecall = new NeumaRecall();
