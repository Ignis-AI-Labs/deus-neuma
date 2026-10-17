// Working layer — […] The live, BOUNDED context
// set a being carries into a turn. This is the resolution-budget backstop that
// keeps lived experience from overloading context: it pulls the always-on recent
// tail plus query-relevant episodes, then enforces a hard budget (item count AND
// an approximate-token char budget). Nothing is ever silently truncated — what
// doesn't fit is RETURNED in `dropped`, with a reason, so a caller can see
// exactly what the budget cost (the "no silent caps" principle).
//
// Deterministic + dependency-free (composes the episodic layer's pure retrieval),
// so it runs inside a portable skill over any StoreAdapter. As the semantic and
// procedural layers land, they compose in here the same way — the working set is
// the assembly point for all four layers.
//
// See docs/planning/proposals/memory/continuity-ecosystem.md (the working layer) and
// experiential-graph.md §6 (the resolution budget).

import { recallEpisodic, recentEpisodes } from './episodic.js';
import { recordToText, approxTokens } from './record-util.js';
import { GENERAL_SPACE } from '../record.js';

const DEFAULTS = Object.freeze({
  maxItems: 8,        // hard cap on items in the working set
  maxTokens: 1000,    // hard approximate-token budget (the context backstop)
  recentCount: 3,     // always-on recent tail (loaded even with no query)
  relevantCount: 5,   // query-relevant episodes considered
});

/**
 * Assemble the bounded working set for a turn. Composes the always-on recent
 * tail with query-relevant episodes, dedupes, and enforces a hard budget. The
 * recent tail is prioritized (it is the […] anchor),
 * then relevant episodes fill the remaining budget. Impure (reads the adapter).
 *
 * @param {Object} adapter - a StoreAdapter
 * @param {string} [query] - the turn's query (omit for the recent-only set)
 * @param {Object} [opts]
 * @param {string} [opts.space='general'] - the active space
 * @param {number} [opts.maxItems=8] - hard item cap
 * @param {number} [opts.maxTokens=1000] - hard approximate-token budget
 * @param {number} [opts.recentCount=3] - always-on recent tail size
 * @param {number} [opts.relevantCount=5] - query-relevant episodes considered
 * @param {string} [opts.asOf] - time-travel
 * @returns {Promise<{
 *   items: Array<{record: Object, source: 'recent'|'relevant', scope?: string, tokens: number}>,
 *   dropped: Array<{record: Object, source: string, scope?: string, reason: 'maxItems'|'maxTokens'}>,
 *   usedTokens: number, maxTokens: number, maxItems: number
 * }>}
 */
// impure — reads the adapter (disk IO)
export async function assembleWorkingSet(adapter, query, opts = {}) {
  opts = opts || {}; // tolerate an explicit null (a forwarded optional that resolved to null)
  const space = typeof opts.space === 'string' && opts.space ? opts.space : GENERAL_SPACE;
  const maxItems = posInt(opts.maxItems, DEFAULTS.maxItems);
  const maxTokens = posInt(opts.maxTokens, DEFAULTS.maxTokens);
  const recentCount = posInt(opts.recentCount, DEFAULTS.recentCount);
  const relevantCount = posInt(opts.relevantCount, DEFAULTS.relevantCount);

  // 1. always-on recent tail (the anchor — loaded even with no query)
  const recent = await recentEpisodes(adapter, { space, limit: recentCount, asOf: opts.asOf });
  const candidates = recent.map((record) => ({ record, source: 'recent' }));

  // 2. query-relevant episodes, deduped against the recent tail
  if (typeof query === 'string' && query.trim()) {
    const seen = new Set(candidates.map((c) => c.record.id));
    const relevant = await recallEpisodic(adapter, query, { space, k: relevantCount, asOf: opts.asOf });
    for (const hit of relevant) {
      if (seen.has(hit.record.id)) continue;
      seen.add(hit.record.id);
      candidates.push({ record: hit.record, source: 'relevant', scope: hit.scope });
    }
  }

  // 3. enforce the hard budget — recent first, then relevant. Overflow is
  //    RETURNED (never silently dropped) so the budget cost is observable.
  const items = [];
  const dropped = [];
  let usedTokens = 0;
  for (const cand of candidates) {
    const tokens = approxTokens(recordToText(cand.record));
    if (items.length >= maxItems) { dropped.push({ ...cand, reason: 'maxItems' }); continue; }
    if (usedTokens + tokens > maxTokens) { dropped.push({ ...cand, reason: 'maxTokens' }); continue; }
    usedTokens += tokens;
    items.push({ ...cand, tokens });
  }

  return { items, dropped, usedTokens, maxTokens, maxItems };
}

// pure — positive integer or the fallback.
function posInt(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
