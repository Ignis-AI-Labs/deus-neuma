/* global window, sessionStorage, localStorage, requestAnimationFrame */
// Actual Wallet settings, signed wallet router and temporary allowlist files.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import http from 'node:http';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import walletRouter from '../../backend/routes/neuma-wallet-routes.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

test('recipient confirmation cancels safely, surfaces refusal and cannot update a switched identity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recipient-confirm-'));
  const previous = getWorkspacesRoot();
  let server; let browser; let release;
  try {
    setWorkspacesRoot(root);
    const auth = await fullAuth(); const stranger = await fullAuth();
    const first = 'recipient-fixture-a'; const second = 'recipient-fixture-b';
    const addresses = ['1', '2', '3'].map((digit) => `0x${digit.repeat(40)}`);
    for (const id of [first, second]) await writeOwner(root, id, auth.address);
    await workspace.writeSpendAllowlist(first, { version: 1, entries: [
      { address: addresses[0], label: 'Alpha' }, { address: addresses[1], label: 'Beta' },
    ] });
    await workspace.writeSpendAllowlist(second, { version: 1, entries: [{ address: addresses[2], label: 'Gamma' }] });
    const entryId = 'virtual:recipient-confirm-proof';
    const source = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { NeumaSettings } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/WalletAppSettings.jsx'))};
      import { loadAllowlist } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/wallet-client.js'))};
      const root = createRoot(document.getElementById('root'));
      const View = () => {
        const [id, setId] = React.useState('recipient-fixture-a');
        const [entries, setEntries] = React.useState([]);
        window.switchIdentity = setId;
        React.useEffect(() => { loadAllowlist(id).then(setEntries); }, [id]);
        return React.createElement(NeumaSettings, { neumaId: id, entries, setEntries, threshold: 0, pending: [] });
      };
      window.mountWallet = () => root.render(React.createElement(View));
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'recipient-proof', resolveId: (id) => id === entryId ? id : null,
        load: (id) => id === entryId ? source : null }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express(); app.use(express.json());
    app.use((_req, res, next) => { res.set('Content-Security-Policy', "connect-src 'self'"); next(); });
    let deletes = 0; let hold = false; let observed;
    app.use('/api/v1/neuma', async (req, _res, next) => {
      if (req.method === 'DELETE') {
        deletes++;
        if (hold) {
          hold = false;
          const barrier = new Promise((resolve) => { release = resolve; });
          observed();
          await barrier;
        }
      }
      next();
    });
    app.use('/api/v1/neuma', walletRouter);
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
    await page.waitForFunction(() => window.mountWallet);
    await page.evaluate(({ token, address }) => {
      sessionStorage.setItem('authToken', token); localStorage.setItem('walletAddress', address); window.mountWallet();
    }, { token: auth.token, address: auth.address });
    const group = page.getByRole('group', { name: 'Confirm recipient revocation' });
    await page.getByRole('button', { name: 'Revoke recipient Alpha', exact: true }).click();
    await expect(group).toContainText(addresses[0]);
    await expect(page.getByRole('button', { name: 'APPROVE', exact: true })).toBeDisabled();
    await expect(group.getByRole('button', { name: 'CANCEL' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(group).toHaveCount(0);
    await page.getByRole('button', { name: 'Revoke recipient Alpha', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(group).toHaveCount(0);
    expect(deletes).toBe(0);
    expect((await workspace.readSpendAllowlist(first)).entries).toHaveLength(2);
    await page.getByRole('button', { name: 'Revoke recipient Alpha', exact: true }).click();
    await page.evaluate((id) => window.switchIdentity(id), second);
    await expect(page.getByRole('button', { name: 'Revoke recipient Gamma', exact: true })).toBeVisible();
    await expect(group).toHaveCount(0);
    expect(deletes).toBe(0);
    await page.evaluate((id) => window.switchIdentity(id), first);
    await page.getByRole('button', { name: 'Revoke recipient Alpha', exact: true }).click();
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), stranger.token);
    await group.getByRole('button', { name: 'REVOKE', exact: true }).click();
    await expect(page.locator('.wal-err')).toBeVisible();
    expect((await workspace.readSpendAllowlist(first)).entries).toHaveLength(2);
    await expect(group).toBeVisible();
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    await group.getByRole('button', { name: 'REVOKE', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Revoke recipient Alpha', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Revoke recipient Beta', exact: true })).toBeVisible();
    expect((await workspace.readSpendAllowlist(first)).entries.map((entry) => entry.label)).toEqual(['Beta']);
    await page.getByRole('button', { name: 'Revoke recipient Beta', exact: true }).click();
    hold = true;
    const seen = new Promise((resolve) => { observed = resolve; });
    const finished = page.waitForResponse((response) => response.request().method() === 'DELETE');
    await group.getByRole('button', { name: 'REVOKE', exact: true }).click();
    await seen;
    await expect(group.getByRole('button', { name: 'WORKING…' })).toBeDisabled();
    await expect(group.getByRole('button', { name: 'CANCEL' })).toBeDisabled();
    await page.evaluate((id) => window.switchIdentity(id), second);
    await expect(page.getByRole('button', { name: 'Revoke recipient Gamma', exact: true })).toBeVisible();
    release();
    await (await finished).finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect((await workspace.readSpendAllowlist(first)).entries).toEqual([]);
    await expect(page.getByRole('button', { name: 'Revoke recipient Gamma', exact: true })).toBeVisible();
    expect((await workspace.readSpendAllowlist(second)).entries.map((entry) => entry.label)).toEqual(['Gamma']);
    await page.getByPlaceholder('0x recipient address', { exact: true }).fill(`0x${'4'.repeat(40)}`);
    await page.getByPlaceholder('label (optional)', { exact: true }).fill('Delta');
    await page.getByRole('button', { name: 'APPROVE', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Revoke recipient Delta', exact: true })).toBeVisible();
    expect((await workspace.readSpendAllowlist(second)).entries.map((entry) => entry.label)).toEqual(['Gamma', 'Delta']);
    expect(deletes).toBe(3);
    expect(errors).toEqual([]);
  } finally {
    release?.();
    await browser?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    setWorkspacesRoot(previous);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
