/**
 * NOTHING LEAVES ON ITS OWN UNTIL IT IS TURNED ON (Design note, 2026-10-25. The real connections routes
 * behind real requireAuth (each wallet signs a real challenge) and the real install-owner gate,
 * the switch file on a temp data root, and the network doors themselves: the platform feed against
 * a real loopback server that counts every request, the security watch's online check against its
 * own door. Nothing is mocked.
 */
import http from 'node:http';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';

describe('the connections that run by themselves start off, and only the install owner turns one on', () => {
  let dir, app, owner, guest, feed, feedRequests, priorOrigin;
  let switches, readPlatformFeed, runAdvisoryScan, fetchOsvBatch;

  beforeAll(async () => {
    dir = await createTempDir('connections');
    process.env.NEUMA_DATA_ROOT = path.join(dir, 'data');
    process.env.NEUMA_WEB_ACCESS_PATH = path.join(dir, 'web-access.json');
    delete process.env.NEUMA_CONNECTIONS_PATH;
    vi.resetModules();
    const { fullAuth } = await import('../helpers/audit-auth.js');
    owner = await fullAuth();
    guest = await fullAuth();
    // the first local sign-in names the install owner
    await (await import('../../backend/services/install-owner.js')).recordFirstLocalOwner(owner.address);
    const { default: router } = await import('../../backend/routes/connection-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/connections', router);
    switches = await import('../../backend/services/connections/connection-switches.js');
    ({ readPlatformFeed } = await import('../../backend/services/platform-feed/platform-feed-read.js'));
    ({ runAdvisoryScan, fetchOsvBatch } = await import('../../backend/services/security/advisory-scan.js'));

    feedRequests = 0;
    feed = http.createServer((_req, res) => {
      feedRequests += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ holders: 1 }));
    });
    await new Promise((resolve) => feed.listen(0, '127.0.0.1', resolve));
    priorOrigin = process.env.NEUMA_PLATFORM_API_ORIGIN;
    process.env.NEUMA_PLATFORM_API_ORIGIN = `http://127.0.0.1:${feed.address().port}`;
  });

  afterAll(async () => {
    if (priorOrigin === undefined) delete process.env.NEUMA_PLATFORM_API_ORIGIN;
    else process.env.NEUMA_PLATFORM_API_ORIGIN = priorOrigin;
    await new Promise((resolve) => feed.close(resolve));
  });

  const list = (who) => request(app).get('/api/v1/connections').set('Authorization', `Bearer ${who.token}`);
  const flip = (who, id, on) => request(app).put(`/api/v1/connections/${id}`).set('Authorization', `Bearer ${who.token}`).send({ on });
  const byId = (rows) => Object.fromEntries(rows.map((row) => [row.id, row]));

  test('a fresh install lists every connection, and the four that run by themselves read OFF', async () => {
    const res = await list(owner);
    expect(res.status).toBe(200);
    const rows = byId(res.body.connections);
    for (const id of ['update-check', 'security-watch', 'platform-data', 'mail-watch', 'sanctions-list', 'chat-bridge', 'webhooks']) expect(rows[id].on).toBe(false);
    expect(rows.spellcheck).toBeUndefined(); // spelling is checked on this computer; it connects to nothing
    expect(rows.web.on).toBe(true); // the web asks each time; its own switch, its own default
    expect(rows.wallets.on).toBeUndefined();
    await expect(fs.access(path.join(dir, 'data', 'settings', 'connections.json'))).rejects.toThrow();
  });

  test('while off, nothing is asked: the platform feed server sees no request, the OSV door never opens', async () => {
    const out = await readPlatformFeed('/api/platform/stats', { timeoutMs: 3000 });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/turned off/);
    expect(feedRequests).toBe(0);
    await expect(fetchOsvBatch([{ package: { name: 'minimist', ecosystem: 'npm' }, version: '1.2.5' }])).rejects.toThrow(/turned off/);
    const scan = await runAdvisoryScan({ id: 'neuma', path: process.cwd() });
    expect(scan).toMatchObject({ ok: false, off: true, checked: 0, hits: [], error: null });
  });

  test('a guest cannot turn one on; a bad id or body is refused; nothing is written', async () => {
    const refused = await flip(guest, 'platform-data', true);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('INSTALL_OWNER_ONLY');
    expect((await flip(owner, 'web', true)).status).toBe(404); // the web has its own switch
    expect((await flip(owner, 'platform-data', 'yes')).status).toBe(400);
    await expect(fs.access(path.join(dir, 'data', 'settings', 'connections.json'))).rejects.toThrow();
  });

  test('the owner turns platform data on: it lands on disk, and the next read goes out', async () => {
    const res = await flip(owner, 'platform-data', true);
    expect(res.status).toBe(200);
    expect(byId(res.body.connections)['platform-data'].on).toBe(true);
    const saved = JSON.parse(await fs.readFile(path.join(dir, 'data', 'settings', 'connections.json'), 'utf8'));
    expect(saved).toEqual({ 'platform-data': true });
    const out = await readPlatformFeed('/api/platform/stats', { timeoutMs: 3000 });
    expect(out.ok).toBe(true);
    expect(feedRequests).toBe(1);
    expect(switches.isConnectionOn('security-watch')).toBe(false); // one switch, not all of them
  });

  test('turned off again, the read stops at the door', async () => {
    expect((await flip(owner, 'platform-data', false)).status).toBe(200);
    expect((await readPlatformFeed('/api/platform/stats', { timeoutMs: 3000 })).ok).toBe(false);
    expect(feedRequests).toBe(1);
  });

  test('a switch file that cannot be read reads as everything off — a broken file never invents consent', async () => {
    await switches.setConnection('platform-data', true);
    await fs.writeFile(path.join(dir, 'data', 'settings', 'connections.json'), '{ broken');
    expect(switches.isConnectionOn('platform-data')).toBe(false);
    expect((await readPlatformFeed('/api/platform/stats', { timeoutMs: 3000 })).ok).toBe(false);
    expect(feedRequests).toBe(1);
  });
});
