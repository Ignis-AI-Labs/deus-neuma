/**
 * THE HOUSE RAIL IN A REAL BROWSER (Design note, 2026-11-12: […],
 * […]).
 * Real Chromium, the PRODUCTION marketing window, the real company and account
 * routes over a real signed-wallet session, the real stores on temp disk
 * (marketing-office-kit.js). No double (RULE 0).
 *
 * Proven: the rail draws the house — companies in their tree, each one's
 * accounts under it, UNSORTED last; a company's ⋯ moves it under another and
 * back to the top, keeping its legal entity; an account's ⋯ moves it to a
 * company; one press opens an account under its own company, lit on the rail.
 */
/* global document */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startMarketingOffice, stopMarketingOffice, openOffice, smallText } from '../helpers/marketing-office-kit.js';
import { listCompanies } from '../../backend/services/marketing/companies.js';
import { listAccounts } from '../../backend/services/social/account-store.js';
import { a11yCheck } from '../helpers/a11y-scan.js';

let ctx;
beforeAll(async () => { ctx = await startMarketingOffice('marketing-rail-'); }, 180000);
afterAll(async () => { await stopMarketingOffice(ctx); }, 30000);

const rows = (page) => page.locator('[data-rail-row]').evaluateAll((els) => els.map((e) => `${e.dataset.railRow}${e.classList.contains('is-here') ? '*' : ''}`));
const pick = async (page, row, target) => {
  await page.locator(`[data-rail-move="${row}"]`).click();
  await page.locator('.cmenu-item', { hasText: target }).first().click();
};
const companyOf = async (id) => (await listCompanies(ctx.auth.address)).find((c) => c.id === id);

describe('the house rail', () => {
  it('draws the house: HOUSE lit, companies in their tree with their accounts, UNSORTED last — every label at the floor', async () => {
    const { page, errors } = await openOffice(ctx, 1400);
    const drawn = await rows(page);
    expect(drawn[0]).toBe('house*');
    expect(drawn.indexOf('company:northwind')).toBeLessThan(drawn.indexOf('company:northwind-labs'));
    expect(drawn.indexOf('company:northwind-labs')).toBeLessThan(drawn.indexOf('company:northwind-studio'));
    expect(drawn.at(-2)).toBe('unsorted');
    expect(drawn.at(-1)).toMatch(/^account:/);
    expect(await page.evaluate(smallText, '[data-mkt-rail]')).toEqual([]);
    // Every person reaches it (AGENTS.md's accessibility rule): no axe finding past the window's baseline.
    const scanned = await a11yCheck(page, 'marketing-house', { include: '[data-marketing-office]' });
    expect(scanned.grown, scanned.detail).toEqual([]);
    expect(errors).toEqual([]);
  }, 90000);

  it('a company moves under another and back to the top — its legal entity kept', async () => {
    const { page, errors } = await openOffice(ctx, 1400);
    const before = await companyOf('northwind');
    expect(before.legalEntity).toBeTruthy();
    await pick(page, 'company:northwind', 'Brookmere');
    await page.waitForFunction(() => {
      const ids = [...document.querySelectorAll('[data-rail-row]')].map((e) => e.dataset.railRow);
      return ids.indexOf('company:northwind') === ids.indexOf('company:brookmere') + 2;
    }, null, { timeout: 15000 });
    expect(await companyOf('northwind')).toMatchObject({ parentId: 'brookmere', legalEntity: before.legalEntity });
    await pick(page, 'company:northwind', 'TOP LEVEL');
    await page.waitForFunction(() => document.querySelector('[data-rail-row="company:northwind"]')?.style.getPropertyValue('--depth') === '1', null, { timeout: 15000 });
    expect(await companyOf('northwind')).toMatchObject({ parentId: null, legalEntity: before.legalEntity });
    expect(errors).toEqual([]);
  }, 90000);

  it('a company\'s campaign stands under it; one press opens its page, lit on the rail; the account page names its campaigns', async () => {
    const { page, errors } = await openOffice(ctx, 1400);
    const drawn = await rows(page);
    const at = drawn.indexOf(`campaign:${ctx.campaign.id}`);
    expect(at).toBeGreaterThan(drawn.indexOf('company:northwind'));
    expect(at).toBeLessThan(drawn.indexOf('company:northwind-labs'));
    await page.locator(`[data-rail-row="campaign:${ctx.campaign.id}"] .mkt-rail-go`).click();
    await page.locator(`[data-campaign-page="${ctx.campaign.id}"]`).waitFor({ timeout: 15000 });
    expect((await rows(page)).filter((r) => r.endsWith('*'))).toEqual([`campaign:${ctx.campaign.id}*`]);
    // Its account's page carries it back: the campaign is a press there too.
    await page.locator('[data-rail-row="account:x-1"] .mkt-rail-go').click();
    const back = page.locator(`[data-account-campaigns] [data-account-campaign="${ctx.campaign.id}"]`);
    await back.waitFor({ timeout: 15000 });
    expect(await back.textContent()).toContain('Launch Week');
    await back.click();
    await page.locator(`[data-campaign-page="${ctx.campaign.id}"]`).waitFor({ timeout: 15000 });
    expect(errors).toEqual([]);
  }, 90000);

  it('CAMPAIGNS shows the BOARD\'s own campaign panel; its name opens the page', async () => {
    const { page, errors } = await openOffice(ctx, 1400);
    await page.locator('[data-rail-row="company:northwind"] .mkt-rail-go').click();
    await page.locator('.mkt-tabs [data-tab="campaigns"]').click();
    const panel = page.locator(`[data-campaign-panels] [data-part="campaign:${ctx.campaign.id}"]`);
    await panel.locator(`[data-campaign-card="${ctx.campaign.id}"] .hud-dial`).waitFor({ timeout: 15000 });
    const scanned = await a11yCheck(page, 'marketing-campaigns', { include: '[data-marketing-office]' });
    expect(scanned.grown, scanned.detail).toEqual([]);
    await panel.locator(`button[data-campaign-row="${ctx.campaign.id}"]`).click();
    await page.locator(`[data-campaign-page="${ctx.campaign.id}"]`).waitFor({ timeout: 15000 });
    expect(errors).toEqual([]);
  }, 90000);

  it('an UNSORTED account moves to a company; one press opens it under that company, lit on the rail', async () => {
    const { page, errors } = await openOffice(ctx, 1400);
    const loose = (await rows(page)).at(-1).replace(/^account:/, '');
    await pick(page, `account:${loose}`, 'Umbrae');
    await page.locator('[data-rail-row="unsorted"]').waitFor({ state: 'detached', timeout: 15000 });
    expect((await listAccounts(ctx.auth.address)).find((a) => a.id === loose).companyId).toBe('umbrae');
    await page.locator(`[data-rail-row="account:${loose}"] .mkt-rail-go`).click();
    await page.locator(`[data-mkt-account$=":${loose}"]`).waitFor({ timeout: 15000 });
    expect(await page.locator('[data-mkt-path]').textContent()).toContain('Umbrae');
    expect((await rows(page)).filter((r) => r.endsWith('*'))).toEqual([`account:${loose}*`]);
    expect(errors).toEqual([]);
  }, 90000);
});
