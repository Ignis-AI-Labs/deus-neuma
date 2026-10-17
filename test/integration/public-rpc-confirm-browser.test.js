/* global window, localStorage, location */
// Actual settings and wallet-scoped browser storage; native local HTTP refusal for the initial probe.
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';

test('public RPC requires browser confirmation and preserves other wallet settings', async () => {
  let server; let browser;
  try {
    const entryId = 'virtual:public-rpc-confirm-proof';
    const source = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { MeSettings } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/WalletAppMeSettings.jsx'))};
      const root = createRoot(document.getElementById('root'));
      window.mountSettings = () => root.render(React.createElement(MeSettings, { myWallets: [] }));
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'rpc-proof', resolveId: (id) => id === entryId ? id : null,
        load: (id) => id === entryId ? source : null }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express(); app.use(express.json());
    app.use((_req, res, next) => { res.set('Content-Security-Policy', "connect-src 'self'"); next(); });
    for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) =>
      res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
    const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
    const styles = bundle.output.filter((file) => file.fileName.endsWith('.css')).map((file) => `<link rel="stylesheet" href="/${file.fileName}">`).join('');
    app.get('/', (_req, res) => res.send(`${styles}<div id="root"></div><script type="module" src="/${entry}"></script>`));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.mountSettings);
    await page.evaluate(() => {
      localStorage.setItem('walletAddress', '0xABC');
      localStorage.setItem('0xabc:base-rpc', location.origin + '/private-rpc-path');
      localStorage.setItem('0xdef:base-rpc', 'https://another-wallet.invalid/private');
      window.mountSettings();
    });
    const trigger = page.getByRole('button', { name: 'USE PUBLIC', exact: true });
    const group = page.getByRole('group', { name: 'Confirm public RPC' });
    await expect(page.getByText('CUSTOM · ACTIVE', { exact: true })).toBeVisible();
    await trigger.click();
    await expect(group).toContainText('Reads and broadcasts will use the public endpoint');
    await expect(group).not.toContainText('private-rpc-path');
    await expect(group.getByRole('button', { name: 'CANCEL' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'SAVE RPC' })).toBeDisabled();
    await page.keyboard.press('Enter');
    await expect(group).toHaveCount(0);
    await trigger.click(); await page.keyboard.press('Escape');
    await expect(group).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('0xabc:base-rpc'))).toContain('/private-rpc-path');
    await trigger.click(); await group.getByRole('button', { name: 'USE PUBLIC' }).click();
    await expect(group).toHaveCount(0);
    await expect(page.getByText('PUBLIC', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('0xabc:base-rpc'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('0xdef:base-rpc'))).toBe('https://another-wallet.invalid/private');
    await page.reload(); await page.waitForFunction(() => window.mountSettings);
    await page.evaluate(() => window.mountSettings());
    await expect(page.getByText('PUBLIC', { exact: true })).toBeVisible();
    await expect(trigger).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
  }
}, 30_000);
