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
import { createRemoteRouter } from '../../backend/routes/remote-routes.js';
import { createAccessGuard } from '../../backend/services/remote/access-guard.js';
import { createRemoteStore, EMPTY_REMOTE_STATE } from '../../backend/services/remote/remote-store.js';
import { loadConfig, _resetConfig } from '../../backend/config.js';
import { fullAuth } from '../helpers/audit-auth.js';

// Production router/guard and read-only CLI status; no pairing or configuration writes.
test('remote status preserves local reads and signals expired sessions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-read-'));
  let vite; let server; let browser;
  try {
    const file = path.join(root, 'remote.json');
    const store = createRemoteStore({ path: file }); await store.save(EMPTY_REMOTE_STATE);
    const before = await fs.readFile(file, 'utf8');
    const auth = await fullAuth();
    const app = express(); app.use(express.json());
    app.use(createAccessGuard({ store }).middleware);
    app.use('/api/v1/remote', createRemoteRouter({ store }));
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import {getRemoteStatus} from "/frontend/services/remote-client.js"; window.readRemote=getRemoteStatus; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
    app.use(vite.middlewares);
    server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    loadConfig({ NODE_ENV: 'test', PORT: String(server.address().port), FRONTEND_PORT: String(server.address().port) });
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.readRemote);
    const call = () => page.evaluate(async () => {
      try { return { ok: true, value: await window.readRemote() }; }
      catch (error) { return { ok: false, message: error.message, http: error.http }; }
    });
    const unauthorized = { ok: false, message: 'Could not read remote status (401)', http: 401 };
    expect(await call()).toEqual(unauthorized);
    expect(await page.evaluate(() => window.expired)).toBe(0);
    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    expect(await call()).toMatchObject({ ok: true, value: {
      enabled: false, origin: null, devices: [], rotatedAt: null,
      serving: expect.any(Boolean), tailscale: { installed: expect.any(Boolean) },
    } });
    await page.evaluate(() => sessionStorage.setItem('authToken', 'expired-invalid-token'));
    expect(await call()).toEqual(unauthorized);
    expect(await page.evaluate(() => window.expired)).toBe(1);
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await vite?.close(); _resetConfig(); await fs.rm(root, { recursive: true, force: true });
  }
}, 45000);
