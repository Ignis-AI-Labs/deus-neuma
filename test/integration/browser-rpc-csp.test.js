/** Actual Chromium CSP refusal, production wallet client and ethers lifecycle. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import { CSP_DIRECTIVES } from '../../backend/services/security-headers.js';

test('CSP refusal stops the provider, stays quiet, and permits an explicit fresh attempt', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-rpc-csp-'));
  let vite, server, browser;
  try {
    const app = express();
    vite = await createServer({
      configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
      cacheDir: path.join(temp, 'vite'), appType: 'custom',
      server: { middlewareMode: true, hmr: false, watch: null },
    });
    app.get('/', (_req, res) => res.set('Content-Security-Policy', CSP_DIRECTIVES.join('; '))
      .type('html').send('<!doctype html><script type="module" src="/probe.js"></script>'));
    app.get('/probe.js', (_req, res) => res.type('application/javascript').send(`
      import { readBaseRpc } from '/frontend/app/RelinkShell/wallet-client.js';
      import { getBrowserNetworkProvider } from '/frontend/services/wallet-browser-network.js';
      globalThis.violations = [];
      document.addEventListener('securitypolicyviolation', event => {
        if (event.effectiveDirective === 'connect-src') globalThis.violations.push(event.blockedURI);
      });
      globalThis.proof = { readBaseRpc, getBrowserNetworkProvider };
    `));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.setDefaultTimeout(5000);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => globalThis.proof).catch(error => {
      throw new Error(`${error.message}: ${errors.join('; ')}`, { cause: error });
    });
    await page.evaluate(() => {
      const { readBaseRpc, getBrowserNetworkProvider } = globalThis.proof;
      globalThis.firstProvider = getBrowserNetworkProvider();
      readBaseRpc('eth_chainId').then(
        () => { globalThis.firstResult = { refused: false }; },
        () => { globalThis.firstResult = { refused: true, destroyed: globalThis.firstProvider.destroyed }; },
      );
    });
    await page.waitForFunction(() => globalThis.firstResult);
    const first = await page.evaluate(() => globalThis.firstResult);
    expect(first).toEqual({ refused: true, destroyed: true });
    await page.waitForFunction(() => globalThis.violations.length > 0);
    const violations = await page.evaluate(() => [...globalThis.violations]);
    // the default network's public endpoint (Ethereum since 2026-10-04) is what the CSP refused
    expect(violations.every(uri => uri.startsWith('https://ethereum-rpc.publicnode.com'))).toBe(true);
    // Cross several of ethers' former one-second retry periods on the real clock.
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => globalThis.violations)).toEqual(violations);
    const retry = await page.evaluate(async () => {
      const { readBaseRpc, getBrowserNetworkProvider } = globalThis.proof;
      const next = getBrowserNetworkProvider();
      try { await readBaseRpc('eth_chainId'); return { refused: false }; }
      catch { return { refused: true, replaced: next !== globalThis.firstProvider, destroyed: next.destroyed }; }
    });
    expect(retry).toEqual({ refused: true, replaced: true, destroyed: true });
    await page.waitForFunction(count => globalThis.violations.length > count, violations.length);
    const afterRetry = await page.evaluate(() => globalThis.violations.length);
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => globalThis.violations.length)).toBe(afterRetry);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await vite?.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
}, 20000);
