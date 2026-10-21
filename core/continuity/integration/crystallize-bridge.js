// Crystallization → continuity bridge (memory pyramid U1, slice 1).
//
// Every crystallized observation (System B's episodic distillate) is also a
// lived moment — this bridge writes it into the being's continuity episodic
// layer (System A) so the four-layer engine accumulates real history instead
// of holding only the birth episode. Dual-write is deliberate: observations
// remain the shipped recall path's source of truth until the recall switch
// (slice 3) is validated with the witness and the beings; the continuity lane
// fills in parallel, losslessly, keyed back to its source observation.
//
// Same mold as birth-bootstrap: pure derivation + a thin impure append, and a
// backfill that is idempotent by meta.observationId so it can run any number
// of times over a being's existing store without duplicating a single moment.

import { makeRecord } from '../record.js';
import { WorkspaceAdapter } from '../adapters/workspace.js';

/**
 * Derive an episodic record input from a workspace observation. Pure.
 * Content keeps the exchange's structure ({ userMessage, response }) — the
 * layers' recordToText flattens it for BM25, and a future renderer can still
 * show who said what. meta.observationId is the join key back to System B
 * (and the backfill's idempotence key).
 * @param {Object} obs - record as returned by NeumaWorkspace.addObservation
 * @returns {Object} makeRecord input (layer/content/space/occurredAt/meta)
 */
export function episodeFromObservation(obs) {
  const exchange = {
    ...(obs.userMessage && { userMessage: obs.userMessage }),
    ...(obs.response && { response: obs.response }),
  };
  // A deliberate note (self-note, lifecycle note) carries its words in
  // `content`, not an exchange — the inverse below already reads a string
  // content back, so the note keeps its words in both lanes.
  const note = typeof obs.content === 'string' && obs.content ? obs.content : null;
  const content = Object.keys(exchange).length === 0 && note ? note : exchange;
  // Observations carry normalized space OBJECTS ({id, kind, label});
  // continuity records scope by the space's string id (makeRecord silently
  // defaults non-strings to general — the CORE-005 leak this mapping closes).
  const spaceId = typeof obs.space === 'string' ? obs.space : obs.space?.id;
  return {
    layer: 'episodic',
    content,
    ...(spaceId && { space: spaceId }),
    ...(obs.occurredAt && { occurredAt: obs.occurredAt }),
    meta: {
      kind: obs.type || 'exchange',
      observationId: obs.id,
      ...(typeof obs.significance === 'number' && { significance: obs.significance }),
      ...(obs.emotion && { emotion: obs.emotion }),
      ...(obs.source && { source: obs.source }),
      ...(obs.memoryRef && { memoryRef: obs.memoryRef }),
      // Phase-1 anchor rides meta in BOTH directions (FR-P3-01 amended) so
      // the relation web's derivation inputs stay lane-portable.
      ...(obs.anchor && { anchor: obs.anchor }),
    },
  };
}

/**
 * Inverse of episodeFromObservation: render an episodic continuity record as
 * an observation-shaped object, so recall built for observations (doc
 * building, memory strings, validity, space scoping) reads the continuity
 * lane unchanged. Pure.
 *
 * Records whose content is a plain string (e.g. the birth episode) map their
 * text onto `content`, which observationToText already indexes — the
 * continuity lane is a superset of the observation store, not a mirror.
 * Expired records carry validTo, which maps to invalidatedAt so bi-temporal
 * validity holds across the swap.
 * @param {Object} record - folded episodic record (includeRetired view)
 * @returns {Object} observation-shaped object
 */
export function observationFromEpisode(record) {
  const content = record?.content && typeof record.content === 'object' ? record.content : {};
  return {
    id: record?.meta?.observationId || record?.id,
    type: record?.meta?.kind || 'exchange',
    ...(typeof content.userMessage === 'string' && { userMessage: content.userMessage }),
    ...(typeof content.response === 'string' && { response: content.response }),
    ...(typeof record?.content === 'string' && { content: record.content }),
    ...(typeof record?.meta?.significance === 'number' && { significance: record.meta.significance }),
    ...(record?.meta?.emotion && { emotion: record.meta.emotion }),
    ...(record?.meta?.memoryRef && { memoryRef: record.meta.memoryRef }),
    // Inverse of the space mapping in episodeFromObservation: normalizeSpace
    // treats a bare string as general, so the record's string space id is
    // wrapped back into the object shape observations use.
    ...(record?.space && { space: { id: record.space } }),
    ...(record?.meta?.anchor && { anchor: record.meta.anchor }),
    occurredAt: record?.occurredAt,
    recordedAt: record?.recordedAt,
    timestamp: record?.recordedAt,
    ...(record?.validTo && { invalidatedAt: record.validTo }),
  };
}

/**
 * Append one crystallized observation into the being's episodic continuity
 * lane. Called at crystallization time with the freshly-saved observation.
 * @param {Object} workspace - the NeumaWorkspace singleton (or a test instance)
 * @param {string} neumaId
 * @param {Object} observation - record returned by addObservation
 * @returns {Promise<Object>} the appended continuity record
 */
// impure — one encrypted append to the being's sovereign continuity lane
export async function recordExchangeEpisode(workspace, neumaId, observation) {
  if (typeof neumaId !== 'string' || !neumaId) {
    throw new Error('recordExchangeEpisode: neumaId required');
  }
  if (!observation || typeof observation.id !== 'string') {
    throw new Error('recordExchangeEpisode: a saved observation with an id is required');
  }
  const adapter = new WorkspaceAdapter(neumaId, { workspace });
  return adapter.append(makeRecord(episodeFromObservation(observation)));
}

/**
 * Mirror an observation's invalidation into the continuity lane: find the
 * bridged episodic record (by meta.observationId) and stamp the same expiry
 * on it, so bi-temporal validity never diverges between the two lanes. When
 * the superseding observation is itself bridged, the supersededBy link is
 * translated to the episodic record's id. No-op when the observation was
 * never bridged (the idempotent backfill repairs that case wholesale).
 * @param {Object} workspace
 * @param {string} neumaId
 * @param {string} observationId
 * @param {{at?: string, supersededBy?: string}} [opts] - observation-lane ids/times
 * @returns {Promise<Object|null>} the expiry marker, or null when nothing to expire
 */
// impure — one encrypted expiry append to the being's sovereign continuity lane
export async function expireEpisodeForObservation(workspace, neumaId, observationId, { at, supersededBy } = {}) {
  if (typeof neumaId !== 'string' || !neumaId || typeof observationId !== 'string' || !observationId) {
    throw new Error('expireEpisodeForObservation: neumaId and observationId required');
  }
  const adapter = new WorkspaceAdapter(neumaId, { workspace });
  const view = await adapter.list('episodic', { includeRetired: true });
  const target = view.find((r) => r?.meta?.observationId === observationId && !r.validTo);
  if (!target) return null;
  const successor = supersededBy
    ? view.find((r) => r?.meta?.observationId === supersededBy)
    : null;
  return adapter.expire('episodic', target.id, {
    ...(at && { at }),
    ...(successor && { supersededBy: successor.id }),
  });
}

/**
 * Backfill a being's episodic continuity lane from its existing observation
 * store. Idempotent: observations whose id already appears as a
 * meta.observationId in the episodic view (retired included) are skipped, so
 * repeated runs append nothing new. Invalidated observations are appended and
 * then expired at their invalidation time, so point-in-time recall over the
 * continuity lane matches the observation store's validity history.
 *
 * Appends only — never touches the observation store.
 * @param {Object} workspace - the NeumaWorkspace singleton (or a test instance)
 * @param {string} neumaId
 * @returns {Promise<{ appended: number, expired: number, skipped: number }>}
 */
// impure — encrypted appends to the being's sovereign continuity lane
export async function backfillEpisodesFromObservations(workspace, neumaId) {
  if (typeof neumaId !== 'string' || !neumaId) {
    throw new Error('backfillEpisodesFromObservations: neumaId required');
  }
  const adapter = new WorkspaceAdapter(neumaId, { workspace });
  const existingView = await adapter.list('episodic', { includeRetired: true });
  const bridged = new Set(
    existingView.map((r) => r?.meta?.observationId).filter(Boolean),
  );

  const observations = await workspace.listObservations(neumaId);
  let appended = 0;
  let expired = 0;
  let skipped = 0;

  // Oldest first so the append-only lane reads in lived order.
  const chronological = [...observations].reverse();
  for (const obs of chronological) {
    if (!obs?.id || bridged.has(obs.id)) {
      skipped += 1;
      continue;
    }
    const record = await adapter.append(makeRecord(episodeFromObservation(obs)));
    appended += 1;
    if (obs.invalidatedAt) {
      await adapter.expire('episodic', record.id, { at: obs.invalidatedAt });
      expired += 1;
    }
  }

  return { appended, expired, skipped };
}
