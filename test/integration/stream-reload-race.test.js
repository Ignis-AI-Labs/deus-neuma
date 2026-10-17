/** Actual Chromium, signed REST/portal, encrypted disk, history loader and gate.
 * Proves resume-before-release and failed-load hold. No model, voice or new
 * thought is sent; full turn persistence and whole-desk reload remain acceptance work. */
import { beforeAll, afterAll, beforeEach, afterEach, describe, test, expect } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import { chromium } from '@playwright/test';
import workspace from '../../core/workspace/neuma-workspace.js';
import workspaceRoutes from '../../backend/routes/workspace-routes.js';
import { setupPortalRoutes } from '../../backend/routes/portal-routes.js';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

const lane = 'reload-storage-fixture';
const session = 'session-reload-existing';
let browser, bundle;
beforeAll(async () => {
  bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
    build: { write: false, rollupOptions: { input: path.resolve('test/fixtures/reload-gate-entry.js') } } });
  browser = await chromium.launch({ args: ['--disable-gpu'] });
});
afterAll(async () => { await browser?.close(); });

describe('reload history release on real browser transport', () => {
  let kit, server, wss, page, frames, sessions, priorKey;
  beforeEach(async () => {
    server = null; wss = null; page = null; kit = null;
    priorKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'reload-private-storage-fixture-key';
    kit = await createHarnessTurnKit(lane);
    const auth = await fullAuth();
    await writeOwner(path.dirname(workspace.pathFor(lane)), lane, auth.address);
    await fs.mkdir(path.join(workspace.pathFor(lane), 'identity'), { recursive: true });
    await fs.writeFile(path.join(workspace.pathFor(lane), 'identity', 'true-name.json'), JSON.stringify({ name: 'StorageFixture' }));
    await workspace.appendMessage(lane, session, { role: 'user', content: 'Prior stored question' });
    await workspace.appendMessage(lane, session, { role: 'assistant', content: 'Prior stored answer' });
    sessions = path.join(workspace.pathFor(lane), 'sessions');
    const app = express();
    app.use('/api/v1/workspace', workspaceRoutes);
    for (const file of bundle.output) app.get(`/${file.fileName}`, (req, res) =>
      res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
    const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
    app.get('/', (req, res) => res.send(`<script type="module" src="/${entry}"></script>`));
    server = createServer(app);
    wss = new WebSocketServer({ server, path: '/ws' });
    frames = [];
    wss.on('connection', (ws) => ws.on('message', (raw) => frames.push(JSON.parse(raw.toString()))));
    setupPortalRoutes(wss, { birthHandler: null });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => typeof window.prepareReload === 'function');
    await page.evaluate((args) => window.prepareReload(args), { token: auth.token, lane });
  });
  afterEach(async () => {
    if (page) { await page.evaluate(() => window.reloadProof?.close()); await page.close(); }
    if (wss) { for (const ws of wss.clients) ws.terminate(); await new Promise((resolve) => wss.close(resolve)); }
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    await kit?.close();
    if (priorKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = priorKey;
  });
  test('pending history releases only after the actual resume frame', async () => {
    const result = await page.evaluate(() => window.reloadProof.begin());
    expect(result).toMatchObject({ immediate: 0, released: true, sent: 1, failed: false });
    await untilHarness(() => frames.some((frame) => frame.type === 'consciousness:interrupt'));
    const resumeAt = frames.findIndex((frame) => frame.type === 'portal:resume');
    expect(resumeAt).toBeGreaterThanOrEqual(0);
    expect(frames[resumeAt].sessionId).toBe(session);
    await page.waitForFunction(() => window.reloadProof.resumes.length > 0);
    expect(await page.evaluate(() => window.reloadProof.resumes[0])).toMatchObject({ neumaId: lane, sessionId: session });
    expect(frames.findIndex((frame) => frame.type === 'consciousness:interrupt')).toBeGreaterThan(resumeAt);
    expect((await fs.readdir(sessions)).filter((name) => name.endsWith('.jsonl'))).toEqual([`${session}.jsonl`]);
    expect(JSON.stringify(result.state)).toContain('Prior stored answer');
  });
  test('an actual damaged session directory holds the send and warns', async () => {
    await fs.rename(sessions, `${sessions}-preserved`);
    await fs.writeFile(sessions, 'not a directory');
    const result = await page.evaluate(() => window.reloadProof.begin());
    expect(result).toMatchObject({ released: false, sent: 0, failed: true });
    expect(frames.some((frame) => frame.type === 'portal:resume' || frame.type === 'consciousness:interrupt')).toBe(false);
    expect(await page.locator('.notification-error').textContent()).toContain('chat history unavailable');
    expect(JSON.stringify(result.state)).toContain('«WARNING»');
    await fs.rm(sessions);
    await fs.rename(`${sessions}-preserved`, sessions);
    expect(await page.evaluate(() => window.reloadProof.begin())).toMatchObject({ released: true, sent: 1, failed: false });
    await page.waitForFunction(() => window.reloadProof.resumes.length > 0);
    expect(await page.evaluate(() => window.reloadProof.resumes[0])).toMatchObject({ neumaId: lane, sessionId: session });
  });
  test('no pending history releases synchronously', async () => {
    expect(await page.evaluate(() => window.reloadProof.immediate())).toEqual({ released: true, sent: 1 });
    await untilHarness(() => frames.some((frame) => frame.type === 'consciousness:interrupt'));
  });
});
