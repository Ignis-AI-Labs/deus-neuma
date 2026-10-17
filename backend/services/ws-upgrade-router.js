/**
 * ws-upgrade-router — one upgrade handler for both WebSocket endpoints, and
 * the two boundaries every upgrade must pass.
 *
 * The WS endpoints share one HTTP server via a single upgrade router. They
 * MUST be noServer: a second `{server, path}` WebSocketServer would let the
 * first abort (400) any path it doesn't own before the other can handle it.
 *
 * Boundaries, in order:
 *   1. Origin (WS-001) — cross-origin upgrades are dropped; CLI/tests have no
 *      Origin and are allowed; the app's own loopback origin always is; the
 *      served tailnet origin is, only while Neuma Remote is enabled.
 *   2. Peer (docs/security/remote-surface.md) — the same decision the HTTP
 *      gate makes, because middleware never sees an upgrade and a socket is
 *      exempt from same-origin policy. The terminal is a shell, so it admits
 *      local desks only, never a phone. Dictation (/dictate-ws) carries the
 *      operator's voice to the local speech lane — local desks only as well.
 */
import { getAllowedOrigins, isSameOriginLoopback } from '../config.js';
import { upgradeAccess, servedOrigin } from './remote/access-guard.js';
import { createLogger } from './logger.js';
import { bindRemoteSocket } from './remote/socket-lifetime.js';
import { createSessionFollow } from './session-follow.js';

const log = createLogger('WsUpgrade');

/**
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
export const wsAllowedOrigin = (req) => {
  const origin = req.headers.origin;
  if (!origin) return true;
  // Road B: a tunnel socket's identity is the TLS handshake, not the
  // origin — the app's WebView presents `https://<deskid>.neuma`, its own
  // virtual origin. (Pairing sockets still die at the peer check below:
  // `/ws` is not the claim.)
  if (req.socket?.neumaTunnel) return true;
  // The app's own renderer (Electron loads http://127.0.0.1:<port>) is
  // same-origin and always allowed — the allowlist only governs other origins.
  if (isSameOriginLoopback(origin)) return true;
  if (origin === servedOrigin()) return true;
  const allowed = getAllowedOrigins();
  return Array.isArray(allowed) && allowed.includes(origin);
};

/**
 * Route upgrades by path; unknown paths, bad origins, and untrusted peers
 * are dropped before a handshake is ever completed. impure (server events).
 * @param {import('http').Server} server
 * @param {{ wss: import('ws').WebSocketServer, terminalWss: import('ws').WebSocketServer, dictateWss?: import('ws').WebSocketServer }} endpoints
 */
export const attachUpgradeRouter = (server, { wss, terminalWss, dictateWss }) => {
  // Siblings in one sitting (a phone and a desk) hear each other's turns —
  // admitted here, before the portal's own handler, so every frame is seen.
  const follow = createSessionFollow();
  // Never a silent drop (Rule 3): a refused upgrade names its reason here —
  // the phone only ever sees "dormant".
  const refuse = (socket, reason, req) => {
    log.debug('upgrade refused', { reason, origin: req.headers.origin ?? null, host: req.headers.host ?? null, path: String(req.url ?? '').split('?')[0] });
    socket.destroy();
  };
  server.on('upgrade', (req, socket, head) => {
    if (!wsAllowedOrigin(req)) { refuse(socket, 'origin not allowed', req); return; }
    const access = upgradeAccess(req);
    if (!access.allow) { refuse(socket, access.reason, req); return; }
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { refuse(socket, 'unreadable url', req); return; }
    if (pathname === '/ws') {
      log.debug('upgrade admitted', { scope: access.scope, host: req.headers.host ?? null });
      wss.handleUpgrade(req, socket, head, (client) => {
        follow.admit(client, req);
        bindRemoteSocket(client, req, access);
        wss.emit('connection', client, req);
      });
    } else if (pathname === '/terminal-ws' && access.scope === 'local') {
      terminalWss.handleUpgrade(req, socket, head, (client) => terminalWss.emit('connection', client, req));
    } else if (pathname === '/dictate-ws' && dictateWss && access.scope === 'local') {
      dictateWss.handleUpgrade(req, socket, head, (client) => dictateWss.emit('connection', client, req));
    } else {
      refuse(socket, `no endpoint at ${pathname} for ${access.scope}`, req);
    }
  });
};
