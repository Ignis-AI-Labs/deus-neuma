// The StoreAdapter contract — the one seam that makes the continuity engine
// portable across every AI. The four-layer logic (retrieval, consolidation,
// budget) is written ONCE against this interface; a being's substrate is chosen
// by which adapter is plugged in:
//
//   fsdir-adapter      → a plain directory of records   (Claude's /memory, any AI)
//   workspace-adapter  → NeumaWorkspace, encrypted       (a sovereign neuma)   [later slice]
//
// See docs/planning/proposals/memory/continuity-ecosystem.md §3.
//
// The store is an APPEND-ONLY event log per layer. Nothing is ever mutated or
// removed in place — retiring a record means appending a newer one (supersede)
// and/or an expiry marker. The adapter folds the log to present the CURRENT view
// (`list`) while retaining the full history (`history`). This is the
// anti-gaslighting / supersede-not-delete invariant, realized in storage.
//
// Contract every adapter MUST satisfy:
//   append(record)                      -> Promise<record>     // never overwrites
//   read(layer, id, {asOf})             -> Promise<record|null> // current folded view of one id
//   list(layer, {space, asOf, includeRetired}) -> Promise<record[]> // current view (or full history)
//   history(layer, id)                  -> Promise<record[]>   // every version ever appended, in order
//   expire(layer, id, {at, supersededBy}) -> Promise<record|null> // append an expiry marker
//
// All reads return plain (frozen) records produced by makeRecord/applied folds.
// Adapters own persistence + encryption; they do NOT own retrieval ranking or
// layer semantics — those live in the pure core above them.

import { LAYERS, isValidAsOf, isIso, deepFreeze } from './record.js';

/** Throw unless `layer` is one of the four. Shared guard for adapters. */
export function assertLayer(layer) {
  if (!LAYERS.includes(layer)) {
    throw new Error(`store-adapter: unknown layer ${String(layer)} (expected ${LAYERS.join('|')})`);
  }
}

/**
 * Fold an append-only event log for ONE layer into its current view.
 * Deterministic, no IO — but it deep-freezes the folded records (and, by
 * aliasing through the shallow copy, their nested counterparts in the input
 * `log`) IN PLACE. Call with a fresh log per call (as the fsdir adapter does).
 *
 * The log is a flat, time-ordered array of entries. Two entry kinds:
 *   - a record           (has a `layer` field) — a versioned memory
 *   - an expiry marker    ({ op:'expire', targetId, at, supersededBy })
 *
 * Folding rules (newest write wins per id; retire never deletes):
 *   1. group records by id; the LAST appended version of an id is its head.
 *   2. an expiry marker stamps validTo on the head of targetId (a non-ISO `at`
 *      is treated as ABSENT, never as a silent live-forever).
 *   3. a record whose id appears as another record's `supersedes` is retired
 *      (validTo = the superseding record's recordedAt).
 *   4. when several signals retire one record (its own validTo, a supersession,
 *      an expiry), the EARLIEST wins — a fact stops being true the first moment
 *      anything retires it. No signal TYPE is ever silently dropped; within the
 *      expiry type, the last appended marker for a target wins ("last expiry").
 *   5. `list` returns heads that are valid as of `asOf` unless includeRetired.
 *
 * @param {Array<Object>} log - raw append entries for a single layer
 * @param {{asOf?:string, includeRetired?:boolean}} [opts]
 * @returns {Object[]} folded current-view records (frozen as stored)
 */
export function foldLog(log, opts = {}) {
  const heads = new Map();          // id -> latest record version
  const expiries = new Map();       // targetId -> { at, supersededBy }
  const supersededBy = new Map();   // retired id -> superseding recordedAt

  for (const entry of log) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.op === 'expire' && typeof entry.targetId === 'string') {
      // last expiry for a target wins
      expiries.set(entry.targetId, { at: entry.at, supersededBy: entry.supersededBy ?? null });
      continue;
    }
    if (typeof entry.id !== 'string') continue; // not a record
    heads.set(entry.id, entry);                 // later append overrides earlier version
    if (typeof entry.supersedes === 'string') {
      supersededBy.set(entry.supersedes, entry.recordedAt);
    }
  }

  const view = [];
  for (const [id, head] of heads) {
    // gather every signal that could retire this record, drop non-ISO ones
    // (a malformed timestamp must not silently keep a record live forever)…
    const signals = [];
    if (isIso(head.validTo)) signals.push(head.validTo);
    if (supersededBy.has(id) && isIso(supersededBy.get(id))) signals.push(supersededBy.get(id));
    if (expiries.has(id) && isIso(expiries.get(id).at)) signals.push(expiries.get(id).at);
    // …and take the EARLIEST (first moment anything retires it).
    const validTo = signals.length
      ? signals.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a))
      : (head.validTo ?? null);
    // Deep-freeze on read so a folded record is as immutable as a fresh
    // makeRecord — `head` is raw JSON.parse output, so even the no-change path
    // must be frozen to honor the contract's […].
    const base = validTo === head.validTo ? { ...head } : { ...head, validTo };
    view.push(deepFreeze(base));
  }

  if (opts.includeRetired) return view;
  return view.filter((r) => isValidAsOf(r, opts.asOf));
}
