// The SOCIAL CHECK window and the LEGAL chip — the DESK (campaign plan slices
// 11 and 12): real Chromium, the PRODUCTION window body and chip, against the
// real routes over a real signed-wallet session, the real stores on tmp disk
// and a loopback X answering /2/users/me. No double (RULE 0); placeholder
// keys only. Screens at three widths are written for a person to look at.
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
import { standTwoHouses } from '../helpers/house-office-kit.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { setAppFields, addAccount, setAccountFields, setAccountMeta } from '../../backend/services/social/account-store.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { setCompanyBlock } from '../../backend/services/marketing/companies.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = path.join(os.tmpdir(), 'neuma-social-check-shots');
const X_USERS = Object.freeze({ 'ph-x-token-1': { id: '101', username: 'core_voice' }, 'ph-x-token-2': { id: '202', username: 'sub_voice' } });
const DOORS = ['NEUMA_X_API_ROOT', 'NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SECTOR_CREW_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH'];
let houses; let vite; let server; let browser; let xServer; let auth; let saved;

beforeAll(async () => {
  saved = Object.fromEntries(DOORS.map((k) => [k, process.env[k]]));
  houses = await standTwoHouses({ label: 'social-check-desk', lanesA: [], lanesB: [] });
  for (const [door, name] of [['NEUMA_SOCIAL_POST_QUEUE_PATH', 'social-post-queue.json'], ['NEUMA_SOCIAL_BINDINGS_PATH', 'social-channel-bindings.json'],
    ['NEUMA_SECTOR_CREW_PATH', 'sector-crew.json'], ['NEUMA_SOCIAL_CREDENTIALS_PATH', 'social-channel-credentials.json']]) {
    process.env[door] = path.join(houses.settings, name);
  }
  await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, '[]');
  xServer = http.createServer((req, res) => {
    const token = decodeURIComponent(/oauth_token="([^"]+)"/.exec(req.headers.authorization || '')?.[1] || '');
    const user = X_USERS[token];
    res.writeHead(user ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(user ? { data: user } : { detail: 'Unauthorized' }));
  });
  await new Promise((r) => xServer.listen(0, '127.0.0.1', r));
  process.env.NEUMA_X_API_ROOT = `http://127.0.0.1:${xServer.address().port}/2`;

  auth = await fullAuth();
  const house = auth.address;
  for (const lane of ['core-cmo', 'sub-cmo', 'drafter']) await writeOwner(houses.rootA, lane, house);
  await setHouseWorkspace(house, path.join(houses.tmp, 'ground'));
  await setCompanyBlock(house, 'ignis', { site: { url: 'https://example.com/ignis', links: [] } });
  await setCompanyBlock(house, 'umbrae', { parentId: 'ignis', site: { url: 'https://example.com/umbrae', links: [] } });
  await setAppFields(house, 'x', { apiKey: 'ph-x-app', apiSecret: 'ph-x-app-secret' });
  await setAccountMeta(house, 'x-1', { companyId: 'ignis', expectedHandle: 'core_voice' }, ['ignis', 'umbrae']);
  await setAccountFields(house, 'x-1', { accessToken: 'ph-x-token-1', accessSecret: 'ph-x-secret-1' });
  await addAccount(house, 'x', { companyId: 'umbrae', expectedHandle: 'a_very_long_expected_handle_that_is_wrong' }, ['ignis', 'umbrae']);
  await setAccountFields(house, 'x-2', { accessToken: 'ph-x-token-2', accessSecret: 'ph-x-secret-2' });
  await addAccount(house, 'x', {}, ['ignis', 'umbrae']);
  await channelBindings.bind(house, 'x-1', { neumaId: 'core-cmo' });
  await channelBindings.bind(house, 'x-2', { neumaId: 'sub-cmo' });
  await channelBindings.bind(house, 'x-3', { neumaId: 'drafter' });
  await postQueue.add({ channelId: 'x', accountId: 'x-1', text: 'Neuma is 3x faster than X.', authorNeumaId: 'core-cmo', queuedBy: 'core-cmo' });

  const [{ default: channelRouter }, { default: accountRouter }] = await Promise.all([
    import('../../backend/routes/social-channel-routes.js'), import('../../backend/routes/social-account-routes.js'),
  ]);
  const app = express();
  app.use(express.json());
  app.use('/api/v1/social-channels', accountRouter);
  app.use('/api/v1/social-channels', channelRouter);
  vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(houses.tmp, 'vite-cache'), appType: 'custom',
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/social-check-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react-i18next', 'i18next'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (req, res) => res.type('html').send(
    `<!doctype html><html><body style="background:#000"><script>window.socialCheckFixture=${JSON.stringify({ token: auth.token })}</script><div id="root"></div><script type="module" src="/test/helpers/social-check-page.jsx"></script></body></html>`,
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
  houses?.restore();
  for (const k of DOORS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
}, 30000);

describe('the SOCIAL CHECK window and the LEGAL chip', () => {
  it('reads the house line, opens on what needs a fix, and a press on a card opens another account', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const check = page.locator('#check');
    await check.locator('.sc-card').first().waitFor({ timeout: 60000 });
    expect(await check.locator('.settings-h').textContent()).toBe('1 OF 3 ACCOUNTS CLEAR · 8 OPTIONAL');
    expect(await check.locator('.sc-card').count()).toBe(3);
    expect(await check.locator('.sc-card.is-clear').count()).toBe(1);
    expect(await check.locator('.sc-card.is-fail').count()).toBe(2);
    // The tree: ignis, umbrae under it, then UNSORTED apart.
    expect(await check.locator('.social-check-name').allTextContents()).toEqual(['Ignis AI Labs', 'Umbrae', 'UNSORTED — NO COMPANY']);
    expect(await check.locator('.social-check-tally').first().textContent()).toBe('1 OF 1 CLEAR · TREE 1 OF 2 CLEAR');

    // It opens on the first account that needs a fix: its fixes as short titles, the finding on its mark's hover.
    const open = check.locator('.sc-card.is-focused');
    expect(await open.getAttribute('data-account')).toBe('x-2');
    expect(await open.locator('.sc-check[data-check="right-account"]').getAttribute('title'))
      .toContain('The keys speak as @sub_voice, not @a_very_long_expected_handle_that_is_wrong.');
    expect(await open.locator('.sc-fix-title').allTextContents()).toContain('Fix the keys or @handle');
    await check.getByRole('button', { name: 'x-3 needs you' }).click();
    expect(await open.getAttribute('data-account')).toBe('x-3');
    expect(await open.locator('.sc-check[data-check="company"]').getAttribute('title')).toContain('It belongs to no company (UNSORTED).');
    expect(await open.locator('.sc-fix-title').allTextContents()).toContain('Pick its company');
    expect(await check.locator('.sc-optional summary').innerText()).toMatch(/OPTIONAL 8 · NOT COUNTED · FOLDED/);

    await check.getByRole('button', { name: 'RECHECK' }).click();
    await expect.poll(() => check.getByRole('button', { name: 'RECHECK' }).isEnabled(), { timeout: 15000 }).toBe(true);
    expect(await check.locator('.settings-h').textContent()).toBe('1 OF 3 ACCOUNTS CLEAR · 8 OPTIONAL');

    // The queue card's LEGAL chip on the being's claim.
    const chip = page.locator('#chips .settings-tag-dim, #chips .settings-tag-warn');
    await chip.first().waitFor({ timeout: 15000 });
    expect(await chip.first().textContent()).toBe('LEGAL · 2 CLAIMS');
    expect(await chip.first().getAttribute('title')).toContain('a comparison to a named product: "faster than X"');
    expect(await page.content()).not.toMatch(/ph-x-/);

    for (const [name, width] of [['1400', 1400], ['760', 760], ['420', 420]]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({ path: path.join(SHOTS, `desk-after-${name}.png`), fullPage: true });
      const overflow = await page.evaluate(() => [...document.querySelectorAll('.sc-card, .social-check-company, .sc-fix')]
        .some((el) => el.scrollWidth > el.clientWidth + 1));
      expect(overflow).toBe(false);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);
});
