/**
 * What the legal intents (legal-acts.js, legal-opinion-act.js) share: the
 * seat law, and the recency duty every filing the house acts on carries.
 *
 * THE SEAT LAW:
 * legal acts belong to the seated CLO alone, re-read per act — refused BEFORE
 * any card, so the operator is never asked for an act this lane may not hold.
 * The seat is the filing connection's OWN house's (its operator's wallet).
 */
import { cloDesignation } from '../legal/clo-designation.js';

/** impure — the seat, re-read per act. */
export const seatRefusal = async (connection) =>
  ((await cloDesignation.holds(connection.walletAddress, connection.companion?.neumaId))
    ? null
    : { ok: false, status: 'denied', reason: 'legal acts belong to the seated CLO alone' });

/** pure */
export const invalid = (reason) => ({ ok: false, status: 'invalid', reason });

/** impure — offered to the seated lane only. */
export const availableFor = async ({ laneId, connection }) =>
  ((await cloDesignation.holds(connection?.walletAddress, laneId)) ? {} : null);

// THE RECENCY DUTY (legal/recency-sweep.js): the app sweeps; the filing answers.
export const SWEEP_FIELDS = 'sweep: {terms, jurisdictions}, recency: ["<what you make of each action the app finds>"]';
export const SWEEP_DUTY = 'The app sweeps the official feeds for the last 120 days on your sweep terms (each must appear in your text); name every action it finds in recency by its number or title and say what it means here — "not on point, because …" is an answer.';

/** The filing's account of what is newer: its recency lines, then its own text. Pure. */
export const accountOf = (recency, text) => [...(Array.isArray(recency) ? recency.map(String) : []), text].join('\n');
