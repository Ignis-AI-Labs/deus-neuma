// impure — real Chromium storage/reload, encrypted wallet and signed HTTP auth.
// User-skip replay only; this does not certify automatic portal stage completion.
/* global window, fetch, sessionStorage, localStorage, requestAnimationFrame */
import { afterAll, beforeAll, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import express from 'express';
import { createServer as createVite } from 'vite';
import { chromium, expect as browserExpect } from '@playwright/test';
import { createAuthRouter } from '../../backend/services/auth.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
let vite; let server; let browser; let tmp;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-arrival-browser-'));
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', createAuthRouter(express));
  vite = await createVite({
    configFile: false, root, cacheDir: path.join(tmp, 'vite'), appType: 'custom',
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'ethers'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (_req, res) => res.type('html').send(
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/test/helpers/arrival-reconnect-page.jsx"></script></body></html>',
  ));
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
}, 30000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
});

it('replays arrival after real disconnect/reload and same-wallet signed reconnect', async () => {
  const page = await browser.newPage({ reducedMotion: 'no-preference' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.arrivalProof);
  const connect = async () => {
    // Approve only the ephemeral wallet's real local authentication challenge.
    const [address] = await Promise.all([
      page.evaluate(() => window.arrivalProof.connect('disposable-arrival-proof')),
      page.locator('.wallet-confirm-approve').click(),
    ]);
    const session = await page.evaluate(async () => {
      const response = await fetch('/api/v1/auth/session', {
        headers: { Authorization: `Bearer ${sessionStorage.getItem('authToken')}` },
      });
      return { status: response.status, body: await response.json() };
    });
    expect(session).toEqual({ status: 200, body: { address: address.toLowerCase(), authenticated: true } });
    return address;
  };
  const address = await connect();
  const veil = page.getByRole('dialog', { name: 'The arrival' });
  await browserExpect(veil).toBeVisible();
  await veil.click();
  await browserExpect(veil).toHaveCount(0);
  const key = `arrivalSeen:${address.toLowerCase()}`;
  expect(await page.evaluate((k) => sessionStorage.getItem(k), key)).toBe('1');
  await page.evaluate(() => window.arrivalProof.remount());
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await browserExpect(veil).toHaveCount(0);
  await Promise.all([
    page.waitForEvent('load'),
    page.evaluate(() => { void window.arrivalProof.disconnect(); }),
  ]);
  await page.waitForFunction(() => window.arrivalProof);
  expect(await page.evaluate((k) => ({
    seen: sessionStorage.getItem(k), token: sessionStorage.getItem('authToken'),
    address: localStorage.getItem('walletAddress'), connected: localStorage.getItem('walletConnected'),
  }), key)).toEqual({ seen: null, token: null, address: null, connected: null });
  expect(await connect()).toBe(address);
  await browserExpect(veil).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
}, 30000);
