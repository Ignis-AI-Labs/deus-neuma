// Connect many accounts — the DESK (campaign plan slice 4): real Chromium,
// the PRODUCTION Settings → API channel keys (the app once + the accounts
// list), the platform window's account strip and the queue's account chips,
// against the real routes over a real signed-wallet session, the real sealed
// store on tmp disk, a loopback X-shaped server for the identity probes, and
// the TikTok stand-in. No double (RULE 0); placeholder keys only. Screens at
// three widths are written for a person to look at.
/* global document */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer as createVite } from 'vite';
import { chromium } from '@playwright/test';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { startTikTokStandIn } from '../helpers/tiktok-stand-in.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setAppFields, addAccount, setAccountFields, loadAccountStore } from '../../backend/services/social/account-store.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = path.join(os.tmpdir(), 'neuma-accounts-desk-shots');
const X_USERS = Object.freeze({ 'ph-x-token-1': { id: '101', username: 'core_voice' }, 'ph-x-token-2': { id: '202', username: 'sub_voice' } });
const ENV = ['NEUMA_X_API_ROOT', 'NEUMA_TIKTOK_API_ROOT', 'NEUMA_SOCIAL_POST_QUEUE_PATH'];
let tmp; let vite; let server; let browser; let xServer; let tiktok; let auth; let saved;

const fixture = (open) => ({
  token: auth.token,
  open,
  roster: [{ neumaId: 'core-cmo', name: 'Core CMO', participantKind: 'neuma' }, { neumaId: 'witness-x-Peer', name: 'Peer', participantKind: 'witness' }],
  entries: [
    { id: 'e-draft', channelId: 'x', accountId: 'x-2', status: 'draft' },
    { id: 'e-old', channelId: 'x', status: 'sent', postedAs: { username: 'core_voice' } },
    { id: 'e-tt', channelId: 'tiktok', accountId: 'tiktok-1', status: 'draft' },
  ],
});

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'accounts-desk-'));
  saved = { realm: getRealmRoot(), lanes: getWorkspacesRoot(), env: Object.fromEntries(ENV.map((k) => [k, process.env[k]])) };
  setRealmRoot(path.join(tmp, 'realm'));
  setWorkspacesRoot(path.join(tmp, 'lanes'));
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(tmp, 'queue.json');
  xServer = http.createServer((req, res) => {
    const token = decodeURIComponent(/oauth_token="([^"]+)"/.exec(req.headers.authorization || '')?.[1] || '');
    const user = X_USERS[token];
    res.writeHead(user ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(user ? { data: user } : { detail: 'Unauthorized' }));
  });
  await new Promise((r) => xServer.listen(0, '127.0.0.1', r));
  process.env.NEUMA_X_API_ROOT = `http://127.0.0.1:${xServer.address().port}/2`;
  tiktok = await startTikTokStandIn();
  process.env.NEUMA_TIKTOK_API_ROOT = tiktok.root;

  auth = await fullAuth();
  await writeOwner(path.join(tmp, 'lanes'), 'core-cmo', auth.address);
  const house = auth.address;
  await setAppFields(house, 'x', { apiKey: 'ph-x-app', apiSecret: 'ph-x-app-secret' });
  await addAccount(house, 'x', { companyId: 'ignis', expectedHandle: 'core_voice' }, ['ignis', 'umbrae']);
  await addAccount(house, 'x', { companyId: 'umbrae', expectedHandle: 'sub_voice' }, ['ignis', 'umbrae']);
  await setAccountFields(house, 'x-1', { accessToken: 'ph-x-token-1', accessSecret: 'ph-x-secret-1' });
  await setAccountFields(house, 'x-2', { accessToken: 'ph-x-token-2', accessSecret: 'ph-x-secret-2' });
  await channelBindings.bind(house, 'x-1', { neumaId: 'core-cmo' });
  await setAppFields(house, 'tiktok', { clientKey: 'awstandinkey', clientSecret: 'ph-tt-secret' });
  await addAccount(house, 'tiktok', {}, []);

  const [{ default: channelRouter }, { default: accountRouter }, { default: connectRouter }, { default: companyRouter }] = await Promise.all([
    import('../../backend/routes/social-channel-routes.js'), import('../../backend/routes/social-account-routes.js'),
    import('../../backend/routes/social-connect-routes.js'), import('../../backend/routes/company-routes.js'),
  ]);
  const app = express();
  app.use(express.json());
  app.use('/api/v1/social-channels', connectRouter);
  app.use('/api/v1/social-channels', accountRouter);
  app.use('/api/v1/social-channels', channelRouter);
  app.use('/api/v1/companies', companyRouter);
  vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(tmp, 'vite-cache'), appType: 'custom',
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/accounts-desk-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react-i18next', 'i18next'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (req, res) => res.type('html').send(
    `<!doctype html><html><body style="background:#000"><script>window.accountsFixture=${JSON.stringify(fixture(req.query.open || 'x'))}</script><div id="root"></div><script type="module" src="/test/helpers/accounts-desk-page.jsx"></script></body></html>`,
  ));
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  await fs.mkdir(SHOTS, { recursive: true });
}, 120000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  await new Promise((r) => xServer.close(r));
  await tiktok?.close();
  setRealmRoot(saved.realm);
  setWorkspacesRoot(saved.lanes);
  for (const [k, v] of Object.entries(saved.env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}, 30000);

const pick = async (page, label, option) => {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('listbox', { name: label }).getByText(option, { exact: true }).click();
};

describe('Settings → API → Channel keys, the account strip and the chips', () => {
  it('shows the app once and each account with its company and its own proof; nothing is echoed', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?open=x`);
    await page.locator('.account-row[data-account="x-2"]').waitFor({ timeout: 60000 });
    const keys = page.locator('#keys');
    expect(await keys.getByText('SAVE APP').count()).toBe(1);
    expect(await keys.locator('.account-row').count()).toBe(2);
    await expect.poll(() => keys.locator('.account-row[data-account="x-2"] .flight-line').textContent(), { timeout: 15000 }).toContain('@sub_voice');
    expect(await keys.locator('.account-row[data-account="x-1"] .flight-line').textContent()).toContain('@core_voice');
    expect(await keys.locator('.account-row[data-account="x-1"] .lc-sel-value').textContent()).toBe('Ignis AI Labs');
    // The account rows ask for the ACCOUNT's keys only; the app's are asked once.
    expect(await keys.locator('.account-row input[aria-label="API Key"]').count()).toBe(0);
    expect(await keys.locator('.account-app input[aria-label="API Key"]').count()).toBe(1);
    expect(await page.content()).not.toMatch(/ph-x-|ph-tt-/);

    // The strip: grouped by company, the holder per account, a witness never offered.
    const strip = page.locator('#strip');
    expect(await strip.locator('.account-strip-group').allTextContents()).toEqual([
      expect.stringContaining('x-1 · @core_voice'), expect.stringContaining('x-2 · @sub_voice'),
    ]);
    expect(await strip.locator('[data-account="x-1"] .lc-sel-value').textContent()).toBe('Core CMO');
    await strip.getByRole('button', { name: 'holder of x-2', exact: true }).click();
    expect(await page.getByRole('listbox', { name: 'holder of x-2' }).textContent()).not.toContain('Peer');
    await page.getByRole('listbox', { name: 'holder of x-2' }).getByText('Core CMO', { exact: true }).click();
    await expect.poll(async () => (await channelBindings.load(auth.address))['x-2']?.neumaId).toBe('core-cmo');
    await pick(page, 'show the boards of', 'Umbrae');
    expect(await strip.locator('.account-strip-group').count()).toBe(1);

    // The chips say who speaks; an account under no company says so.
    const chips = page.locator('#chips');
    expect(await chips.locator('[data-entry="e-draft"]').textContent()).toBe('POSTS AS @sub_voice (Umbrae)');
    expect(await chips.locator('[data-entry="e-old"]').textContent()).toBe('WENT OUT AS @core_voice (Ignis AI Labs)');
    expect(await chips.locator('[data-entry="e-tt"] .settings-tag-warn').textContent()).toBe('POSTS AS tiktok-1 (no company yet)');

    for (const [name, width] of [['wide', 1280], ['mid', 760], ['narrow', 420]]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({ path: path.join(SHOTS, `accounts-x-${name}.png`), fullPage: true });
      // Nothing runs off the right edge at any width.
      const overflow = await page.evaluate(() => [...document.querySelectorAll('.account-row, .account-strip-row')]
        .some((el) => el.scrollWidth > el.clientWidth + 1));
      expect(overflow).toBe(false);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('ADD ACCOUNT opens the next one under a company, and one press moves it', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/?open=x`);
    await page.locator('.account-row[data-account="x-2"]').waitFor({ timeout: 60000 });
    await pick(page, 'company of the new X (Twitter) account', 'Umbrae');
    await page.getByRole('button', { name: 'ADD ACCOUNT' }).click();
    await page.locator('.account-row[data-account="x-3"]').waitFor({ timeout: 15000 });
    expect((await loadAccountStore(auth.address)).accounts['x-3'].companyId).toBe('umbrae');
    await pick(page, 'company of x-3', 'Ignis AI Labs');
    await expect.poll(async () => (await loadAccountStore(auth.address)).accounts['x-3'].companyId).toBe('ignis');
    await page.locator('.account-row[data-account="x-3"]').getByRole('button', { name: 'REMOVE' }).click();
    await expect.poll(async () => Boolean((await loadAccountStore(auth.address)).accounts['x-3'])).toBe(false);
    await page.close();
  }, 120000);

  it('a sign-in platform: the app once, each account its own CONNECT', async () => {
    const page = await browser.newPage({ viewport: { width: 760, height: 1000 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/?open=tiktok`);
    await page.locator('.account-row[data-account="tiktok-1"]').waitFor({ timeout: 60000 });
    const row = page.locator('.account-row[data-account="tiktok-1"]');
    expect(await row.getByRole('button', { name: 'CONNECT' }).isEnabled()).toBe(true);
    expect(await row.locator('.lc-sel-value').textContent()).toBe('no company yet — choose one');
    await page.screenshot({ path: path.join(SHOTS, 'accounts-tiktok-mid.png'), fullPage: true });
    await page.close();
  }, 120000);
});
