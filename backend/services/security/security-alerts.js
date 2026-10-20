// Security alerts — THE OPERATOR'S EAR: how the watch tells the house's
// operator, by card (tray + OS leg), what the ledger alone cannot.
//
// Policy (ruling, 2026-10-19):
//   - a NEW critical or high — first sighting, a watch-closed entry seen
//     again, or an open entry re-rated up into critical/high — raises ONE
//     card per run, never one per threat;
//   - an open critical reminds at most once per 24 hours until it is settled;
//   - medium never raises a card; it is counted on the card that does go out.
//
// The card goes to the operator of the house whose ledger holds the threat,
// CSO seated or not: the seat decides who ASSESSES, never whether the
// operator HEARS (before this an unseated house's criticals reached nobody).
// Fail-soft by law: the watch's record never depends on a card (the bus
// itself already never throws).

import { csoDesignation } from './cso-designation.js';
import { threatLedgerFor } from './threat-ledger.js';
import { remindersDue } from './threat-lifecycle.js';
import { houseKey } from '../staff/cos-designation.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { createLogger } from '../logger.js';

const log = createLogger('SecurityAlerts');

export const REMIND_EVERY_MS = 24 * 60 * 60 * 1000;
const CARD_NAMES = 3;

// pure — […], the first few by name.
const nameLine = (entries) => entries.slice(0, CARD_NAMES)
  .map((e) => `${e.severity.toUpperCase()} ${e.externalId}${e.repo ? ` (${e.repo})` : ''}`)
  .join(' · ') + (entries.length > CARD_NAMES ? ` · +${entries.length - CARD_NAMES} more in the ledger` : '');

const countOf = (entries, severity) => entries.filter((e) => e.severity === severity).length;

// impure — the seat line: an operator with no CSO must know nobody else is
// reading these. A failed seat read only drops the line.
const seatNote = async (house) => {
  const officer = await csoDesignation.getOfficer(house).catch(() => null);
  return officer?.laneId ? null : 'no CSO seated — these wait on you';
};

// A card's detail is one short line (the record caps it), so the parts go
// in the order the operator most needs them; what the cap cuts rides `ref`.
const detailOf = (...parts) => parts.filter(Boolean).join(' · ');

// impure — one card, then the stamp the reminder cadence counts from.
const raise = async ({ house, title, detail, ref, carded, ledger, at }) => {
  const record = await notifyOperator({
    wallet: house, kind: KIND.securityAlert, standing: STANDING.system, title, detail, ref,
  });
  if (record && ledger && carded.every((e) => e.id)) {
    await ledger.markAlerted(carded.map((e) => e.id), at)
      .catch((err) => log.warn('the alert stamp did not land — the next tick may remind early', { error: err.message }));
  }
  return record;
};

/**
 * A run's fresh threats → one card when any is critical/high.
 * impure — notification store + socket, and the ledger stamp when given.
 * @param {Array<Object>} fresh entries this run made new (added, reopened, re-rated)
 * @param {string} wallet the house whose ledger took them
 * @param {{ledger?: Object, nowMs?: number}} [opts]
 * @returns {Promise<?Object>} the card raised, or null
 */
export const alertOnNewCriticals = async (fresh, wallet, { ledger = null, nowMs = Date.now() } = {}) => {
  const house = houseKey(wallet);
  const all = fresh || [];
  const loud = all.filter((e) => e.severity === 'critical' || e.severity === 'high');
  if (!house || !loud.length) return null;
  try {
    const medium = countOf(all, 'medium');
    return await raise({
      house, ledger, carded: loud, at: new Date(nowMs).toISOString(),
      title: `Security watch: ${loud.length} new critical/high threat${loud.length === 1 ? '' : 's'}`,
      detail: detailOf(await seatNote(house), nameLine(loud), medium ? `${medium} new medium counted in the ledger` : null),
      ref: { critical: countOf(loud, 'critical'), high: countOf(loud, 'high'), medium },
    });
  } catch (err) {
    log.warn('the security alert could not be raised — the ledger still holds the threats', { error: err.message });
    return null;
  }
};

/**
 * The standing reminder: every open critical whose last card is a day old
 * rides one card. impure.
 * @param {{wallet: string, nowMs?: number, ledger?: Object}} opts
 * @returns {Promise<?Object>} the card raised, or null
 */
export const remindOpenCriticals = async ({ wallet, nowMs = Date.now(), ledger } = {}) => {
  const house = houseKey(wallet);
  if (!house) return null;
  try {
    const store = ledger || await threatLedgerFor(house);
    const due = remindersDue(await store.load(), nowMs, REMIND_EVERY_MS);
    if (!due.length) return null;
    const oldest = due.reduce((min, e) => (e.ingestedAt < min ? e.ingestedAt : min), due[0].ingestedAt);
    return await raise({
      house, ledger: store, carded: due, at: new Date(nowMs).toISOString(),
      title: `Security watch: ${due.length} critical threat${due.length === 1 ? '' : 's'} still open`,
      detail: detailOf(await seatNote(house), `open since ${oldest}`, nameLine(due)),
      ref: { critical: due.length, reminder: true },
    });
  } catch (err) {
    log.warn('the security reminder could not be raised — the ledger still holds the threats', { error: err.message });
    return null;
  }
};
