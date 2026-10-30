/**
 * THE CONNECTIONS PANEL in a real Chromium against the real backend (Settings → Security): every
 * connection listed from the app's one list, the seven that run by themselves reading OFF with what
 * the person does without while off, the install owner turning one on (it lands on disk), and a
 * guest's press answered with the server's own refusal. Real signed-wallet auth; nothing is mocked.
 * Screenshots land in test/e2e/shots/connections-*.png.
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect as pw } from '@playwright/test';
import { createTempDir } from '../helpers/temp-fs.js';
import { shotPath } from '../helpers/first-run-door-kit.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

describe('the CONNECTIONS panel', () => {
  let dir, vite, server, browser, owner, guest, url;

  beforeAll(async () => {
    dir = await createTempDir('connections-panel');
    process.env.NEUMA_DATA_ROOT = path.join(dir, 'data');
    process.env.NEUMA_WEB_ACCESS_PATH = path.join(dir, 'web-access.json');
    delete process.env.NEUMA_CONNECTIONS_PATH;
    vi.resetModules();
    const { fullAuth } = await import('../helpers/audit-auth.js');
    owner = await fullAuth();
    guest = await fullAuth();
    await (await import('../../backend/services/install-owner.js')).recordFirstLocalOwner(owner.address);
    const { default: router } = await import('../../backend/routes/connection-routes.js');
    vite = await createServer({ configFile: false, root: REPO, cacheDir: path.join(dir, 'cache'), appType: 'custom',
      esbuild: { jsx: 'automatic' }, optimizeDeps: { entries: ['test/fixtures/connections-panel.jsx'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/connections', router);
    app.get('/', (_q, res) => res.type('html').send('<!doctype html><body style="margin:0;background:#000"><script type="module" src="/test/fixtures/connections-panel.jsx"></script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/`;
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    await vite?.close();
  });

  const open = async (who) => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await page.addInitScript((t) => sessionStorage.setItem('authToken', t), who.token);
    await page.goto(url);
    await page.getByTestId('connections').locator('[data-connection="update-check"]').waitFor({ timeout: 60_000 });
    return page;
  };
  const row = (page, id) => page.locator(`[data-connection="${id}"]`);

  test('a fresh install: the seven that run by themselves read OFF and say what is lost; the rest happen only on use', async () => {
    const page = await open(owner);
    await pw(page.getByText('RUNS BY ITSELF · 0 OF 7 ON')).toBeVisible();
    for (const id of ['update-check', 'security-watch', 'spellcheck', 'platform-data', 'mail-watch', 'sanctions-list', 'chat-bridge']) {
      await pw(row(page, id).locator('.conn-state')).toHaveText('OFF');
      await pw(row(page, id)).toContainText('While off:');
      await pw(row(page, id).getByRole('button', { name: 'TURN ON' })).toBeEnabled();
    }
    await pw(row(page, 'web').locator('.conn-state')).toHaveText('ON');
    await pw(row(page, 'web')).toContainText('Settings → API');
    await pw(row(page, 'wallets').getByRole('button')).toHaveCount(0);
    // the privacy policy's whole paragraph, one press away
    await row(page, 'spellcheck').getByText('MORE').click();
    await pw(row(page, 'spellcheck')).toContainText('downloads a dictionary for it from Google');
    await page.screenshot({ path: shotPath('connections-fresh-1366'), fullPage: true });
    await page.close();
  }, 90_000);

  test('a guest\'s press is answered with the refusal, and nothing is written', async () => {
    const page = await open(guest);
    await row(page, 'update-check').getByRole('button', { name: 'TURN ON' }).click();
    await pw(page.locator('.settings-err')).toBeVisible();
    await pw(row(page, 'update-check').locator('.conn-state')).toHaveText('OFF');
    await expect(fs.access(path.join(dir, 'data', 'settings', 'connections.json'))).rejects.toThrow();
    await page.close();
  }, 90_000);

  test('the owner turns the update check on: the row reads ON, the count moves, the file says so', async () => {
    const page = await open(owner);
    await row(page, 'update-check').getByRole('button', { name: 'TURN ON' }).click();
    await pw(row(page, 'update-check').locator('.conn-state')).toHaveText('ON');
    await pw(page.getByText('RUNS BY ITSELF · 1 OF 7 ON')).toBeVisible();
    await pw(row(page, 'update-check')).not.toContainText('While off:');
    await pw(row(page, 'update-check')).toHaveClass(/is-on/);
    const saved = JSON.parse(await fs.readFile(path.join(dir, 'data', 'settings', 'connections.json'), 'utf8'));
    expect(saved).toEqual({ 'update-check': true });
    await page.screenshot({ path: shotPath('connections-one-on-1366'), fullPage: true });
    await row(page, 'update-check').getByRole('button', { name: 'TURN OFF' }).click();
    await pw(row(page, 'update-check').locator('.conn-state')).toHaveText('OFF');
    await page.close();
  }, 90_000);
});
