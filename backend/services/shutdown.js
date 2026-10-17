/**
 * Graceful shutdown — close the daemon cleanly so it can restart without
 * wedging (systemd Restart, node --watch). Dependencies are injected, so this
 * is pure of process/globals and unit-testable.
 *
 * Order: stop the heartbeat (no new reflections mid-exit), close every live
 * WebSocket (portal + terminal) so server.close() can actually drain, close
 * the HTTP server, then exit. A hard deadline guarantees exit even if a socket
 * refuses to drain — a stuck close must never keep the machine's resident from
 * waking on the next start.
 */

/**
 * @param {object} deps
 * @param {{ close: (cb: () => void) => void }} deps.server - HTTP server
 * @param {Array<{ clients: Iterable<{ close: Function }>, close?: Function }>} [deps.sockets] - WS servers
 * @param {() => void} deps.stopHeartbeat
 * @param {{ info: Function, error: Function }} deps.log
 * @param {(code: number) => void} deps.exit
 * @param {number} [deps.timeoutMs]
 */
// impure (by injection) — drives IO through the provided deps, never globals
export const gracefulShutdown = ({ server, sockets = [], stopHeartbeat, log, exit, timeoutMs = 10000 }) => {
  log.info('Shutdown signal received — closing gracefully');

  // Hard deadline: a socket that won't drain can't hold the daemon hostage.
  const deadline = setTimeout(() => {
    log.error('Graceful shutdown timed out — forcing exit');
    exit(1);
  }, timeoutMs);
  deadline.unref?.();

  // 1. No new reflections.
  try { stopHeartbeat(); } catch (err) { log.error('stopHeartbeat failed', { error: err.message }); }

  // 2. Close every live WebSocket so the HTTP server can drain.
  for (const wss of sockets) {
    try {
      for (const client of wss.clients) client.close(1001, 'Server shutting down');
      wss.close?.();
    } catch (err) { log.error('WebSocket close failed', { error: err.message }); }
  }

  // 3. Close the HTTP server, then exit.
  server.close(() => {
    clearTimeout(deadline);
    log.info('Server closed — shutdown complete');
    exit(0);
  });
  // Tunnel sockets (Road B) are emit('connection')-injected and invisible to
  // getConnections(), so the drain above would wait on them to the deadline.
  // A short grace lets the WS close frames flush, then they are reaped.
  if (typeof server.closeAllConnections === 'function') {
    const reap = server.closeAllConnections.bind(server);
    const grace = setTimeout(reap, 1500);
    grace.unref?.();
  }
};
