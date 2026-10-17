/**
 * A FIRED WATCH, DELIVERED TO ITS CHAT (chat-watch.js; Design note, 2026-10-15: […]). The watched thing ended; the chat that
 * set the watch gets a NEW turn carrying the report.
 *
 *   - Only to that conversation: the live desk socket bound to the watch's
 *     wallet, lane and session. None open → the watch waits; it is offered
 *     again when that chat is next opened (portal-bind-handlers.js).
 *   - Never mid-turn (the turn ends where the being ends it — 7d99f6b11): a
 *     turn in flight is waited out, and the watch's turn starts only on an
 *     idle chat. Never through the held-words queue, whose handoff cuts a
 *     running turn — that cut is the operator's alone.
 *   - Never as the operator: the row is marked origin 'watch'
 *     (portal-turn-persist.js), the report opens by naming itself the
 *     platform's, and the desk draws it as a WATCH line, not a bubble.
 *
 * Wired at load, like the notification sender: services must not import routes.
 */
import { createLogger } from '../services/logger.js';
import { claimWatch, setWatchDeliverer } from '../services/chat-watch.js';
import { portalConnections } from './portal-connections.js';
import { runTurnAndDrain } from './portal-context.js';

const log = createLogger('ChatWatch');
const OPEN = 1; // WebSocket.OPEN
const inFlight = new Set();
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

// pure — what the being reads: whose words these are, then the report
export const watchThought = (watch) =>
  `[A WATCH YOU SET — the platform reporting, not your operator] ${watch.label} has settled. ${watch.report}`
  + ' Your operator asked to be told when it ended.';

// impure — the open chat this watch belongs to, or null
const chatFor = (watch) => [...portalConnections.values()].find((c) => c.ws?.readyState === OPEN
  && String(c.walletAddress || '').toLowerCase() === watch.wallet
  && c.companion?.neumaId === watch.laneId && c.sessionId === watch.sessionId) || null;

// impure — wait out a turn in flight; the chat as it stands once idle, or null if it closed
const idleChat = async (watch) => {
  for (;;) {
    const chat = chatFor(watch);
    if (!chat || !chat.turnPromise) return chat;
    await chat.turnPromise.catch(() => {});
    await pause(250); // the turn's own settle (persist, notices) lands first
  }
};

export const deliverWatch = async (watch) => {
  if (inFlight.has(watch.id)) return;
  inFlight.add(watch.id);
  try {
    const chat = await idleChat(watch);
    if (!chat) return; // not open — held for the next opening
    // claim, frame and turn with NO await between: a message landing in a gap would start a second turn
    if (!claimWatch(watch.id)) return; // another path took it
    chat.ws.send(JSON.stringify({ type: 'watch:fired', id: watch.id, kind: watch.kind, label: watch.label, text: watchThought(watch), at: Date.now() }));
    chat._turnOrigin = 'watch';
    log.info('watch delivered — the chat takes a turn', { kind: watch.kind, ref: watch.ref, sessionId: watch.sessionId });
    await runTurnAndDrain(chat, { thought: watchThought(watch) });
  } finally {
    inFlight.delete(watch.id);
  }
};

setWatchDeliverer(deliverWatch);
