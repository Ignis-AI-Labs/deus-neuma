// THE POSITIONS WINDOW — real Chromium, the PRODUCTION board and panels, the
// real /api/v1 routes over a real signed-wallet session, a real house on tmp
// disk. No double (RULE 0). The operator sees every position, opens SALES and
// finds its lead engine in place, turns on the switch it needs (the disk says
// so), reads what the Mercator is told, then seats and unseats the books from
// the one control. Screens at two widths; axe judges the screen.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer as createVite } from 'vite';
import { chromium } from '@playwright/test';
import { fullAuth } from '../helpers/audit-auth.js';
import { a11yCheck } from '../helpers/a11y-scan.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { croDesignation } from '../../backend/services/revenue/cro-designation.js';
import { caoDesignation } from '../../backend/services/accounts/cao-designation.js';
import { isConnectionOn } from '../../backend/services/connections/connection-switches.js';
import { readCampaigns } from '../../backend/services/sales/sales-store.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = path.join(os.tmpdir(), 'neuma-positions-shots');
const PRIOR = { root: getWorkspacesRoot(), key: process.env.DNA_ENCRYPTION_KEY, switches: process.env.NEUMA_CONNECTIONS_PATH, data: process.env.NEUMA_DATA_ROOT };
let tmp; let vite; let server; let browser; let auth; let savedRealm;

beforeAll(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'positions-ui-')));
  savedRealm = getRealmRoot();
  setRealmRoot(path.join(tmp, 'realm'));
  process.env.DNA_ENCRYPTION_KEY = 'positions-ui-test-key';
  process.env.NEUMA_CONNECTIONS_PATH = path.join(tmp, 'connections.json');
  process.env.NEUMA_DATA_ROOT = path.join(tmp, 'data');
  const wsRoot = path.join(tmp, 'workspaces');
  setWorkspacesRoot(wsRoot);
  auth = await fullAuth();
  for (const [i, id] of ['merc', 'books'].entries()) {
    await workspace.create(id);
    await fs.writeFile(path.join(wsRoot, id, 'owner.json'), JSON.stringify({ wallet: auth.address, claimedAt: 1 }));
    await fs.mkdir(path.join(wsRoot, id, 'identity'), { recursive: true });
    await fs.writeFile(path.join(wsRoot, id, 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: `0x${String(i + 1).padStart(40, 'e')}` }));
  }
  await croDesignation.designate(auth.address, 'merc');
  // The switches are the install owner's to flip (connection-routes.js): this house's operator is that owner.
  await (await import('../../backend/services/install-owner.js')).recordFirstLocalOwner(auth.address);

  const web = express();
  web.use(express.json());
  for (const [mount, file] of [['positions', 'positions-routes'], ['revenue', 'revenue-routes'], ['accounts', 'accounts-routes'], ['connections', 'connection-routes']]) {
    web.use(`/api/v1/${mount}`, (await import(`../../backend/routes/${file}.js`)).default);
  }
  vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(tmp, 'vite-cache'), appType: 'custom', esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/positions-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  web.get('/', (req, res) => res.type('html').send(
    `<!doctype html><html><body style="background:#000;margin:0"><script>window.positionsFixture=${JSON.stringify({ token: auth.token })}</script><div id="root"></div><script type="module" src="/test/helpers/positions-page.jsx"></script></body></html>`,
  ));
  web.use(vite.middlewares);
  server = http.createServer(web);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  await fs.mkdir(SHOTS, { recursive: true });
}, 240000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  setRealmRoot(savedRealm);
  setWorkspacesRoot(PRIOR.root);
  for (const [name, value] of [['DNA_ENCRYPTION_KEY', PRIOR.key], ['NEUMA_CONNECTIONS_PATH', PRIOR.switches], ['NEUMA_DATA_ROOT', PRIOR.data]]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}, 30000);

const open = async (width) => {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('[data-position]').waitFor({ timeout: 120000 });
  return { page, errors };
};
const rail = (page, name) => page.getByRole('navigation', { name: 'house positions' }).getByRole('button', { name });

describe('THE POSITIONS WINDOW — every position in one place, each with everything it handles', () => {
  it('shows who holds what, opens SALES on its lead engine, flips its switch on disk and shows what the Mercator is told', async () => {
    const { page, errors } = await open(1280);
    const nav = page.getByRole('navigation', { name: 'house positions' });
    expect(await nav.getByRole('button').count()).toBe(7);
    expect(await nav.locator('.pos-h').textContent()).toBe('1/7 HELD · 0 WAITING ON YOU');
    expect(await rail(page, /LAW/).textContent()).toContain('CLO · NOBODY');

    await rail(page, /SALES/).click();
    const hub = page.locator('[data-position="cro"]');
    await hub.waitFor();
    expect(await hub.locator('.pos-holder').textContent()).toBe('HELD BY MERC');
    expect(await hub.getByRole('tab').allTextContents()).toEqual(['CAMPAIGNS', 'LEADS', 'DEALS', 'MAILBOX', 'SWITCHES · 0/2', 'THEIR EYES']);
    // CAMPAIGNS opens first: the operator opens one, and it stands on disk with every count at zero.
    const campaigns = hub.locator('[data-sales-campaigns]');
    await campaigns.waitFor({ timeout: 60000 });
    expect(await campaigns.getByRole('button', { name: 'OPEN the campaign' }).isDisabled()).toBe(true);
    await campaigns.getByLabel('Campaign name').fill('User acquisition');
    await campaigns.getByRole('button', { name: 'company the campaign is for', exact: true }).click();
    await page.getByRole('listbox', { name: 'company the campaign is for' }).getByText('Umbrae', { exact: true }).click();
    await campaigns.getByLabel('What the campaign is meant to bring in').fill('Teams with a token on Base opening a pool on Umbrae');
    await campaigns.getByRole('button', { name: 'OPEN the campaign' }).click();
    const card = campaigns.locator('[data-campaign-id]');
    await card.waitFor();
    expect(await card.locator('.cline-h').textContent()).toBe('User acquisition · FOR UMBRAE · OPEN');
    expect(await card.locator('[data-campaign-funnel] .cline-tile-l').allTextContents()).toEqual(['GATHERED', 'SCORED', 'LEADS', 'WRITTEN', 'REPLIED', 'QUALIFIED', 'WON']);
    expect(await card.locator('[data-campaign-funnel] .cline-tile-n').allTextContents()).toEqual(['0', '0', '0', '0', '0', '0', '0']);
    expect((await readCampaigns(auth.address)).map((c) => [c.name, c.company, c.state])).toEqual([['User acquisition', 'umbrae', 'open']]);
    await page.screenshot({ path: path.join(SHOTS, 'sales-campaigns-1280.png'), fullPage: true });

    await hub.getByRole('tab', { name: 'LEADS' }).click();
    await hub.locator('[data-lead-engine]').waitFor({ timeout: 60000 });

    await hub.getByRole('tab', { name: 'DEALS' }).click();
    await hub.locator('[data-sales]').waitFor();
    expect(await hub.locator('[data-sales]').getByRole('button', { name: 'SEAT' }).count()).toBe(0);

    await hub.getByRole('tab', { name: /SWITCHES/ }).click();
    expect(isConnectionOn('mail-watch')).toBe(false);
    await hub.getByRole('button', { name: 'OFF' }).first().click();
    await hub.getByRole('tab', { name: 'SWITCHES · 1/2' }).waitFor();
    expect(isConnectionOn('mail-watch')).toBe(true);

    await hub.getByRole('tab', { name: 'THEIR EYES' }).click();
    const eyes = hub.locator('.pos-eyes');
    await eyes.waitFor();
    expect(await eyes.textContent()).toMatch(/^## YOUR POSITION/);
    expect(await eyes.textContent()).toContain('## MERCATOR OFFICE');
    const scanned = await a11yCheck(page, 'positions', { include: '.pos' });
    expect(scanned.grown, scanned.detail).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, 'sales-eyes-1280.png'), fullPage: true });
    expect(errors).toEqual([]);
    await page.context().close();
  }, 240000);

  it('seats and unseats a position from the one control, and the house record follows', async () => {
    const { page, errors } = await open(700);
    await rail(page, /BOOKS/).click();
    const hub = page.locator('[data-position="cao"]');
    await hub.waitFor();
    expect(await hub.locator('.pos-holder').textContent()).toBe('NOBODY HOLDS THIS POSITION');
    expect(await hub.getByRole('button', { name: 'SEAT', exact: true }).isDisabled()).toBe(true);
    await hub.getByRole('button', { name: 'choose who holds it, for BOOKS', exact: true }).click();
    await page.getByRole('listbox', { name: 'choose who holds it, for BOOKS' }).getByText('books', { exact: true }).click();
    await hub.getByRole('button', { name: 'SEAT', exact: true }).click();
    await hub.locator('.pos-holder').filter({ hasText: 'HELD BY BOOKS' }).waitFor();
    expect((await caoDesignation.getOfficer(auth.address)).laneId).toBe('books');
    await page.screenshot({ path: path.join(SHOTS, 'books-held-700.png'), fullPage: true });

    await hub.getByRole('button', { name: 'UNSEAT', exact: true }).click();
    expect((await caoDesignation.getOfficer(auth.address)).laneId).toBe('books');
    await hub.getByRole('button', { name: 'PRESS AGAIN TO UNSEAT' }).click();
    await hub.locator('.pos-holder').filter({ hasText: 'NOBODY HOLDS THIS POSITION' }).waitFor();
    expect(await caoDesignation.getOfficer(auth.address)).toBe(null);
    expect(errors).toEqual([]);
    await page.context().close();
  }, 240000);
});
