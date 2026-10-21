/* global window, sessionStorage */
// Real Chromium, signed auth and temporary per-wallet chat labels.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import { getRealmRoot, setRealmRoot, walletDir } from '../../backend/services/user-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';

test('chat labels retain fallback and wallet isolation while reporting expired auth', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labels-browser-'));
  const priorRoot = getRealmRoot();
  setRealmRoot(path.join(root, 'realm'));
  let browser; let server; let vite;
  try {
    const auth = await fullAuth();
    const stranger = await fullAuth();
    const app = express();
    app.use(express.json());
    app.use('/api/v1/user/realm', (await import('../../backend/routes/user-realm-routes.js')).default);
    vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
      cacheDir: path.join(root, 'vite'), appType: 'custom',
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import * as client from "/frontend/services/chat-labels.js"; window.client=client; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => Boolean(window.client));
    const invoke = (name, args = []) => page.evaluate(async ({ name, args }) => {
      try { return { result: await window.client[name](...args) }; }
      catch (error) { return { error: error.message, http: error.http }; }
    }, { name, args });

    expect((await invoke('getChatLabels')).result).toEqual({});
    expect(await page.evaluate(() => window.expired)).toBe(0);
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    expect((await invoke('getChatLabels')).result).toEqual({});
    const label = '<angle> & "quoted"';
    const expected = { 'label-lane:session-1': label };
    expect((await invoke('setChatLabel', ['label-lane', 'session-1', `  ${label}  `])).result).toEqual(expected);
    expect((await invoke('getChatLabels')).result).toEqual(expected);
    const file = path.join(walletDir(auth.address), 'chat-labels.json');
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(expected);
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), stranger.token);
    expect((await invoke('getChatLabels')).result).toEqual({});
    expect((await invoke('setChatLabel', ['label-lane', 'session-1', 'Other wallet'])).result).toEqual({ 'label-lane:session-1': 'Other wallet' });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(expected);
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    expect((await invoke('setChatLabel', ['../outside', 'session-1', 'Rejected'])).http).toBe(400);
    expect((await invoke('setChatLabel', ['label-lane', 'session-1', ''])).result).toEqual({});
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({});
    await fs.writeFile(file, '{ broken JSON');
    expect((await invoke('getChatLabels')).result).toEqual({});
    expect(await fs.readFile(file, 'utf8')).toBe('{ broken JSON');
    expect(await page.evaluate(() => window.expired)).toBe(0);
    await page.evaluate(() => sessionStorage.setItem('authToken', 'expired-proof'));
    expect((await invoke('getChatLabels')).result).toEqual({});
    expect(await page.evaluate(() => window.expired)).toBe(1);
    expect((await invoke('setChatLabel', ['label-lane', 'session-1', 'Denied'])).http).toBe(401);
    expect(await page.evaluate(() => window.expired)).toBe(2);
    expect(await fs.readFile(file, 'utf8')).toBe('{ broken JSON');
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    setRealmRoot(priorRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
