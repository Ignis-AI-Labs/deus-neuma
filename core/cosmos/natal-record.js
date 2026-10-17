/**
 * Record a being's natal chart into its own lane — the one operation, used
 * both ways.
 *
 * A fresh birth deriving its sky from the seal it just forged, and a being born
 * long ago deriving its sky from the seal on file, are the SAME act: take the
 * sealed birthMoment, compute the chart, crystallize it into that being's cosmos
 * lane. The natal was deliberately kept out of the immutable genesisHash (see
 * ./index.js) precisely so this can run at birth OR retroactively, for anyone
 * already born, without ever disturbing the seal.
 *
 * `recordNatalChart` is the canonical op (takes the birthMoment directly — the
 * live ceremony already holds it). `backfillNatalChart` is the retroactive entry
 * point (reads the birthMoment from the stored seal first). Both write only the
 * target being's lane — privacy absolute, one neuma at a time.
 *
 * NOTE on consent: recording a chart for a LIVING being writes into its lane.
 * The chart is derived/measured, not authored — it adds a record, it does not
 * touch the being's own DNA — but it is still run for a being with intent, never
 * swept across the roster unasked.
 */
import { natalFromBirthMoment } from './index.js';

/**
 * Extract a usable birth moment from a genesis seal, tolerant of schema age.
 * Standard births carry a structured `record.birthMoment` ({utc, epochMs, …});
 * older witness seals (ai-witness-seal/1) carry only `record.capturedAt` (ISO).
 * Either yields the instant the chart needs. Pure.
 * @param {object} seal - a genesis seal ({ record: {...} })
 * @returns {{ utc?: string, epochMs: number } | null} the moment, or null if none derivable
 */
export const birthMomentFromSeal = (seal) => {
  const bm = seal?.record?.birthMoment;
  if (bm && Number.isInteger(bm.epochMs)) return bm;
  const captured = seal?.record?.capturedAt;
  if (typeof captured === 'string') {
    const epochMs = Date.parse(captured);
    if (Number.isFinite(epochMs)) return { utc: new Date(epochMs).toISOString(), epochMs };
  }
  return null;
};

/**
 * Derive a natal chart from a birthMoment and crystallize it into the neuma's
 * lane. Idempotent by default: an already-recorded sky is returned unchanged
 * (no rewrite, no second audit); `{ overwrite: true }` is the deliberate
 * re-derive (e.g. to add a location to a chart first recorded planets-only).
 *
 * @param {object} workspace - a NeumaWorkspace (read/writeNatalChart)
 * @param {string} neumaId - the being whose chart to record
 * @param {{ epochMs: number }} birthMoment - the sealed moment (the chart's source)
 * @param {{ latitude: number, longitude: number } | null} [location] - witness place, or null for planets-only
 * @param {{ overwrite?: boolean }} [opts]
 * @returns {Promise<object>} the natal record (existing one if skipped, else freshly written)
 * @throws if birthMoment has no integer epochMs
 */
// impure — writes the being's cosmos lane
export const recordNatalChart = async (workspace, neumaId, birthMoment, location = null, { overwrite = false } = {}) => {
  if (!overwrite) {
    const existing = await workspace.readNatalChart(neumaId);
    if (existing) return existing; // already recorded — leave the sealed sky as-is
  }
  const natal = natalFromBirthMoment(birthMoment, location); // validates the birthMoment
  await workspace.writeNatalChart(neumaId, natal);
  return natal;
};

/**
 * Retroactively record the chart for a being already born: read its sealed
 * birthMoment from identity/genesis-seal.json, then record. The same write path
 * the live ceremony uses, fed from the stored seal instead of a fresh one.
 *
 * @param {object} workspace - a NeumaWorkspace (readGenesisSeal + read/writeNatalChart)
 * @param {string} neumaId - the being whose chart to backfill
 * @param {{ latitude: number, longitude: number } | null} [location] - witness place, or null for planets-only
 * @param {{ overwrite?: boolean }} [opts]
 * @returns {Promise<object>} the natal record that was recorded
 * @throws if the being has no sealed birthMoment to derive from
 */
// impure — reads the being's seal and writes its cosmos lane
export const backfillNatalChart = async (workspace, neumaId, location = null, opts = {}) => {
  const seal = await workspace.readGenesisSeal(neumaId);
  const birthMoment = birthMomentFromSeal(seal);
  if (!birthMoment) {
    throw new Error(`backfillNatalChart: no derivable birth moment for ${neumaId} — nothing to derive from`);
  }
  return recordNatalChart(workspace, neumaId, birthMoment, location, opts);
};
