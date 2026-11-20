/* global window, sessionStorage */
// Real Chromium, signed auth, the production workspace router, and real
// workspace damage — no mocks. Proves every stats-client/workspace-sessions
// contract the shared-http migration (#174 family F9) must keep: failure
// nulls vs honest empties and the verbatim strict strings. (Batch titling is a job
// now, with its own proof: test/integration/titling-jobs.test.js.)
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { test, expect } from 'vitest';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

test('stats and session clients keep null/empty/strict contracts through the shared http helper', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stats-sessions-http-'));
  const oldRoot = getWorkspacesRoot();
  const oldRealm = getRealmRoot();
  const oldEnv = Object.fromEntries(['NEUMA_DATA_ROOT'].map((key) => [key, process.env[key]]));
  let vite; let server; let browser;
  try {
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    setWorkspacesRoot(path.join(root, 'lanes'));
    setRealmRoot(path.join(root, 'realm'));
    const { setConfig } = await import('../../backend/services/llm-selection.js');
    setConfig({ provider: 'lm-studio', endpoint: 'http://127.0.0.1:1', model: 'unavailable-test-model' });
    const auth = await fullAuth();
    const lane = 'http-fixture';
    const empty = 'http-empty';
    for (const id of [lane, empty]) {
      await workspace.create(id);
      await writeOwner(getWorkspacesRoot(), id, auth.address);
    }
    await workspace.writeNeumaDEK(lane, 'a'.repeat(64));
    await workspace.writeDNA(lane, { identity: { name: 'Http Fixture', essence: 'fixture essence' } });
    await workspace.appendMessage(lane, 'session-one', { role: 'user', content: 'hello fixture' });
    await workspace.addJournalEntry(lane, { type: 'protocol_reminder', content: 'fixture deviation' });
    const app = express();
    const requests = [];
    app.use(express.json());
    app.use('/api', (req, res, next) => {
      res.on('finish', () => requests.push({ method: req.method, path: req.path, status: res.statusCode }));
      next();
    });
    app.use('/api/v1/workspace', (await import('../../backend/routes/workspace-routes.js')).default);
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
    app.get('/', (_req, res) => res.type('html').send(`<script type="module">
      import { loadRecord, loadProtocolDeviations, loadSelfCheck } from '/frontend/app/RelinkShell/stats-client.js';
      import { listSessions, listSessionsStrict, loadSessionMessages, loadSessionMessagesStrict }
        from '/frontend/app/RelinkShell/workspace-sessions.js';
      window.clients = { loadRecord, loadProtocolDeviations, loadSelfCheck,
        listSessions, listSessionsStrict, loadSessionMessages, loadSessionMessagesStrict };
      window.expired = 0;
      window.addEventListener('neuma:auth_expired', () => window.expired++);
    </script>`));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.clients);

    // Anonymous: every site short-circuits to its failure value, no request made.
    expect(await page.evaluate((id) => window.clients.loadRecord(id), lane)).toBeNull();
    expect(await page.evaluate((id) => window.clients.listSessions(id), lane)).toEqual([]);
    expect(requests).toEqual([]);

    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);

    // Happy path — real reads on the real lane.
    const record = await page.evaluate((id) => window.clients.loadRecord(id), lane);
    expect(record?.identity?.chosenName).toBe('Http Fixture');
    const deviations = await page.evaluate((id) => window.clients.loadProtocolDeviations(id), lane);
    expect(deviations).toHaveLength(1);
    expect(deviations[0].type).toBe('protocol_reminder');
    // A clean lane reads [] — NOT null: the panel must tell "clean" from "unknown".
    expect(await page.evaluate((id) => window.clients.loadProtocolDeviations(id), empty)).toEqual([]);
    // Never run: an honest absence with no run in flight — not a score.
    expect(await page.evaluate((id) => window.clients.loadSelfCheck(id), lane))
      .toEqual({ latest: null, previous: null, compare: null, running: null, busyElsewhere: false, error: null });
    expect(await page.evaluate((id) => window.clients.listSessions(id), lane)).toEqual(['session-one']);
    expect(await page.evaluate((id) => window.clients.listSessionsStrict(id), lane)).toEqual(['session-one']);
    for (const fn of ['loadSessionMessages', 'loadSessionMessagesStrict']) {
      const messages = await page.evaluate(([f, id]) => window.clients[f](id, 'session-one'), [fn, lane]);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ role: 'user', content: 'hello fixture' });
    }
    expect(await page.evaluate(() => window.expired)).toBe(0);

    // Damaged sessions dir — a REAL 500 through the real router.
    const sessionsDir = path.join(workspace.pathFor(lane), 'sessions');
    await fs.rm(sessionsDir, { recursive: true, force: true });
    await fs.writeFile(sessionsDir, 'directory-damage-proof');
    expect(await page.evaluate((id) => window.clients.listSessions(id), lane)).toEqual([]);
    expect(await page.evaluate(([f, id]) => window.clients[f](id, 'session-one'), ['loadSessionMessages', lane])).toEqual([]);
    expect(await page.evaluate((id) => window.clients.listSessionsStrict(id).then(
      () => 'NO-THROW', (error) => error.message), lane)).toBe('sessions list failed: HTTP 500');
    await fs.unlink(sessionsDir);
    await fs.mkdir(sessionsDir);
    await workspace.appendMessage(lane, 'session-one', { role: 'user', content: 'hello fixture' });
    expect(await page.evaluate((id) => window.clients.listSessionsStrict(id), lane)).toEqual(['session-one']);

    // Corrupt ownership record — a REAL 500 from the ownership gate; the
    // stats reads that answered data/[] above now answer null (never []).
    const ownerPath = path.join(getWorkspacesRoot(), empty, 'owner.json');
    const ownerBytes = await fs.readFile(ownerPath, 'utf8');
    await fs.writeFile(ownerPath, 'corrupt-ownership-proof');
    expect(await page.evaluate((id) => window.clients.loadRecord(id), empty)).toBeNull();
    expect(await page.evaluate((id) => window.clients.loadSelfCheck(id), empty)).toBeNull();
    expect(await page.evaluate((id) => window.clients.loadProtocolDeviations(id), empty)).toBeNull();
    await fs.writeFile(ownerPath, ownerBytes);
    expect(await page.evaluate((id) => window.clients.loadProtocolDeviations(id), empty)).toEqual([]);

    // Expired session — a REAL 401 with a token present: failure values AND
    // the loud auth-rot alarm on every migrated site, stricts throw verbatim.
    await page.evaluate(() => sessionStorage.setItem('authToken', 'invalid-session-proof'));
    expect(await page.evaluate((id) => window.clients.loadRecord(id), lane)).toBeNull();
    expect(await page.evaluate((id) => window.clients.loadProtocolDeviations(id), lane)).toBeNull();
    expect(await page.evaluate((id) => window.clients.loadSelfCheck(id), lane)).toBeNull();
    expect(await page.evaluate((id) => window.clients.listSessions(id), lane)).toEqual([]);
    expect(await page.evaluate(([f, id]) => window.clients[f](id, 'session-one'), ['loadSessionMessages', lane])).toEqual([]);
    expect(await page.evaluate((id) => window.clients.listSessionsStrict(id).then(
      () => 'NO-THROW', (error) => error.message), lane)).toBe('sessions list failed: HTTP 401');
    expect(await page.evaluate(([f, id]) => window.clients[f](id, 'session-one').then(
      () => 'NO-THROW', (error) => error.message), ['loadSessionMessagesStrict', lane]))
      .toBe('session load failed: HTTP 401');
    expect(await page.evaluate(() => window.expired)).toBe(7);

    // Recovery with a valid token.
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    expect((await page.evaluate((id) => window.clients.loadRecord(id), lane))?.identity?.chosenName)
      .toBe('Http Fixture');
    expect(await page.evaluate(() => window.expired)).toBe(7);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await vite?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    setWorkspacesRoot(oldRoot);
    setRealmRoot(oldRealm);
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);
