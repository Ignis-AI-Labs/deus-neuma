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
    company: 'ignis', customerProblem: 'They know what to build and cannot build it', targetRole: 'Founder', targetGeography: 'United States, United Kingdom', countries: ['US', 'GB'],
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
    { company: 'ignis', claim: 'One-to-one sessions with the founder, 60 minutes', figure: { value: 60, unit: 'minutes' }, source: 'https://ignislabs.ai/sessions' },
    { company: 'ignis', claim: 'A session costs 250 US dollars an hour', figure: { value: 250, unit: 'USD' }, source: 'https://ignislabs.ai/sessions' },
    { company: 'ignis', claim: 'A customer launched his own product after the sessions', source: 'customer: Darren, by email, 2026-10' },
  ] }));
  const ledger = await leadLedgerFor(auth.address);
  const lead = await ledger.add({ name: 'Grace Hopper', contact: 'grace@navy.example', channelId: 'email', kind: 'buyer', status: 'contacted', addedBy: 'merc' });
  await ledger.touch(lead.id, { direction: 'out', promised: 'two short written ideas on a field app', note: 'emailed: "Your field app"', by: 'merc' });
  await ledger.touch(lead.id, { status: 'replied', direction: 'in', note: 'asked for the price', by: 'operator' });

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
    // The audience reads as marks: who and where as chips, the pool as count tiles, the signs of a fit as a ticked list.
    expect(await row.locator('.cline-aud-chips').filter({ hasText: 'REACH' }).locator('.cline-chip').allTextContents()).toEqual(['Founder']);
    expect(await row.locator('[data-countries] .cline-chip').allTextContents()).toEqual(['US', 'GB']);
    expect(await row.locator('.cline-aud-chips').filter({ hasText: 'SIZE' }).locator('.cline-chip').allTextContents()).toEqual(['1–10']);
    expect(await row.locator('[data-pool-counts] .cline-tile-l').allTextContents()).toEqual(['COMPANIES', 'STRONG', 'WEAK', 'NO MATCH', 'ON THE LEAD LIST']);
    expect(await row.locator('[data-pool-counts] .cline-tile-n').allTextContents()).toEqual(['2', '1', '1', '0', '0']);
    expect(await row.getByRole('list', { name: 'fits if' }).locator('li').count()).toBeGreaterThan(0);
    // Strongest first; the reasons fold one press away, opened by keyboard.
    const firstCompany = row.locator('[data-prospect-id]').first();
    expect(await firstCompany.locator('summary').textContent()).toBe('harbourapp (harbourapp.co.uk) — STRONG MATCH — Ada Lovelace, Founder');
    await firstCompany.locator('summary').focus();
    await page.keyboard.press('Enter');
    expect(await firstCompany.textContent()).toContain('Founder is not a developer — 4/5: the about page says twenty years as a welder (4)');
    // What is due on the lead list.
    const grace = page.locator('[data-person]').filter({ hasText: 'Grace Hopper' });
    expect((await grace.locator('[data-upkeep="answer"]').textContent()).trim()).toBe('ANSWER OWED (0 H)');
    expect(await grace.locator('[data-lead-status]').textContent()).toBe('THEY WROTE');
    expect(await grace.locator('[data-upkeep="answer"]').getAttribute('title')).toContain('PROMISED: two short written ideas on a field app');
    // One person, one line: a sheet row with a cell for each fact.
    expect(await page.locator('[data-sheet="people"] thead th').allTextContents()).toEqual(['NAME', 'COMPANY', 'TITLE', 'CAMPAIGN', 'EMAIL OR REACH', 'PROOF', 'FILED AS', 'STANDS', 'FROM', 'DUE']);
    expect(await grace.locator('[data-person-reach]').textContent()).toBe('grace@navy.example');
    expect(await page.locator('[data-people-stat]').first().textContent()).toMatch(/ACTIVE LEAD/);
    // The facts sheet waits for the operator: every fact with its source.
    expect(await page.locator('[data-facts-state]').textContent()).toBe('WAITS FOR YOUR APPROVAL');
    expect(await page.locator('[data-fact]').count()).toBe(3);
    // A section is a line first: the sheet and each company carry their counts on the line, open while they wait on you.
    expect(await page.locator('[data-fold="company:facts"] > summary .fold-stat').allTextContents()).toEqual(['3 FACTS', 'WAITS FOR YOUR APPROVAL']);
    expect(await page.locator('[data-fold="facts:ignis"] > summary .fold-title').textContent()).toBe('IGNIS AI LABS');
    expect(await page.locator('[data-fold="facts:ignis"] > summary .fold-stat').allTextContents()).toEqual(['3 FACTS', '0 CHECKED']);
    expect(await page.locator('[data-fold="company:facts"]').getAttribute('open')).not.toBe(null);
    expect(await page.locator('[data-fact="2"] .cline-fact-claim').textContent()).toBe('A session costs 250 US dollars an hour');
    expect(await page.locator('[data-fact="2"] .cline-fact-figure').textContent()).toBe('250 USD');
    expect(await page.locator('[data-sheet^="facts about"]').first().locator('thead th').allTextContents()).toEqual(['#', 'OK', 'WHAT MAY BE SAID', 'FIGURE', 'SOURCE', 'STANDS', 'CHANGE']);
    expect(await page.locator('[data-fact="2"] .cline-fact-source').textContent()).toBe('https://ignislabs.ai/sessions');
    // One fact is rewritten in place: a new sheet stands on disk, still waiting, the figure and source kept.
    await page.getByRole('button', { name: 'EDIT fact 2' }).click();
    await page.getByLabel('Fact 2, the words').fill('A session costs 250 US dollars for one hour');
    await page.getByRole('button', { name: 'SAVE fact 2' }).click();
    await page.locator('[data-fact="2"] .cline-fact-claim').filter({ hasText: 'for one hour' }).waitFor();
    expect((await readSalesFacts(auth.address)).sheet).toMatchObject({ by: 'operator', facts: [{}, { claim: 'A session costs 250 US dollars for one hour', figure: { value: 250, unit: 'USD' }, source: 'https://ignislabs.ai/sessions' }, {}] });
    // A sheet holds at least three facts: taking one of three off is refused in words.
    await page.getByRole('button', { name: 'DELETE fact 3' }).click();
    await page.getByRole('button', { name: 'PRESS AGAIN TO DELETE fact 3' }).click();
    await page.getByRole('alert').filter({ hasText: 'a sheet holds at least three facts' }).waitFor();
    expect(await page.locator('[data-fact]').count()).toBe(3);
    const scanned = await a11yCheck(page, 'lead-engine', { include: '[data-lead-engine]' });
    expect(scanned.grown, scanned.detail).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, 'draft-1280.png'), fullPage: true });

    // One bar over the sheet. RETURN ALL needs a reason; nothing ticked, so APPROVE CHECKED waits.
    const bar = page.locator('[data-facts-bar]');
    expect(await bar.getByRole('button', { name: /^RETURN ALL/ }).isDisabled()).toBe(true);
    expect(await bar.locator('[data-facts-checked]').textContent()).toBe('0 OF 3 CHECKED');
    expect(await bar.getByRole('button', { name: /^APPROVE CHECKED/ }).isDisabled()).toBe(true);
    expect(await bar.getByRole('button', { name: /^APPROVE ALL \(3\)/ }).isEnabled()).toBe(true);
    // Two facts ticked and approved: they stand on disk; the third goes back to the seat to fix.
    await page.getByLabel('Approve fact 1').check();
    await page.getByLabel('Approve fact 2').check();
    expect(await bar.locator('[data-facts-checked]').textContent()).toBe('2 OF 3 CHECKED');
    await bar.getByRole('button', { name: /^APPROVE CHECKED \(2\) · REST GO BACK — the other 1 go/ }).click();
    await page.locator('[data-facts-state]').filter({ hasText: 'APPROVED — EMAILS TO LEADS ARE CHECKED AGAINST IT' }).waitFor();
    expect(await page.locator('[data-facts-review]').textContent()).toBe('2 APPROVED · 1 SENT BACK TO FIX');
    expect(await page.locator('[data-fact="3"]').getAttribute('data-fact-standing')).toBe('held');
    expect(await page.locator('[data-fact="1"]').getAttribute('data-fact-standing')).toBe('approved');
    const stands = await readSalesFacts(auth.address);
    expect([stands.approved.facts.map((f) => f.n), stands.review.held.map((f) => f.n)]).toEqual([[1, 2], [3]]);
    expect(await page.locator('[data-facts-bar]').count()).toBe(0);
    // Decided, its line says what stands and what went back; it does not fold under the operator's hands,
    // and one press folds it to that line.
    expect(await page.locator('[data-fold="company:facts"] > summary .fold-stat').allTextContents()).toEqual(['3 FACTS', '2 APPROVED · 1 SENT BACK']);
    expect(await page.locator('[data-fold="company:facts"]').getAttribute('open')).not.toBe(null);
    await page.locator('[data-fold="company:facts"] > summary').click();
    expect(await page.locator('[data-fold="company:facts"]').getAttribute('open')).toBe(null);
    expect(await page.locator('[data-fact="1"]').isVisible()).toBe(false);
    const after = await a11yCheck(page, 'lead-engine-reviewed', { include: '[data-lead-engine]' });
    expect(after.grown, after.detail).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, 'reviewed-1280.png'), fullPage: true });

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
    expect(await page.locator('[data-fold="leads:dnc"] > summary .fold-stat').allTextContents()).toEqual(['0 ENTRIES']);
    await page.locator('[data-fold="leads:dnc"] > summary').click();
    const field = page.getByLabel('Email address or company domain never to contact');
    const add = page.locator('[data-suppress-form]').getByRole('button', { name: 'ADD' });
    await field.fill('not an address');
    expect(await add.isDisabled()).toBe(true);
    await field.fill('rival.example');
    await add.click();
    await page.locator('[data-engine-notice]').filter({ hasText: 'rival.example is on the do-not-contact list.' }).waitFor();
    expect(await readSuppressions(auth.address)).toEqual([expect.objectContaining({ kind: 'domain', value: 'rival.example', reason: 'asked', by: 'operator' })]);
    // The notice is said before the fresh read lands: wait for the count itself.
    await page.locator('[data-fold="leads:dnc"] > summary .fold-stat').filter({ hasText: '1 ENTRY' }).waitFor();
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
