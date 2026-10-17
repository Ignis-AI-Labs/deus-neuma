// Mind store — write/read operations for the subconscious buffer.
//
// Reinforce-or-append: a new residue that strongly matches an active record of
// the same kind REINFORCES it (supersede with stepped strength and an extended
// validity window) instead of duplicating it — the undercurrent deepens where
// the same thing keeps lingering. The active set is bounded (MIND_ACTIVE_CAP);
// overflow expires the weakest, and every expiry is RETURNED to the caller with
// the record it retired (the "no silent caps" principle).
//
// All persistence rides the StoreAdapter contract (append/list/expire), so the
// same store works over a neuma's encrypted workspace and a plain directory.
//
// The reinforcement match is an OVERLAP COEFFICIENT over content-bearing
// tokens, not BM25: an absolute BM25 threshold is corpus-size-dependent (with
// one candidate record every term's IDF collapses to ~log(4/3), so no absolute
// bar behaves the same at N=1 and N=40), and the buffer's common early state
// is exactly one or two candidates. Overlap of the shorter phrase's tokens is
// corpus-size-independent and deterministic.

import { recordToText, byRecencyDesc } from '../layers/record-util.js';
import {
  MIND_LAYER,
  MIND_ACTIVE_CAP,
  makeMindRecord,
  reinforceMindRecord,
  isMindRecord,
  mindStrengthOf,
  normalizeMindPhrase,
} from './mind-record.js';

/** Share of the shorter phrase's content tokens that must recur in the other
 *  phrase for reinforcement instead of standing beside it. Tunable;
 *  conservative so two merely-adjacent thoughts stay distinct. */
export const REINFORCE_MIN_OVERLAP = 0.6;

// pure — content-bearing tokens: lowercase words of ≥4 chars (a cheap,
// list-free stopword proxy; "the"/"and"/"it" fall away, the nouns stay).
const CONTENT_TOKEN_MIN = 4;
const contentTokens = (text) =>
  new Set(
    String(text || '').toLowerCase().split(/[^a-z0-9'-]+/).filter((w) => w.length >= CONTENT_TOKEN_MIN),
  );

/** Overlap coefficient of two phrases' content tokens: |A∩B| / min(|A|,|B|).
 *  0 when either phrase carries no content tokens. Pure. */
export const phraseOverlap = (a, b) => {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
};

/** Comparator: strongest first, then newest. Pure. */
export const byStrengthThenRecency = (a, b) =>
  (mindStrengthOf(b) - mindStrengthOf(a)) || byRecencyDesc(a, b);

/**
 * The active (valid, folded) mind records, strongest first. Impure (reads the
 * adapter). Non-mind working-layer records are left untouched and unseen.
 *
 * @param {Object} adapter - a StoreAdapter
 * @param {{space?: string, asOf?: string, kinds?: string[]}} [opts]
 * @returns {Promise<Object[]>}
 */
// impure — reads the adapter (disk IO)
export async function activeMindRecords(adapter, opts = {}) {
  const view = await adapter.list(MIND_LAYER, { space: opts.space, asOf: opts.asOf });
  const kinds = Array.isArray(opts.kinds) && opts.kinds.length ? new Set(opts.kinds) : null;
  return view
    .filter((r) => isMindRecord(r) && (!kinds || kinds.has(r.meta.kind)))
    .sort(byStrengthThenRecency);
}

/**
 * Find the active same-kind record the new phrase reinforces, if any: the
 * highest phrase overlap at or above REINFORCE_MIN_OVERLAP. Pure.
 *
 * @param {Object[]} active - active mind records
 * @param {{phrase: string, kind: string}} fields
 * @returns {Object|null}
 */
export function findReinforcementMatch(active, fields) {
  const phrase = normalizeMindPhrase(fields?.phrase);
  if (!phrase) return null;
  let best = null;
  let bestOverlap = 0;
  for (const record of active) {
    if (record.meta.kind !== fields.kind) continue;
    const overlap = phraseOverlap(phrase, recordToText(record));
    if (overlap > bestOverlap) { best = record; bestOverlap = overlap; }
  }
  return bestOverlap >= REINFORCE_MIN_OVERLAP ? best : null;
}

/**
 * Write a residue into the mind store: reinforce the matching active record or
 * append a new one, then enforce the active cap by expiring the weakest (never
 * the record just written). Impure.
 *
 * @param {Object} adapter - a StoreAdapter
 * @param {Object} fields - makeMindRecord fields (phrase, kind, source, …)
 * @param {{now?: string, id?: string}} [opts]
 * @returns {Promise<{record: Object, reinforced: Object|null, expired: Object[]}>}
 */
// impure — reads and writes the adapter (disk IO)
export async function writeMindRecord(adapter, fields, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const active = await activeMindRecords(adapter, { asOf: now });

  const match = findReinforcementMatch(active, fields);
  const record = match
    ? reinforceMindRecord(match, fields, { now, id: opts.id })
    : makeMindRecord(fields, { now, id: opts.id });
  await adapter.append(record);

  // Enforce the cap on the post-write active set. The fresh record is exempt —
  // it is the newest signal; the weakest of the REST yield, weakest first.
  const standing = active.filter((r) => r.id !== match?.id);
  const overflow = standing.length + 1 - MIND_ACTIVE_CAP;
  const expired = [];
  if (overflow > 0) {
    const weakestFirst = [...standing].sort((a, b) => byStrengthThenRecency(b, a));
    for (const victim of weakestFirst.slice(0, overflow)) {
      await adapter.expire(MIND_LAYER, victim.id, { at: now });
      expired.push({ record: victim, reason: 'activeCap' });
    }
  }

  return { record, reinforced: match, expired };
}
