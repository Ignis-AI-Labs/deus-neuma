/**
 * tunnel — the native road's TLS listeners (docs/security/remote-surface.md,
 * Road B; design of record in the ratified proposal, §4.2).
 *
 * The PERSISTENT listener is one tls.Server for both roads: on the LAN road
 * it binds a port; on the relay road (phase C) the desk dials OUT and feeds
 * the accepted duplex to this same server with emit('connection', duplex),
 * so both roads produce one secureConnection event and one admission
 * function. A peer's certificate is REQUESTED but not chain-validated by
 * OpenSSL — `rejectUnauthorized: false` — because the whole admission
 * decision is the live SPKI lookup below: the presented key must hash to a
 * device row that is in the store RIGHT NOW, TTL-checked and
 * revocation-aware. One trust decision, one place, always live — an
 * OpenSSL ca-store rebuild on every device change proved to lag newly
 * paired certs (rebuild-race), and the lookup is strictly stronger anyway.
 * An unpaired or revoked peer completes the handshake and is destroyed
 * HERE, before one byte of HTTP exists (I2); the cost is one handshake,
 * bounded by the handshake limiter and maxConnections. Session resumption
 * is safe only because this lookup runs on EVERY secureConnection, resumed
 * or not — nothing may cache admission per session.
 *
 * The PAIRING listener is a second, short-lived server: requestCert: false,
 * bound on an ephemeral port only while a pairing code is live, every
 * socket it accepts confined by the gate to POST /r/claim, 10-second socket
 * timeout. This is D2's second port, and it keeps rejectUnauthorized
 * unconditional on the persistent listener.
 *
 * The socket marker `neumaTunnel` is the third gate shape's evidence: set
 * here, by us, on a socket we created — no header can forge it (I3).
 */
import tls from 'node:tls';
import { createLogger } from '../logger.js';
import { findDeviceBySpki, livePairingCount } from './pairing.js';
import { spkiSha256OfCertDer } from './x509-self.js';

const log = createLogger('RemoteTunnel');

const HANDSHAKE_TIMEOUT_MS = 5000;
const PAIRING_SOCKET_TIMEOUT_MS = 10000;
const MAX_CONNECTIONS = 32;
const HANDSHAKE_WINDOW_MS = 10000;
const HANDSHAKES_PER_WINDOW = 30;
const PAIRING_SWEEP_MS = 30 * 1000;

/** Per-source-IP handshake rate limit, applied on the raw connection,
 * before the TLS handshake begins — a flood costs the attacker resets,
 * not handshakes. impure (map). */
const handshakeLimiter = () => {
  const recent = new Map();
  return (raw) => {
    const ip = raw.remoteAddress || 'unknown';
    const now = Date.now();
    const list = (recent.get(ip) || []).filter((t) => now - t < HANDSHAKE_WINDOW_MS);
    list.push(now);
    recent.set(ip, list);
    if (recent.size > 4096) recent.clear();
    if (list.length > HANDSHAKES_PER_WINDOW) {
      log.debug('tunnel handshake flood', { peer: ip });
      raw.destroy();
    }
  };
};

/**
 * Build the tunnel against injected pieces — tests pass a tmp store, their
 * own identity, and their own http server; production passes the real ones.
 * @param {{ store: object, identity: { privateKeyPem: string, certPem: string, fingerprint: string, deskId: string }, httpServer: import('http').Server, lanPortDefault?: number }} deps
 */
export const createDeskTunnel = ({ store, identity, httpServer, lanPortDefault = 27777 }) => {
  const server = tls.createServer({
    minVersion: 'TLSv1.3',
    maxVersion: 'TLSv1.3',
    key: identity.privateKeyPem,
    cert: identity.certPem,
    requestCert: true,
    // The client certificate is NOT chain-validated here on purpose: the
    // admission decision is the live SPKI lookup below — exact key match
    // against the current store, TTL-checked, revocation-aware — which is
    // strictly stronger than a chain check and cannot go stale. Rebuilding
    // the OpenSSL trust store via setSecureContext on every device change
    // proved to lag newly-paired certs in the field (rebuild-race class);
    // this way the context never changes after boot. An unpaired or
    // revoked peer completes the handshake and is destroyed HERE, before
    // one byte of HTTP exists (I2) — at the cost of one handshake, bounded
    // by the handshake limiter and maxConnections.
    rejectUnauthorized: false,
    ca: [],
    handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
  });
  server.maxConnections = MAX_CONNECTIONS;

  const limitHandshake = handshakeLimiter();
  // tls.Server emits 'connection' for the raw TCP stream, pre-handshake.
  server.on('connection', (raw) => { limitHandshake(raw); });

  server.on('secureConnection', (socket) => {
    try {
      const der = socket.getPeerCertificate()?.raw;
      const spki = der ? spkiSha256OfCertDer(der) : null;
      const device = spki ? findDeviceBySpki(store.get().devices, spki) : null;
      if (!device) {
        log.debug('tunnel refused', { reason: 'unknown device', peer: socket.remoteAddress ?? 'relay' });
        socket.destroy();
        return;
      }
      // Relay-fed duplexes carry neumaTunnelRelay; the LAN road shows a real
      // peer address. (The relay road binds nothing — the desk dialed out.)
      const road = socket.neumaTunnelRelay === true ? 'relay' : (socket.remoteAddress ? 'lan' : 'relay');
      socket.neumaTunnel = Object.freeze({ road, id: device.id, spki });
      httpServer.emit('connection', socket);
    } catch (error) {
      log.debug('tunnel refused', { reason: error.message, peer: socket.remoteAddress ?? 'relay' });
      socket.destroy();
    }
  });

  server.on('tlsClientError', (error) => {
    // Every alert is named here — never a silent drop (Rule 3). This is the
    // sound of the gate working: a stranger met a TLS alert, no HTTP read.
    log.debug('tls alert', { reason: error.message });
  });

  // Revocation and pairing rewrite the device list — rebuild the trust
  // store so a revoked key cannot open a NEW session either (I8, twice).
  // The SPKI lookup reads the store LIVE on every secureConnection, so
  // revocation cuts the next handshake with no context rebuild at all
  // (I8); no store subscription is needed on this listener.
  const unsubscribeStore = () => {};

  // --- LAN road ---
  let lanListening = false;
  server.on('error', (error) => {
    lanListening = false;
    log.error('tunnel listener failed', { error: error.message });
  });

  /**
   * Bring the listeners in line with the store's roads. impure (binds).
   * @returns {Promise<void>}
   */
  const applyRoads = async () => {
    const lan = store.get().roads?.lan;
    if (lan && !lanListening) {
      const port = Number(lan.port) || lanPortDefault;
      await new Promise((resolve) => {
        server.listen(port, '0.0.0.0', () => {
          lanListening = true;
          log.info('native LAN road listening', { port });
          resolve();
        });
      });
    } else if (!lan && lanListening) {
      lanListening = false;
      // Sockets injected by emit('connection') are invisible to
      // getConnections(); closeAllConnections sees them.
      server.closeAllConnections?.();
      await new Promise((resolve) => { server.close(resolve); });
      log.info('native LAN road closed');
    }
  };

  // --- Pairing listener (D2: the second, ephemeral port) ---
  let pairingServer = null;
  let pairingPort = null;

  const ensurePairingListener = () => new Promise((resolve, reject) => {
    if (pairingServer?.listening) { resolve(pairingPort); return; }
    const p = tls.createServer({
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3',
      key: identity.privateKeyPem,
      cert: identity.certPem,
      requestCert: false,
      rejectUnauthorized: true,
      handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
    });
    p.on('tlsClientError', (error) => log.debug('pairing tls alert', { reason: error.message }));
    p.on('secureConnection', (socket) => {
      socket.neumaTunnel = Object.freeze({ pairingOnly: true });
      socket.setTimeout(PAIRING_SOCKET_TIMEOUT_MS, () => socket.destroy());
      httpServer.emit('connection', socket);
    });
    p.once('error', (error) => {
      log.error('pairing listener failed', { error: error.message });
      pairingServer = null;
      pairingPort = null;
      reject(error);
    });
    p.listen(0, '0.0.0.0', () => {
      pairingServer = p;
      pairingPort = p.address().port;
      log.info('pairing listener open', { port: pairingPort });
      resolve(pairingPort);
    });
  });

  /**
   * Feed a relay-established duplex into the persistent listener — the
   * same secureConnection admission the LAN road gets, road-tagged 'relay'
   * (phase C). impure.
   * @param {import('node:stream').Duplex} duplex
   */
  const feedLan = (duplex) => {
    server.emit('connection', duplex);
  };

  /**
   * Feed a relay-established duplex into the ephemeral pairing listener —
   * its sockets are confined to POST /r/claim by the gate. impure.
   * @param {import('node:stream').Duplex} duplex
   */
  const feedPairing = (duplex) => {
    if (!pairingServer?.listening) { duplex.destroy(); return; }
    pairingServer.emit('connection', duplex);
  };

  const closePairingListener = async () => {
    if (!pairingServer) return;
    const p = pairingServer;
    pairingServer = null;
    pairingPort = null;
    p.closeAllConnections?.();
    await new Promise((resolve) => { p.close(resolve); });
    log.info('pairing listener closed — no live codes');
  };

  const pairingSweep = setInterval(() => {
    if (pairingServer && livePairingCount() === 0) closePairingListener().catch(() => {});
  }, PAIRING_SWEEP_MS);
  pairingSweep.unref();

  /**
   * Shut the tunnel down entirely — boot stop, disable, process exit.
   * impure (sockets).
   * @returns {Promise<void>}
   */
  const closeAll = async () => {
    clearInterval(pairingSweep);
    unsubscribeStore();
    await closePairingListener();
    lanListening = false;
    server.closeAllConnections?.();
    await new Promise((resolve) => { server.close(resolve); });
    log.info('tunnel closed');
  };

  return {
    identity,
    applyRoads,
    ensurePairingListener,
    closePairingListener,
    feedLan,
    feedPairing,
    closeAll,
    /** Whether the persistent listener is currently bound. Pure read. */
    isLanListening: () => lanListening,
    /** The ephemeral pairing port while open, else null. Pure read. */
    getPairingPort: () => pairingPort,
  };
};
