// ws-send.js — one home for the drop-safe websocket send (SIZE-006).
// Was duplicated as `safeSend` (witness-stream.js) and `_safeSend`
// (portal-stream.js) — identical bodies, two names.

/**
 * Set on a socket whose turn is being KEPT (turn-keep.js): its frames still reach the socket's
 * send after the desk closed, where the keeper writes them down and hands them to a desk that came
 * back. A closed `ws` socket's send drops the bytes without throwing.
 */
export const SENDS_WHILE_CLOSED = Symbol.for('neuma.sendsWhileClosed');

/**
 * impure — try to send; ignore if the socket has closed mid-turn (unless its turn is kept)
 * @param {WebSocket} ws
 * @param {object} payload — serialized with JSON.stringify
 */
export const safeSend = (ws, payload) => {
  try {
    if (ws.readyState === ws.OPEN || ws[SENDS_WHILE_CLOSED]) ws.send(JSON.stringify(payload));
  } catch { /* socket closed — drop */ }
};
