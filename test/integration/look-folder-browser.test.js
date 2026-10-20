/** Real settings UI, signed auth, production routes and disk. No inference. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import { fullAuth } from '../helpers/audit-auth.js';

test('folder color applies live, survives reload and presets, and releases to lavender', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-look-folder-'));
  const oldPath = process.env.NEUMA_LOOK_SETTINGS_PATH;
  const file = path.join(root, 'look.json');
  process.env.NEUMA_LOOK_SETTINGS_PATH = file;
  let vite; let server; let browser;
  try {
    const auth = await fullAuth();
    const app = express();
    app.use(express.json());
    app.use('/api/v1/look', (await import('../../backend/routes/look-routes.js')).default);
    vite = await createServer({ configFile: false,
      root: fileURLToPath(new URL('../..', import.meta.url)), cacheDir: path.join(root, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      optimizeDeps: { entries: ['test/fixtures/look-folder.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
    });
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><body><div id="root"></div><script type="module" src="/test/fixtures/look-folder.jsx"></script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ token, address }) => {
      sessionStorage.setItem('authToken', token);
      localStorage.setItem('walletAddress', address);
    }, { token: auth.token, address: auth.address });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const color = () => page.locator('.tabstrip-ground').evaluate(el => getComputedStyle(el).color);
    const saved = async () => JSON.parse(await fs.readFile(file, 'utf8'));
    await page.getByLabel('FOLDER hex').waitFor();
    expect(await color()).toBe('rgb(185, 162, 208)');
    await page.getByLabel('FOLDER hex').fill('#33cc99');
    await page.getByLabel('FOLDER hex').press('Enter');
    await expect.poll(color).toBe('rgb(51, 204, 153)');
    await expect.poll(async () => (await saved()).theme?.folder).toBe('#33CC99');
    await page.getByPlaceholder('Name this dress').fill('Folder custom');
    await page.getByRole('button', { name: 'SAVE', exact: true }).click();
    await expect.poll(async () => (await saved()).presets[0]?.theme.folder).toBe('#33CC99');
    await page.reload();
    await expect.poll(color).toBe('rgb(51, 204, 153)');
    await expect.poll(() => page.getByLabel('FOLDER hex').inputValue()).toBe('#33CC99');
    await page.getByRole('button', { name: 'Release FOLDER to stock' }).click();
    await expect.poll(color).toBe('rgb(185, 162, 208)');
    await expect.poll(async () => (await saved()).theme?.folder ?? null).toBeNull();
    await page.getByRole('button', { name: 'Folder custom', exact: true }).click();
    await expect.poll(color).toBe('rgb(51, 204, 153)');
    const theme = (await saved()).presets[0].theme;
    const refused = await page.request.put(new URL('/api/v1/look/theme', page.url()).href, {
      headers: { Authorization: `Bearer ${auth.token}` }, data: { theme: { ...theme, folder: 'invalid' } },
    });
    expect(refused.status()).toBe(400);
    await page.getByLabel('FOLDER hex').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/neuma-look-folder-control.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await vite?.close();
    if (oldPath === undefined) delete process.env.NEUMA_LOOK_SETTINGS_PATH;
    else process.env.NEUMA_LOOK_SETTINGS_PATH = oldPath;
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
