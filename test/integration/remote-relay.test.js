// The relay road, end to end over REAL sockets (RULE 0 — no mocks): a real
// relay service on an ephemeral port, the real desk tunnel fed by the real
// relay client, and a real phone-style client dialing through the splice to
// make an HTTPS request against the desk's Express app.
//
// Proven here: token gating, signature verification, the splice carrying a
// full TLS session untouched, and the relay refusing to route for desks
// that never registered.
import crypto from 'node:crypto';
import fs from 'fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import express from 'express';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { remoteStore } from '../../backend/services/remote/remote-store.js';
import { createAccessGuard } from '../../backend/services/remote/access-guard.js';
import { ensureDeskIdentity } from '../../backend/services/remote/desk-identity.js';
import { buildSelfSignedCert, spkiSha256 } from '../../backend/services/remote/x509-self.js';
import { mintNativeDevice } from '../../backend/services/remote/pairing.js';
import { createEnrollRouter } from '../../backend/routes/remote-routes.js';
import { createDeskTunnel } from '../../backend/services/remote/tunnel.js';
import { createRelayClient, RelayDuplex } from '../../backend/services/remote/relay-client.js';

const WALLET = '0x67f39a66108068b66c1c409f71c81f5697e990cf';
const DESK_HOST = 'deskrelay.test';
const RELAY_TOKEN = 'test-licence-token';

const freePort = () => new Promise((resolve) => {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const relayPort = await freePort();
process.env.RELAY_PORT = String(relayPort);
process.env.RELAY_TOKEN = RELAY_TOKEN;
// Imported AFTER the env is set: the relay reads its port + tokens at boot.
const { server: relayServer } = await import('../../tools/remote-relay/server.mjs');

let dir; let identity; let httpServer; let tunnel; let relayClientHandle;
const relayUrlBase = `ws://127.0.0.1:${relayPort}`;

const mintPhone = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    keyPair: privateKey,
    certPem: buildSelfSignedCert({ key: privateKey, commonName: 'neuma phone', days: 30 }),
    keyPem: privateKey.export({ type: 'sec1', format: 'pem' }).toString(),
    spki: spkiSha256(publicKey),
  };
};

const pairDevice = async (phone) => {
  const { device } = mintNativeDevice({
    address: WALLET, label: 'relay phone', spki: phone.spki, cert: phone.certPem,
  });
  await remoteStore.save({ ...remoteStore.get(), devices: [...remoteStore.get().devices, device] });
  phone.deviceId = device.id;
  return device;
};

/** Dial the desk through the relay and ride the splice as a real TLS client. */
const spliceRequest = ({ deskId, phone }) => new Promise((resolve) => {
  const dial = new WebSocket(`ws://127.0.0.1:${relayPort}/v1/dial/${deskId}`);
  let settled = false;
  let stream = null;
  let raw = '';
  const settle = (value) => {
    if (settled) return;
    settled = true;
    try { stream?.destroy(); } catch { /* */ }
    try { dial.close(); } catch { /* */ }
    resolve(value);
  };
  // Draining settle: bytes queued on the splice are delivered as messages
  // before the close frame, but their processing can land a tick later.
  const finish = (value) => {
    if (settled) return;
    setTimeout(() => settle({
      status: /^HTTP\/1\.1 (\d{3})/.exec(raw)?.[1] ?? value.status ?? 'none',
      body: raw,
      error: value.error,
    }), 150);
  };
  dial.on('error', (error) => finish({ error: String(error.message) }));
  dial.on('close', () => finish({ status: 'closed', body: '' }));
  dial.on('message', (data) => {
    if (settled) return;
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return finish({ error: 'unexpected relay frame' }); }
    if (msg.op !== 'nonce') return finish({ error: 'expected nonce' });
    const sig = crypto.sign('sha256', Buffer.concat([Buffer.from(deskId), Buffer.from(msg.nonce)]), {
      key: phone.keyPair, dsaEncoding: 'der',
    }).toString('base64');
    dial.send(JSON.stringify({ op: 'dial', deviceId: phone.deviceId, sig }));
    // From here the WebSocket carries nothing but the inner TLS records.
    stream = new RelayDuplex(dial, { sessionId: msg.sessionId });
    const tlsSocket = tls.connect({
      socket: stream,
      ca: [identity.certPem], servername: DESK_HOST,
      checkServerIdentity: () => undefined,
      cert: phone.certPem, key: phone.keyPem,
    }, () => {
      tlsSocket.write(`GET /probe HTTP/1.1\r\nhost: ${DESK_HOST}\r\nconnection: close\r\n\r\n`);
    });
    tlsSocket.setEncoding('utf8');
    tlsSocket.on('data', (chunk) => { raw += chunk; });
    tlsSocket.on('close', () => finish({ status: 'none', body: raw }));
    tlsSocket.on('error', (error) => finish({ error: String(error.message) }));
  });
});

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-relay-'));
  process.env.NEUMA_DATA_ROOT = dir;
  await remoteStore.load();
  identity = await ensureDeskIdentity();

  const app = express();
  const guard = createAccessGuard({ store: remoteStore });
  app.use(guard.middleware);
  app.use(express.json());
  app.use('/r', createEnrollRouter());
  app.get('/probe', (req, res) => {
    res.json({ scope: req.accessScope, device: req.remoteDevice?.id ?? null, road: req.socket?.neumaTunnel?.road ?? null });
  });

  httpServer = http.createServer(app);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));

  tunnel = createDeskTunnel({ store: remoteStore, identity, httpServer });
  relayClientHandle = createRelayClient({
    url: relayUrlBase, token: RELAY_TOKEN, identity, tunnel, store: remoteStore,
  });
  // The relay leg needs no LAN listener; the desk merely must be registered
  // before a phone dials.
  await new Promise((resolve) => setTimeout(resolve, 150));
});

afterAll(async () => {
  relayClientHandle?.stop();
  await tunnel.closeAll();
  await new Promise((resolve) => httpServer.close(resolve));
  await new Promise((resolve) => relayServer.close(resolve));
  delete process.env.NEUMA_DATA_ROOT;
  delete process.env.RELAY_PORT;
  delete process.env.RELAY_TOKEN;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('relay admission', () => {
  it('refuses a desk registration with a bad token', async () => {
    const result = await new Promise((resolve) => {
      const ws = new WebSocket(`${relayUrlBase}/v1/desk`);
      ws.on('message', (data) => {
        const msg = JSON.parse(String(data));
        if (msg.op !== 'nonce') return;
        const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const spki = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
        const sig = crypto.sign('sha256', Buffer.from(msg.nonce), { key: privateKey, dsaEncoding: 'der' });
        ws.send(JSON.stringify({ op: 'register', pubkey: spki.toString('base64'), sig, token: 'WRONG' }));
      });
      ws.on('close', (code) => resolve({ code }));
      ws.on('error', () => resolve({ code: 'error' }));
    });
    expect(result.code).toBe(1008);
  });

  it('refuses a phone dial for a desk that never registered', async () => {
    const result = await new Promise((resolve) => {
      const ws = new WebSocket(`${relayUrlBase}/v1/dial/zzzzzzzzzzzzzzzz`);
      ws.on('close', (code) => resolve({ code }));
      ws.on('error', () => resolve({ code: 'error' }));
    });
    expect(result.code).toBe(1008);
  });
});

describe('the splice carries a full TLS session', () => {
  it('a relay-paired phone rides the splice into the desk and is admitted', async () => {
    const phone = mintPhone();
    await pairDevice(phone);
    const result = await spliceRequest({ deskId: identity.deskId, phone });
    if (result.error) console.log('SPLICE-ERR:', result.error);
    expect(result.status).toBe('200');
    expect(result.body).toContain('"road":"relay"');
    expect(result.body).toContain(`"device":"${phone.deviceId}"`);
  });

  it('an UNPAIRED phone is dropped after the handshake, before any HTTP', async () => {
    const stranger = mintPhone();
    const result = await spliceRequest({ deskId: identity.deskId, phone: stranger });
    // Refused at the dial proof (dropped before any HTTP could flow).
    expect(['closed', 'none']).toContain(result.status);
    expect(result.body).not.toContain('HTTP/1.1');
  });

  it('a phone dialing a foreign desk id is refused (no such desk)', async () => {
    const phone = mintPhone();
    await pairDevice(phone);
    const result = await spliceRequest({ deskId: 'yyyyyyyyyyyyyyyy', phone });
    expect(['closed', 'none', 'error']).toContain(result.status ?? 'error');
    expect(result.body ?? '').not.toContain('HTTP/1.1');
  });
});
