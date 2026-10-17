/* global window, localStorage */
// Native opaque-origin storage refusal, through the actual wallet client.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';

test('RPC clear reports native storage refusal and preserves other wallet scopes on success', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpc-storage-proof-'));
  let browser; let server; let vite;
  try {
    const app = express();
    app.use((_req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next(); });
    app.get('/denied', (_req, res) => res.type('html').send('<iframe sandbox="allow-scripts" src="/"></iframe>'));
    app.get('/', (_req, res) => res.type('html').send(`
      <script type="module">
        import { clearRpc } from '/frontend/app/RelinkShell/wallet-client.js';
        window.clearRpc = clearRpc;
      </script>`));
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin); await page.waitForFunction(() => window.clearRpc);
    await page.evaluate(() => {
      localStorage.setItem('walletAddress', '0xABC');
      localStorage.setItem('0xabc:base-rpc', 'https://active.invalid/key');
      localStorage.setItem('0xdef:base-rpc', 'https://other.invalid/key');
    });
    for (let i = 0; i < 2; i++) {
      expect(await page.evaluate(() => window.clearRpc())).toEqual({ ok: true, status: { custom: false, browser: true } });
    }
    expect(await page.evaluate(() => localStorage.getItem('0xabc:base-rpc'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('0xdef:base-rpc'))).toBe('https://other.invalid/key');
    await page.goto(`${origin}/denied`);
    const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
    await frame.waitForFunction(() => window.clearRpc);
    expect(await frame.evaluate(() => {
      try { localStorage.removeItem('probe'); return 'accessible'; }
      catch (error) { return error.name; }
    })).toBe('SecurityError');
    expect(await frame.evaluate(() => window.clearRpc())).toEqual({ ok: false, error: 'Could not clear the RPC in this browser.' });
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close(); await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
