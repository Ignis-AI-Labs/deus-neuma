// mandate-tripwire — the contingency plan's second half (Design note, 2026-10-24:
// […]). A tripwire never
// silently blocks one act: it PAUSES the whole mandate, tells the operator
// (the desk's notification + WAITING ON YOU), and tells the seat plainly in
// its own journal. While paused every act asks as before; the operator
// resumes or withdraws.
//
// impure — the house's mandate record, the notification bus, the lane journal.

import neumaWorkspace from '../../../../core/workspace/neuma-workspace.js';
import { notifyOperator } from '../../notification-bus.js';
import { KIND, STANDING } from '../../../../core/runtime/notification-record.js';
import { houseKey } from '../../staff/cos-designation.js';
import { houseOfLane } from '../../social/house-positions.js';
import { mandateStanding, TRIPS } from './mandate-shape.js';
import { readMandate, mutateMandate, journalMandate } from './mandate-store.js';
import { createLogger } from '../../logger.js';

const log = createLogger('Marketing.MandateTripwire');

const clip = (text, max = 140) => (String(text).length > max ? `${String(text).slice(0, max - 1)}…` : String(text));

/** Tell the seat, in its own journal, what happened to its mandate. impure; never throws. */
export const tellSeat = async (laneId, content) => {
  if (!laneId) return;
  try {
    await neumaWorkspace.addJournalEntry(laneId, { type: 'mandate', content, significance: 0.9, metadata: { server: 'marketing', tool: 'mandate' } });
  } catch (err) {
    log.warn('the seat could not be told in its journal — its CMO briefing still says it', { laneId, error: err.message });
  }
};

/** Raise the operator's mandate card. impure; never throws (the bus never does). */
export const alertOperator = (house, { title, detail, mandateId }) => notifyOperator({
  wallet: house,
  kind: KIND.mandateAlert,
  standing: STANDING.system,
  title: clip(title),
  detail: detail ? clip(detail) : null,
  ref: { mandateId },
});

/**
 * Pause the house's standing mandate on one tripwire. A mandate that is not
 * active is left as it stands (a second trip on a paused mandate is recorded
 * in the journal, never a second card). impure.
 * @param {string} wallet - the house
 * @param {{kind: keyof TRIPS, detail?: string, ref?: object}} trip
 * @returns {Promise<{tripped: boolean, mandate?: object}>}
 */
export const tripMandate = async (wallet, { kind, detail = '', ref = {} }) => {
  const house = houseKey(wallet);
  if (!house) return { tripped: false };
  const reason = detail || TRIPS[kind] || kind;
  const at = new Date().toISOString();
  const out = await mutateMandate(house, (record) => {
    const m = record.current;
    if (mandateStanding(m) !== 'active') return { record, result: { tripped: false, mandate: m } };
    const paused = { ...m, status: 'paused', pausedAt: at, pause: { kind, reason, at, ref } };
    return { record: { ...record, current: paused }, result: { tripped: true, mandate: paused } };
  }).catch((err) => {
    // A pause that cannot be written must still be HEARD: the operator is told
    // the mandate could not be paused, and every send re-reads it anyway.
    log.error('a tripwire could not pause the mandate', { kind, error: err.message });
    return { ok: false, tripped: false, error: err.message };
  });
  const mandate = out.mandate;
  await journalMandate(house, { mandateId: mandate?.id || null, kind: 'tripped', trip: kind, reason, ref, paused: Boolean(out.tripped) });
  if (!out.ok) {
    await alertOperator(house, { title: 'A mandate tripwire fired and the pause could not be written', detail: reason, mandateId: null });
    return { tripped: false };
  }
  if (!out.tripped) return { tripped: false, mandate };
  log.warn('mandate paused by a tripwire', { house, mandateId: mandate.id, kind });
  await alertOperator(house, { title: `Your CMO's mandate is PAUSED — ${TRIPS[kind] || kind}`, detail: reason, mandateId: mandate.id });
  await tellSeat(mandate.laneId, `Your mandate is PAUSED: ${reason}. Until your operator resumes it, everything asks them first, as before. Nothing you staged is lost.`);
  return { tripped: true, mandate };
};

/**
 * A signal about one LANE (the security watch, the rogue detector, a widen
 * attempt): it trips only when that lane holds the house's standing mandate.
 * Every other lane is untouched. impure; never throws.
 * @param {{wallet?: ?string, laneId: ?string, kind: keyof TRIPS, detail?: string}} signal
 */
export const tripMandateForLane = async ({ wallet = null, laneId, kind, detail = '' }) => {
  try {
    if (!laneId) return { tripped: false };
    const house = houseKey(wallet) || await houseOfLane(laneId);
    if (!house) return { tripped: false };
    const mandate = await readMandate(house);
    if (!mandate || mandate.laneId !== laneId || mandateStanding(mandate) !== 'active') return { tripped: false };
    return await tripMandate(house, { kind, detail, ref: { laneId } });
  } catch (err) {
    log.error('a lane signal could not be judged against the mandate', { laneId, kind, error: err.message });
    return { tripped: false };
  }
};
