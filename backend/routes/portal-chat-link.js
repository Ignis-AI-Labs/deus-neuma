/**
 * CHAT-LINK, THE PORTAL'S HALF (#597; the law is services/chat-link.js). The
 * live chats come from the portal's own registry, and a link is delivered the
 * way a fired watch is (portal-watch-delivery.js):
 *
 *   - To that chat only: the live socket bound to the same wallet, lane and
 *     session. Closed while the link waited → it is not delivered, and logged.
 *   - Never mid-turn: a turn in flight is waited out, and the link's turn starts
 *     only on an idle chat. Never through the held-words queue, whose handoff
 *     cuts a running turn: that cut is the operator's alone.
 *   - Never as the operator: the row is marked origin 'link'
 *     (portal-turn-persist.js), its words open by naming a housemate, and the
 *     desk draws it as a LINK line, not a bubble.
 *   - It rides runTurnAndDrain, so the model line (turn-line.js) and the house's
 *     ceilings meter it like any other turn.
 *
 * Wired at load, like the watch deliverer: services must not import routes.
 */
import { createLogger } from '../services/logger.js';
import { getChatLabels } from '../services/user-chat-labels.js';
import {
  setChatLinkDoors, openChatsFor, chatAt, isOpenChat, addressOf, linkThought, linkRunFull,
} from '../services/chat-link.js';
import { portalConnections } from './portal-connections.js';
import { runTurnAndDrain } from './portal-context.js';

const log = createLogger('ChatLink');
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

const live = () => portalConnections.values();

// impure — the wallet's chat titles; an unreadable map names no chat, never fails the link
const labelsFor = (wallet) => getChatLabels(wallet).catch(() => ({}));

// impure — a chat open on the desk (the registry holds its address in its house): the only kind
// that can send and be answered. By address, never identity: the intent sweep asks with its
// captured copy of the connection (intent-context.js).
const canLink = (connection) => isOpenChat(connection)
  && Boolean(chatAt(live(), connection.walletAddress, addressOf(connection)));

// impure — wait out a turn in flight; the chat as it stands once idle, or null if it closed
const idleChat = async (wallet, address) => {
  for (;;) {
    const chat = chatAt(live(), wallet, address);
    if (!chat || !chat.turnPromise) return chat;
    await chat.turnPromise.catch(() => {});
    await pause(250); // the turn's own settle (persist, notices) lands first
  }
};

// impure — the link reaches its chat once that chat is idle, and the chat takes a turn on it
const deliver = async (wallet, address, link) => {
  const chat = await idleChat(wallet, address);
  if (!chat) {
    log.warn('chat link not delivered — the chat closed while it waited', { from: link.from.chat, to: address });
    return;
  }
  if (linkRunFull(chat)) {
    log.warn('chat link held — the chat took its run of links without its operator', { from: link.from.chat, to: address });
    return;
  }
  // frame, origin and turn with NO await between: a message landing in a gap would start a second turn
  chat.ws.send(JSON.stringify({ type: 'chatlink:arrived', from: link.from, text: link.thought, at: Date.now() }));
  chat._turnOrigin = 'link';
  chat._linkRun = (chat._linkRun || 0) + 1;
  log.info('chat link delivered — the chat takes a turn', { from: link.from.chat, to: address });
  await runTurnAndDrain(chat, { thought: link.thought });
};

/**
 * impure — send a link from `self` to the chat at `address`. Answers at once
 * with whom it reached and whether that chat was mid-turn; the delivery runs on
 * its own, so the sender's turn never waits on another chat's. null when no
 * such chat is open in this house.
 */
const send = async (self, address, { body, re }) => {
  const wallet = self.walletAddress;
  const target = chatAt(live(), wallet, address);
  if (!target) return null;
  const labels = await labelsFor(wallet);
  const chat = addressOf(self);
  const from = { chat, name: self.companion.name || self.companion.neumaId, title: labels[chat] || null };
  const busy = Boolean(target.turnPromise);
  deliver(wallet, address, { from, thought: linkThought({ from, body, re }) })
    .catch((err) => log.warn('chat link turn failed', { to: address, error: err?.message }));
  return { name: target.companion.name || target.companion.neumaId, busy };
};

setChatLinkDoors(Object.freeze({
  canLink,
  openChats: async (self) => openChatsFor(live(), self, await labelsFor(self.walletAddress)),
  find: (self, address) => chatAt(live(), self.walletAddress, address),
  send,
}));
