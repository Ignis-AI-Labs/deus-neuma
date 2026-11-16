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
import { readModels } from '../../backend/services/positions/business-model.js';
import { readSpend } from '../../backend/services/sales/lead-spend.js';
import { houseSeatingIntent } from '../../backend/services/intents/house-seating.js';
import { readSeating } from '../../backend/services/positions/position-seating.js';

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
    // Every row reads the same way: the seat, then its short form, its title and who holds it.
    expect(await rail(page, /CHIEF LEGAL OFFICER/).textContent()).toContain('CLO · Praetor · NOBODY');

    await rail(page, /CHIEF REVENUE OFFICER/).click();
    const hub = page.locator('[data-position="cro"]');
    await hub.waitFor();
    expect(await hub.locator('.pos-holder').textContent()).toBe('HELD BY MERC');
    expect(await hub.getByRole('tab').allTextContents()).toEqual(['SETUP · 1/12', 'COMPANY', 'CAMPAIGNS', 'LEADS', 'DEALS', 'MAILBOX', 'SETTINGS · 0/3', 'THEIR EYES']);
    // SETUP leads while the seat is not ready: each step says who does it, and an open one says exactly how.
    const setup = hub.locator('[data-setup-step]');
    expect(await setup.count()).toBe(14);
    expect(await hub.locator('[data-setup-step="seat"] .pos-step-h').textContent()).toBe('DONE — Seat a member as CHIEF REVENUE OFFICER');
    expect(await hub.locator('[data-setup-step="mailbox"]').textContent()).toContain('YOURS — Connect the mailbox the house sends from');
    expect(await hub.locator('[data-setup-step="mailbox"]').textContent()).toContain('myaccount.google.com/apppasswords');
    // A step is one press from its place: GO TO MAILBOX lands on the mailbox tab, and SETUP is still there to come back to.
    await hub.getByRole('button', { name: /^GO TO 2 · ENTER IT IN MAILBOX — Connect the mailbox/ }).click();
    expect(await hub.getByRole('tab', { name: 'MAILBOX' }).getAttribute('aria-selected')).toBe('true');
    await hub.getByRole('tab', { name: /^SETUP/ }).click();
    expect(await hub.locator('[data-setup-step="mailbox"] a').getAttribute('href')).toBe('https://myaccount.google.com/apppasswords');
    await page.screenshot({ path: path.join(SHOTS, 'sales-setup-1280.png'), fullPage: true });
    await hub.getByRole('tab', { name: 'CAMPAIGNS' }).click();
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

    // COMPANY (the business model, then the facts a buyer may be told): the operator who knows the model types it; it stands at once and the setup count is measured again.
    await hub.getByRole('tab', { name: 'COMPANY' }).click();
    const umbrae = hub.locator('[data-model-company="umbrae"]');
    await umbrae.waitFor();
    expect(await umbrae.locator('summary .fold-title').textContent()).toBe('Umbrae');
    expect(await umbrae.locator('summary .fold-stat').allTextContents()).toEqual(['NOT WRITTEN YET']);
    expect(await umbrae.getByRole('button', { name: 'SAVE the business model of Umbrae' }).isDisabled()).toBe(true);
    expect(await umbrae.getByRole('button', { name: /^WORK IT OUT WITH merc/ }).count()).toBe(1);
    const answers = ['A swap venue on Base where anyone opens a pool', 'Token teams on Base; the founder decides', 'Thin liquidity makes every trade cost more', 'Their token trades with less slippage, shown on the pool page', 'Free to open; the venue earns 5% of each swap fee'];
    for (const [i, words] of answers.entries()) await umbrae.locator('textarea').nth(i).fill(words);
    await umbrae.getByRole('button', { name: 'SAVE the business model of Umbrae' }).click();
    await hub.locator('[data-model-company="umbrae"][data-model-state="approved"]').waitFor();
    // Written, it folds to its line and reads as text, not boxes, when opened.
    expect(await umbrae.locator('summary .fold-stat').allTextContents()).toEqual(['APPROVED', '5 OF 7 ANSWERED']);
    expect(await umbrae.locator('textarea').count()).toBe(0);
    expect(await umbrae.locator('[data-model-read] dd').first().textContent()).toBe('A swap venue on Base where anyone opens a pool');
    expect(await hub.locator('[data-model-notice]').textContent()).toBe('The business model of Umbrae is saved and stands.');
    expect((await readModels(auth.address)).get('umbrae').approved.value).toBe('Their token trades with less slippage, shown on the pool page');
    await hub.getByRole('tab', { name: 'SETUP · 3/12' }).waitFor();
    const modelScan = await a11yCheck(page, 'positions-model', { include: '.pos' });
    expect(modelScan.grown, modelScan.detail).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, 'business-model-1280.png'), fullPage: true });

    // Each tab carries only its own data: the facts stand on COMPANY, the audiences on CAMPAIGNS, and LEADS holds leads.
    await hub.locator('[data-lead-engine="facts"]').waitFor({ timeout: 60000 });
    expect(await hub.locator('[data-facts-sheet]').count()).toBe(1);
    // CAMPAIGNS is one flow: a campaign's audiences stand under it, never as a second list of cards.
    await hub.getByRole('tab', { name: 'CAMPAIGNS' }).click();
    await hub.locator('[data-campaign-id] [data-campaign-audiences]').waitFor({ timeout: 60000 });
    expect(await hub.locator('[data-campaign-id] [data-campaign-audiences]').textContent()).toBe('NO AUDIENCE YET — THE SALES SEAT FILES ONE UNDER THIS CAMPAIGN');
    expect(await hub.locator('[data-facts-sheet], [data-paid-lead], [data-suppress-form], [data-lead-engine], [data-campaign-links]').count()).toBe(0);
    await hub.getByRole('tab', { name: 'LEADS' }).click();
    await hub.locator('[data-lead-engine="leads"]').waitFor({ timeout: 60000 });
    expect(await hub.locator('[data-facts-sheet], [data-business-model], [data-sales-campaigns], [data-segment-id]').count()).toBe(0);
    // A setting is not a lead: paid lead data stands on SETTINGS as one switch, never here.
    await hub.locator('[data-fold="leads:list"]').waitFor({ timeout: 60000 });
    expect(await hub.locator('[data-switch-limit], [data-paid-lead]').count()).toBe(0);
    expect(await hub.locator('[data-suppress-form], [data-fold="leads:list"], [data-fold="leads:contacts"]').count()).toBe(3);

    await hub.getByRole('tab', { name: 'DEALS' }).click();
    await hub.locator('[data-sales]').waitFor();
    expect(await hub.locator('[data-sales]').getByRole('button', { name: 'SEAT' }).count()).toBe(0);

    // SETTINGS: everything the position may be switched on or off to use, each one ON/OFF. Paid lead data is one of
    // them, with its monthly limit beside it, and nothing else to choose.
    await hub.getByRole('tab', { name: /SETTINGS/ }).click();
    expect(await hub.locator('[data-switch]').evaluateAll((rows) => rows.map((r) => r.dataset.switch))).toEqual(['mail-watch', 'lead-sources', 'paid-lead-data']);
    expect(isConnectionOn('mail-watch')).toBe(false);
    await hub.getByRole('button', { name: 'OFF — House mailbox watch' }).click();
    await hub.getByRole('tab', { name: 'SETTINGS · 1/3' }).waitFor();
    expect(isConnectionOn('mail-watch')).toBe(true);
    const paid = hub.locator('[data-switch="paid-lead-data"]');
    expect(await paid.locator('.pos-switch-name').textContent()).toBe('Paid lead data');
    expect(await paid.locator('[data-switch-limit]').textContent()).toBe('USED 0 OFCREDITS THIS MONTHSET LIMIT');
    await paid.getByRole('button', { name: 'OFF — Paid lead data' }).click();
    await hub.getByRole('tab', { name: 'SETTINGS · 2/3' }).waitFor();
    expect(await readSpend(auth.address)).toMatchObject({ mode: 'on', on: true, cap: 100, chosen: true });
    await paid.getByLabel('Paid lead data: the most credits a month').fill('250');
    await paid.getByRole('button', { name: 'SET LIMIT for Paid lead data' }).click();
    await paid.locator('[data-switch-limit]').filter({ hasText: 'USED 0 OF' }).waitFor();
    await expect.poll(async () => (await readSpend(auth.address)).cap).toBe(250);
    expect((await readSpend(auth.address)).on).toBe(true);

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
    await rail(page, /CHIEF ACCOUNTING OFFICER/).click();
    const hub = page.locator('[data-position="cao"]');
    await hub.waitFor();
    expect(await hub.locator('.pos-holder').textContent()).toBe('NOBODY HOLDS THIS POSITION');
    expect(await hub.getByRole('button', { name: 'SEAT', exact: true }).isDisabled()).toBe(true);
    await hub.getByRole('button', { name: 'choose who holds it, for the CHIEF ACCOUNTING OFFICER', exact: true }).click();
    await page.getByRole('listbox', { name: 'choose who holds it, for the CHIEF ACCOUNTING OFFICER' }).getByText('books', { exact: true }).click();
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

  // Design note, 2026-11-15: seat them yourself, or hold a seating council where the members decide together.
  it('offers both ways to seat; a seating the members filed is applied seat by seat through each office, then leaves', async () => {
    let { page, errors } = await open(1280);
    const strip = page.getByRole('region', { name: 'seating your house' });
    await strip.waitFor();
    expect(await strip.locator('.pos-seating-way b').allTextContents()).toEqual(['SEAT THEM YOURSELF', 'HOLD A SEATING COUNCIL · RECOMMENDED']);
    expect(errors).toEqual([]);
    await page.context().close();

    // a member files what the house decided, through the real act (house/seating): it seats nobody
    const connection = { walletAddress: auth.address, companion: { neumaId: 'merc', name: 'merc' } };
    const refused = await houseSeatingIntent.validate({ seats: { BOOKS: 'merc', SALES: 'merc' }, why: 'x' }, { connection });
    expect(refused).toMatchObject({ ok: false, reason: expect.stringContaining('one member holds one position') });
    const judged = await houseSeatingIntent.validate({ seats: { books: 'books', Mercator: 'merc' }, why: 'Merc keeps sales; books takes the ledger it already keeps.' }, { connection });
    expect(judged.ok).toBe(true);
    await houseSeatingIntent.execute(judged.value);
    expect(await caoDesignation.getOfficer(auth.address)).toBe(null);

    ({ page, errors } = await open(1280));
    const filed = page.locator('.pos-seating-filed');
    await filed.waitFor();
    expect(await filed.locator('.pos-h').textContent()).toBe("THE HOUSE'S SEATING · FILED BY MERC");
    expect(await filed.locator('li').allTextContents()).toEqual(['CHIEF REVENUE OFFICER · CRO · Mercatormerc (already)', 'CHIEF ACCOUNTING OFFICER · CAO · Logistabooks']);
    await page.screenshot({ path: path.join(SHOTS, 'seating-filed-1280.png'), fullPage: true });
    await filed.getByRole('button', { name: 'APPLY THE SEATING' }).click();
    await page.locator('.pos-seating-ways').waitFor();
    expect((await caoDesignation.getOfficer(auth.address)).laneId).toBe('books');
    expect((await croDesignation.getOfficer(auth.address)).laneId).toBe('merc');
    expect(await readSeating(auth.address)).toBe(null);
    expect(errors).toEqual([]);
    await page.context().close();
  }, 240000);
});
