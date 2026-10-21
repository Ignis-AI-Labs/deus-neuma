/**
 * Remote Routes — Neuma Remote, phases 1–2 plus the native road's desk side
 * (Road B, docs/security/remote-surface.md).
 *
 * Management (local only, signed in; every road change is the install
 * owner's — pairing a phone and cutting one's own stay any house's):
 *   GET    /api/v1/remote                 status: enabled, origin, roads, devices, tailscale, serving
 *   POST   /api/v1/remote/enable          enrol this machine's MagicDNS name
 *   POST   /api/v1/remote/disable         off, every device cut
 *   POST   /api/v1/remote/rotate          every device cut, remote stays on
 *   POST   /api/v1/remote/pair            one-time pairing code for this wallet
 *   GET    /api/v1/remote/qr.svg?code=    the code as a QR — URL (Road A) or document (Road B)
 *   POST   /api/v1/remote/https/enable    tailscale serve on
 *   POST   /api/v1/remote/https/disable   tailscale serve off
 *   POST   /api/v1/remote/lan/enable      native TLS listener on (opt-in, D2)
 *   POST   /api/v1/remote/lan/disable     native LAN road off
 *   DELETE /api/v1/remote/devices/:id     cut one phone
 *
 * The phones' doors:
 *   GET    /r/:code                       Road A: claim the code → device cookie → /
 *   POST   /r/claim                       Road B: code + self-signed cert + desk fingerprint → device row
 *   POST   /api/v1/remote/session         device cookie → 24 h session token
 *
 * The asymmetry is Faber's: a phone can use Neuma, but never read or mint
 * the capability that admits phones. Every road-management route is
 * local-only — a phone must never open the LAN listener.
 */
import { Router } from 'express';
import { X509Certificate } from 'node:crypto';
import QRCode from 'qrcode';
import { createLogger } from '../services/logger.js';
import { requireAuth, createSessionToken, verifySessionToken } from '../services/auth.js';
import { bridgeLimiter } from '../services/rate-limiter.js';
import { getAppConfig, isProduction } from '../config.js';
import { requireLocalScope } from '../services/remote/access-guard.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { remoteStore, EMPTY_REMOTE_STATE } from '../services/remote/remote-store.js';
import {
  createPairing, hasPairing, claimPairing, mintDevice, mintNativeDevice,
  deviceLabel, withDeviceSeen, withoutDevice, publicDevice, deviceCookie,
} from '../services/remote/pairing.js';
import {
  tailscaleStatus, serveStatus, enableServe, disableServe,
} from '../services/remote/tailscale.js';
import {
  deskIdentity, lanAddresses, lanStatus, ensurePairingPort,
  enableLanRoad, disableLanRoad, enableRelayRoad, disableRelayRoad, relayStatus,
} from '../services/remote/road-control.js';
import { spkiSha256 } from '../services/remote/x509-self.js';

const log = createLogger('Remote');

// pure — is this device the wallet's own: the wallet that paired it?
const ownDevice = (device, wallet) =>
  typeof device?.address === 'string' && device.address === String(wallet || '').toLowerCase();

// In development the desk is served by Vite, which proxies the API and the
// socket, so that is the port Serve must front; packaged, the backend serves
// the built desk itself.
const servePort = () => {
  const config = getAppConfig();
  return isProduction() ? config.port : config.frontendPort;
};

const QR_OPTIONS = Object.freeze({
  type: 'svg', margin: 1, color: { dark: '#ffffffff', light: '#00000000' },
});

/**
 * The Road B pairing document the app scans (ratified proposal §5): the
 * desk fingerprint and id first — the app trusts nobody but the desk whose
 * SPKI hashes to `fp` — then the roads to try, the live pairing port, and
 * the code. Pure.
 * @param {{ fingerprint: string, deskId: string }} identity
 * @param {{ lanAddresses: string[], lanPort: number | null, pairPort: number | null }} roads
 * @param {string} code
 * @returns {string}
 */
export const pairingDocument = (identity, { lanAddresses: lan, lanPort, pairPort, relayUrl }, code) => {
  const parts = [
    `fp=${identity.fingerprint}`,
    `id=${identity.deskId}`,
    lan.length && lanPort ? `lan=${lan.map((ip) => `${ip}:${lanPort}`).join(',')}` : null,
    pairPort && lan.length ? `pair=${lan[0]}:${pairPort}` : null,
    relayUrl ? `relay=${relayUrl}` : null,
    `code=${code}`,
  ].filter(Boolean);
  return `neuma-remote:1?${parts.join('&')}`;
};

/**
 * @param {{ store?: typeof remoteStore, tailscale?: { status: typeof tailscaleStatus, serve: typeof serveStatus, enable: typeof enableServe, disable: typeof disableServe } }} [deps]
 */
export const createRemoteRouter = ({
  store = remoteStore,
  tailscale = { status: tailscaleStatus, serve: serveStatus, enable: enableServe, disable: disableServe },
} = {}) => {
  const router = Router();
  const localOnly = [requireAuth, requireLocalScope];
  // The roads are the machine's: opening, closing or cutting them reaches
  // every house's phones, so they are the install owner's (install-owner.js).
  const machineOnly = [...localOnly, requireInstallOwner];

  // impure — CLI + store read. The devices listed are the caller's own: a
  // device acts as the wallet that paired it, and another house's phones are
  // not this operator's to see or cut.
  const status = async (wallet) => {
    const state = store.get();
    const ts = await tailscale.status();
    const port = servePort();
    const serving = ts.installed && ts.binary ? (await tailscale.serve(ts.binary, port)).serving : false;
    const identity = deskIdentity();
    const tunnel = lanStatus();
    return {
      enabled: state.enabled,
      origin: state.origin,
      rotatedAt: state.rotatedAt,
      roads: state.roads,
      devices: state.devices.filter((d) => ownDevice(d, wallet)).map(publicDevice),
      port,
      serving,
      desk: identity ? { fingerprint: identity.fingerprint, deskId: identity.deskId } : null,
      native: tunnel
        ? { listening: tunnel.listening, pairingPort: tunnel.pairingPort, lanAddresses: lanAddresses() }
        : null,
      tailscale: {
        installed: ts.installed,
        backendState: ts.backendState,
        dnsName: ts.dnsName,
        certDomains: ts.certDomains,
        detail: ts.detail,
      },
    };
  };

  // The phone's session door — no bearer yet, the cookie IS the credential.
  router.post('/session', bridgeLimiter, async (req, res) => {
    const device = req.remoteDevice;
    if (req.accessScope !== 'remote' || !device) {
      res.status(401).json({ error: 'no paired device' });
      return;
    }
    const token = createSessionToken(device.address);
    const expiresAt = verifySessionToken(token)?.expiresAt ?? Date.now();
    const state = store.get();
    await store.save({ ...state, devices: withDeviceSeen(state.devices, device.id) });
    res.json({ token, address: device.address, expiresIn: expiresAt - Date.now(), device: publicDevice(device) });
  });

  router.get('/', ...localOnly, async (req, res) => {
    res.json(await status(req.walletAddress));
  });

  router.post('/enable', ...machineOnly, async (req, res) => {
    const ts = await tailscale.status();
    if (!ts.dnsName) {
      res.status(409).json({ error: 'Tailscale is not running or not signed in on this machine', detail: ts.detail });
      return;
    }
    await store.save({ ...store.get(), enabled: true, origin: ts.dnsName });
    log.info('remote access enabled', { origin: ts.dnsName });
    res.json(await status(req.walletAddress));
  });

  router.post('/disable', ...machineOnly, async (req, res) => {
    await store.save(EMPTY_REMOTE_STATE);
    log.info('remote access disabled — every device cut');
    res.json(await status(req.walletAddress));
  });

  router.post('/rotate', ...machineOnly, async (req, res) => {
    await store.save({ ...store.get(), devices: [], rotatedAt: new Date().toISOString() });
    log.info('remote devices rotated — every device cut');
    res.json(await status(req.walletAddress));
  });

  router.post('/pair', ...localOnly, async (req, res) => {
    const state = store.get();
    if (!state.enabled && !state.roads?.lan && !state.roads?.relay) {
      res.status(409).json({ error: 'Enable remote access, the native LAN road, or the relay road first' });
      return;
    }
    const { code, expiresIn } = createPairing(req.walletAddress);
    // The ephemeral pairing listener exists only while a code is live (D2):
    // open it now so the QR can name its port.
    let pairPort = null;
    if (state.roads?.lan) {
      try { pairPort = await ensurePairingPort(); } catch (error) {
        log.error('pairing listener failed to open', { error: error.message });
        res.status(502).json({ error: 'The pairing listener failed to open' });
        return;
      }
    }
    const url = state.enabled && state.origin ? `https://${state.origin}/r/${code}` : null;
    res.json({ code, expiresIn, url, pairPort });
  });

  router.get('/qr.svg', ...localOnly, async (req, res) => {
    const state = store.get();
    const code = String(req.query.code ?? '');
    if (!hasPairing(code) || (!state.enabled && !state.roads?.lan && !state.roads?.relay)) {
      res.status(404).json({ error: 'Unknown or expired pairing code' });
      return;
    }
    const identity = deskIdentity();
    let payload = state.enabled && state.origin ? `https://${state.origin}/r/${code}` : null;
    if (identity && (state.roads?.lan || state.roads?.relay)) {
      // Road B: the app scans the document and pins the fingerprint before
      // it ever connects.
      const tunnel = lanStatus();
      payload = pairingDocument(
        identity,
        {
          lanAddresses: lanAddresses(),
          lanPort: state.roads?.lan?.port ?? null,
          pairPort: tunnel?.pairingPort,
          relayUrl: state.roads?.relay?.url ?? null,
        },
        code,
      );
    }
    if (!payload) {
      res.status(409).json({ error: 'No road is on to pair through' });
      return;
    }
    const svg = await QRCode.toString(payload, QR_OPTIONS);
    res.type('image/svg+xml').send(svg);
  });

  router.post('/lan/enable', ...machineOnly, async (req, res) => {
    try {
      await enableLanRoad({ port: req.body?.port });
      log.info('native LAN road enabled', { native: lanStatus() });
      res.json(await status(req.walletAddress));
    } catch (error) {
      log.error('LAN road enable failed', { error: error.message });
      res.status(502).json({ error: 'The native LAN road failed to start' });
    }
  });

  router.post('/lan/disable', ...machineOnly, async (req, res) => {
    await disableLanRoad();
    log.info('native LAN road disabled — tunnel sockets cut');
    res.json(await status(req.walletAddress));
  });

  router.put('/relay', ...machineOnly, async (req, res) => {
    try {
      await enableRelayRoad({ url: req.body?.url, token: req.body?.token });
      log.info('relay road enabled', { relay: relayStatus() });
      res.json(await status(req.walletAddress));
    } catch (error) {
      log.warn('relay road enable refused', { error: error.message });
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/relay/disable', ...machineOnly, async (req, res) => {
    await disableRelayRoad();
    log.info('relay road disabled');
    res.json(await status(req.walletAddress));
  });

  router.post('/https/enable', ...machineOnly, async (req, res) => {
    const ts = await tailscale.status();
    if (!ts.binary) {
      res.status(409).json({ error: 'Tailscale is not installed on this machine' });
      return;
    }
    const result = await tailscale.enable(ts.binary, servePort());
    if (!result.ok) {
      res.status(502).json({ error: result.detail });
      return;
    }
    res.json(await status(req.walletAddress));
  });

  router.post('/https/disable', ...machineOnly, async (req, res) => {
    const ts = await tailscale.status();
    if (!ts.binary) {
      res.status(409).json({ error: 'Tailscale is not installed on this machine' });
      return;
    }
    const result = await tailscale.disable(ts.binary);
    if (!result.ok) {
      res.status(502).json({ error: result.detail });
      return;
    }
    res.json(await status(req.walletAddress));
  });

  router.delete('/devices/:id', ...localOnly, async (req, res) => {
    const state = store.get();
    const id = String(req.params.id);
    if (!state.devices.some((d) => d.id === id && ownDevice(d, req.walletAddress))) {
      res.status(404).json({ error: 'no such paired device' });
      return;
    }
    await store.save({ ...state, devices: withoutDevice(state.devices, id) });
    res.json(await status(req.walletAddress));
  });

  return router;
};

/**
 * The enrolment roads. Mounted at `/r`.
 *
 * `GET /:code` — Road A. The access guard admits a tailnet peer here
 * WITHOUT a cookie, because this is where the cookie comes from. A desk
 * opening its own link locally is told where to use it.
 *
 * `POST /claim` — Road B. A pairing-listener socket (the only shape the
 * gate admits here besides a tailnet peer) carries the code, the phone's
 * self-signed certificate, and the desk fingerprint the QR named. The
 * fingerprint is checked BEFORE the code is touched — a substituted QR
 * naming an attacker's desk is refused here, which closes the poisoned-QR
 * MITM. The code is then consumed whether or not it was valid: one claim,
 * one answer.
 * @param {{ store?: typeof remoteStore }} [deps]
 */
export const createEnrollRouter = ({ store = remoteStore } = {}) => {
  const router = Router();
  router.get('/:code', bridgeLimiter, async (req, res) => {
    if (req.accessScope !== 'remote') {
      res.status(403).json({ error: 'pairing links are claimed from a phone on the tailnet' });
      return;
    }
    const claim = claimPairing(req.params.code);
    if (!claim) {
      res.status(404).type('text/plain').send('This pairing link is unknown or has expired. Pair again from the desk.');
      return;
    }
    const { secret, device } = mintDevice({ address: claim.address, label: deviceLabel(req.headers['user-agent']) });
    const state = store.get();
    await store.save({ ...state, devices: [...state.devices, device] });
    log.info('device paired', { device: device.id, label: device.label, road: 'tailnet' });
    res.setHeader('Set-Cookie', deviceCookie(secret));
    res.redirect(302, '/');
  });

  router.post('/claim', bridgeLimiter, async (req, res) => {
    const identity = deskIdentity();
    if (!identity) {
      res.status(403).json({ error: 'native pairing is not enabled on this desk' });
      return;
    }
    const { code, cert, fp } = req.body ?? {};
    // The poisoned-QR check: the claim must name THIS desk's fingerprint.
    // Refuse before consuming anything, loudly.
    if (String(fp ?? '') !== identity.fingerprint) {
      log.warn('claim named a foreign desk fingerprint — poisoned QR?', { peer: req.socket?.remoteAddress });
      res.status(403).json({ error: 'this claim names another desk' });
      return;
    }
    const claim = claimPairing(code);
    if (!claim) {
      res.status(404).json({ error: 'Unknown or expired pairing code' });
      return;
    }
    let spki;
    try {
      spki = spkiSha256(new X509Certificate(String(cert)).publicKey);
    } catch {
      res.status(400).json({ error: 'the device certificate is unreadable' });
      return;
    }
    // The desk never sees a private key and signs nothing: the certificate
    // the phone self-signed IS the row's public record.
    const { device } = mintNativeDevice({
      address: claim.address,
      label: deviceLabel(req.headers['user-agent']),
      spki,
      cert: String(cert),
    });
    const state = store.get();
    await store.save({ ...state, devices: [...state.devices, device] });
    log.info('device paired', { device: device.id, label: device.label, road: 'native' });
    res.json({ deviceId: device.id, fp: identity.fingerprint });
  });

  return router;
};
