// impure — real Chromium, encrypted wallet and EIP-1193 consent gate.
/* global window, document */
import { beforeAll, afterAll, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import { createServer as createVite } from 'vite';
import { chromium, expect as browserExpect } from '@playwright/test';
import { verifyMessage } from 'ethers';

let vite; let server; let browser; let tmp;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-wallet-consent-'));
  vite = await createVite({
    configFile: false, root: fileURLToPath(new URL('../../', import.meta.url)),
    cacheDir: path.join(tmp, 'vite'), appType: 'custom',
    optimizeDeps: { include: ['ethers'] },
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><body></body></html>');
    } else vite.middlewares(req, res, () => { res.statusCode = 404; res.end(); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
}, 30000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
});

const openPage = async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({ type: 'module', content: `
    import * as wallet from '/frontend/services/EmbeddedWallet.js';
    import * as modal from '/frontend/services/wallet-confirm-modal.js';
    window.wallet = wallet;
    window.modal = modal;
  ` });
  await page.waitForFunction(() => window.wallet && window.modal);
  return page;
};

it('renders message and transaction text literally, preserving confirm, reject and backdrop choices', async () => {
  const page = await openPage();
  const payload = '<img src=x onerror="window.injected=true"> & "quoted"';
  await page.evaluate((message) => {
    window.choice = 'pending';
    window.modal.requestConfirmation('sign', { message }).then((v) => { window.choice = v; });
  }, payload);
  await browserExpect(page.locator('.wallet-confirm-message')).toHaveText(payload);
  expect(await page.locator('img').count()).toBe(0);
  expect(await page.evaluate(() => window.choice)).toBe('pending');
  await page.locator('.wallet-confirm-approve').click();
  expect(await page.evaluate(() => window.choice)).toBe(true);
  await browserExpect(page.locator('.wallet-confirm-overlay')).toHaveCount(0);
  await page.evaluate((to) => {
    window.choice = 'pending';
    window.modal.requestConfirmation('transaction', { to, value: '1000000000000000000', data: '0x123456789012345678901234' })
      .then((v) => { window.choice = v; });
  }, payload);
  await browserExpect(page.locator('.wallet-confirm-value').nth(0)).toHaveText(payload);
  await browserExpect(page.locator('.wallet-confirm-value').nth(1)).toHaveText('1.0 ETH');
  await browserExpect(page.locator('.wallet-confirm-value').nth(2)).toHaveText('0x123456789012345678...');
  expect(await page.locator('img').count()).toBe(0);
  await page.locator('.wallet-confirm-reject').click();
  expect(await page.evaluate(() => window.choice)).toBe(false);
  await page.evaluate(() => {
    window.choice = 'pending';
    window.modal.requestConfirmation('sign', { message: '0x68656c6c6f' }).then((v) => { window.choice = v; });
    document.querySelector('.wallet-confirm-overlay').click();
  });
  expect(await page.evaluate(() => window.choice)).toBe(false);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.close();
});

it('signs only after approval, rejects transactions before RPC, and unlocks through the real encrypted vault', async () => {
  const page = await openPage();
  const address = await page.evaluate(async () => {
    const result = await window.wallet.createEmbeddedWallet('temporary-consent-password');
    window.provider = window.wallet.getEmbeddedProvider();
    return result.address;
  });
  const start = async (method, params) => page.evaluate(({ method, params }) => {
    window.result = { status: 'pending' };
    window.provider.request({ method, params }).then(
      (value) => { window.result = { status: 'ok', value }; },
      (error) => { window.result = { status: 'error', error: error.message }; },
    );
  }, { method, params });
  await start('personal_sign', ['consent proof', address]);
  await browserExpect(page.locator('.wallet-confirm-header')).toHaveText('Sign Message');
  expect(await page.evaluate(() => window.result.status)).toBe('pending');
  await page.locator('.wallet-confirm-reject').click();
  await page.waitForFunction(() => window.result.status !== 'pending');
  expect(await page.evaluate(() => window.result)).toEqual({ status: 'error', error: 'User rejected signature request' });
  await start('personal_sign', ['consent proof', address]);
  await page.locator('.wallet-confirm-approve').click();
  await page.waitForFunction(() => window.result.status !== 'pending');
  const signed = await page.evaluate(() => window.result);
  expect(signed.status).toBe('ok');
  expect(verifyMessage('consent proof', signed.value)).toBe(address);
  const requests = [];
  page.on('request', (req) => requests.push(req.url()));
  await start('eth_sendTransaction', [{ to: address, value: '0x0' }]);
  await browserExpect(page.locator('.wallet-confirm-header')).toHaveText('Confirm Transaction');
  expect(await page.evaluate(() => window.result.status)).toBe('pending');
  await page.locator('.wallet-confirm-reject').click();
  await page.waitForFunction(() => window.result.status !== 'pending');
  expect(await page.evaluate(() => window.result)).toEqual({ status: 'error', error: 'User rejected transaction' });
  expect(requests).toEqual([]);
  await page.evaluate(() => window.wallet.lockEmbeddedWallet());
  await start('personal_sign', ['after unlock', address]);
  await browserExpect(page.locator('.wallet-confirm-header')).toHaveText('Unlock Wallet');
  await page.locator('.wallet-confirm-approve').click();
  await browserExpect(page.locator('.wallet-unlock-input')).toBeVisible();
  await page.locator('.wallet-unlock-input').fill('wrong-password');
  await page.locator('.wallet-unlock-input').press('Enter');
  await browserExpect(page.locator('.wallet-unlock-error')).toHaveText('Unlock failed.');
  await page.locator('.wallet-unlock-input').fill('temporary-consent-password');
  await page.locator('.wallet-unlock-input').press('Enter');
  await browserExpect(page.locator('.wallet-confirm-header')).toHaveText('Sign Message');
  expect(await page.evaluate(() => window.result.status)).toBe('pending');
  await page.locator('.wallet-confirm-approve').click();
  await page.waitForFunction(() => window.result.status !== 'pending');
  const unlocked = await page.evaluate(() => window.result);
  expect(unlocked.status).toBe('ok');
  expect(verifyMessage('after unlock', unlocked.value)).toBe(address);
  await page.evaluate(() => window.wallet.lockEmbeddedWallet());
  await start('personal_sign', ['cancel unlock', address]);
  await page.locator('.wallet-unlock-input').press('Escape');
  await page.waitForFunction(() => window.result.status !== 'pending');
  expect(await page.evaluate(() => window.result)).toEqual({ status: 'error', error: 'Wallet unlock cancelled' });
  await page.close();
}, 30000);
