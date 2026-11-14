// THE LEAD ENGINE on the COMPANY LINE window — real Chromium, the PRODUCTION
// section, the real /api/v1/revenue routes over a real signed-wallet session,
// and the real lead engine and lead ledger stores on tmp disk. No double
// (RULE 0). The operator reads an audience the Mercator filed, opens a
// company's reasons, approves the pitch and then its list (and the disk says so), sees what is
// due on the lead list, and adds to the do-not-contact list. Screens at two
// widths are written for a person to look at; axe judges the screen.
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
import { fullAuth } from '../helpers/audit-auth.js';
import { a11yCheck } from '../helpers/a11y-scan.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { makeSegment } from '../../backend/services/sales/segment-shape.js';
import { makeProspect } from '../../backend/services/sales/prospect-shape.js';
import { fileSegment, addProspects, readSegments, readSuppressions, readProspects, fileSalesFacts, readSalesFacts } from '../../backend/services/sales/sales-store.js';
import { makeSalesSheet } from '../../backend/services/sales/sales-facts.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = path.join(os.tmpdir(), 'neuma-lead-engine-shots');
let tmp; let vite; let server; let browser; let auth; let savedRealm; let segment;

const score = (criterion, n, why) => ({ criterion, score: n, reasoning: why });

beforeAll(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lead-engine-ui-')));
  savedRealm = getRealmRoot();
  setRealmRoot(path.join(tmp, 'realm'));
  auth = await fullAuth();
  const now = new Date().toISOString();
  segment = makeSegment({
    name: 'Non-developer founders', offer: 'One-to-one coaching to build your own product with AI tools',
    customerProblem: 'They know what to build and cannot build it', targetRole: 'Founder', targetGeography: 'United States, United Kingdom',
    targetCompanySize: '1–10', positiveCriteria: ['Building a software product', 'Founder is not a developer'], negativeCriteria: ['Software agency'],
    exampleClients: ['Smart Maintenance Systems'], why: 'Raw AI tools leave them with half-built parts', by: 'merc', now,
  });
  await fileSegment(auth.address, segment);
  const found = (domain, a, b, people = []) => makeProspect({
    segment, domain, name: domain.split('.')[0], source: `https://${domain}/`, by: 'merc', now, people,
    scores: [score('Building a software product', a, `their site says a field app is in beta (${a})`), score('Founder is not a developer', b, `the about page says twenty years as a welder (${b})`)],
  });
  await addProspects(auth.address, [
    found('weakfit.co', 3, 2),
    found('harbourapp.co.uk', 5, 4, [{ name: 'Ada Lovelace', role: 'Founder', sourceUrl: 'https://harbourapp.co.uk/team' }]),
  ]);
  await fileSalesFacts(auth.address, makeSalesSheet({ by: 'merc', now, facts: [
    { claim: 'One-to-one sessions with the founder, 60 minutes', figure: { value: 60, unit: 'minutes' }, source: 'https://ignislabs.ai/sessions' },
    { claim: 'A session costs 250 US dollars an hour', figure: { value: 250, unit: 'USD' }, source: 'https://ignislabs.ai/sessions' },
    { claim: 'A customer launched his own product after the sessions', source: 'customer: Darren, by email, 2026-10' },
  ] }));
  const ledger = await leadLedgerFor(auth.address);
  const lead = await ledger.add({ name: 'Grace Hopper', contact: 'grace@navy.example', channelId: 'email', status: 'contacted', addedBy: 'merc' });
  await ledger.touch(lead.id, { status: 'replied', note: 'asked for the price', by: 'operator' });

  const { default: revenue } = await import('../../backend/routes/revenue-routes.js');
  const web = express();
  web.use(express.json());
  web.use('/api/v1/revenue', revenue);
  vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(tmp, 'vite-cache'), appType: 'custom', esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/lead-engine-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  web.get('/', (req, res) => res.type('html').send(
    `<!doctype html><html><body style="background:#000"><script>window.leadEngineFixture=${JSON.stringify({ token: auth.token })}</script><div id="root"></div><script type="module" src="/test/helpers/lead-engine-page.jsx"></script></body></html>`,
  ));
  web.use(vite.middlewares);
  server = http.createServer(web);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  await fs.mkdir(SHOTS, { recursive: true });
}, 180000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  setRealmRoot(savedRealm);
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}, 30000);

const open = async (width) => {
  const context = await browser.newContext({ viewport: { width, height: 1100 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('[data-segment-id]').first().waitFor({ timeout: 60000 });
  return { page, errors };
};

describe('THE LEAD ENGINE section — read the pitch, see the reasons, approve it, keep the list clean', () => {
  it('approves a draft pitch on disk, shows every score with its reason, lists what is due, and holds the do-not-contact list', async () => {
    const { page, errors } = await open(1280);
    const row = page.locator(`[data-segment-id="${segment.id}"]`);
    expect(await row.getAttribute('data-segment-state')).toBe('draft');
    expect(await row.locator('[data-state-words]').textContent()).toBe('DRAFT — WAITS FOR YOUR APPROVAL');
    expect(await row.textContent()).toContain('REACH: Founder · WHERE: United States, United Kingdom · SIZE: 1–10');
    expect(await row.locator('[data-pool-counts]').textContent()).toBe('COMPANIES: 2 — STRONG 1 · WEAK 1 · NO MATCH 0 · ON THE LEAD LIST 0');
    // Strongest first; the reasons fold one press away, opened by keyboard.
    const firstCompany = row.locator('[data-prospect-id]').first();
    expect(await firstCompany.locator('summary').textContent()).toBe('harbourapp (harbourapp.co.uk) — STRONG MATCH — Ada Lovelace, Founder');
    await firstCompany.locator('summary').focus();
    await page.keyboard.press('Enter');
    expect(await firstCompany.textContent()).toContain('Founder is not a developer — 4/5: the about page says twenty years as a welder (4)');
    // What is due on the lead list.
    expect(await page.locator('[data-upkeep="answer"]').textContent()).toBe('Grace Hopper — REPLIED — WAITING FOR AN ANSWER');
    // The facts sheet waits for the operator: every fact with its source.
    expect(await page.locator('[data-facts-state]').textContent()).toBe('WAITS FOR YOUR APPROVAL');
    expect(await page.locator('[data-fact]').count()).toBe(3);
    expect(await page.locator('[data-fact="2"]').textContent()).toBe('A session costs 250 US dollars an hour [250 USD] — https://ignislabs.ai/sessions');
    const scanned = await a11yCheck(page, 'lead-engine', { include: '[data-lead-engine]' });
    expect(scanned.grown, scanned.detail).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, 'draft-1280.png'), fullPage: true });

    // RETURN needs a reason; APPROVE lands on disk and the sheet's buttons go.
    expect(await page.getByRole('button', { name: 'RETURN' }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'APPROVE THE FACTS' }).click();
    await page.locator('[data-facts-state]').filter({ hasText: 'APPROVED — EMAILS TO LEADS ARE CHECKED AGAINST IT' }).waitFor();
    expect((await readSalesFacts(auth.address)).approved?.facts).toHaveLength(3);
    expect(await page.getByRole('button', { name: 'APPROVE THE FACTS' }).count()).toBe(0);

    await row.getByRole('button', { name: `APPROVE ${segment.name}` }).click();
    await page.locator(`[data-segment-id="${segment.id}"][data-segment-state="approved"]`).waitFor();
    expect(await page.locator('[data-engine-notice]').textContent()).toBe(`"${segment.name}" is approved.`);
    expect((await readSegments(auth.address))[0]).toMatchObject({ state: 'approved', stateBy: 'operator' });
    expect(await row.getByRole('button', { name: `PAUSE ${segment.name}` }).count()).toBe(1);

    // The list, approved once: both matches go on it, each marked, and the disk says so.
    const listButton = row.locator('[data-list-approve]').getByRole('button');
    expect(await listButton.textContent()).toBe('APPROVE THE LIST (2)');
    expect(await row.locator('[data-list-approve]').textContent()).toContain('20 a day. Replies still come to you.');
    await listButton.click();
    await page.locator('[data-engine-notice]').filter({ hasText: `2 companies on "${segment.name}" approved for outreach.` }).waitFor();
    expect(await row.locator('[data-list-approve]').count()).toBe(0);
    expect(await row.locator('[data-listed]').count()).toBe(2);
    expect((await readProspects(auth.address)).every((p) => p.listApproved)).toBe(true);

    // The do-not-contact list: a malformed entry cannot be sent; a domain lands on disk and on screen.
    const field = page.getByLabel('Email address or company domain never to contact');
    const add = page.locator('[data-suppress-form]').getByRole('button', { name: 'ADD' });
    await field.fill('not an address');
    expect(await add.isDisabled()).toBe(true);
    await field.fill('rival.example');
    await add.click();
    await page.locator('[data-engine-notice]').filter({ hasText: 'rival.example is on the do-not-contact list.' }).waitFor();
    expect(await readSuppressions(auth.address)).toEqual([expect.objectContaining({ kind: 'domain', value: 'rival.example', reason: 'asked', by: 'operator' })]);
    expect(await page.locator('[data-lead-engine] .cline-h').last().textContent()).toBe('DO NOT CONTACT · 1');
    await page.screenshot({ path: path.join(SHOTS, 'approved-1280.png'), fullPage: true });
    expect(errors).toEqual([]);
    await page.context().close();
  }, 120000);

  it('a narrow window still reads every audience and company without sideways scrolling', async () => {
    const { page, errors } = await open(420);
    expect(await page.locator('[data-prospect-id]').count()).toBe(2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, 'narrow-420.png'), fullPage: true });
    await page.context().close();
  }, 60000);
});
