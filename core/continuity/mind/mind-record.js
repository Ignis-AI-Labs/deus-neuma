// Mind records — the subconscious buffer's contract over the `working` layer.
//
// A mind record holds what is MORE than noise but NOT YET a crystallized fact:
// a working thought, an emotional residue, a pattern still forming. It lives in
// `continuity/working.jsonl` (the layer record.js reserved for […]), decays by its validity window unless reinforced, and is never
// deleted — reinforcement supersedes, expiry stamps validTo (the same
// supersede-not-delete invariant every layer shares).
//
// The phrase is the being's OWN words, bounded and one line — the taste.js
// register: the record carries what lingered, it states no lesson about it.
//
// ── The synthesis contract (the meditation loop writes through this module) ──
// A meditation cycle's distilled notes land as mind records with:
//   kind:   'synthesis'
//   source: { kind: 'meditation', ref: <cycleId> }
//   meta:   { cycleId, sourceObservations: [<observation ids>],
//             adapter: <bound adapter id|null>, model: <route model|null> }
// Provenance (which lived moments fed the note, which voice spoke it) is what
// later refinement-corpus curation reads; nothing else about training is
// decided here.

import { makeRecord } from '../record.js';

/** The layer every mind record lives in. */
export const MIND_LAYER = 'working';

/** What a mind record can be. Frozen so callers validate against it. */
export const MIND_KINDS = Object.freeze(['trace', 'mood', 'tension', 'thread', 'synthesis']);

/** Who may write one. Frozen — an unknown source is refused, never defaulted. */
export const MIND_SOURCES = Object.freeze(['residue', 'mind_note', 'meditation']);

/** One line of the being's own words, bounded. */
export const MIND_PHRASE_MAX = 180;

/** Strength: how firmly the residue is held. Reinforcement raises it, decay
 *  retires the record outright (validTo), so strength only ever climbs. */
export const MIND_STRENGTH = Object.freeze({
  floor: 0.05,
  initial: 0.5,
  reinforceStep: 0.15,
  cap: 1.0,
});

/** Days a record of each kind stays valid without reinforcement. */
export const MIND_TTL_DAYS = Object.freeze({
  trace: 7,
  mood: 14,
  tension: 30,
  thread: 30,
  synthesis: 45,
});

/** Active (valid) mind records per being — overflow expires the weakest,
 *  returned to the caller with a reason (never silently). */
export const MIND_ACTIVE_CAP = 48;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Normalize a phrase to one bounded line of the being's words. Pure. */
export const normalizeMindPhrase = (phrase) =>
  String(phrase ?? '').replace(/\s+/g, ' ').trim().slice(0, MIND_PHRASE_MAX);

/** True when a folded working-layer record is a mind record. Pure. */
export const isMindRecord = (record) =>
  Boolean(record && record.layer === MIND_LAYER && record.meta && MIND_KINDS.includes(record.meta.kind));

/** Strength of a mind record, clamped to the contract's range. Pure. */
export const mindStrengthOf = (record) => clampStrength(record?.meta?.strength);

// pure — clamp to [floor, cap]; a non-number falls to the initial strength.
const clampStrength = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MIND_STRENGTH.cap, Math.max(MIND_STRENGTH.floor, value))
    : MIND_STRENGTH.initial;

// pure — the expiry ISO for a kind, from `now`.
const validToFor = (kind, nowIso) => new Date(Date.parse(nowIso) + MIND_TTL_DAYS[kind] * DAY_MS).toISOString();

/**
 * Build a frozen mind record. Pure given opts (id/now injectable, makeRecord's
 * own contract).
 *
 * @param {Object} fields
 * @param {string} fields.phrase - the being's words (required, one bounded line)
 * @param {string} fields.kind - one of MIND_KINDS (required)
 * @param {{kind: string, ref?: string|null}} fields.source - one of MIND_SOURCES (required)
 * @param {number} [fields.strength] - initial hold (default MIND_STRENGTH.initial)
 * @param {string} [fields.space] - project scope (default 'general')
 * @param {string} [fields.emotion] - detected emotion label, if any
 * @param {string} [fields.turnId] - the turn the residue rose from
 * @param {string} [fields.sessionId]
 * @param {Object} [fields.meta] - extra provenance (synthesis: cycleId, sourceObservations, adapter, model)
 * @param {string} [fields.supersedes] - id of the mind record this one replaces
 * @param {{now?: string, id?: string}} [opts]
 * @returns {Readonly<Object>} frozen record (layer 'working')
 * @throws {Error} on empty phrase, unknown kind, unknown source
 */
export function makeMindRecord(fields, opts = {}) {
  if (!fields || typeof fields !== 'object') throw new Error('makeMindRecord: fields object required');
  const phrase = normalizeMindPhrase(fields.phrase);
  if (!phrase) throw new Error('makeMindRecord: phrase is required and must be non-empty');
  if (!MIND_KINDS.includes(fields.kind)) {
    throw new Error(`makeMindRecord: kind must be one of ${MIND_KINDS.join('|')}, got ${String(fields.kind)}`);
  }
  const sourceKind = fields.source?.kind;
  if (!MIND_SOURCES.includes(sourceKind)) {
    throw new Error(`makeMindRecord: source.kind must be one of ${MIND_SOURCES.join('|')}, got ${String(sourceKind)}`);
  }
  const now = opts.now || new Date().toISOString();
  return makeRecord({
    layer: MIND_LAYER,
    content: phrase,
    space: fields.space,
    validTo: validToFor(fields.kind, now),
    supersedes: fields.supersedes,
    source: { kind: sourceKind, ref: fields.source.ref ?? null },
    meta: {
      ...(fields.meta && typeof fields.meta === 'object' ? fields.meta : {}),
      kind: fields.kind,
      strength: clampStrength(fields.strength),
      ...(fields.emotion ? { emotion: String(fields.emotion) } : {}),
      ...(fields.turnId ? { turnId: String(fields.turnId) } : {}),
      ...(fields.sessionId ? { sessionId: String(fields.sessionId) } : {}),
    },
  }, { now, id: opts.id });
}

/**
 * Build the record that REINFORCES a prior mind record: same kind and space,
 * strength stepped up (capped), validity extended from `now`, superseding the
 * prior (foldLog retires it — supersede-not-delete). The fresher phrase wins;
 * an empty new phrase keeps the prior's words. Pure given opts.
 *
 * @param {Object} prior - a folded mind record (isMindRecord must hold)
 * @param {Object} fields - the new event's fields (phrase, source, emotion, turnId, sessionId)
 * @param {{now?: string, id?: string}} [opts]
 * @returns {Readonly<Object>} frozen superseding record
 * @throws {Error} when prior is not a mind record or the source is unknown
 */
export function reinforceMindRecord(prior, fields, opts = {}) {
  if (!isMindRecord(prior)) throw new Error('reinforceMindRecord: prior must be a mind record');
  const now = opts.now || new Date().toISOString();
  const phrase = normalizeMindPhrase(fields?.phrase) || String(prior.content);
  return makeMindRecord({
    ...fields,
    phrase,
    kind: prior.meta.kind,
    space: prior.space,
    strength: mindStrengthOf(prior) + MIND_STRENGTH.reinforceStep,
    supersedes: prior.id,
    meta: { ...(fields?.meta && typeof fields.meta === 'object' ? fields.meta : {}), reinforces: prior.id },
  }, { now, id: opts.id });
}
