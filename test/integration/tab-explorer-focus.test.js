/* global fetch */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { Wallet } from 'ethers';
import { createServer } from 'vite';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, test } from 'vitest';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { createExplorerCheckout } from '../helpers/explorer-checkout-kit.js';

test('Explorer follows tab focus and external filesystem changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-tab-explorer-'));
  const saved = process.env.NEUMA_FILES_SETTINGS_PATH;
  const oldRealm = getRealmRoot();
  setRealmRoot(path.join(root, 'realm'));
  process.env.NEUMA_FILES_SETTINGS_PATH = path.join(root, 'files-settings.json');
  let vite; let server; let browser; let files; let oldRoots;
  try {
    const folders = ['a', 'b', 'c'].map((name) => path.join(root, name));
    for (const folder of folders) {
      await fs.mkdir(folder);
      await fs.writeFile(path.join(folder, `${path.basename(folder)}-only.txt`), 'folder proof');
    }
    const history = await createExplorerCheckout(folders[0]);
    files = await import('../../backend/services/user-files.js');
    oldRoots = files.getRoots();
    files.setRoots(folders);
    const { default: router } = await import('../../backend/routes/user-files-routes.js');
    const { default: projectsRouter } = await import('../../backend/routes/user-projects-routes.js');
    const { createAuthRouter } = await import('../../backend/services/auth.js');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRouter(express));
    app.use('/api/v1/user/files', router);
    app.use('/api/v1/user/projects', projectsRouter);
    vite = await createServer({ configFile: false,
      root: fileURLToPath(new URL('../..', import.meta.url)), cacheDir: path.join(root, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      optimizeDeps: { entries: ['test/fixtures/tab-focus-lifecycle.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
    });
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><div id="root"></div><script type="module" src="/test/fixtures/tab-focus-lifecycle.jsx"></script>'));
    app.use(vite.middlewares);
    server = await new Promise((resolve) => {
      const live = app.listen(0, '127.0.0.1', () => resolve(live));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    expect((await fetch(`${base}/api/v1/user/files/roots`)).status).toBe(401);
    expect((await fetch(`${base}/api/v1/user/files/events`)).status).toBe(401);
    const wallet = Wallet.createRandom();
    const { challenge } = await (await fetch(`${base}/api/v1/auth/challenge?address=${wallet.address}`)).json();
    const auth = await fetch(`${base}/api/v1/auth/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: wallet.address, challenge, signature: await wallet.signMessage(challenge) }),
    });
    expect(auth.status).toBe(200);
    const { token } = await auth.json();
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(({ token, address }) => {
      globalThis.sessionStorage.setItem('authToken', token);
      globalThis.localStorage.setItem('walletAddress', address);
    }, { token, address: wallet.address });
    const watchReady = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/user/files/events' && response.status() === 200);
    await page.goto(`${base}/?root=${encodeURIComponent(root)}`);
    await watchReady;
    for (const name of ['a', 'b', 'c', 'b', 'a']) {
      await page.getByRole('button', { name: `Select ${name}`, exact: true }).click().catch((error) => {
        throw new Error(`${error.message}\nBrowser errors: ${errors.join('; ')}`);
      });
      await browserExpect(page.locator('.xp-name')).toHaveText(name);
      const tree = page.locator('.files');
      const folder = tree.locator('.files-name').filter({ hasText: new RegExp(`^${name}$`) });
      await browserExpect(folder).toBeVisible();
      if (!await tree.getByText(`${name}-only.txt`, { exact: true }).isVisible()) await folder.click();
      await browserExpect(tree.getByText(`${name}-only.txt`, { exact: true })).toBeVisible();
      for (const other of ['a', 'b', 'c'].filter((id) => id !== name)) {
        await browserExpect(tree.getByText(`${other}-only.txt`, { exact: true })).toHaveCount(0);
      }
    }
    await page.getByRole('button', { name: 'Select empty', exact: true }).click();
    await browserExpect(page.locator('#folder')).toHaveText('CHOOSE A FOLDER');
    await browserExpect(page.locator('.xp-none')).toHaveText('CHOOSE A FOLDER');
    await browserExpect(page.locator('.files .files-name')).toHaveCount(0);
    await page.getByRole('button', { name: 'Select a', exact: true }).click();
    await browserExpect(page.locator('.files').getByText('a-only.txt', { exact: true })).toBeVisible();
    const row = (name) => page.locator('.files').getByText(name, { exact: true });
    const external = path.join(root, 'a', 'external.txt');
    const renamed = path.join(root, 'a', 'renamed.txt');
    await fs.writeFile(external, 'created outside Neuma');
    await browserExpect(row('external.txt')).toBeVisible();
    await fs.rename(external, renamed);
    await browserExpect(row('external.txt')).toHaveCount(0);
    await browserExpect(row('renamed.txt')).toBeVisible();
    await fs.unlink(renamed);
    await browserExpect(row('renamed.txt')).toHaveCount(0);
    const nested = path.join(root, 'a', 'external-folder');
    await fs.mkdir(nested);
    await browserExpect(row('external-folder')).toBeVisible();
    const listed = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/user/files/list' && url.searchParams.get('path') === nested;
    });
    await row('external-folder').click();
    expect((await (await listed).json()).entries).toEqual([]);
    await fs.writeFile(path.join(nested, 'nested.txt'), 'external nested write');
    await browserExpect(row('nested.txt')).toBeVisible();
    await fs.rm(nested, { recursive: true });
    await browserExpect(row('nested.txt')).toHaveCount(0);
    await browserExpect(row('external-folder')).toHaveCount(0);
    const revisionRows = page.locator('.files .files-name').filter({ hasText: /^(before|after)-\d{3}\.txt$/ });
    await browserExpect(revisionRows).toHaveText(history.before);
    await history.checkout(history.second);
    await browserExpect(revisionRows).toHaveText(history.after);
    await history.checkout(history.first);
    await browserExpect(revisionRows).toHaveText(history.before);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    if (oldRoots) files.setRoots(oldRoots);
    setRealmRoot(oldRealm);
    if (saved === undefined) delete process.env.NEUMA_FILES_SETTINGS_PATH;
    else process.env.NEUMA_FILES_SETTINGS_PATH = saved;
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
