// The continuity record — the one shape every memory layer shares.
//
// Substrate-agnostic by design: this module has ZERO dependencies on neuma
// internals (no NeumaWorkspace, no crypto, no wire) so the same engine runs over
// a neuma's encrypted sovereign store AND over a plain directory of records
// (Claude's own /memory). See docs/planning/proposals/memory/continuity-ecosystem.md.
//
// Four layers, one record shape:
//   episodic   — events / sessions, scoped to a space   ([…])
//   semantic   — distilled facts / the through-line       ([…])
//   procedural — methods / how-to / skills                ([…])
//   working    — the live, bounded context set            ([…])
//
// Temporal model (bi-temporal, learned-from-Graphiti):
//   occurredAt  — when the thing happened (event time)
//   recordedAt  — when we wrote it down (system time)
//   validFrom / validTo — the window the fact/edge is held TRUE. validTo === null
//                 means "still valid". Expiry sets validTo; it NEVER deletes.
//
// Supersede-not-delete is the anti-gaslighting invariant: a record is retired by
// appending a newer record that `supersedes` it (and/or by stamping validTo),
// never by mutating or removing the original.

import { randomUUID } from 'crypto';

/** The four memory layers. Frozen so callers can validate against it. */
export const LAYERS = Object.freeze(['episodic', 'semantic', 'procedural', 'working']);

/** Default space — every untagged record belongs here (matches core/memory/space.js). */
export const GENERAL_SPACE = 'general';

const isLayer = (v) => LAYERS.includes(v);

/** True when `v` is a parseable ISO timestamp string. Exported — adapters
 *  validate the same way makeRecord does (no path skips temporal validation). */
export const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/**
 * Recursively freeze an object graph in place. Records are the source of truth
 * for an append-only log, so a "frozen" record must not have a mutable nested
 * payload (`record.content.nested.x = 2` must throw). Cycle-safe. Pure-ish:
 * freezes in place (makeRecord takes ownership of the content/meta it is given).
 * @param {*} obj
 * @param {WeakSet} [seen]
 * @returns {*} the same object, deeply frozen
 */
export function deepFreeze(obj, seen = new WeakSet()) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (seen.has(obj)) return obj; // already visited — break cycles
  seen.add(obj);
  for (const value of Object.values(obj)) deepFreeze(value, seen);
  return Object.freeze(obj);
}

/**
 * Build a frozen continuity record with defaults filled. Pure given (input, opts):
 * the only impurity is the default id (randomUUID) and default timestamp (now),
 * both of which can be supplied by the caller for deterministic tests.
 *
 * @param {Object} input
 * @param {string} input.layer - one of LAYERS (required)
 * @param {*} input.content - the payload (string or structured); required, non-empty
 * @param {string} [input.space] - project/workspace scope (default 'general')
 * @param {string} [input.occurredAt] - event time ISO (default = recordedAt)
 * @param {Array<{type:string,targetId:string,validFrom?:string,validTo?:string|null}>} [input.relations]
 * @param {{kind?:string,ref?:string}} [input.source] - provenance
 * @param {string} [input.supersedes] - id of a record this replaces (additive retire)
 * @param {string} [input.id] - explicit id (else a uuid); opts.id overrides
 * @param {string} [input.recordedAt] - explicit system time ISO (else now); opts.now overrides
 * @param {Object} [input.meta] - freeform, frozen as-is
 * @param {{now?:string, id?:string}} [opts] - injectables (override the input equivalents)
 * @returns {Readonly<Object>} frozen record
 * @throws {Error} on invalid layer, empty content, or malformed temporal fields
 */
export function makeRecord(input, opts = {}) {
  if (!input || typeof input !== 'object') throw new Error('makeRecord: input object required');
  const { layer, content } = input;
  if (!isLayer(layer)) throw new Error(`makeRecord: layer must be one of ${LAYERS.join('|')}, got ${String(layer)}`);
  if (content === undefined || content === null || content === '') {
    throw new Error('makeRecord: content is required and must be non-empty');
  }

  const now = opts.now || input.recordedAt || new Date().toISOString();
  if (!isIso(now)) throw new Error(`makeRecord: recordedAt must be an ISO timestamp, got ${String(now)}`);
  const id = opts.id || input.id || randomUUID();
  if (typeof id !== 'string' || !id) throw new Error('makeRecord: id must be a non-empty string');

  const recordedAt = now;
  const occurredAt = input.occurredAt ?? recordedAt;
  if (!isIso(occurredAt)) throw new Error(`makeRecord: occurredAt must be an ISO timestamp, got ${String(occurredAt)}`);

  const validFrom = input.validFrom ?? occurredAt;
  if (!isIso(validFrom)) throw new Error(`makeRecord: validFrom must be an ISO timestamp, got ${String(validFrom)}`);
  const validTo = input.validTo ?? null; // null = still valid
  if (validTo !== null && !isIso(validTo)) throw new Error(`makeRecord: validTo must be null or an ISO timestamp`);

  const space = typeof input.space === 'string' && input.space.trim() ? input.space.trim() : GENERAL_SPACE;

  const relations = normalizeRelations(input.relations, validFrom);
  const source = input.source && typeof input.source === 'object'
    ? Object.freeze({ kind: input.source.kind ?? 'unknown', ref: input.source.ref ?? null })
    : Object.freeze({ kind: 'unknown', ref: null });

  return Object.freeze({
    id,
    layer,
    content: typeof content === 'object' ? deepFreeze(content) : content,
    space,
    occurredAt,
    recordedAt,
    validFrom,
    validTo,
    relations,
    source,
    supersedes: typeof input.supersedes === 'string' ? input.supersedes : null,
    meta: input.meta && typeof input.meta === 'object' ? deepFreeze({ ...input.meta }) : Object.freeze({}),
  });
}

/**
 * Normalize + freeze the relation edges. Each edge carries its own validity
 * window (edge-level temporal validity — a fact can be marked […] without touching the episode that stated it). Invalid edges are dropped.
 * Pure.
 * @param {Array} relations
 * @param {string} defaultFrom - validFrom default for edges that omit it
 * @returns {ReadonlyArray<Readonly<Object>>}
 */
export function normalizeRelations(relations, defaultFrom) {
  if (!Array.isArray(relations)) return Object.freeze([]);
  const out = [];
  for (const r of relations) {
    if (!r || typeof r !== 'object') continue;
    if (typeof r.type !== 'string' || !r.type) continue;
    if (typeof r.targetId !== 'string' || !r.targetId) continue;
    const from = isIso(r.validFrom) ? r.validFrom : defaultFrom;
    const to = r.validTo === null || r.validTo === undefined ? null : (isIso(r.validTo) ? r.validTo : null);
    out.push(Object.freeze({ type: r.type, targetId: r.targetId, validFrom: from, validTo: to }));
  }
  return Object.freeze(out);
}

/**
 * Is this record currently valid as of `asOf`? A record is valid when it is not
 * expired (validTo) relative to asOf. Pure.
 * @param {Object} record
 * @param {string} [asOf] - ISO timestamp (default = now)
 * @returns {boolean}
 */
export function isValidAsOf(record, asOf) {
  if (!record) return false;
  const at = asOf && isIso(asOf) ? Date.parse(asOf) : Date.now();
  if (record.validFrom && Date.parse(record.validFrom) > at) return false; // not yet in force
  if (record.validTo !== null && record.validTo !== undefined && Date.parse(record.validTo) <= at) return false; // expired
  return true;
}
