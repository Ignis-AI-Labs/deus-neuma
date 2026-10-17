/**
 * relay-client — the desk's leg of the relay road (Road B, proposal §7).
 *
 * The desk dials OUT to the relay, registers under its own derived id
 * (nonce-signed, token-gated), and waits for dial requests. For each dial
 * the desk verifies the phone's signature — ECDSA over `deskId‖nonce` with
 * the paired device's public key, read live from the store so revocation
 * applies — and only then opens the accept leg whose raw stream is fed to
 * the tunnel's tls.Server as a connection. The relay never sees anything
 * but the opaque inner TLS records.
 *
 * Pairing dials (`pairing: true`, no signature) are accepted only while a
 * pairing code is live and are fed to the ephemeral pairing listener, whose
 * sockets the gate confines to POST /r/claim.
 *
 * Reconnects back off 1→30 s while the road is enabled; a disabled road
 * stops the client entirely.
 */
import { Duplex } from 'node:stream';
import crypto from 'node:crypto';
import { WebSocket } from 'ws';
import { createLogger } from '../logger.js';
import { X509Certificate } from 'node:crypto';
import { livePairingCount } from './pairing.js';

const log = createLogger('RelayClient');

const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30 * 1000;

/**
 * A relay WebSocket as a Node stream — the shape tls.Server.emit('connection')
 * expects. Synthetic peer address keeps express's req.ip consumers safe
 * (per-device rate keys never consult it).
 */
export class RelayDuplex extends Duplex {
  constructor(ws, { sessionId }) {
    super();
    this.ws = ws;
    this.remoteAddress = `relay:${sessionId.slice(0, 8)}`;
    this.remoteFamily = 'IPv4';
    this.neumaTunnelRelay = true;
    ws.on('message', (data, isBinary) => {
      if (isBinary && !this.push(data)) ws._socket?.pause?.();
    });
    ws.on('close', () => this.push(null));
    ws.on('error', (error) => this.destroy(error));
  }
  _read() { /* push-driven; the relay delivers as it delivers */ }
  _write(chunk, _enc, cb) {
    if (this.ws.readyState !== this.ws.OPEN) { cb(new Error('relay socket closed')); return; }
    this.ws.send(chunk, { binary: true }, cb);
  }
  _final(cb) { try { this.ws.close(); } catch { /* already dead */ } cb(); }
  setNoDelay() { return this; }
  setKeepAlive() { return this; }
  ref() { return this; }
  unref() { return this; }
}

/**
 * Build the client against injected pieces — production passes the road
 * control's tunnel handle; tests pass their own.
 * @param {{ url: string, token: string, identity: object, tunnel: object, store: object }} deps
 *   `tunnel` needs `feedLan(duplex)` and `feedPairing(duplex)`.
 */
export const createRelayClient = ({ url, token, identity, tunnel, store }) => {
  let ws = null;
  let stopped = false;
  let attempts = 0;
  let reconnectTimer = null;
  const base = String(url).replace(/\/+$/, '');
  const deskId = identity.deskId;

  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(`${base}/v1/desk`);
    ws.once('open', () => { /* wait for the nonce */ });
    ws.once('message', (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return retry(); }
      if (msg.op !== 'nonce' || typeof msg.nonce !== 'string') return retry();
      let sig;
      try {
        sig = crypto.sign('sha256', Buffer.from(msg.nonce), {
          key: crypto.createPrivateKey(identity.privateKeyPem),
          dsaEncoding: 'der',
        }).toString('base64');
      } catch (error) {
        log.error('desk registration signing failed', { error: error.message });
        return retry();
      }
      const spkiDer = crypto.createPublicKey(crypto.createPrivateKey(identity.privateKeyPem))
        .export({ type: 'spki', format: 'der' });
      ws.send(JSON.stringify({ op: 'register', pubkey: spkiDer.toString('base64'), sig, token }));
      attempts = 0;
    });
    ws.on('message', (data) => onControl(String(data)));
    ws.on('close', () => { ws = null; retry(); });
    ws.on('error', (error) => log.debug('relay socket error', { error: error.message }));
  };

  const retry = () => {
    if (stopped) return;
    attempts += 1;
    const delay = Math.min(BACKOFF_MIN_MS * 2 ** Math.min(attempts - 1, 5), BACKOFF_MAX_MS);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, delay);
    reconnectTimer.unref?.();
  };

  const verifyDialProof = (deviceId, proofNonce, sig) => {
    const device = store.get().devices.find((d) => d.id === String(deviceId));
    if (!device || typeof device.cert !== 'string') return false;
    try {
      const key = new X509Certificate(device.cert).publicKey;
      return crypto.verify('sha256', Buffer.concat([Buffer.from(deskId), Buffer.from(proofNonce)]), key, Buffer.from(String(sig), 'base64'));
    } catch {
      return false;
    }
  };

  const accept = (sessionId) => {
    const acceptWs = new WebSocket(`${base}/v1/accept/${sessionId}?token=${encodeURIComponent(ws?.acceptToken || '')}`);
    acceptWs.once('open', () => {
      const duplex = new RelayDuplex(acceptWs, { sessionId });
      tunnel.feedLan(duplex);
    });
    acceptWs.on('error', (error) => log.debug('accept leg error', { error: error.message }));
  };

  const onControl = (text) => {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.op === 'registered') {
      if (ws) ws.acceptToken = msg.acceptToken;
      log.info('relay road online', { deskId, relay: base });
      return;
    }
    if (msg.op !== 'dial' || typeof msg.sessionId !== 'string') return;
    const sessionId = msg.sessionId;
    // Pairing dials carry no proof: the desk admits them only while a
    // pairing code is live, and only onto the confined pairing listener.
    if (msg.pairing === true) {
      if (livePairingCount() === 0) { sendResult(sessionId, false); return; }
      tunnel.feedPairing(new RelayDuplex(pairAccept(sessionId), { sessionId }));
      return;
    }
    if (!verifyDialProof(msg.deviceId, msg.nonce, msg.sig)) {
      log.debug('dial proof refused', { deviceId: msg.deviceId });
      sendResult(sessionId, false);
      return;
    }
    accept(sessionId);
  };

  const pairAccept = (sessionId) => {
    const acceptWs = new WebSocket(`${base}/v1/accept/${sessionId}?token=${encodeURIComponent(ws?.acceptToken || '')}`);
    acceptWs.on('error', (error) => log.debug('pairing accept leg error', { error: error.message }));
    return acceptWs;
  };

  const sendResult = (sessionId, ok) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'dial-result', sessionId, ok }));
  };

  const stop = () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    try { ws?.close(); } catch { /* already dead */ }
    ws = null;
    log.info('relay road client stopped');
  };

  connect();
  return { stop, deskId };
};
