// The native road's boundary, proven over REAL TLS 1.3 (RULE 0 — no mock,
// stub, or spy anywhere): a real Express app behind the real tunnel, driven
// through road-control — the production lifecycle — every client a real
// tls.connect, every device certificate a real self-signed P-256 as a
// phone's keystore would present it.
//
// TLS 1.3 subtlety the tests honour: a client's handshake can appear
// complete before the server's certificate_required alert lands, so
// "admitted" is proven only by an HTTP byte coming BACK. Nothing counts
// until the app answers.
import crypto from 'node:crypto';
import fs from 'fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { remoteStore } from '../../backend/services/remote/remote-store.js';
import { createAccessGuard } from '../../backend/services/remote/access-guard.js';
import { wsAllowedOrigin } from '../../backend/services/ws-upgrade-router.js';
import { bindRemoteSocket } from '../../backend/services/remote/socket-lifetime.js';
import { buildSelfSignedCert, spkiSha256 } from '../../backend/services/remote/x509-self.js';
import { createPairing, _clearPairings } from '../../backend/services/remote/pairing.js';
import { createEnrollRouter } from '../../backend/routes/remote-routes.js';
import { createRateLimiter, requestLimiterKey } from '../../backend/services/rate-limiter.js';
import {
  setRemoteHttpServer, enableLanRoad, deskIdentity, ensurePairingPort, stopTunnel,
} from '../../backend/services/remote/road-control.js';

const WALLET = '0x67f39a66108068b66c1c409f71c81f5697e990cf';
const DESK_HOST = 'abc123.neuma';

let dir; let identity; let httpServer; let lanPort;
let probeHits = 0;
let pairedPhone; let pairedDeviceId;

const freePort = () => new Promise((resolve) => {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

/** A phone, as it will exist: key generated at home, certificate self-signed. */
const mintPhone = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    keyPem: privateKey.export({ type: 'sec1', format: 'pem' }).toString(),
    certPem: buildSelfSignedCert({ key: privateKey, commonName: 'neuma phone', days: 30 }),
    spki: spkiSha256(publicKey),
  };
};

/** One real HTTP/1.1 request through a real pinned TLS session, driven by
 * Node's own HTTP client the way the phone's bridge drives its pooled
 * stack. A dial that dies transport-side (no HTTP answer) redials once —
 * the phone does the same; an HTTP answer is never retried. */
const tlsRequest = async ({ port, method = 'GET', path = '/', headers = {}, body = null, phone = null }) => {
  const attempt = () => new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const req = https.request({
      port, host: '127.0.0.1', servername: DESK_HOST,
      ca: [identity.certPem],
      // The phone's pin-only trust manager: one SPKI, no names.
      checkServerIdentity: () => undefined,
      ...(phone ? { cert: phone.certPem, key: phone.keyPem } : {}),
      method, path,
      // agent: false — a fresh connection per dial. Node's default global
      // agent pools keep-alive sockets by host:port, so a second device's
      // request would ride the FIRST device's TLS session (its tunnel
      // marker, its rate bucket) and die on it when the desk closes it.
      agent: false,
      headers: {
        host: DESK_HOST,
        ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
        ...(payload !== null ? { 'content-type': 'application/json' } : {}),
      },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
  try {
    return await attempt();
  } catch {
    // Transport death (no HTTP answer) — redial once, like the phone.
    return attempt();
  }
};

/**
 * Did this key get INTO the app? Only an HTTP answer counts — a TLS 1.3
 * client can see its side of the handshake complete moments before the
 * server's alert arrives.
 */
const canReachApp = ({ phone = null }) => new Promise((resolve) => {
  const socket = tls.connect({
    port: lanPort, host: '127.0.0.1', ca: [identity.certPem], servername: DESK_HOST,
    checkServerIdentity: () => undefined,
    ...(phone ? { cert: phone.certPem, key: phone.keyPem } : {}),
  });
  let done = false;
  const finish = (ok, error) => {
    if (done) return;
    done = true;
    socket.destroy();
    resolve({ ok, error });
  };
  socket.on('secureConnect', () => {
    socket.write(`GET /probe HTTP/1.1\r\nhost: ${DESK_HOST}\r\nconnection: close\r\n\r\n`);
  });
  socket.on('data', () => finish(true));
  socket.on('close', () => finish(false, 'closed before any HTTP'));
  socket.on('error', (error) => finish(false, String(error.message)));
});

/** The app's own virtual origin over the tunnel — the upgrade path. */
const openRawSocket = ({ phone }) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`wss://127.0.0.1:${lanPort}/ws`, {
    agent: new https.Agent({
      ca: [identity.certPem], checkServerIdentity: () => undefined,
      cert: phone.certPem, key: phone.keyPem,
    }),
    headers: { host: DESK_HOST, origin: `https://${DESK_HOST}` },
  });
  ws.on('open', () => resolve(ws));
  ws.on('error', reject);
});

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-tunnel-'));
  process.env.NEUMA_DATA_ROOT = dir;
  // THE singleton store — road-control's tunnel reads it, the guard reads
  // it, the claim route writes it. One store, exactly as production wires
  // it; the env var points its lazy defaultPath at the tmp root.
  await remoteStore.load();

  const app = express();
  app.set('trust proxy', 'loopback');
  const guard = createAccessGuard({ store: remoteStore });
  app.use(guard.middleware);
  app.use(express.json());
  app.use('/r', createEnrollRouter());
  app.get('/probe', (req, res) => {
    probeHits += 1;
    res.json({ scope: req.accessScope, device: req.remoteDevice?.id ?? null });
  });
  // The strict meter: two requests per window per DEVICE, proving the
  // bucket follows the tunnel identity, never a shared address.
  app.post('/metered', createRateLimiter({ windowMs: 60000, max: 2, keyFn: requestLimiterKey }),
    (_req, res) => res.json({ ok: true }));

  httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => { ws.send('hello'); });
  // The same boundary order as the real upgrade router.
  httpServer.on('upgrade', (req, socket, head) => {
    if (!wsAllowedOrigin(req)) { socket.destroy(); return; }
    const access = guard.upgradeAccess(req);
    if (!access.allow) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (client) => {
      bindRemoteSocket(client, req, access);
      wss.emit('connection', client, req);
    });
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));

  // The production lifecycle: the tunnel is born from road-control, which
  // owns the identity and applies the store's roads.
  setRemoteHttpServer(httpServer);
  lanPort = await freePort();
  await enableLanRoad({ port: lanPort });
  identity = deskIdentity();
  await remoteStore.save({ ...remoteStore.get(), roads: { ...remoteStore.get().roads, lan: { port: lanPort } } });
  await new Promise((resolve) => setTimeout(resolve, 50));
});

afterAll(async () => {
  await stopTunnel();
  await new Promise((resolve) => httpServer.close(resolve));
  delete process.env.NEUMA_DATA_ROOT;
  await fs.rm(dir, { recursive: true, force: true });
  _clearPairings();
});

describe('the handshake IS the gate', () => {
  it('no certificate: no HTTP ever flows', async () => {
    const result = await canReachApp({});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/alert|certificate|required|reset|closed/i);
    expect(probeHits).toBe(0);
  });

  it('an unpaired certificate: no HTTP ever flows', async () => {
    const stranger = mintPhone();
    const result = await canReachApp({ phone: stranger });
    expect(result.ok).toBe(false);
    expect(probeHits).toBe(0);
  });

  it('the pairing listener hands out nothing — only /r/claim exists there', async () => {
    const pairPort = await ensurePairingPort();
    expect(pairPort).toBeGreaterThan(0);
    const { code } = createPairing(WALLET);
    const refused = await tlsRequest({ port: pairPort, path: '/probe' });
    expect(refused.status).toBe(403);
    expect(refused.body).toContain('pairing road carries the claim only');
    expect(probeHits).toBe(0);
  });
});

describe('pairing over the ephemeral listener', () => {
  it('a poisoned claim is refused; the true claim answers and mints the row', async () => {
    pairedPhone = mintPhone();
    const { code } = createPairing(WALLET);
    // A substituted QR names an ATTACKER's desk: the claim carries that
    // fingerprint, and this desk refuses it before consuming anything.
    const poisoned = await tlsRequest({
      port: await ensurePairingPort(), method: 'POST', path: '/r/claim',
      body: { code, cert: pairedPhone.certPem, fp: 'ff'.repeat(32) },
    });
    expect(poisoned.status).toBe(403);
    expect(poisoned.body).toContain('another desk');
    // The honest phone's claim with the same, still-unspent code succeeds.
    const honest = await tlsRequest({
      port: await ensurePairingPort(), method: 'POST', path: '/r/claim',
      body: { code, cert: pairedPhone.certPem, fp: identity.fingerprint },
    });
    expect(honest.status).toBe(200);
    const parsed = JSON.parse(honest.body);
    pairedDeviceId = parsed.deviceId;
    expect(parsed.fp).toBe(identity.fingerprint);
  });

  it('the row on disk carries public material only — spki and cert, never a hash or secret', async () => {
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'settings', 'remote.json'), 'utf8'));
    const row = onDisk.devices.find((d) => d.id === pairedDeviceId);
    expect(row.spki).toBe(pairedPhone.spki);
    expect(row.cert).toContain('BEGIN CERTIFICATE');
    expect(row.hash).toBeUndefined();
  });

  it('the paired phone is admitted, with its identity on the socket', async () => {
    const r = await tlsRequest({ port: lanPort, path: '/probe', phone: pairedPhone });
    expect(r.status).toBe(200);
    expect(probeHits).toBe(1);
    const parsed = JSON.parse(r.body);
    expect(parsed.scope).toBe('remote');
    expect(parsed.device).toBe(pairedDeviceId);
  });

  it('hostile headers change nothing: the marker decides', async () => {
    const r = await tlsRequest({
      port: lanPort, path: '/probe', phone: pairedPhone,
      headers: { 'x-forwarded-for': '8.8.8.8' },
    });
    expect(r.status).toBe(200);
  });
});

describe('the phone as the operator, over the socket', () => {
  it('the native origin opens the WebSocket; revocation cuts it mid-stream, and the road closes behind it', async () => {
    const ws = await openRawSocket({ phone: pairedPhone });
    const opened = new Promise((resolve) => ws.once('message', (data) => resolve(String(data))));
    expect(await opened).toBe('hello');
    const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
    // Revoke while the socket is alive — the store subscription must close
    // it (I8, live), and the rebuilt ca must refuse reconnection (I8, twice).
    await remoteStore.save({ ...remoteStore.get(), devices: [] });
    expect(await closed).toBe(4003);
    const again = await canReachApp({ phone: pairedPhone });
    expect(again.ok).toBe(false);
  });

  it('counted every request that reached the app', () => {
    expect(probeHits).toBe(2);
  });
});

describe('the meter follows the device, never the address', () => {
  it('two devices do not share a bucket', async () => {
    // Self-contained: two fresh phones, both paired over the wire, so this
    // test proves the meter — and only the meter — wherever it runs.
    const pair = (phone) => new Promise(async (resolve) => {
      const { code } = createPairing(WALLET);
      const claimed = await tlsRequest({
        port: await ensurePairingPort(), method: 'POST', path: '/r/claim',
        body: { code, cert: phone.certPem, fp: identity.fingerprint },
      });
      resolve(claimed.status);
    });
    const phoneA = mintPhone();
    const phoneB = mintPhone();
    expect(await pair(phoneA)).toBe(200);
    expect(await pair(phoneB)).toBe(200);

    // The real bridge holds ONE pooled connection per device and rides it —
    // so does this test: one keep-alive agent per phone, the phone's three
    // metered requests sharing its own socket, its own bucket.
    const agentFor = (phone) => new https.Agent({
      keepAlive: true, maxSockets: 1,
      ca: [identity.certPem], checkServerIdentity: () => undefined,
      cert: phone.certPem, key: phone.keyPem,
    });
    const agentA = agentFor(phoneA);
    const agentB = agentFor(phoneB);
    const meter = (agent) => new Promise((resolve, reject) => {
      const req = https.request({
        port: lanPort, host: '127.0.0.1', servername: DESK_HOST,
        agent, method: 'POST', path: '/metered',
        headers: { host: DESK_HOST, 'content-type': 'application/json' },
      }, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      });
      req.on('error', reject);
      req.write('{}');
      req.end();
    });

    expect((await meter(agentA)).status).toBe(200);
    expect((await meter(agentB)).status).toBe(200);
    expect((await meter(agentA)).status).toBe(200);
    expect((await meter(agentA)).status).toBe(429);
    // A capped at its own third request while B was served between A's two
    // 200s: two buckets, proven without a dial that chases a 429.
    agentA.destroy();
    agentB.destroy();
  });
});
