// socket-resilience — the policy behind a socket that survives a phone's link.
//
// Faber's hardening, lifted where Neuma did not already have it (its
// index.html WS section): a handshake that never opens is force-closed so
// the ordinary reconnect path runs; reconnects back off exponentially and
// reset once a link proves stable; and a message typed while disconnected
// waits in an outbox mirrored to storage, drained on reopen. Silence
// policing already exists in WebSocketService (the server heartbeats every
// 30 s; 120 s without a frame forces a close), so no ping/pong is added.
//
// PURE throughout: the WebSocketService owns the timers and the socket,
// this module owns the decisions, so the decisions can be proven in Node.

export const CONNECT_MS = 12000;
// A page coming back from the background: a socket that has heard nothing
// for this long is presumed a zombie the OS froze, and is closed so the
// ordinary reconnect path runs — the server heartbeats every 30 s.
export const NUDGE_SILENCE_MS = 45000;
export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 15000;

/**
 * The delay before the next reconnect attempt: doubles from the floor to the
 * ceiling; null means […].
 * @param {number | null} previous
 * @returns {number}
 */
export const nextBackoff = (previous) =>
  previous === null ? BACKOFF_MIN_MS : Math.min(BACKOFF_MAX_MS, previous * 2);
