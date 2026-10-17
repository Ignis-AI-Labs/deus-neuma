// Depth filter — the four layers composed at read time, by DEPTH.
//
// Three retrieval tiers, filled in order under one token ceiling:
//   active   — recent tail + query-relevant episodes   ("what is happening")
//   semantic — consolidated through-lines               ("what is true")
//   implicit — the mind layer, strongest first          ([…])
//
// working.js promised […] — this is that assembly, kept beside it rather than inside it so
// the episodic-only bounded set (its callers' contract) stays untouched.
//
// The honest-degradation law: an empty tier is STATED in `degraded`, never
// faked and never silently absent — on the default recall lane the semantic
// tier may be thin, and a caller must be able to see that. Overflow is
// RETURNED in `dropped` with a reason (the no-silent-caps principle).
//
// Ships in SHADOW: computed beside the live memory path, recorded, never on
// a prompt until the participatory promotion (mind-validation protocol).

import { recallEpisodic, recentEpisodes } from './episodic.js';
import { recallSemantic } from './semantic.js';
import { recordToText, approxTokens } from './record-util.js';
import { activeMindRecords } from '../mind/mind-store.js';
import { GENERAL_SPACE } from '../record.js';
import { DEPTH_TIERS, DEPTH_MAX_TOKENS } from '../../memory/recall-budgets.js';

/** Only SHADOW opts in (the bury ruling, IL-004, Design note, 2026-09-05: the depth
 *  filter computes beside the live memory path and records — nothing more.
 *  A live promotion is NOT BUILT, so the resolver no longer admits the word;
 *  an env var or record asking for it rests off rather than promising
 *  something nothing consumes. */
export const resolveDepthMode = (value) =>
  value === 'shadow' ? 'shadow' : 'off';

// pure — the dedup keys one record answers to: its own id, and the
// observation it mirrors (the crystallize-bridge join key), so one lived
// moment never rides twice across tiers.
const keysOf = (record) => {
  const keys = [record.id];
  if (typeof record?.meta?.observationId === 'string') keys.push(`obs:${record.meta.observationId}`);
  return keys;
};

/**
 * Assemble the depth set: three tiers, per-tier item budgets, one token
 * ceiling, cross-tier dedup, honest degradation. Impure (reads the adapter).
 *
 * @param {Object} adapter - a StoreAdapter
 * @param {string} [query] - the turn's query
 * @param {Object} [opts]
 * @param {string} [opts.space='general'] - the active space
 * @param {string} [opts.asOf] - time-travel
 * @param {{active: number, semantic: number, implicit: number}} [opts.tiers]
 * @param {number} [opts.maxTokens]
 * @returns {Promise<{
 *   items: Array<{record: Object, tier: 'active'|'semantic'|'implicit', source: string, tokens: number}>,
 *   dropped: Array<{record: Object, tier: string, reason: 'tierItems'|'maxTokens'}>,
 *   usedTokens: number, maxTokens: number,
 *   perTier: {active: number, semantic: number, implicit: number},
 *   degraded: Array<{tier: string, reason: string}>
 * }>}
 */
// impure — reads the adapter (disk IO)
export async function assembleDepthSet(adapter, query, opts = {}) {
  const space = typeof opts.space === 'string' && opts.space ? opts.space : GENERAL_SPACE;
  const tiers = { ...DEPTH_TIERS, ...(opts.tiers || {}) };
  const maxTokens = Number.isInteger(opts.maxTokens) && opts.maxTokens > 0 ? opts.maxTokens : DEPTH_MAX_TOKENS;
  const asOf = opts.asOf;

  // ── gather each tier's candidates, in depth order ─────────────────────────
  const candidates = [];

  // active: the recent tail anchors, query-relevant episodes join (the
  // assembleWorkingSet shape, deduped within the tier).
  const recent = await recentEpisodes(adapter, { space, limit: tiers.active, asOf });
  const activeSeen = new Set(recent.map((r) => r.id));
  const active = recent.map((record) => ({ record, tier: 'active', source: 'recent' }));
  if (typeof query === 'string' && query.trim()) {
    const relevant = await recallEpisodic(adapter, query, { space, k: tiers.active, asOf });
    for (const hit of relevant) {
      if (activeSeen.has(hit.record.id)) continue;
      activeSeen.add(hit.record.id);
      active.push({ record: hit.record, tier: 'active', source: 'relevant' });
    }
  }
  candidates.push(...active);

  // semantic: through-lines, active space first then a general pad (the
  // CORE-005 shape gatherMemoryContext uses).
  const semanticHits = await recallSemantic(adapter, query || '', { space, k: tiers.semantic, asOf });
  if (semanticHits.length < tiers.semantic && space !== GENERAL_SPACE) {
    const seen = new Set(semanticHits.map((h) => h.record.id));
    const pad = await recallSemantic(adapter, query || '', { space: GENERAL_SPACE, k: tiers.semantic - semanticHits.length, asOf });
    semanticHits.push(...pad.filter((h) => !seen.has(h.record.id)));
  }
  candidates.push(...semanticHits.map((h) => ({ record: h.record, tier: 'semantic', source: 'through-line' })));

  // implicit: the mind layer, already strongest-first from the store.
  const minds = await activeMindRecords(adapter, { asOf });
  candidates.push(...minds.map((record) => ({ record, tier: 'implicit', source: record.source?.kind || 'mind' })));

  // ── fill under the budgets: tier item caps + one token ceiling ────────────
  const items = [];
  const dropped = [];
  const seenKeys = new Set();
  const perTier = { active: 0, semantic: 0, implicit: 0 };
  let usedTokens = 0;
  for (const cand of candidates) {
    const keys = keysOf(cand.record);
    if (keys.some((k) => seenKeys.has(k))) continue; // one moment, one ride
    if (perTier[cand.tier] >= tiers[cand.tier]) { dropped.push({ ...cand, reason: 'tierItems' }); continue; }
    const tokens = approxTokens(recordToText(cand.record));
    if (usedTokens + tokens > maxTokens) { dropped.push({ ...cand, reason: 'maxTokens' }); continue; }
    keys.forEach((k) => seenKeys.add(k));
    perTier[cand.tier] += 1;
    usedTokens += tokens;
    items.push({ ...cand, tokens });
  }

  const degraded = Object.entries(perTier)
    .filter(([, count]) => count === 0)
    .map(([tier]) => ({ tier, reason: `no ${tier} records surfaced` }));

  return { items, dropped, usedTokens, maxTokens, perTier, degraded };
}
