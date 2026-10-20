/* global window */
/** Real price-route auth refusal and browser connection failure; no feed substitute. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { beforeAll, afterAll, test, expect } from 'vitest';
import priceRoutes from '../../backend/routes/price-routes.js';

let root; let browser; let server; let vite; let page;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wallet-price-browser-'));
  const app = express();
  app.use('/api/v1/prices', priceRoutes);
  app.get('/', (_req, res) => res.type('html').send(`
    <script type="module">
      import { fetchEthPrice, fetchTokenPrices } from '/frontend/app/RelinkShell/wallet-prices.js';
      window.prices = { fetchEthPrice, fetchTokenPrices };
    </script>`));
  vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
    cacheDir: path.join(root, 'vite'), appType: 'custom',
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null }, optimizeDeps: { noDiscovery: true } });
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => Boolean(window.prices));
});
afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('actual route refuses unauthenticated requests and the price client degrades', async () => {
  const ethResponse = page.waitForResponse((response) => response.url().endsWith('/prices/eth'));
  expect(await page.evaluate(() => window.prices.fetchEthPrice())).toBeNull();
  expect((await ethResponse).status()).toBe(401);
  const tokenResponse = page.waitForResponse((response) => response.url().includes('/prices/tokens?'));
  expect(await page.evaluate(() => window.prices.fetchTokenPrices(['ethereum']))).toEqual({});
  expect((await tokenResponse).status()).toBe(401);
});

test('closing the actual listener causes fetch rejection and preserves fallbacks', async () => {
  await new Promise((resolve) => server.close(resolve));
  const failures = [];
  page.on('requestfailed', (request) => failures.push(request.url()));
  expect(await page.evaluate(() => window.prices.fetchEthPrice())).toBeNull();
  expect(await page.evaluate(() => window.prices.fetchTokenPrices(['ethereum']))).toEqual({});
  expect(failures.filter((url) => url.includes('/api/v1/prices/'))).toHaveLength(2);
});
