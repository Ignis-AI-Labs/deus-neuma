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
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

test('voice-seal status reports invalid auth and preserves ownership refusals without a ceremony', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-seal-status-http-'));
  const paths = { NEUMA_DATA_ROOT: 'data', WORKSPACES_ROOT: 'lanes' };
  const saved = Object.fromEntries(Object.keys(paths).map(key => [key, process.env[key]]));
  let vite; let server; let browser;
  try {
    for (const [key, file] of Object.entries(paths)) process.env[key] = path.join(root, file);
    const auth = await fullAuth();
    await writeOwner(process.env.WORKSPACES_ROOT, 'owned', auth.address);
    const foreign = await fullAuth();
    await writeOwner(process.env.WORKSPACES_ROOT, 'foreign', foreign.address);
    const app = express(); const requests = [];
    app.use('/api', (req, res, next) => { res.on('finish', () => requests.push({ method: req.method, status: res.statusCode })); next(); });
    app.use('/api/v1/voice-seal', (await import('../../backend/routes/voice-seal-routes.js')).default);
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import {sealStatus} from "/frontend/app/RelinkShell/voice-seal-client.js"; window.read=sealStatus; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
    app.use(vite.middlewares); server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.read);
    expect(await page.evaluate(() => window.read('owned'))).toBeNull(); expect(requests).toEqual([]);
    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    expect(await page.evaluate(() => window.read(''))).toBeNull(); expect(requests).toEqual([]);
    const initial = await page.evaluate(() => window.read('owned'));
    expect(initial).toEqual({ sealed: false });
    expect(await page.evaluate(() => window.read('foreign'))).toBeNull();
    expect(requests.at(-1).status).toBe(403);
    expect(await page.evaluate(() => window.read('missing'))).toBeNull();
    expect(requests.at(-1).status).toBe(404);
    expect(await page.evaluate(() => window.read('invalid!'))).toBeNull();
    expect(requests.at(-1).status).toBe(400);
    expect(await page.evaluate(() => window.expired)).toBe(0);
    await page.evaluate(() => sessionStorage.setItem('authToken', 'invalid-session-proof'));
    expect(await page.evaluate(() => window.read('owned'))).toBeNull();
    expect(await page.evaluate(() => window.expired)).toBe(1);
    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    expect(await page.evaluate(() => window.read('owned'))).toEqual(initial);
    expect(await fs.readdir(path.join(process.env.WORKSPACES_ROOT, 'owned'))).toEqual(['owner.json']);
    expect(await fs.readdir(path.join(process.env.WORKSPACES_ROOT, 'foreign'))).toEqual(['owner.json']);
    expect(requests.every(request => request.method === 'GET')).toBe(true);
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
