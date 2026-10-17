// Neuma Remote is a peer-identity boundary, never a Host-header boundary.
//
// A real Express app on a real loopback listener, guarded exactly as
// server.js guards: the access middleware on HTTP and the same decision on
// the WebSocket upgrade. Every request below is a raw HTTP request with the
// headers a given peer would actually carry — Tailscale Serve's single
// X-Forwarded-For hop, a browser's Origin, the device cookie — and every
// socket is a real `ws` client. The remote store is a real tmp file.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRemoteStore, EMPTY_REMOTE_STATE } from '../../backend/services/remote/remote-store.js';
import { createAccessGuard } from '../../backend/services/remote/access-guard.js';
import { createRemoteRouter, createEnrollRouter } from '../../backend/routes/remote-routes.js';
import { createPairing, _clearPairings, DEVICE_COOKIE } from '../../backend/services/remote/pairing.js';
import { verifySessionToken } from '../../backend/services/auth.js';

const ENROLLED = 'phone.test.ts.net';
const WALLET = '0x67f39a66108068b66c1c409f71c81f5697e990cf';
const PHONE = Object.freeze({ host: ENROLLED, 'x-forwarded-for': '100.64.0.5' });

let dir; let store; let server; let port; let sockets = 0;

const call = (method, urlPath, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  req.on('error', reject);
  req.end();
});

const json = (r) => JSON.parse(r.body);

const socket = (headers) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  ws.on('message', (data) => { ws.close(); resolve({ opened: true, greeting: String(data) }); });
  ws.on('error', () => resolve({ opened: false }));
  ws.on('unexpected-response', () => resolve({ opened: false }));
});

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-remote-'));
  store = createRemoteStore({ path: path.join(dir, 'remote.json') });
  await store.save({ enabled: true, origin: ENROLLED, devices: [] });
  const guard = createAccessGuard({ store });
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  app.use(guard.middleware);
  app.use('/r', createEnrollRouter({ store }));
  app.use('/api/v1/remote', createRemoteRouter({ store }));
  app.get('/probe', (req, res) => res.json({ scope: req.accessScope }));
  app.post('/probe', (req, res) => res.json({ scope: req.accessScope }));
  server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => { sockets += 1; ws.send('hello'); });
  server.on('upgrade', (req, sock, head) => {
    if (!guard.upgradeAccess(req).allow) { sock.destroy(); return; }
    wss.handleUpgrade(req, sock, head, (client) => wss.emit('connection', client, req));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
  _clearPairings();
});

describe('the peer boundary over real sockets', () => {
  it('a loopback peer with a local Host is local', async () => {
    expect(json(await call('GET', '/probe', { host: 'localhost' })).scope).toBe('local');
  });
  it('a loopback peer with a rebound Host is refused', async () => {
    const r = await call('GET', '/probe', { host: 'attacker.example' });
    expect(r.status).toBe(403);
    expect(json(r).error).toBe('untrusted network peer');
  });
  it('a tailnet peer without the cookie is unauthorized', async () => {
    const r = await call('GET', '/probe', PHONE);
    expect(r.status).toBe(403);
    expect(json(r).error).toBe('unauthorized');
  });
  it('a forwarded chain and a non-tailnet hop are refused', async () => {
    expect((await call('GET', '/probe', { host: ENROLLED, 'x-forwarded-for': '100.64.0.5, 100.64.0.6' })).status).toBe(403);
    expect((await call('GET', '/probe', { host: ENROLLED, 'x-forwarded-for': '8.8.8.8' })).status).toBe(403);
  });
  it('a bare tailnet peer cannot open the socket; a local peer can', async () => {
    expect((await socket(PHONE)).opened).toBe(false);
    expect((await socket({ host: 'localhost' })).greeting).toBe('hello');
  });
});

describe('pairing, then the phone as the operator', () => {
  let cookie; let token;
  it('a desk-minted code is claimed once from the tailnet and answers with the cookie', async () => {
    const { code } = createPairing(WALLET);
    const local = await call('GET', `/r/${code}`, { host: 'localhost' });
    expect(local.status).toBe(403);
    const r = await call('GET', `/r/${code}`, { ...PHONE, 'user-agent': 'Mozilla/5.0 (iPhone) Safari/604.1' });
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/');
    const set = String(r.headers['set-cookie']?.[0]);
    expect(set).toMatch(new RegExp(`^${DEVICE_COOKIE}=`));
    expect(set).toContain('HttpOnly');
    expect(set).toContain('Secure');
    cookie = set.split(';')[0];
    expect((await call('GET', `/r/${code}`, PHONE)).status).toBe(404);
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'remote.json'), 'utf8'));
    expect(onDisk.devices).toHaveLength(1);
    expect(onDisk.devices[0].label).toBe('iPhone · Safari');
    expect(onDisk.devices[0].address).toBe(WALLET);
    expect(onDisk.devices[0].hash).not.toContain(cookie.split('=')[1]);
  });
  it('with the cookie the phone is remote, and a foreign Origin cannot change state', async () => {
    expect(json(await call('GET', '/probe', { ...PHONE, cookie })).scope).toBe('remote');
    expect(json(await call('POST', '/probe', { ...PHONE, cookie, origin: `https://${ENROLLED}` })).scope).toBe('remote');
    expect(json(await call('POST', '/probe', { ...PHONE, cookie })).scope).toBe('remote');
    const foreign = await call('POST', '/probe', { ...PHONE, cookie, origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect(json(foreign).error).toBe('cross-origin request blocked');
  });
  it('the cookie trades for a session token in the paired wallet\'s name', async () => {
    const r = await call('POST', '/api/v1/remote/session', { ...PHONE, cookie });
    expect(r.status).toBe(200);
    token = json(r).token;
    expect(verifySessionToken(token).address.toLowerCase()).toBe(WALLET);
    expect(json(r).address).toBe(WALLET);
  });
  it('the phone can open the socket with the cookie', async () => {
    expect((await socket({ ...PHONE, cookie })).greeting).toBe('hello');
  });
  it('even with a valid session the phone cannot read or mint the capability', async () => {
    const r = await call('GET', '/api/v1/remote', { ...PHONE, cookie, authorization: `Bearer ${token}` });
    expect(r.status).toBe(403);
    expect(json(r).error).toBe('local only');
  });
  it('rotation cuts the phone; disable refuses the whole road', async () => {
    await store.save({ ...store.get(), devices: [], rotatedAt: new Date().toISOString() });
    expect((await call('GET', '/probe', { ...PHONE, cookie })).status).toBe(403);
    // The gate refuses the cut cookie before the session route can answer.
    expect((await call('POST', '/api/v1/remote/session', { ...PHONE, cookie })).status).toBe(403);
    expect((await socket({ ...PHONE, cookie })).opened).toBe(false);
    await store.save(EMPTY_REMOTE_STATE);
    const r = await call('GET', '/probe', PHONE);
    expect(r.status).toBe(403);
    expect(json(r).error).toBe('remote access is disabled');
    expect(json(await call('GET', '/probe', { host: 'localhost' })).scope).toBe('local');
  });
  it('counted every socket that was actually opened', () => {
    expect(sockets).toBe(2);
  });
});
