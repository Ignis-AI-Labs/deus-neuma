import { normalizeSpace } from './space.js';

const allowedRecallSpaces = (space, fallbackToGeneral) => {
  const activeId = normalizeSpace(space).id;
  const allowed = new Set([activeId]);
  if (fallbackToGeneral && activeId !== 'general') allowed.add('general');
  return allowed;
};

/**
 * Whether a memory is recallable at an instant. Invalid `asOf` deliberately
 * preserves the existing behavior of hiding nothing.
 *
 * @param {{occurredAt?:(string|null),invalidatedAt?:(string|null)}} doc
 * @param {(string|number|Date|null)} [asOf]
 * @returns {boolean}
 */
export const isValidAt = (doc, asOf = null) => {
  if (!doc) return false;
  const t = asOf != null ? new Date(asOf).getTime() : Date.now();
  if (Number.isNaN(t)) return true;
  if (doc.occurredAt) {
    const occurred = new Date(doc.occurredAt).getTime();
    if (!Number.isNaN(occurred) && occurred > t) return false;
  }
  if (doc.invalidatedAt) {
    const invalidated = new Date(doc.invalidatedAt).getTime();
    if (!Number.isNaN(invalidated) && t >= invalidated) return false;
  }
  return true;
};

/** A graph node may only use a persisted observation/continuity id. */
export const stableRecallId = (doc) =>
  typeof doc?.obsId === 'string' && doc.obsId.trim() ? doc.obsId : null;

/**
 * A retired graph seed must have existed by the recall instant and belong to
 * the same active/general scope as emitted recall documents. Supersession
 * evidence is checked separately by the graph builder.
 */
export const isRetiredRecallDoc = (
  doc,
  { space = null, asOf = null, fallbackToGeneral = true } = {},
) => {
  if (!doc?.invalidatedAt) return false;
  const instant = asOf != null ? new Date(asOf).getTime() : Date.now();
  const invalidated = new Date(doc.invalidatedAt).getTime();
  if (Number.isNaN(instant) || Number.isNaN(invalidated) || instant < invalidated) return false;
  if (doc.occurredAt) {
    const occurred = new Date(doc.occurredAt).getTime();
    if (!Number.isNaN(occurred) && occurred > instant) return false;
  }
  return allowedRecallSpaces(space, fallbackToGeneral).has(doc?.space?.id);
};


/**
 * Build the stable-id universe allowed for one recall. Temporal and scope
 * filtering happens here, before any graph edge or traversal is considered.
 *
 * @param {Array<Object>} docs
 * @param {{space?:Object,asOf?:(string|number|Date|null),fallbackToGeneral?:boolean}} [opts]
 * @returns {Map<string,Object>}
 */
export const eligibleRecallDocs = (
  docs,
  { space = null, asOf = null, fallbackToGeneral = true } = {},
) => {
  const allowedSpaces = allowedRecallSpaces(space, fallbackToGeneral);

  const eligible = new Map();
  for (const doc of docs || []) {
    const id = stableRecallId(doc);
    if (!id || eligible.has(id)) continue;
    if (!isValidAt(doc, asOf) || !allowedSpaces.has(doc?.space?.id)) continue;
    eligible.set(id, doc);
  }
  return eligible;
};
