// Settings → API in a real browser: the PRODUCTION ServiceKeysSection against the
// real routing router (real session, real install-owner gate, real encrypted store
// in a temp path). The operator saves a chain RPC address by typing it, the desk
// says it is saved and encrypted, the address is never shown back, and removing it
// falls back to the env file's value — named. No mocks (RULE 0).
/* global document */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer as createVite } from 'vite';
import { chromium } from '@playwright/test';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SECRET = 'k3y-1n-th3-url-9876543210';
let tmp; let vite; let server; let browser; let saved;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'service-keys-browser-'));
  saved = { creds: process.env.NEUMA_PROVIDER_CREDENTIALS_PATH, base: process.env.BASE_MAINNET_RPC_URL };
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(tmp, 'creds.json');
  process.env.BASE_MAINNET_RPC_URL = 'https://env-node.example/v2/from-env';
  const { strangerWitness } = await import('../helpers/witness.js');
  const owner = strangerWitness();
  await makeInstallOwner(owner.address);
  const { hydrateStoredSecrets } = await import('../../backend/services/stored-secrets.js');
  await hydrateStoredSecrets();
  const { default: router } = await import('../../backend/routes/routing-routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/routing', router);
  vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(tmp, 'vite-cache'), appType: 'custom',
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/service-keys-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react-i18next', 'i18next'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (req, res) => res.type('html').send(
    `<!doctype html><script>window.serviceKeysFixture=${JSON.stringify({ token: owner.token })}</script><div id="root"></div><script type="module" src="/test/helpers/service-keys-page.jsx"></script>`,
  ));
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
}, 120000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  if (saved.creds === undefined) delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH; else process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = saved.creds;
  if (saved.base === undefined) delete process.env.BASE_MAINNET_RPC_URL; else process.env.BASE_MAINNET_RPC_URL = saved.base;
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}, 30000);

describe('Settings → API — keys without an env file', () => {
  it('save an RPC address by typing it; the desk says where the value comes from and never shows it back', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    // Each key is one row; its form opens beneath it.
    const card = page.locator('.cred-item', { hasText: 'Base mainnet RPC address' });
    await card.waitFor({ timeout: 60000 });
    expect(await card.locator('.cred-row-detail').textContent()).toBe('from the env file');
    await card.locator('.cred-row').click();
    // The headings people look for, and the env fallback named.
    for (const h of ['WEB SEARCH', 'PAGE READER', 'MODEL DOWNLOADS', 'CHAIN RPC']) expect(await page.getByText(h, { exact: true }).count()).toBeGreaterThan(0);
    expect(await card.textContent()).toContain('In use from the env file (BASE_MAINNET_RPC_URL)');
    expect(await card.locator('a', { hasText: 'Alchemy' }).getAttribute('href')).toBe('https://dashboard.alchemy.com/');

    await card.locator('input').fill(`https://base-mainnet.g.alchemy.com/v2/${SECRET}`);
    expect(await card.locator('input').getAttribute('type')).toBe('password');
    await card.getByRole('button', { name: 'SAVE' }).click();
    await card.getByText('Saved here, encrypted on this computer', { exact: false }).waitFor({ timeout: 15000 });
    expect(await card.locator('input').inputValue()).toBe('');
    expect(await page.content()).not.toContain(SECRET);
    expect(await fs.readFile(process.env.NEUMA_PROVIDER_CREDENTIALS_PATH, 'utf8')).not.toContain(SECRET);

    // A bad address is refused in words, before it is stored.
    const eth = page.locator('.cred-item', { hasText: 'Ethereum mainnet RPC address' });
    await eth.locator('.cred-row').click();
    await eth.locator('input').fill('http://not-local.example/v2/x');
    await eth.getByRole('button', { name: 'SAVE' }).click();
    await eth.locator('.settings-err').waitFor({ timeout: 15000 });
    expect(await eth.locator('.settings-err').textContent()).toContain('https://');

    // Remove → confirm → back to the env file's value. (One row stands open at a time: reopen it.)
    await card.locator('.cred-row').click();
    await card.getByRole('button', { name: 'REMOVE' }).click();
    await card.locator('.is-danger, button', { hasText: 'REMOVE' }).last().click();
    await card.getByText('In use from the env file (BASE_MAINNET_RPC_URL)', { exact: false }).waitFor({ timeout: 15000 });
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);
});
