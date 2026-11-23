// THE REMOTE ROAD'S ACCESS LOG (backend/services/remote/access-log.js; docs/work/crm-match-blob.md, 2026-11-23):
// every reach of this desk from outside it is kept — a phone paired and signed in, every change it made, the phone
// cut, a refused peer (at most once a minute, the repeats counted) — readable by the install owner at the desk only.
// A lead deleted from a phone leaves a tombstone, and the change is in the log with the phone that made it.
// A real Express app guarded as server.js guards it, a real remote store on a tmp file, the real routers, asked over
// raw HTTP by a phone paired through the real claim. No mocks (RULE 0).
import http from 'node:http';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { createRemoteStore } from '../../backend/services/remote/remote-store.js';
import { createAccessGuard } from '../../backend/services/remote/access-guard.js';
import { createAccessLog } from '../../backend/services/remote/access-log.js';
import { createEnrollRouter, createRemoteRouter } from '../../backend/routes/remote-routes.js';
import { createPairing, _clearPairings } from '../../backend/services/remote/pairing.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { recordFirstLocalOwner } from '../../backend/services/install-owner.js';
import { loadConfig } from '../../backend/config.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import leadRouter from '../../backend/routes/lead-routes.js';

const ENROLLED = 'phone.test.ts.net';
const WALLET = '0x67f39a66108068b66c1c409f71c81f5697e990cf';
const PHONE = Object.freeze({ host: ENROLLED, 'x-forwarded-for': '100.64.0.5' });
const NO_TAILSCALE = { status: async () => ({ installed: false, binary: null, dnsName: null, certDomains: [], detail: 'test' }), serve: async () => ({ serving: false }), enable: async () => ({ ok: false }), disable: async () => ({ ok: false }) };

let dir; let server; let port; let cookie; let phoneToken; let clock; let journal; let file;
const call = (method, urlPath, headers = {}, body = null) => new Promise((resolve, reject) => {
  const payload = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) } }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { text += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
  });
  req.on('error', reject);
  req.end(payload || undefined);
});
const desk = () => ({ host: 'localhost', authorization: `Bearer ${createSessionToken(WALLET)}` });
const phone = () => ({ ...PHONE, cookie, origin: `https://${ENROLLED}`, authorization: `Bearer ${phoneToken}` });

beforeAll(async () => {
  loadConfig();
  dir = await createTempDir('remote-access-log');
  file = path.join(dir, 'remote-access.jsonl');
  clock = Date.parse('2026-11-23T12:00:00Z');
  journal = createAccessLog({ path: file, now: () => clock });
  const store = createRemoteStore({ path: path.join(dir, 'remote.json') });
  await store.save({ enabled: true, origin: ENROLLED, devices: [] });
  await recordFirstLocalOwner(WALLET);
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  app.use(createAccessGuard({ store, journal }).middleware);
  app.use('/r', createEnrollRouter({ store, journal }));
  app.use('/api/v1/remote', createRemoteRouter({ store, journal, tailscale: NO_TAILSCALE }));
  app.use('/api/v1/leads', leadRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  const { code } = createPairing(WALLET);
  const claimed = await call('GET', `/r/${code}`, { ...PHONE, 'user-agent': 'Mozilla/5.0 (iPhone) Safari/604.1' });
  cookie = String(claimed.headers['set-cookie']?.[0]).split(';')[0];
  phoneToken = JSON.parse((await call('POST', '/api/v1/remote/session', { ...PHONE, cookie })).body).token;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  _clearPairings();
});

describe('the access log', () => {
  it('keeps the pairing and the sign-in, never the cookie or the token', async () => {
    const { entries } = await journal.read();
    expect(entries.map((e) => e.event)).toEqual(['session', 'paired']);
    expect(entries[1]).toMatchObject({ event: 'paired', road: 'tailnet', address: WALLET, label: expect.any(String), device: expect.any(String) });
    const text = await fs.readFile(file, 'utf8');
    expect(text).not.toContain(cookie.split('=')[1]);
    expect(text).not.toContain(phoneToken);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  it('a lead deleted from the phone leaves a tombstone, and the change is logged with the phone that made it', async () => {
    const ledger = await leadLedgerFor(WALLET);
    const lead = await ledger.add({ name: 'Pia Sund', contact: 'pia@sund.example', channelId: 'email', addedBy: WALLET });
    const r = await call('DELETE', `/api/v1/leads/${lead.id}`, phone());
    expect(r.status, r.body).toBe(200);
    const [stone] = await ledger.removed();
    expect(stone).toMatchObject({ type: 'removed', id: lead.id, by: WALLET });
    expect(JSON.stringify(stone)).not.toMatch(/Pia|sund/); // who the person was is not kept
    const [acted] = (await journal.read()).entries;
    expect(acted).toMatchObject({ event: 'acted', method: 'DELETE', path: `/api/v1/leads/${lead.id}`, address: WALLET });
  });

  it('a refused peer is written once a minute, its repeats counted on the next line', async () => {
    const stranger = { host: ENROLLED, 'x-forwarded-for': '100.64.0.9' }; // no device cookie
    for (let i = 0; i < 3; i += 1) expect((await call('GET', '/api/v1/leads', stranger)).status).toBe(403);
    let refused = (await journal.read()).entries.filter((e) => e.event === 'refused');
    expect(refused).toHaveLength(1);
    clock += 61_000;
    expect((await call('GET', '/api/v1/leads', stranger)).status).toBe(403);
    refused = (await journal.read()).entries.filter((e) => e.event === 'refused');
    expect(refused).toHaveLength(2);
    expect(refused[0]).toMatchObject({ repeats: 2, method: 'GET', path: '/api/v1/leads' });
  });

  it('reads at the desk for the install owner, never from the phone; a cut phone is logged', async () => {
    expect((await call('GET', '/api/v1/remote/access-log', phone())).status).toBe(403);
    const devices = JSON.parse((await call('GET', '/api/v1/remote', desk())).body).devices;
    expect((await call('DELETE', `/api/v1/remote/devices/${devices[0].id}`, desk())).status).toBe(200);
    const read = await call('GET', '/api/v1/remote/access-log?limit=2', desk());
    expect(read.status, read.body).toBe(200);
    const page = JSON.parse(read.body);
    expect(page.entries[0]).toMatchObject({ event: 'revoked', device: devices[0].id, address: WALLET });
    expect(page.more).toBe(true);
    const older = JSON.parse((await call('GET', `/api/v1/remote/access-log?before=${encodeURIComponent(page.entries.at(-1).at)}`, desk())).body);
    expect(older.entries.every((e) => e.at < page.entries.at(-1).at)).toBe(true);
    // The phone it cut is refused from then on, and that is logged too.
    expect((await call('GET', '/api/v1/leads', phone())).status).toBe(403);
  });
});
