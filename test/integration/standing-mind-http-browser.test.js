/* global window, sessionStorage */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { test, expect } from 'vitest';
import { fullAuth } from '../helpers/audit-auth.js';

test('standing and mind reads preserve scoped data and null refusals while reporting auth expiry', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'standing-mind-http-'));
  const paths = { NEUMA_DATA_ROOT: 'data', WORKSPACES_ROOT: 'lanes', AI_WITNESSES_ROOT: 'witnesses',
    NEUMA_MIND_SETTINGS_PATH: 'mind.json', NEUMA_MIND_SHADOW_PATH: 'shadow.jsonl', NEUMA_REALM_ROOT: 'realm' };
  const saved = Object.fromEntries(Object.keys(paths).map(key => [key, process.env[key]]));
  let vite; let server; let browser;
  try {
    for (const [key, value] of Object.entries(paths)) process.env[key] = path.join(root, value);
    const { default: workspace } = await import('../../core/workspace/neuma-workspace.js');
    const auth = await fullAuth(); const foreign = await fullAuth();
    const lane = 'http-read-metadata';
    await workspace.create(lane);
    await fs.writeFile(path.join(workspace.pathFor(lane), 'owner.json'), JSON.stringify({ wallet: auth.address, claimedAt: new Date().toISOString() }));
    const app = express(); const requests = [];
    app.use('/api', (req, _res, next) => { requests.push(`${req.method} ${req.path}`); next(); });
    app.use('/api/v1/roster', (await import('../../backend/routes/roster-routes.js')).default);
    app.use('/api/v1/mind', (await import('../../backend/routes/mind-routes.js')).default);
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, watch: null } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import {loadStanding} from "/frontend/app/RelinkShell/nite-client.js"; import {loadMind,loadMindPosture} from "/frontend/app/RelinkShell/mind-client.js"; window.clients={loadStanding,loadMind,loadMindPosture}; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
    app.use(vite.middlewares); server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.clients);
    const call = (name, ...args) => page.evaluate(({ name, args }) => window.clients[name](...args), { name, args });
    for (const name of ['loadStanding', 'loadMind', 'loadMindPosture']) expect(await call(name, lane)).toBeNull();
    expect(requests).toEqual([]);
    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    expect(await call('loadStanding')).toMatchObject({ beings: [{ neumaId: lane }] });
    expect(await call('loadMind')).toMatchObject({ gates: {}, shadow: {} });
    expect(await call('loadMindPosture', lane)).toMatchObject({ neumaId: lane, total: 0, kinds: {}, latestAt: null });
    const beforeMissing = requests.length;
    expect(await call('loadMindPosture', '')).toBeNull(); expect(requests).toHaveLength(beforeMissing);
    await page.evaluate(token => sessionStorage.setItem('authToken', token), foreign.token);
    expect(await call('loadStanding')).toMatchObject({ beings: [] });
    expect(await call('loadMindPosture', lane)).toBeNull();
    expect(await page.evaluate(() => window.expired)).toBe(0);
    await page.evaluate(() => sessionStorage.setItem('authToken', 'invalid-session-proof'));
    for (const name of ['loadStanding', 'loadMind', 'loadMindPosture']) expect(await call(name, lane)).toBeNull();
    expect(await page.evaluate(() => window.expired)).toBe(3);
    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    expect(await call('loadMindPosture', lane)).toMatchObject({ total: 0 });
    expect(requests.every(request => request.startsWith('GET '))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); await vite?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
