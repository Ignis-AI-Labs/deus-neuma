// mandate-lifecycle — the operator's acts on a mandate: GRANT, WITHDRAW,
// RESUME, RENEW, and CLEAR of a hostile-text hold. A mandate never grants itself: every act here is reached
// only through the operator's own signed session (mandate-routes.js) or the
// operator's CLI at the machine (scripts/mandate.mjs), never from a being.
//
// WITHDRAW is the contingency plan's first half: it revokes at once, cancels
// every post approved under the mandate that has not left, names what is
// already in flight (a single platform call no one can recall), tells the
// seat plainly, and journals all of it.
//
// impure — the house's mandate record, the post queue, the lane journal.

import { postQueue } from '../../social/post-queue.js';
import { houseEntries } from '../../social/queue-house.js';
import { listAccounts } from '../../social/account-store.js';
import { cmoDesignation } from '../cmo-designation.js';
import { houseKey } from '../../staff/cos-designation.js';
import { settleGrant, mandateStanding, plainWords, termWords, DEFAULT_DAYS } from './mandate-shape.js';
import { mutateMandate, retire, newMandateId, journalMandate } from './mandate-store.js';
import { tellSeat } from './mandate-tripwire.js';
import { clearHold } from './mandate-hold-store.js';
import { createLogger } from '../../logger.js';

const log = createLogger('Marketing.Mandate');
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Grant the house's CMO seat a mandate. Refused while one still stands
 * (withdraw it first — a mandate is changed whole, never widened in place).
 * impure.
 * @param {string} wallet - the house operator granting it
 * @param {object} input - the grant screen's choices
 */
export const grantMandate = async (wallet, input) => {
  const house = houseKey(wallet);
  if (!house) return { ok: false, status: 400, error: 'a mandate needs the house\'s wallet' };
  const officer = await cmoDesignation.getOfficer(house);
  if (!officer?.laneId) return { ok: false, status: 409, error: 'seat a CMO first — a mandate is the CMO seat\'s' };
  const accounts = await listAccounts(house);
  const out = await mutateMandate(house, (record) => {
    const standing = mandateStanding(record.current);
    if (standing === 'active' || standing === 'paused') {
      return { error: 'a mandate already stands — withdraw it first, then grant the new one' };
    }
    const settled = settleGrant(input, { accounts, house, laneId: officer.laneId, by: house, now: new Date(), id: newMandateId() });
    if (!settled.ok) return { error: settled.error };
    const base = record.current ? retire(record, record.current) : record;
    return { record: { ...base, current: settled.mandate }, result: { mandate: settled.mandate } };
  });
  if (!out.ok) return { ok: false, status: 409, error: out.error };
  await journalMandate(house, { mandateId: out.mandate.id, kind: 'granted', words: plainWords(out.mandate) });
  await tellSeat(out.mandate.laneId, `Your operator granted you a MANDATE: ${plainWords(out.mandate, { seatName: 'You' })[0]} Read it whole with mandate_read.`);
  log.info('mandate granted', { house, mandateId: out.mandate.id, accounts: out.mandate.accounts.map((a) => a.id) });
  return { ok: true, mandate: out.mandate };
};

// impure — cancel every post approved under this mandate that has not left.
const cancelPending = async (house, mandateId, by) => {
  const entries = (await houseEntries(house)).filter((e) => e.decidedUnder === mandateId);
  const cancelled = [];
  const refused = [];
  for (const e of entries.filter((x) => x.status === 'approved')) {
    const pulled = await postQueue.withdraw(e.id, { withdrawnBy: by, reason: 'mandate-withdrawn' });
    (pulled.ok ? cancelled : refused).push(e.id);
  }
  // Re-read: a post the scheduler claimed while we worked is in flight now.
  const after = (await houseEntries(house)).filter((e) => e.decidedUnder === mandateId);
  return { cancelled, inFlight: after.filter((e) => e.status === 'sending').map((e) => e.id), refused };
};

/**
 * WITHDRAW — one press, from anywhere the operator stands. Revokes at once;
 * a mandate that already ended is still swept for anything left pending.
 * impure.
 * @param {string} wallet
 * @param {{by?: string, reason?: string}} [opts]
 */
export const withdrawMandate = async (wallet, { by = null, reason = '' } = {}) => {
  const house = houseKey(wallet);
  if (!house) return { ok: false, status: 400, error: 'a mandate needs the house\'s wallet' };
  const at = new Date().toISOString();
  const out = await mutateMandate(house, (record) => {
    if (!record.current) return { error: 'no mandate stands' };
    const ended = { ...record.current, status: 'withdrawn', withdrawnAt: at, withdrawnBy: by || house, withdrawReason: String(reason || '').slice(0, 300) };
    return { record: retire(record, ended), result: { mandate: ended } };
  });
  if (!out.ok) return { ok: false, status: 409, error: out.error };
  const swept = await cancelPending(house, out.mandate.id, by || house);
  await journalMandate(house, { mandateId: out.mandate.id, kind: 'withdrawn', by: by || house, reason: out.mandate.withdrawReason, ...swept });
  const inFlight = swept.inFlight.length ? ` ${swept.inFlight.length} post(s) were already leaving and could not be stopped.` : '';
  await tellSeat(out.mandate.laneId, `Your operator WITHDREW your mandate. ${swept.cancelled.length} queued post(s) under it were cancelled.${inFlight} From now on every act asks them first, as before.`);
  log.warn('mandate withdrawn', { house, mandateId: out.mandate.id, cancelled: swept.cancelled.length, inFlight: swept.inFlight.length });
  return { ok: true, mandate: out.mandate, ...swept };
};

/** RESUME a paused mandate. impure. */
export const resumeMandate = async (wallet) => {
  const house = houseKey(wallet);
  if (!house) return { ok: false, status: 400, error: 'a mandate needs the house\'s wallet' };
  const out = await mutateMandate(house, (record) => {
    if (mandateStanding(record.current) !== 'paused') return { error: 'only a paused mandate can be resumed' };
    const { pause, pausedAt, ...rest } = record.current;
    const resumed = { ...rest, status: 'active', resumedAt: new Date().toISOString(), lastPause: pause || null };
    return { record: { ...record, current: resumed }, result: { mandate: resumed, pausedAt } };
  });
  if (!out.ok) return { ok: false, status: 409, error: out.error };
  await journalMandate(house, { mandateId: out.mandate.id, kind: 'resumed' });
  await tellSeat(out.mandate.laneId, `Your operator RESUMED your mandate — it stands again, ${termWords(out.mandate)}.`);
  return { ok: true, mandate: out.mandate };
};

/** RENEW the term from today (a mandate "until withdrawn" needs none). impure. */
export const renewMandate = async (wallet) => {
  const house = houseKey(wallet);
  if (!house) return { ok: false, status: 400, error: 'a mandate needs the house\'s wallet' };
  const out = await mutateMandate(house, (record) => {
    const m = record.current;
    if (!m || m.status === 'withdrawn') return { error: 'no mandate stands to renew' };
    if (!m.expiresAt) return { error: 'this mandate stands until you withdraw it — there is nothing to renew' };
    const days = m.days || DEFAULT_DAYS;
    const renewed = { ...m, status: m.status === 'paused' ? 'paused' : 'active', expiresAt: new Date(Date.now() + days * DAY_MS).toISOString(), renewedAt: new Date().toISOString() };
    return { record: { ...record, current: renewed }, result: { mandate: renewed } };
  });
  if (!out.ok) return { ok: false, status: 409, error: out.error };
  await journalMandate(house, { mandateId: out.mandate.id, kind: 'renewed', expiresAt: out.mandate.expiresAt });
  await tellSeat(out.mandate.laneId, `Your operator RENEWED your mandate, ${termWords(out.mandate)}.`);
  return { ok: true, mandate: out.mandate };
};

/**
 * CLEAR one hostile-text hold: the operator has looked. What was staged under
 * it stays a card for them to decide; only what comes next is covered again.
 * impure.
 * @param {string} wallet
 * @param {string} id - the hold's id
 */
export const clearMandateHold = async (wallet, id) => {
  const house = houseKey(wallet);
  if (!house) return { ok: false, status: 400, error: 'a mandate needs the house\'s wallet' };
  const out = await clearHold(house, String(id || ''), { by: house });
  if (!out.ok) return { ok: false, status: 404, error: out.error };
  await journalMandate(house, { mandateId: out.hold.mandateId, kind: 'cleared', holdId: out.hold.id, origin: out.hold.origin });
  await tellSeat(out.hold.laneId, `Your operator looked at the text held from ${out.hold.origin} and cleared it. What you staged from it is still theirs to decide.`);
  return { ok: true, hold: out.hold };
};
