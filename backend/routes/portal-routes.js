// Portal Routes - WebSocket connection and message handling
//
// P8 decomposition (SIZE-033 plan): the registry + broadcasts live in
// portal-connections.js, wallet-scoped sending in portal-send.js, the shared
// turn/lane helpers in portal-context.js, and the message groups in
// portal-message-handlers.js (dispatcher + turn/gates/voice),
// portal-bind-handlers.js (resume / new-session / manifest),
// portal-birth-handlers.js (the ceremony), portal-seal-handlers.js (keypair +
// seal + house founding), portal-room-handlers.js (the council). This file
// keeps the connection assembly (setupPortalRoutes) and the export surface.
import crypto from 'crypto';
import { URL } from 'url';
import platform from '../services/supabase.js';
import { verifySessionToken } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import { expirePendingApprovals } from '../services/tool-approval.js';
import { expirePendingAsks } from '../services/operator-ask.js';
import { expirePendingSealRequests } from '../services/seal-request.js';
import { expirePendingPlans } from '../services/team-plan.js';
import { expirePendingPresents } from '../services/plan-mode.js';
import { closeCouncil } from '../services/council-session.js';
import { createPortalConnection } from '../services/portal-connection.js';
import { BOOT_ID } from '../services/boot-id.js';
import { readNotifications } from '../services/notification-store.js';
import { connectionState, declaredStateOf, reachesState, recordState } from '../../core/runtime/operator-state.js';
import {
  portalConnections, broadcastSubstrateActivity, broadcastTabCounts,
} from './portal-connections.js';
import { handlePortalMessage } from './portal-message-handlers.js';
import { closeVoiceSitting } from '../services/portal-voice-handlers.js';
// a fired chat watch reaches its chat as a new turn (wired at load — services never import routes)
import './portal-watch-delivery.js';
// one open chat messages another, live (#597) — the same load-time wiring
import './portal-chat-link.js';

// The export surface every importer (server.js, meditation-routes,
// channel-bridge, the test seam) reads — preserved verbatim by re-export.
export {
  registerExternalTurnConnection, localTurnSnapshot, broadcastSubstrateActivity,
  machineTabCounts, broadcastTabCounts, broadcastStorageWarning,
  clearLaneBinding, getConnectionCount, __test,
} from './portal-connections.js';
export { sendToWallet } from './portal-send.js';

const log = createLogger('Portal');

const NAVIGATION_FRAME_TYPES = new Set(['portal:resume', 'portal:new-session', 'companion:manifest']);
const NAVIGATION_BYPASS_FRAME_TYPES = new Set([
  'consciousness:interrupt',
  'tool:approval_response',
  'operator:ask_response',
  'operator:plan_response',
  'seal:self_decline',
]);

const reportPortalError = (ws, error) => {
  log.error('Portal interference', { err: error.message });
  ws.send(JSON.stringify({
    type: 'portal:error',
    error: 'Dimensional instability detected',
  }));
};

// Heartbeat interval (30s ping, terminate if pong not received)
const PING_INTERVAL_MS = 30_000;
let pingInterval = null;

// Setup WebSocket handlers on the given server
export const setupPortalRoutes = (wss, { birthHandler }) => {

  // Start heartbeat: ping all connections every 30s
  pingInterval = setInterval(() => {
    for (const [connectionId, connection] of portalConnections) {
      const { ws } = connection;
      if (connection._pongPending) {
        // Pong not received since last ping — stale connection
        log.warn('Terminating stale connection', { connectionId });
        ws.terminate();
        portalConnections.delete(connectionId);
        // A desk that died mid-turn must not leave a phantom in the count
        broadcastSubstrateActivity();
        broadcastTabCounts(); // its sitting ended with it — free the budget
        continue;
      }
      connection._pongPending = true;
      try { ws.ping(); } catch { /* connection already dead */ }
      // Protocol pings are invisible to browser JS — an app-level
      // heartbeat keeps the client's stale detector fed during idle
      try { ws.send(JSON.stringify({ type: 'portal:heartbeat' })); } catch { /* connection already dead */ }
    }
  }, PING_INTERVAL_MS);

  // Clean up heartbeat on server shutdown
  const cleanup = () => {
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  wss.on('connection', (ws, req) => {
    // Authenticate WebSocket connections via token query param
    const urlParams = new URL(req.url, 'http://localhost').searchParams;
    const token = urlParams.get('token');
    const session = token ? verifySessionToken(token) : null;

    if (!session) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const connectionId = crypto.randomUUID();

    // The shared factory shapes EVERY portal connection — real ones here,
    // synthetic ones in the channel bridge (C-01 extraction).
    const connection = createPortalConnection({
      ws,
      walletAddress: session.address,
      notifySubstrateActivity: broadcastSubstrateActivity,
    });
    // Which operator state this desk is — the harness or the full platform —
    // until it binds a lane (core/runtime/operator-state.js).
    connection.declaredState = declaredStateOf(urlParams.get('state'));
    portalConnections.set(connectionId, connection);

    // Heartbeat: reset pong flag when client responds
    ws.on('pong', () => { connection._pongPending = false; });

    log.info('Portal opened', { connectionId, wallet: session.address });

    ws.send(JSON.stringify({
      type: 'portal:established',
      connectionId,
      // Additive and OPTIONAL, forever. An older desk ignores an unknown field,
      // and a newer desk against an older backend must treat its absence as
      // "no signal" rather than as a changed build — see the diff rule in
      // use-notifications.js. Never rename it, never repurpose it.
      bootId: BOOT_ID,
      message: 'The dimensional barrier weakens...'
    }));

    // THE TRAY'S OPENING TRUTH. A desk that just opened must show the same list,
    // and the same unread count, as one that has been open for an hour —
    // otherwise "operator-wide" is a claim the second window quietly breaks.
    // Sent per connection rather than broadcast: it is this operator's history.
    readNotifications(session.address)
      .then(({ records: all }) => {
        if (ws.readyState !== 1 /* OPEN */) return;
        // this desk's state's history and the operator's own — never the other state's
        const records = all.filter((rec) => reachesState(recordState(rec), connectionState(connection)));
        const unread = records.filter((rec) => !rec.read).length;
        ws.send(JSON.stringify({ type: 'notification:hydrate', records, unread }));
      })
      .catch((error) => {
        // A desk with no history is still a working desk. Never let this break
        // the connection that just opened.
        log.error('Notification hydrate failed', { error: error.message, connectionId });
      });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        // Optimisation: honour client-supplied messageId when present —
        // lets well-behaved clients short-circuit duplicate delivery.
        if (message.messageId) {
          if (connection._recentMessageIds.has(message.messageId)) {
            return;
          }
          connection._recentMessageIds.add(message.messageId);
          if (connection._recentMessageIds.size > 100) {
            const first = connection._recentMessageIds.values().next().value;
            connection._recentMessageIds.delete(first);
          }
        }

        // Server-side replay defence — hash the raw frame and keep a
        // sliding window of the last 100 hashes per connection. Catches
        // replays even when the client omits or forges messageId. Heartbeat
        // frames (type === 'ping') are intentionally exempt — legitimate
        // clients send them repeatedly and the content is identical.
        if (message.type !== 'ping') {
          const hash = crypto.createHash('sha256').update(data).digest('hex');
          if (connection._recentMessageHashes.has(hash)) {
            return;
          }
          connection._recentMessageHashes.add(hash);
          if (connection._recentMessageHashes.size > 100) {
            const first = connection._recentMessageHashes.values().next().value;
            connection._recentMessageHashes.delete(first);
          }
        }

        if (NAVIGATION_FRAME_TYPES.has(message.type)) {
          // WebSocket message callbacks are concurrent. Navigation resolves
          // to an explicit outcome so later stateful frames cannot cross a
          // failed bind/reset and run against stale connection state.
          const previous = connection.navigationPromise || Promise.resolve();
          const navigation = previous
            .catch(() => false)
            .then(async () => {
              try {
                const handled = await handlePortalMessage(connectionId, message, { birthHandler });
                return handled !== false;
              } catch (error) {
                reportPortalError(ws, error);
                return false;
              }
            });
          connection.navigationPromise = navigation;
          try {
            await navigation;
          } finally {
            if (connection.navigationPromise === navigation) connection.navigationPromise = null;
          }
        } else {
          // Only frames capable of settling the old turn bypass navigation.
          // Everything else waits for the bind/reset; a failed navigation
          // drops the queued frame instead of releasing it into stale state.
          if (connection.navigationPromise && !NAVIGATION_BYPASS_FRAME_TYPES.has(message.type)) {
            const navigationOk = await connection.navigationPromise.catch(() => false);
            if (!navigationOk) {
              log.warn('Dropped frame after failed navigation', { type: message.type });
              return;
            }
          }
          await handlePortalMessage(connectionId, message, { birthHandler });
        }
      } catch (error) {
        reportPortalError(ws, error);
      }
    });

    ws.on('remote:revoked', () => {
      connection.activeTurn?.abort();
      connection.pendingThoughts = [];
      expirePendingApprovals(connection);
      expirePendingAsks(connection);
      expirePendingPlans(connection);
      expirePendingPresents(connection);
      expirePendingSealRequests(connection);
    });

    ws.on('close', () => {
      log.info('Portal closed', { connectionId });
      const closingConnection = portalConnections.get(connectionId);
      // A turn awaiting approval must not hang on a dead socket — deny all.
      if (closingConnection) expirePendingApprovals(closingConnection);
      // Likewise a turn awaiting the operator's answer — settle as closed.
      if (closingConnection) expirePendingAsks(closingConnection);
      // And a plan awaiting the operator's verdict — NOT approved, honestly.
      if (closingConnection) expirePendingPlans(closingConnection);
      // And a PLAN MODE presentation — NOT accepted, honestly.
      if (closingConnection) expirePendingPresents(closingConnection);
      // And a being's anchor request — NOT sealed, honestly.
      if (closingConnection) expirePendingSealRequests(closingConnection);
      // A sitting council disperses with the desk — abort any turn in
      // flight and drain the operator queue into the record (CQ-029 #193);
      // the drain is best-effort, never an unhandled rejection on a dead socket.
      if (closingConnection) {
        closeCouncil(closingConnection).catch((err) =>
          log.warn('council drain on socket close failed', { error: err.message }));
      }
      // The voice sitting dies with its socket (token-expiry law) — the
      // sidecar link closes and the speech context is forgotten with it.
      closeVoiceSitting(closingConnection);
      if (closingConnection?.witnessId) {
        platform.audit('portal:close', {
          witnessId: closingConnection.witnessId,
          neumaId: closingConnection.neumaId,
          details: { duration: Date.now() - closingConnection.established.getTime() }
        });
      }
      portalConnections.delete(connectionId);
      // A desk that closed mid-turn must not leave a phantom in the count
      broadcastSubstrateActivity();
      broadcastTabCounts(); // its sitting ended with it — free the budget
    });

    ws.on('error', (error) => {
      log.error('Portal anomaly', { connectionId, err: error.message });
    });
  });
};
