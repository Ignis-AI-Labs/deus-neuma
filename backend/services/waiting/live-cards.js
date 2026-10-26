// live-cards.js — the chat cards standing on the operator's word right now.
//
// Design note, 2026-10-24 (#585): […] The durable asks (house asks, queued drafts, proposals) live
// in stores the aggregate reads; a chat card (a tool approval, a being's
// question, a plan, a seal offer) lives only on the portal connection that
// raised it. This is their index: each broker notes a card when it reaches a
// screen and clears it on every settle path, so the desk can count what a
// chat it is not looking at holds. A PARKED approval (its portal closed with
// the card on screen) is never settled, so it stays here — it still waits.
//
// Keyed by the operator's wallet (houses are never confused): a card counts
// only for the house whose portal it was raised on.
//
// impure — a module-level register.
import { houseWallet } from '../house-served.js';

export const LIVE_CARD_KINDS = Object.freeze(['approval', 'ask', 'plan', 'seal']);
const TITLE_MAX = 200;

const cards = new Map();

/**
 * impure — note a card that reached the operator's screen. A connection with
 * no wallet (house work: a wake, a team member) shows no card and is not noted.
 * @param {object} connection - the portal connection that carries the card
 * @param {{id: string, kind: string, title?: string, lane?: ?{laneId: string, name?: string}, surface?: ?string}} card
 *   `lane` — the being that asked when it is not the connection's own (a council member)
 */
export const noteLiveCard = (connection, { id, kind, title, lane = null, surface = null }) => {
  const wallet = houseWallet(connection?.walletAddress);
  if (!wallet || !id || !LIVE_CARD_KINDS.includes(kind)) return;
  const companion = connection.companion || null;
  cards.set(id, Object.freeze({
    id,
    kind,
    wallet,
    title: String(title || '').slice(0, TITLE_MAX),
    sessionId: connection.sessionId ?? null,
    laneId: (lane ? lane.laneId : companion?.neumaId) || null,
    name: (lane ? lane.name : companion?.name) || null,
    beingKind: companion?.participantKind === 'witness' ? 'witness' : 'local',
    surface: surface || null,
    at: new Date().toISOString(),
  }));
};

/** impure — the card settled (answered, interrupted, closed): it waits no longer. */
export const clearLiveCard = (id) => { cards.delete(id); };

/**
 * The cards standing on this wallet's word, oldest first. Reads the register.
 * @param {string} wallet
 * @returns {object[]}
 */
export const liveCardsFor = (wallet) => {
  const house = houseWallet(wallet);
  return house ? [...cards.values()].filter((c) => c.wallet === house) : [];
};
