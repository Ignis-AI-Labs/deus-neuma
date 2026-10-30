/**
 * wire — how Neuma Remote attaches to the Express app (docs/security/remote-surface.md).
 *
 * Three acts, called from server.js at the points that matter:
 *   installRemoteGate  — right after CORS, before any body is parsed: who is
 *                        on the other end, decided before Host is trusted.
 *   mountRemoteRoutes  — before the blanket-requireAuth routers, so the
 *                        phone's /session door is reachable with only the
 *                        device cookie; plus the local-only tier for routes
 *                        other routers own.
 *   attachRemoteTunnelTarget — the http.Server the native tunnel (Road B)
 *                        injects admitted TLS sockets into; started from the
 *                        store by startRemoteTunnel at boot, stopped by
 *                        stopRemoteTunnel at shutdown.
 */
import { remoteStore } from './remote-store.js';
import { accessScopeMiddleware, requireLocalScope } from './access-guard.js';
import { createRemoteRouter, createEnrollRouter } from '../../routes/remote-routes.js';
import {
  setRemoteHttpServer, startTunnelFromStore, stopTunnel,
} from './road-control.js';

// A paired phone can use Neuma, but never activate the machine, swap or stop
// its substrate, rewrite a wallet's spending consent or a house's posting
// credentials, or strand itself. Each guard passes local requests straight
// through to the router mounted after it.
const LOCAL_ONLY_ROUTES = Object.freeze([
  ['post', '/api/v1/license/activate'],
  ['put', '/api/v1/llm/provider'],
  ['post', '/api/v1/llm/substrate/ignite'],
  ['post', '/api/v1/substrate/unload'],
  ['post', '/api/v1/substrate/capacity'],
  ['put', '/api/v1/substrate/standby'],
  // re-audit 2026-10-29, NEW-M1: the consent a wallet spends under (who it may pay, how much without
  // asking) and the credentials a house posts with are set at the desk, never from a paired phone
  ['post', '/api/v1/neuma/:neumaId/wallet/allowlist'],
  ['put', '/api/v1/neuma/:neumaId/wallet/threshold'],
  ['put', '/api/v1/social-channels/:channelId/credentials'],
  ['delete', '/api/v1/social-channels/:channelId/credentials'],
  ['post', '/api/v1/social-channels/accounts'],
  ['post', '/api/v1/social-channels/accounts/unlock'],
  ['post', '/api/v1/social-channels/accounts/start-fresh'],
  ['put', '/api/v1/social-channels/accounts/:accountId/credentials'],
  ['delete', '/api/v1/social-channels/accounts/:accountId'],
  ['put', '/api/v1/social-channels/apps/:channelId'],
  ['post', '/api/v1/social-channels/:channel(youtube|tiktok)/connect'],
]);

const passThrough = (_req, _res, next) => next();

/**
 * Read the remote record into memory and stand the gate. Local requests are
 * stamped and pass untouched; a tailnet peer through Serve needs the device
 * cookie. impure (fs once, then app state).
 * @param {import('express').Express} app
 */
export const installRemoteGate = async (app) => {
  await remoteStore.load();
  app.use(accessScopeMiddleware);
};

/**
 * The phone's two doors, the desk's management routes, and the local-only
 * tier. impure (app state).
 * @param {import('express').Express} app
 */
export const mountRemoteRoutes = (app) => {
  app.use('/r', createEnrollRouter());
  app.use('/api/v1/remote', createRemoteRouter());
  for (const [method, route] of LOCAL_ONLY_ROUTES) {
    app[method](route, requireLocalScope, passThrough);
  }
};

/**
 * Hand the tunnel its injection target — the same http.Server the upgrade
 * router watches. Called once from server.js after the server exists; the
 * tunnel is created lazily by road-control on first enable, or at boot from
 * the store below. impure.
 * @param {import('http').Server} server
 */
export const attachRemoteTunnelTarget = (server) => {
  setRemoteHttpServer(server);
};

/**
 * Boot the native road if a native road is already on. Guarded by the
 * caller: a tunnel that cannot start costs the road, not the listen.
 * impure (disk, maybe listen).
 * @returns {Promise<object | null>}
 */
export const startRemoteTunnel = () => startTunnelFromStore();

/**
 * Stop the native road at shutdown. impure (sockets).
 * @returns {Promise<void>}
 */
export const stopRemoteTunnel = () => stopTunnel();
