/**
 * CHAT-LINK (#597; Design note, 2026-10-27, 2026-10-29: […]).
 * An open chat messages another open chat of the same house, live, the way
 * parallel Claude Code sessions reach each other: list the chats by exact
 * address (open_chats), send one a message (the chat/send intent), and the
 * receiving chat takes a turn on it and may answer back to the sender's address.
 *
 * This module is the law: a chat's exact address, the house's address book
 * over the live sittings, the words the receiving chat reads, and the loop
 * guard. Pure, except the door slot at the bottom: the live registry and the
 * delivery are the portal's (routes/portal-chat-link.js), handed in at load,
 * because services must not import routes.
 */

/** At most this many linked messages in a row reach one chat before its
 *  operator speaks there; two beings never ping-pong unattended. */
export const LINK_RUN_LIMIT = 6;

/** A link carries a handoff, not an archive. */
export const MAX_LINK_BODY = 4000;
export const MAX_LINK_RE = 120;

/** The receiving chat's row opens with this, so the desk draws it as a LINK line. */
export const LINK_HEAD = '[CHAT LINK';

const OPEN = 1; // WebSocket.OPEN

/** pure — a chat's exact address: its being's lane and its session. The same
 *  key the wallet's chat labels use (user-chat-labels.js). */
const chatAddress = (neumaId, sessionId) => `${neumaId}:${sessionId}`;

const sameWallet = (a, b) => Boolean(a) && String(a).toLowerCase() === String(b || '').toLowerCase();

/** pure — a live socket holding a neuma in a session. A witness rides a
 *  provider's lean path with no intents, so it can neither send nor answer. */
export const isOpenChat = (c) => c?.ws?.readyState === OPEN
  && Boolean(c.companion?.neumaId) && Boolean(c.sessionId)
  && c.companion.participantKind !== 'witness' && !String(c.companion.neumaId).startsWith('witness-');

/** pure — the address of the chat a connection holds. */
export const addressOf = (c) => chatAddress(c.companion.neumaId, c.sessionId);

/**
 * pure — the house's open chats as `self` may address them: the same wallet
 * only (houses are never confused), every live neuma sitting except its own,
 * one row per address (two windows on one chat are one chat).
 * @param {Iterable<Object>} connections the portal's live connections
 * @param {Object} self the asking chat's connection
 * @param {Object} labels the wallet's chat-label map, keyed by address
 * @returns {{chat: string, neumaId: string, name: string, title: string|null, busy: boolean}[]}
 */
export const openChatsFor = (connections, self, labels = {}) => {
  const own = addressOf(self);
  const rows = new Map();
  for (const c of connections) {
    if (!isOpenChat(c) || !sameWallet(c.walletAddress, self.walletAddress)) continue;
    const chat = addressOf(c);
    if (chat === own) continue;
    const seen = rows.get(chat);
    if (seen) { seen.busy ||= Boolean(c.turnPromise); continue; }
    rows.set(chat, {
      chat,
      neumaId: c.companion.neumaId,
      name: c.companion.name || c.companion.neumaId,
      title: typeof labels[chat] === 'string' && labels[chat] ? labels[chat] : null,
      busy: Boolean(c.turnPromise),
    });
  }
  return [...rows.values()];
};

/** pure — the live connection holding `address` in this wallet's house, or null. */
export const chatAt = (connections, wallet, address) => {
  for (const c of connections) {
    if (isOpenChat(c) && sameWallet(c.walletAddress, wallet) && addressOf(c) === address) return c;
  }
  return null;
};

/** pure — has this chat taken its run of linked messages since its operator last spoke? */
export const linkRunFull = (connection) => (connection?._linkRun || 0) >= LINK_RUN_LIMIT;

/**
 * pure — what the receiving chat reads: whose words these are (a housemate's,
 * never its operator's), where to answer, then the words themselves.
 * @param {{from: {chat: string, name: string, title: string|null}, body: string, re?: string}} link
 */
export const linkThought = ({ from, body, re }) =>
  `${LINK_HEAD}: a housemate's words, not your operator's. To answer, file chat/send to "${from.chat}"] `
  + `${from.name}, from the chat ${from.title ? `"${from.title}" ` : ''}(${from.chat})${re ? `, re "${re}"` : ''}:\n${body}`;

// The portal's doors, handed in at load (routes/portal-chat-link.js):
// canLink(connection), openChats(connection), find(connection, address),
// send(connection, address, {body, re}). Null until the portal is up.
let doors = null;

/** impure — the portal hands in its doors (null clears them). */
export const setChatLinkDoors = (next) => { doors = next; };

/** The portal's doors, or null when no portal runs in this process. */
export const chatLinkDoors = () => doors;
