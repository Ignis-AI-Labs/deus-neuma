/**
 * road-control — the one owner of the tunnel's lifecycle, and the seam
 * between the routes that ask for roads and tunnel.js that binds them.
 *
 * remote-routes.js and wire.js both need tunnel actions; tunnel.js needs
 * the store, the identity, and the http server. This module holds the
 * single instance so neither side imports the other (wire.js mounts the
 * routers; a cycle would be a boot-order landmine). The desk identity is
 * generated lazily on the FIRST native road enable — never at boot, never
 * for a desk that never enables the road.
 */
import os from 'node:os';
import { createLogger } from '../logger.js';
import { remoteStore } from './remote-store.js';
import { ensureDeskIdentity } from './desk-identity.js';
import { createDeskTunnel } from './tunnel.js';
import { createRelayClient } from './relay-client.js';

const log = createLogger('RemoteRoads');

/** @type {ReturnType<createDeskTunnel> | null} */
let tunnel = null;
/** @type {import('http').Server | null} */
let httpServer = null;
/** @type {ReturnType<createRelayClient> | null} */
let relayClient = null;

/**
 * The http server the tunnel injects admitted TLS sockets into. The app
 * sets this once at boot (wire.js); tests may set their own. impure.
 * @param {import('http').Server} server
 */
export const setRemoteHttpServer = (server) => { httpServer = server; };

/** The desk identity once the tunnel exists, else null. Pure read. */
export const deskIdentity = () => tunnel?.identity ?? null;

/** The live tunnel's LAN-listening state, else null. Pure read. */
export const lanStatus = () => (tunnel ? { listening: tunnel.isLanListening(), pairingPort: tunnel.getPairingPort() } : null);

/**
 * The desk's non-internal IPv4 addresses, for the QR's `lan=` candidates.
 * impure (os probe).
 * @returns {string[]}
 */
export const lanAddresses = () => {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni?.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
};

const ensureTunnel = async () => {
  if (tunnel) return tunnel;
  if (!httpServer) throw new Error('no http server set — call setRemoteHttpServer first');
  const identity = await ensureDeskIdentity();
  tunnel = createDeskTunnel({ store: remoteStore, identity, httpServer });
  await tunnel.applyRoads();
  return tunnel;
};

/**
 * Turn the relay road on (phase C): the desk dials OUT to the operator's
 * relay — no inbound port anywhere. impure (disk, maybe dial).
 * @param {{ url: string, token: string }} opts
 */
export const enableRelayRoad = async ({ url, token }) => {
  const clean = String(url || '').trim();
  const wss = /^wss:\/\//.test(clean);
  const wsLoopback = /^ws:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?$/.test(clean);
  if (!wss && !wsLoopback) {
    throw new Error('relay url must be wss:// (or ws:// to a loopback host)');
  }
  await ensureTunnel();
  const state = remoteStore.get();
  await remoteStore.save({
    ...state,
    roads: { ...state.roads, relay: { url: clean, token: String(token || '') } },
  });
  startRelayClient();
  return relayStatus();
};

/**
 * Turn the relay road off — the client stops dialing, live sessions die
 * with the desk's registration. impure (store, sockets).
 */
export const disableRelayRoad = async () => {
  const state = remoteStore.get();
  await remoteStore.save({ ...state, roads: { ...state.roads, relay: null } });
  stopRelayClient();
};

const startRelayClient = () => {
  const relay = remoteStore.get().roads?.relay;
  if (!relay || !tunnel) return null;
  stopRelayClient();
  relayClient = createRelayClient({
    url: relay.url,
    token: relay.token || '',
    identity: tunnel.identity,
    tunnel,
    store: remoteStore,
  });
  return relayClient;
};

const stopRelayClient = () => {
  relayClient?.stop();
  relayClient = null;
};

/** The live relay road's state for the status route. Pure read. */
export const relayStatus = () => (tunnel ? { online: Boolean(relayClient) } : null);

/**
 * Turn the LAN road on (D2: opt-in). Generates the desk identity on first
 * use and binds the TLS-only port. impure (disk, listen, store).
 * @param {{ port?: number }} [opts]
 */
export const enableLanRoad = async ({ port } = {}) => {
  await ensureTunnel();
  const state = remoteStore.get();
  const requested = Number(port);
  const chosen = Number.isInteger(requested) && requested >= 1 && requested <= 65535
    ? requested
    : undefined;
  await remoteStore.save({
    ...state,
    roads: { ...state.roads, lan: chosen ? { port: chosen } : state.roads?.lan ?? { port: 27777 } },
  });
  await tunnel.applyRoads();
  return lanStatus();
};

/**
 * Turn the LAN road off — the port closes and every tunnel socket dies.
 * The tailnet road is untouched (D4). impure (store, sockets).
 */
export const disableLanRoad = async () => {
  const state = remoteStore.get();
  await remoteStore.save({ ...state, roads: { ...state.roads, lan: null } });
  if (tunnel) await tunnel.applyRoads();
};

/**
 * Open the ephemeral pairing listener while a code is live; answers the
 * port for the QR's `pair=` field, or null when no native road stands.
 * impure (binds).
 * @returns {Promise<number | null>}
 */
export const ensurePairingPort = async () => {
  if (!tunnel) return null;
  return tunnel.ensurePairingListener();
};

/**
 * Stop the tunnel entirely — boot shutdown. impure (sockets).
 */
export const stopTunnel = async () => {
  stopRelayClient();
  if (!tunnel) return;
  const t = tunnel;
  tunnel = null;
  await t.closeAll();
};

/**
 * Start the tunnel from the store at boot — binds only if a native road is
 * already on. impure (disk, maybe listen). Never throws into the boot path:
 * a tunnel that cannot start costs the road, not the listen.
 */
export const startTunnelFromStore = async () => {
  try {
    const state = remoteStore.get();
    if (!state.roads?.lan && !state.roads?.relay) return null;
    await ensureTunnel();
    if (state.roads?.relay) startRelayClient();
    return tunnel;
  } catch (error) {
    log.error('native tunnel did not start — the road reads as off', { error: error.message });
    return null;
  }
};
