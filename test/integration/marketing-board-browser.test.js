// The MARKETING board as data (marketing-panel-plan.md slice 3) — real
// Chromium, the PRODUCTION window, the real board route over a real
// signed-wallet session, the real board store on tmp disk
// (marketing-office-kit.js). No double (RULE 0). Proves what the operator
// does: each panel's ⋯ (WIDTH, MOVE, HIDE, PIN, by pointer and by keyboard)
// saves the board and it holds across a reload; ADD PANEL offers what this
// level may still hold; RESET returns the default; the CMO's mark is drawn
// from who set a panel; a panel whose campaign is gone drops and is named; a
// change made in a second page waits under the pointer and lands after; and
// no label is under 13px, the menus included, wide or narrow.
/* global document, window, getComputedStyle */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { startMarketingOffice, stopMarketingOffice, openOffice, smallText, spill } from '../helpers/marketing-office-kit.js';
import { boardStoreFor } from '../../backend/services/marketing/board-store.js';
import { campaignStoreFor } from '../../backend/services/marketing/campaign-store.js';
import { campaignContextFor } from '../../backend/services/marketing/campaign-context.js';
import { listCompanies } from '../../backend/services/marketing/companies.js';

const SHOTS = path.join(os.tmpdir(), 'neuma-marketing-slice3-shots');
let ctx;

beforeAll(async () => {
  ctx = await startMarketingOffice('marketing-board-');
  await fs.mkdir(SHOTS, { recursive: true });
}, 180000);

afterAll(async () => { await stopMarketingOffice(ctx); }, 30000);

/** The board as drawn: each panel's part and width, in order. */
const drawn = (page) => page.locator('[data-mkt-board] .mkb-grid > .sub-panel').evaluateAll((els) => els.map((el) => [el.dataset.part,
  Number([...el.classList].find((c) => c.startsWith('sub-span-')).slice('sub-span-'.length))]));
const ready = (page, level = 'house') => page.locator(`[data-mkt-level="${level}"] [data-mkt-board] .mkb-grid > .sub-panel`).first().waitFor();
const saved = (page, method = 'PUT') => page.waitForResponse((r) => r.url().includes('/api/v1/marketing/board') && r.request().method() === method);
const menuOf = (page, part) => page.locator(`[data-part="${part}"] [data-panel-menu]`);
const item = (page, text) => page.locator('.cmenu-item', { hasText: text });
/** impure — one ⋯ choice on a panel, and the save it makes. */
const lever = async (page, part, ...choices) => {
  await menuOf(page, part).click();
  const put = saved(page);
  for (const choice of choices) await item(page, choice).click();
  expect((await put).status()).toBe(200);
};

describe('MARKETING — the board as data: the operator\'s levers', () => {
  it('⋯ WIDTH, MOVE, HIDE and PIN (pointer and keyboard) save the board, and it holds across a reload', async () => {
    const { page, errors } = await openOffice(ctx, 1400);
    await ready(page);
    const c = `campaign:${ctx.campaign.id}`;
    const platforms = (await drawn(page)).filter(([part]) => part.startsWith('platform:'));
    expect(platforms.map(([part]) => part).sort()).toEqual(['platform:bluesky', 'platform:x']);
    const row = [...platforms, ['next-7-days', 6], ['cmo-log', 6]];
    expect(await drawn(page)).toEqual([['tiles', 12], [c, 6], ['accounts', 6], ['angles', 6], ['links', 6], ...row, ['posts', 12]]);
    expect(await page.locator('[data-mkb-reset]').count()).toBe(0);

    await lever(page, 'accounts', /^WIDTH/, '12 OF 12');
    await lever(page, 'angles', 'MOVE EARLIER');
    await lever(page, 'links', 'HIDE');
    // The keyboard reaches the ⋯ and walks its menu: WIDTH, MOVE EARLIER, PIN, HIDE on the last panel.
    await menuOf(page, 'posts').focus();
    await page.keyboard.press('Enter');
    expect(await page.locator('.cmenu-item').allTextContents()).toEqual(['WIDTH · 12 OF 12  ›', 'MOVE EARLIER', 'PIN', 'HIDE']);
    const put = saved(page);
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter']) await page.keyboard.press(key);
    expect((await put).status()).toBe(200);

    const after = [['tiles', 12], [c, 6], ['angles', 6], ['accounts', 12], ...row, ['posts', 12]];
    expect(await drawn(page)).toEqual(after);
    expect(await page.locator('[data-part="posts"] [data-mark="pin"]').count()).toBe(1);
    await page.reload();
    await ready(page);
    expect(await drawn(page)).toEqual(after);
    expect(await page.locator('[data-part="posts"] [data-mark="pin"]').count()).toBe(1);
    expect(await page.locator('[data-mark="cmo"]').count()).toBe(0);

    // The store holds it as the operator's; a panel the CMO set wears the CMO's mark (from `setBy`).
    const store = await boardStoreFor(ctx.auth.address);
    const board = await store.load('house');
    expect(board.map((p) => [p.id, p.span, p.pinned, p.setBy])).toEqual([['tiles', 12, false, 'operator'], [c, 6, false, 'operator'],
      ['angles', 6, false, 'operator'], ['accounts', 12, false, 'operator'], ...row.map(([id, span]) => [id, span, false, 'operator']), ['posts', 12, true, 'operator']]);
    const house = { companies: await listCompanies(ctx.auth.address), campaigns: await (await campaignStoreFor(ctx.auth.address)).load() };
    expect((await store.save('house', board.map((p) => (p.id === 'angles' ? { ...p, span: 4 } : p)), { ...house, setBy: 'cmo' })).ok).toBe(true);
    await page.reload();
    await ready(page);
    expect(await page.locator('[data-mark="cmo"]').evaluateAll((els) => els.map((el) => el.closest('[data-part]').dataset.part))).toEqual(['angles']);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('+ PANEL offers what this level may still hold; ↺ DEFAULT returns the default board', async () => {
    const { page, errors } = await openOffice(ctx, 1400);
    await ready(page);
    await page.locator('[data-mkb-add]').click();
    // The site counter, hidden in the first test, is offered first; the new kinds after it (marketing-panel-kinds-browser).
    expect((await page.locator('.cmenu-item').allTextContents())[0]).toBe('SITE COUNTER');
    const put = saved(page);
    await item(page, 'SITE COUNTER').click();
    expect((await put).status()).toBe(200);
    expect((await drawn(page)).at(-1)).toEqual(['links', 6]);
    // Once on the board it is offered no more.
    await page.locator('[data-mkb-add]').click();
    expect(await page.locator('.cmenu-item').allTextContents()).not.toContain('SITE COUNTER');
    await page.keyboard.press('Escape');

    const reset = saved(page, 'DELETE');
    await page.locator('[data-mkb-reset]').click();
    expect((await reset).status()).toBe(200);
    const back = await drawn(page);
    expect(back.slice(0, 5)).toEqual([['tiles', 12], [`campaign:${ctx.campaign.id}`, 6], ['accounts', 6], ['angles', 6], ['links', 6]]);
    expect(back.slice(-3)).toEqual([['next-7-days', 6], ['cmo-log', 6], ['posts', 12]]);
    expect(await page.locator('[data-mkb-reset]').count()).toBe(0);
    expect(await (await boardStoreFor(ctx.auth.address)).load('house')).toBeNull();

    // A company's board never offers the site counter (it counts house-wide).
    await page.locator('[data-company-tile="northwind"]').click();
    await ready(page, 'northwind');
    await lever(page, 'angles', 'HIDE');
    await page.locator('[data-mkb-add]').click();
    const offered = await page.locator('.cmenu-item').allTextContents();
    expect(offered[0]).toBe('ANGLES × ACCOUNTS');
    expect(offered).not.toContain('SITE COUNTER');
    expect(offered).not.toContain('CMO LOG');
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('a campaign gone drops its panel quietly, and the board names it', async () => {
    const house = ctx.auth.address;
    const bench = await campaignStoreFor(house);
    const brief = await bench.add({ name: 'Short Push', companyId: 'brookmere', goal: { kind: 'signups' } }, await campaignContextFor(house), house);
    const { page, errors } = await openOffice(ctx, 1400);
    await page.locator('[data-company-tile="brookmere"]').click();
    await ready(page, 'brookmere');
    await lever(page, `campaign:${brief.id}`, /^WIDTH/, '8 OF 12');
    expect(await drawn(page)).toContainEqual([`campaign:${brief.id}`, 8]);
    await bench.remove(brief.id);
    await page.reload();
    await ready(page, 'brookmere');
    expect((await drawn(page)).map(([part]) => part)).not.toContain(`campaign:${brief.id}`);
    const gone = page.locator('[data-mkb-gone]');
    expect(await gone.innerText()).toBe('1 GONE');
    expect(await gone.getAttribute('title')).toBe(`campaign:${brief.id}: there is no campaign "${brief.id}" in this house`);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('calm: a change made in another page waits while the operator is at the board, and lands when they leave', async () => {
    const context = await ctx.browser.newContext();
    const one = await openOffice(ctx, 1280, { context, height: 900 });
    const two = await openOffice(ctx, 1280, { context, height: 900 });
    for (const { page } of [one, two]) {
      await page.locator('[data-company-tile="northwind"]').click();
      await ready(page, 'northwind');
    }
    const parts = async (page) => (await drawn(page)).map(([part]) => part);
    expect(await parts(one.page)).toContain('accounts');
    await one.page.hover('[data-mkt-board] [data-part="posts"]');
    await lever(two.page, 'accounts', 'HIDE');
    expect(await parts(two.page)).not.toContain('accounts');
    await one.page.waitForTimeout(1500);
    expect(await parts(one.page), 'held while the pointer is on the board').toContain('accounts');
    await one.page.mouse.move(2, 2);
    await expect.poll(() => parts(one.page), { timeout: 10000 }).not.toContain('accounts');
    expect([...one.errors, ...two.errors]).toEqual([]);
    await context.close();
  }, 120000);

  it('legible: no label under 13px, the menus and marks included, and no sideways spill, wide and narrow', async () => {
    const store = await boardStoreFor(ctx.auth.address);
    const house = { companies: await listCompanies(ctx.auth.address), campaigns: await (await campaignStoreFor(ctx.auth.address)).load() };
    // A board wearing both marks: a pin of the operator's and a panel the CMO set.
    await store.reset('house', 'operator');
    const base = [['tiles', 12], [`campaign:${ctx.campaign.id}`, 8], ['accounts', 4], ['angles', 6], ['links', 6], ['posts', 12]]
      .map(([id, span]) => ({ id, kind: id.startsWith('campaign:') ? 'campaign' : id, span, scope: { companyId: null, ...(id.startsWith('campaign:') ? { campaignId: ctx.campaign.id } : {}) } }));
    expect((await store.save('house', base.map((p) => ({ ...p, pinned: p.id === 'posts' })), { ...house, setBy: 'operator' })).ok).toBe(true);
    expect((await store.save('house', (await store.load('house')).map((p) => (p.id === 'angles' ? { ...p, span: 3 } : p)), { ...house, setBy: 'cmo' })).ok).toBe(true);
    for (const width of [1400, 720, 420]) {
      const { page, errors } = await openOffice(ctx, width, { height: 1000 });
      await ready(page);
      expect(await page.locator('[data-mark]').count()).toBe(2);
      expect(await page.evaluate(smallText), `HOUSE at ${width}px`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `HOUSE ${width}px spills`).toBeLessThanOrEqual(1);
      expect(await page.evaluate(spill), `HOUSE ${width}px`).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `house-${width}.png`), fullPage: true });
      await menuOf(page, 'accounts').click();
      const sizes = await page.locator('.cmenu .cmenu-item').evaluateAll((els) => els.map((i) => parseFloat(getComputedStyle(i).fontSize)));
      expect(Math.min(...sizes), `menu at ${width}px`).toBeGreaterThanOrEqual(13);
      // The menu clamps itself into the window once it has measured its first paint (CtxMenu).
      await expect.poll(() => page.locator('.cmenu').evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; }),
        `menu inside the window at ${width}px`).toBe(true);
      await page.screenshot({ path: path.join(SHOTS, `house-menu-${width}.png`) });
      await page.keyboard.press('Escape');
      await page.locator('[data-company-tile="northwind"]').click();
      await ready(page, 'northwind');
      await page.locator('[data-mkb-add]').click();
      expect(Math.min(...await page.locator('.cmenu-item').evaluateAll((els) => els.map((i) => parseFloat(getComputedStyle(i).fontSize)))), `add menu at ${width}px`).toBeGreaterThanOrEqual(13);
      await page.keyboard.press('Escape');
      expect(await page.evaluate(smallText), `company at ${width}px`).toEqual([]);
      expect(await page.evaluate(spill), `company ${width}px`).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `company-${width}.png`), fullPage: true });
      expect(errors).toEqual([]);
      await page.close();
    }
  }, 180000);
});
