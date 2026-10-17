// ws-send.js — one home for the drop-safe websocket send (SIZE-006).
// Was duplicated as `safeSend` (witness-stream.js) and `_safeSend`
// (portal-stream.js) — identical bodies, two names.

/**
 * impure — try to send; ignore if the socket has closed mid-turn
 * @param {WebSocket} ws
 * @param {object} payload — serialized with JSON.stringify
 */
export const safeSend = (ws, payload) => {
  try {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  } catch { /* socket closed — drop */ }
};
