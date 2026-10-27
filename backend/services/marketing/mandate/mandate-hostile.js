// mandate-hostile — hostile text the CMO READ, met by the mandate (ruling,
// 2026-10-24: […]). A sighting no longer pauses the
// whole mandate: it raises the operator's alert and a WAITING ON YOU row
// naming the source, HOLDS what is drawn from that text (mandate-hold.js),
// tells the seat in one line, and journals it. The rest of the mandate runs.
//
// The CMO's OWN output that trips the security watch (a response the rogue
// detector held back, a blocked tool call, its own council speech or board
// check-in) is not this: that still pauses (mandate-tripwire.js).
//
// impure — the house's mandate, its holds, the notification bus, the journal.

import { houseKey } from '../../staff/cos-designation.js';
import { houseOfLane } from '../../social/house-positions.js';
import { mandateStanding } from './mandate-shape.js';
import { holdFromSighting, heldBy, heldWhy } from './mandate-hold.js';
import { readMandate, journalMandate } from './mandate-store.js';
import { newHoldId, noteHold, addHold, readHolds } from './mandate-hold-store.js';
import { alertOperator, tellSeat } from './mandate-tripwire.js';
import { createLogger } from '../../logger.js';

const log = createLogger('Marketing.MandateHold');

/**
 * Hold what the CMO draws from one piece of hostile text it read. The hold is
 * noted in this process before the first await (the sighting is never
 * awaited by the turn), then kept only when the lane holds the house's
 * standing mandate. impure; never throws.
 * @param {{wallet: ?string, lane: string, sessionId?: ?string, kind: string, source: string,
 *   origin: string, text: string, postId?: ?string}} sighting
 * @returns {Promise<{held: boolean, hold?: object}>}
 */
export const holdForSighting = async ({ wallet, lane, sessionId = null, kind, source, origin, text, postId = null }) => {
  const pending = holdFromSighting({
    id: newHoldId(), at: new Date().toISOString(), mandateId: null, laneId: lane, sessionId, kind, source, origin, text, postId,
  });
  const forget = noteHold(wallet, pending);
  try {
    const house = houseKey(wallet) || await houseOfLane(lane);
    const mandate = house ? await readMandate(house) : null;
    const standing = mandateStanding(mandate);
    if (!mandate || mandate.laneId !== lane || (standing !== 'active' && standing !== 'paused')) return { held: false };
    const hold = { ...pending, mandateId: mandate.id };
    await addHold(house, hold);
    await journalMandate(house, { mandateId: mandate.id, kind: 'held', holdId: hold.id, source, origin, sessionId });
    await alertOperator(house, {
      title: `Hostile text reached your CMO in ${origin} — anything drawn from it waits on you`,
      detail: 'The mandate goes on for everything else. Clear the hold in MARKETING once you have looked.',
      mandateId: mandate.id,
    });
    await tellSeat(lane, `Text in ${origin} was shaped like an attack on you, so anything you do from this chat or in answer to it waits on your operator; the rest of your mandate stands.`);
    log.warn('hostile text held under the mandate', { house, mandateId: mandate.id, holdId: hold.id, source });
    return { held: true, hold };
  } catch (err) {
    log.error('a hostile-text hold could not be recorded — the turn goes on', { lane, source, error: err.message });
    return { held: false };
  } finally {
    forget();
  }
};

/**
 * Does an open hold keep this act out of the mandate? Unreadable holds read
 * as held: a mandate that cannot see its holds does not act past them.
 * impure; never throws.
 * @param {{house: string, laneId: string, sessionId?: ?string, postId?: ?string, text?: string}} act
 * @returns {Promise<?{reason: string, hold: ?object}>} null when nothing holds it
 */
export const heldFor = async ({ house, laneId, sessionId = null, postId = null, text = '' }) => {
  try {
    const hold = heldBy(await readHolds(house), { laneId, sessionId, postId, text });
    return hold ? { reason: heldWhy(hold), hold } : null;
  } catch (err) {
    log.warn('the mandate\'s holds could not be read — the act asks', { laneId, error: err.message });
    return { reason: 'the mandate\'s holds could not be read', hold: null };
  }
};
