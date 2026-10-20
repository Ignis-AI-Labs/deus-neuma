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
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import walletRouter from '../../backend/routes/neuma-wallet-routes.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

test('wallet policy reads preserve data, ownership and defaults while reporting invalid auth', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wallet-policy-read-'));
  const previous = getWorkspacesRoot(); let vite; let server; let browser;
  try {
    setWorkspacesRoot(root);
    const auth = await fullAuth(); const foreign = await fullAuth();
    const lane = 'policy-read-metadata'; const empty = 'policy-read-empty';
    for (const id of [lane, empty]) await writeOwner(root, id, auth.address);
    const address = `0x${'1'.repeat(40)}`;
    const entry = { address, label: 'Read proof' };
    await workspace.writeSpendAllowlist(lane, { version: 1, entries: [entry] });
    await workspace.writeSpendThreshold(lane, { thresholdEth: 0.125 });
    const pending = { id: 'pending-proof', status: 'pending', expiry: Math.floor(Date.now() / 1000) + 3600,
      to: address, value: '1', nonce: 'metadata-only' };
    await workspace.writePendingSpends(lane, [pending, { ...pending, id: 'expired', expiry: 1 },
      { ...pending, id: 'completed', status: 'sent' }]);
    const app = express(); const requests = [];
    app.use('/api', (req, _res, next) => { requests.push(`${req.method} ${req.path}`); next(); });
    app.use('/api/v1/neuma', walletRouter);
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import * as clients from "/frontend/app/RelinkShell/wallet-client.js"; window.clients=clients; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
    app.use(vite.middlewares); server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.clients);
    const call = (name, id = lane) => page.evaluate(({ name, id }) => window.clients[name](id), { name, id });
    const defaults = [['loadAllowlist', []], ['loadThreshold', 0], ['loadPendingSpends', []]];
    for (const [name, value] of defaults) expect(await call(name)).toEqual(value);
    expect(requests).toEqual([]);
    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    expect(await call('loadAllowlist')).toEqual([entry]);
    expect(await call('loadThreshold')).toBe(0.125);
    expect(await call('loadPendingSpends')).toEqual([pending]);
    for (const [name, value] of defaults) expect(await call(name, empty)).toEqual(value);
    const beforeMissing = requests.length;
    for (const [name, value] of defaults) expect(await call(name, '')).toEqual(value);
    expect(requests).toHaveLength(beforeMissing);
    await page.evaluate(token => sessionStorage.setItem('authToken', token), foreign.token);
    for (const [name, value] of defaults) expect(await call(name)).toEqual(value);
    expect(await page.evaluate(() => window.expired)).toBe(0);
    await page.evaluate(() => sessionStorage.setItem('authToken', 'invalid-session-proof'));
    for (const [name, value] of defaults) expect(await call(name)).toEqual(value);
    expect(await page.evaluate(() => window.expired)).toBe(3);
    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    expect(await call('loadPendingSpends')).toEqual([pending]);
    expect(await workspace.readSpendThreshold(lane)).toEqual({ thresholdEth: 0.125 });
    expect(await workspace.readPendingSpends(lane)).toHaveLength(3);
    expect(requests.every(request => request.startsWith('GET '))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); await vite?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    setWorkspacesRoot(previous); await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
