// The CMO proposes a company's links; the operator approves each change
// (2026-10-24) — real Chromium: the PRODUCTION SITE & CODE panel and the
// PRODUCTION house social check, each inside the production WindowManager,
// against the real routes over a real signed-wallet session and the real
// stores on tmp disk (marketing-office-kit.js). The CMO's proposal is filed
// through the REAL intent sweep. No double (RULE 0); placeholder keys only.
// Proven: the card shows the change before → after with its AWAITING mark,
// waits while the pointer is on the panel (calm gate), and APPROVE writes it
// through the company route — the new repo listed, its reading still the
// operator's own press; the social check's […] and the
// panel's empty state HAND TO the CMO, the ask drafted and nothing sent;
// nothing under 13px on the card.
/* global document, window, getComputedStyle */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { URL } from 'node:url';
import { startMarketingOffice, stopMarketingOffice } from '../helpers/marketing-office-kit.js';
import { viaIntent } from '../helpers/intent-path.js';
import { pinSocialKeysEmpty } from '../helpers/no-social-keys.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { listCompanies } from '../../backend/services/marketing/companies.js';

const SHOTS = path.join(os.tmpdir(), 'neuma-cmo-company-links-shots');
const CMO = 'kestrel';
const run = promisify(execFile);
let ctx; let siteRepo;

// impure — a real git repository (the company's site), so the panel reads it as one.
const initRepo = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'f@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'f@example.invalid' };
  await run('git', ['init', '-q', dir]);
  await fs.writeFile(path.join(dir, 'README.md'), '# the site\n');
  await run('git', ['add', '-A'], { cwd: dir, env });
  await run('git', ['commit', '-q', '-m', 'the site'], { cwd: dir, env });
  return fs.realpath(dir);
};

beforeAll(async () => {
  pinSocialKeysEmpty();
  ctx = await startMarketingOffice('cmo-company-links-');
  await cmoDesignation.designate(ctx.auth.address, CMO);
  siteRepo = await initRepo(path.join(ctx.tmp, 'repos', 'northwind-site'));
  await fs.mkdir(SHOTS, { recursive: true });
}, 180000);

afterAll(async () => { await stopMarketingOffice(ctx); }, 30000);

const company = async (id) => (await listCompanies(ctx.auth.address)).find((c) => c.id === id);
const propose = (payload) => viaIntent({ walletAddress: ctx.auth.address, companion: { name: CMO, neumaId: CMO }, toolMode: 'ask' }, 'marketing/company-links', payload);

// impure — a page on the kit's origin; every API request from `track()` on is recorded.
const openPage = async (route, html, ready) => {
  const page = await (await ctx.browser.newContext()).newPage();
  await page.setViewportSize({ width: 1280, height: 1100 });
  const errors = [];
  const asked = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const track = () => {
    page.on('request', (r) => { if (r.url().includes('/api/')) asked.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    page.on('websocket', (ws) => asked.push(`WS ${ws.url()}`));
  };
  await page.route(`**/${route}`, (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(ctx.url(route));
  await page.locator(ready).first().waitFor({ timeout: 60000 });
  return { page, errors, asked, track };
};
const sourcesPage = (companyId) => {
  const fixture = JSON.stringify({ token: ctx.auth.token, wallet: ctx.auth.address, companyId, roster: [{ neumaId: CMO, name: 'Kestrel' }] });
  return openPage(`cmo-links-${companyId}`,
    `<!doctype html><html><body style="background:#000"><script>window.linksFixture=${fixture}</script><div id="root"></div><script type="module" src="/test/helpers/cmo-company-links-page.jsx"></script></body></html>`,
    `[data-company-sources="${companyId}"]`);
};

/** In the page: visible text under 13px inside one element. */
const smallIn = (selector) => [...document.querySelectorAll(`${selector} *`)]
  .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && el.getClientRects().length)
  .map((el) => ({ text: el.textContent.trim().slice(0, 40), size: parseFloat(getComputedStyle(el).fontSize) }))
  .filter((t) => t.size < 13);

describe('HAND TO the CMO — the ask drafted in its chat, nothing sent', () => {
  it('SITE & CODE\'s empty state hands what is missing to the CMO', async () => {
    const { page, errors, asked, track } = await sourcesPage('brookmere');
    track();
    await page.getByRole('button', { name: 'HAND TO KESTREL' }).click();
    const composer = page.locator('[data-window-id^="chat#"] [data-composer]');
    await composer.waitFor({ timeout: 15000 });
    expect(await composer.getAttribute('data-neuma')).toBe(CMO);
    const draft = await composer.locator('textarea').inputValue();
    expect(draft).toContain('Brookmere (brookmere) has no site and no code repositories on record');
    expect(draft).toContain('marketing/company-links (company: brookmere)');
    expect(draft).toContain('I will approve the change in WAITING ON YOU.');
    expect(await page.locator('.bk-lc-hand .door-handed').innerText()).toBe('DRAFTED · KESTREL');
    await page.waitForTimeout(500);
    expect(asked.filter((a) => !a.startsWith('GET '))).toEqual([]);
    expect((await company('brookmere')).site.url).toBeNull();
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('the house social check\'s "Add the company site" hands to the CMO', async () => {
    const fixture = JSON.stringify({ token: ctx.auth.token, wallet: ctx.auth.address });
    const { page, errors, asked, track } = await openPage('social-check-doors',
      `<!doctype html><html><body style="background:#000"><script>window.doorsFixture=${fixture}</script><div id="root"></div><script type="module" src="/test/helpers/social-check-doors-page.jsx"></script></body></html>`,
      '#check .sc-card');
    // The core account: its company has no site on record yet (this runs before the card's APPROVE records one).
    const card = page.locator('#check .sc-card[data-account="x-1"]');
    await card.locator('.sc-card-head').click();
    const fix = card.locator('.sc-fix', { hasText: 'Add the company site' });
    await fix.waitFor({ timeout: 15000 });
    track();
    await fix.getByRole('button', { name: 'HAND TO KESTREL' }).click();
    const composer = page.locator('[data-window-id^="chat#"] [data-composer]');
    await composer.waitFor({ timeout: 15000 });
    expect(await composer.getAttribute('data-neuma')).toBe(CMO);
    const draft = await composer.locator('textarea').inputValue();
    expect(draft).toContain('no site on record for Northwind (northwind)');
    expect(draft).toContain('marketing/company-links (company: northwind, site:');
    expect(draft).toContain('I will approve the change in WAITING ON YOU.');
    await page.waitForTimeout(500);
    expect(asked.filter((a) => !a.startsWith('GET '))).toEqual([]);
    expect((await company('northwind')).site.url).toBeNull();
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);
});

describe('the CMO proposes; the operator approves on the card', () => {
  it('the card arrives only when the pointer leaves, shows before → after, and APPROVE writes it', async () => {
    const { page, errors } = await sourcesPage('northwind');
    const panel = page.locator('[data-company-sources="northwind"]');
    expect(await page.locator('[data-link-change-id]').count()).toBe(0);
    // The operator is at the panel when the CMO's proposal lands: it waits for them to leave.
    await panel.hover();
    const [receipt] = await propose({
      company: 'northwind', site: 'https://www.northwind.example/',
      repos: [{ remote: 'https://github.com/northwind/app', role: 'the app' }, { path: siteRepo, role: 'the website' }],
    });
    expect(receipt.status).toBe('ok');
    await expect.poll(() => page.evaluate(() => window.waitingCount()), { timeout: 15000 }).toBe(1);
    await page.waitForTimeout(600);
    expect(await page.locator('[data-link-change-id]').count()).toBe(0);
    await page.mouse.move(1270, 1090);
    const card = page.locator('[data-link-change-id]');
    await card.waitFor({ timeout: 10000 });

    expect((await card.locator('.bk-lc-h').textContent()).trim()).toBe('KESTREL PROPOSES');
    expect(await card.locator('[data-status="draft"]').getAttribute('aria-label')).toBe('AWAITING');
    const rows = await card.locator('[data-lc-row]').evaluateAll((els) => els.map((el) => [
      el.getAttribute('data-lc-row'), el.querySelector('[data-lc-before]').textContent, el.querySelector('[data-lc-after]').textContent]));
    expect(rows).toEqual([['SITE', '—', 'northwind.example'], ['REPO', '—', 'the app · github.com/northwind/app'],
      ['REPO', '—', `the website · ${siteRepo}`]]);
    expect(await card.locator('[data-lc-read]').innerText()).toBe('LISTED ONLY — READING STAYS YOURS');
    expect(await page.evaluate(smallIn, '[data-link-change-id]')).toEqual([]);
    expect((await company('northwind')).site.url).toBeNull();
    await page.screenshot({ path: path.join(SHOTS, 'card-1280.png'), fullPage: true });

    await card.getByRole('button', { name: 'APPROVE' }).click();
    await page.locator('[data-src-notice]').waitFor();
    expect(await page.locator('[data-src-notice]').textContent()).toBe('Approved — written onto Northwind. Kestrel cannot read a new repo until you let it, on its row.');
    expect(await page.locator('[data-link-change-id]').count()).toBe(0);
    const after = await company('northwind');
    expect(after.site.url).toBe('https://www.northwind.example/');
    expect(after.repos.map((r) => r.role)).toEqual(['the app', 'the website']);
    // The new local repo is listed, and lending its reading is still the operator's own press on its row.
    const local = page.locator(`[data-src-repo="${siteRepo}"]`);
    await local.waitFor();
    expect(await local.getByRole('button', { name: 'LET KESTREL READ' }).count()).toBe(1);
    await expect.poll(() => page.evaluate(() => window.waitingCount()), { timeout: 15000 }).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('DECLINE writes nothing', async () => {
    const [receipt] = await propose({ company: 'northwind', links: ['https://northwind.example/press'] });
    expect(receipt.status).toBe('ok');
    const { page, errors } = await sourcesPage('northwind');
    const card = page.locator('[data-link-change-id]');
    await card.waitFor({ timeout: 15000 });
    await card.getByRole('button', { name: 'DECLINE' }).click();
    await page.locator('[data-src-notice]').waitFor();
    expect(await page.locator('[data-src-notice]').textContent()).toBe('Declined — nothing was changed.');
    expect((await company('northwind')).site.links).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);
});
