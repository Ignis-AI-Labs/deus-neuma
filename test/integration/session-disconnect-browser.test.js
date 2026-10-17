/* global window, localStorage, sessionStorage */
/** Actual browser storage, navigation and opaque-origin SecurityError. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { beforeAll, afterAll, beforeEach, afterEach, describe, test, expect } from 'vitest';

let root; let browser; let server; let vite; let origin; let context; let page;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'disconnect-browser-'));
  const app = express();
  // The sandboxed frame has an opaque origin; allow it to load real modules.
  app.use((_req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next(); });
  app.get('/denied', (_req, res) => res.type('html').send('<iframe sandbox="allow-scripts" src="/"></iframe>'));
  app.get('/', (_req, res) => res.type('html').send(`
    <button id="disconnect">Disconnect</button>
    <script type="module">
      import { disconnectSession } from '/frontend/services/session.js';
      import { getWalletService } from '/frontend/services/WalletGate.js';
      import { setWindowCompanion } from '/frontend/utils/companion-data.js';
      window.setWindowCompanion = setWindowCompanion;
      window.wallet = getWalletService();
      document.querySelector('#disconnect').onclick = disconnectSession;
      window.ready = true;
    </script>`));
  vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
    cacheDir: path.join(root, 'vite'), appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
});
afterEach(async () => context?.close());
afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const open = async () => {
  await page.goto(origin);
  await page.waitForFunction(() => window.ready === true);
};
const disconnect = async (frame = page.mainFrame()) => {
  const navigation = page.waitForEvent('framenavigated', { predicate: (navigated) => navigated === frame });
  await frame.locator('#disconnect').click();
  await navigation;
  await frame.waitForFunction(() => window.ready === true);
};

describe('disconnectSession in Chromium', () => {
  test('clears actual local/session storage and reloads the document', async () => {
    await open();
    await page.evaluate(() => {
      sessionStorage.setItem('authToken', 'temporary-token');
      sessionStorage.setItem('llm-apikey', 'non-secret-marker');
      localStorage.setItem('walletAddress', '0xabc');
      localStorage.setItem('walletConnected', 'true');
    });
    expect(await page.evaluate(() => window.wallet.isConnected())).toBe(true);
    await disconnect();
    expect(await page.evaluate(() => ({
      connected: window.wallet.isConnected(), address: window.wallet.getAddress(),
      token: sessionStorage.getItem('authToken'), key: sessionStorage.getItem('llm-apikey'),
      flag: localStorage.getItem('walletConnected'),
    }))).toEqual({ connected: false, address: null, token: null, key: null, flag: null });
  });

  test('clears the old wallet arrival marker despite provider cleanup removing its address', async () => {
    await open();
    await page.evaluate(() => {
      sessionStorage.setItem('arrivalSeen:0xabc', '1');
      localStorage.setItem('walletAddress', '0xABC');
    });
    await disconnect();
    expect(await page.evaluate(() => sessionStorage.getItem('arrivalSeen:0xabc'))).toBeNull();
  });

  test('clears the exact departing wallet binding after provider cleanup, preserving other scopes', async () => {
    await open();
    const keys = await page.evaluate(() => {
      localStorage.setItem('walletAddress', '0xDEF');
      window.setWindowCompanion({ neumaId: 'other-record' });
      localStorage.setItem('walletAddress', '0xABC');
      window.setWindowCompanion({ neumaId: 'departing-record' });
      sessionStorage.setItem('neuma-companion-seed', 'one-shot-marker');
      return Object.keys(sessionStorage).filter((key) => key.includes('neuma-window-companion'));
    });
    expect(keys.sort()).toEqual(['0xabc:neuma-window-companion', '0xdef:neuma-window-companion']);
    await disconnect();
    expect(await page.evaluate(() => ({
      departing: sessionStorage.getItem('0xabc:neuma-window-companion'),
      other: JSON.parse(sessionStorage.getItem('0xdef:neuma-window-companion')),
      seed: sessionStorage.getItem('neuma-companion-seed'),
    }))).toEqual({ departing: null, other: { neumaId: 'other-record' }, seed: null });
  });

  test('real browser storage denial still permits session teardown and reload', async () => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${origin}/denied`);
    const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
    await frame.waitForFunction(() => window.ready === true, null, { timeout: 5000 })
      .catch((error) => { throw new Error(`${error.message}: ${errors.join('; ')}`); });
    expect(await frame.evaluate(() => {
      const names = [];
      for (const key of ['localStorage', 'sessionStorage']) {
        try { window[key].getItem('probe'); names.push('accessible'); }
        catch (error) { names.push(error.name); }
      }
      return names;
    })).toEqual(['SecurityError', 'SecurityError']);
    await disconnect(frame);
  });

  test('reloads safely with no connected session', async () => {
    await open();
    await disconnect();
    expect(await page.evaluate(() => window.wallet.isConnected())).toBe(false);
  });
});
