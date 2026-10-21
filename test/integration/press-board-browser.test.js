/* global window, sessionStorage */
// Actual signed board route, temporary kit files and real binary discovery.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import { fullAuth } from '../helpers/audit-auth.js';

test('press board reads disk kits, reports binary availability and emits authentication expiry', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'press-board-browser-'));
  const keys = ['NEUMA_BRAND_KITS_DIR', 'NEUMA_CHROMIUM_PATH'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  let browser; let server; let vite;
  try {
    process.env.NEUMA_BRAND_KITS_DIR = path.join(root, 'kits');
    process.env.NEUMA_CHROMIUM_PATH = chromium.executablePath();
    await fs.mkdir(path.join(root, 'kits', 'proof'), { recursive: true });
    await fs.writeFile(path.join(root, 'kits', 'proof', 'kit.json'),
      JSON.stringify({ name: 'Board proof', companyName: 'Temporary test kit' }));
    const auth = await fullAuth();
    const app = express();
    app.use(express.json());
    app.use('/api/v1/doc-press', (await import('../../backend/routes/doc-press-routes.js')).default);
    vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
      cacheDir: path.join(root, 'vite'), appType: 'custom',
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import * as client from "/frontend/services/doc-press-client.js"; window.client=client; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => Boolean(window.client));
    const invoke = (name, args = []) => page.evaluate(async ({ name, args }) => {
      try { return { result: await window.client[name](...args) }; }
      catch (error) { return { error: error.message, http: error.http }; }
    }, { name, args });
    let requests = 0;
    page.on('request', (request) => { if (request.url().includes('/api/v1/doc-press')) requests++; });
    expect((await invoke('getPressBoard')).error).toBe('Not authenticated.');
    expect(requests).toBe(0);
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    expect((await invoke('getPressBoard')).result).toEqual({
      kits: [{ id: 'proof', name: 'Board proof', companyName: 'Temporary test kit' }],
      chromium: { available: true },
    });
    process.env.NEUMA_CHROMIUM_PATH = path.join(root, 'missing-chromium');
    const unavailable = (await invoke('getPressBoard')).result;
    expect(unavailable.chromium.available).toBe(false);
    expect(unavailable.chromium.detail).toContain('does not exist');
    expect(unavailable.kits).toHaveLength(1);
    await fs.rm(path.join(root, 'kits', 'proof'), { recursive: true });
    expect((await invoke('getPressBoard')).result.kits).toEqual([]);
    await page.evaluate(() => sessionStorage.setItem('authToken', 'expired-proof'));
    expect((await invoke('getPressBoard')).http).toBe(401);
    expect(await page.evaluate(() => window.expired)).toBe(1);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
