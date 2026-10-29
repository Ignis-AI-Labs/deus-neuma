// The MARKETING board's new panels (marketing-panel-plan.md slice 4) in real
// Chromium — the PRODUCTION window on the real routes over a real
// signed-wallet session, the real stores on tmp disk, the house's numbers
// from the REAL stats sweep against local stand-ins, a REAL git repository
// for COMPANY WATCH (marketing-office-kit.js + marketing-kinds-seeds.js). No
// double (RULE 0); placeholder keys; drafts only; no scheduler runs.
//
// Proven: the default board draws a PLATFORM per platform at each level, NEXT
// 7 DAYS, and the CMO LOG at the house, each from the kit's real reads; ⋯ and
// + PANEL offer only the metrics a platform reports, and a platform that
// reports nothing offers none (its panel draws its tracked links' clicks);
// TOP POSTS, FUNNEL and COMPANY WATCH added from + PANEL draw from the same
// reads; a NEXT 7 DAYS post's press lands on its own card in the desk; every
// kind is legible at 1400 / 720 / 420 (no label under 13px, no spill).
/* global document, window */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { startMarketingOffice, stopMarketingOffice, openOffice, smallText, spill } from '../helpers/marketing-office-kit.js';
import { seedKinds } from '../helpers/marketing-kinds-seeds.js';
import { boardStoreFor } from '../../backend/services/marketing/board-store.js';
import { campaignStoreFor } from '../../backend/services/marketing/campaign-store.js';
import { listCompanies } from '../../backend/services/marketing/companies.js';
import { listAccounts } from '../../backend/services/social/account-store.js';

const SHOTS = '/tmp/neuma-slice4-shots';
let ctx;

beforeAll(async () => {
  ctx = await startMarketingOffice('marketing-kinds-');
  await seedKinds(ctx);
  await fs.mkdir(SHOTS, { recursive: true });
}, 180000);

afterAll(async () => { await stopMarketingOffice(ctx); }, 30000);

const drawn = (page) => page.locator('[data-mkt-board] .mkb-grid > .sub-panel').evaluateAll((els) => els.map((el) => el.dataset.part));
const ready = (page, level = 'house') => page.locator(`[data-mkt-level="${level}"] [data-mkt-board] .mkb-grid > .sub-panel`).first().waitFor();
const panel = (page, part) => page.locator(`[data-mkt-board] [data-part="${part}"]`);
const saved = (page, method = 'PUT') => page.waitForResponse((r) => r.url().includes('/api/v1/marketing/board') && r.request().method() === method);
const items = (page) => page.locator('.cmenu-item').allTextContents();
const item = (page, text) => page.locator('.cmenu-item', { hasText: text });
const traceNow = (page, part, metric) => panel(page, part).locator(`[data-metric="${metric}"] .hud-trace-now`).innerText();
// The house as the board route judges it: its companies, its bench, its accounts.
const house = async () => ({
  companies: await listCompanies(ctx.auth.address),
  campaigns: await (await campaignStoreFor(ctx.auth.address)).load(),
  accounts: (await listAccounts(ctx.auth.address)).map((a) => ({ id: a.id, channelId: a.channelId, companyId: a.companyId ?? null })),
});

describe('MARKETING — the new panels', () => {
  it('the default board: a PLATFORM per platform at each level, NEXT 7 DAYS, the CMO LOG at the house — each from the real reads', async () => {
    const { page, errors } = await openOffice(ctx, 1400);
    await ready(page);
    await panel(page, 'cmo-log').locator('[data-mkk-log]').waitFor({ timeout: 30000 });
    // One PLATFORM per platform the house's accounts are on (in the accounts' own order), then the week, then the log.
    const houseKinds = (await drawn(page)).filter((p) => /^(platform|next-7-days|cmo-log)/.test(p));
    expect(houseKinds.slice(0, 3).sort()).toEqual(['platform:bluesky', 'platform:telegram', 'platform:x']);
    expect(houseKinds.slice(3)).toEqual(['next-7-days', 'cmo-log']);

    // X: what it reports, the kit's post read by the real sweep (SEEN 4100), its days drawn.
    expect(await panel(page, 'platform:x').locator('[data-metric]').evaluateAll((els) => els.map((el) => el.dataset.metric))).toEqual(['views', 'likes', 'replies']);
    expect(await traceNow(page, 'platform:x', 'views')).toBe('4100');
    expect(await panel(page, 'platform:x').locator('[data-metric="views"] .hud-trace-line').getAttribute('d')).toMatch(/^M .* L /);
    expect(await panel(page, 'platform:bluesky').locator('[data-metric]').evaluateAll((els) => els.map((el) => el.dataset.metric))).toEqual(['likes', 'replies', 'shares']);
    expect(await traceNow(page, 'platform:bluesky', 'likes')).toBe('8');
    // Telegram reports no post numbers: its tracked link's clicks, as the counter counted them on two days.
    expect(await panel(page, 'platform:telegram').locator('[data-mkk-traces]').getAttribute('data-mkk-traces')).toBe('links');
    expect(await traceNow(page, 'platform:telegram', 'clicks')).toBe('8');

    // NEXT 7 DAYS: a lane per platform, a mark per staged post; the unscheduled draft is not drawn.
    const week = panel(page, 'next-7-days');
    expect(await week.locator('[data-lane]').evaluateAll((els) => els.map((el) => el.dataset.lane))).toEqual(houseKinds.slice(0, 3).map((p) => p.slice('platform:'.length)));
    expect(await week.locator('[data-week-post]').count()).toBe(4);
    expect(await week.locator('.sub-panel-aside').innerText()).toBe('4');
    expect(await week.locator('.mkk-week-day.is-today').count()).toBe(1);

    // CMO LOG: the seated CMO, the mandate on, its one act, the CMO's open ask, the plan's two days.
    const log = panel(page, 'cmo-log');
    expect(await log.locator('.sub-panel-aside').innerText()).toBe('KESTREL');
    expect(await log.locator('[data-log="mandate"] b').innerText()).toBe('ON');
    expect(await log.locator('[data-log="acts"] b').innerText()).toBe('1');
    expect(await log.locator('[data-log="asks"] .mkk-ask').allInnerTexts()).toEqual(['1', '0']);
    expect(await log.locator('.mkk-plan i.is-on').allInnerTexts()).toEqual(['M', 'T']);
    await panel(page, 'platform:x').screenshot({ path: path.join(SHOTS, 'kind-platform-1400.png') });
    await panel(page, 'platform:telegram').screenshot({ path: path.join(SHOTS, 'kind-platform-links-1400.png') });
    await week.screenshot({ path: path.join(SHOTS, 'kind-next-7-days-1400.png') });
    await log.screenshot({ path: path.join(SHOTS, 'kind-cmo-log-1400.png') });

    // A company's board: its own platforms and week, never the CMO LOG.
    await page.locator('[data-company-tile="northwind"]').click();
    await ready(page, 'northwind');
    const companyKinds = (await drawn(page)).filter((p) => /^(platform|next-7-days|cmo-log)/.test(p));
    expect([companyKinds.slice(0, 2).sort(), companyKinds.slice(2)]).toEqual([['platform:bluesky', 'platform:x'], ['next-7-days']]);
    expect(await panel(page, 'next-7-days').locator('[data-week-post]').count()).toBe(4);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('⋯ and + PANEL offer only the metrics a platform reports; a platform that reports nothing offers none', async () => {
    const { page, errors } = await openOffice(ctx, 1400);
    await ready(page);
    await panel(page, 'platform:x').locator('[data-panel-menu]').click();
    expect(await items(page)).toEqual(['WIDTH · 6 OF 12  ›', 'SHOW · 3 OF 8  ›', 'WINDOW · 7 DAYS  ›', 'MOVE EARLIER', 'MOVE LATER', 'PIN', 'HIDE']);
    await item(page, 'SHOW').click();
    expect(await items(page)).toEqual(['‹  SHOW', 'SEEN', 'LIKES', 'REPLIES', 'SHARES', 'SAVES', 'QUOTES', 'LINK CLICKS', 'PROFILE CLICKS']);
    let put = saved(page);
    await item(page, 'LINK CLICKS').click();
    expect((await put).status()).toBe(200);
    // The page stays open to toggle several; what shows is checked.
    await expect.poll(() => page.locator('.cmenu-item.is-checked').allTextContents()).toEqual(['SEEN', 'LIKES', 'REPLIES', 'LINK CLICKS']);
    await page.keyboard.press('Escape');
    expect(await panel(page, 'platform:x').locator('[data-metric]').evaluateAll((els) => els.map((el) => el.dataset.metric))).toEqual(['views', 'likes', 'replies', 'linkClicks']);

    await panel(page, 'platform:bluesky').locator('[data-panel-menu]').click();
    await item(page, 'SHOW').click();
    expect(await items(page)).toEqual(['‹  SHOW', 'LIKES', 'REPLIES', 'SHARES', 'QUOTES']);
    await page.keyboard.press('Escape');

    await panel(page, 'platform:telegram').locator('[data-panel-menu]').click();
    expect(await items(page)).toEqual(['WIDTH · 6 OF 12  ›', 'WINDOW · 7 DAYS  ›', 'MOVE EARLIER', 'MOVE LATER', 'PIN', 'HIDE']);
    await item(page, 'WINDOW').click();
    put = saved(page);
    await item(page, '30 DAYS').click();
    expect((await put).status()).toBe(200);
    expect(await panel(page, 'platform:telegram').locator('.sub-panel-aside').innerText()).toBe('30 DAYS');

    // + PANEL: one decision at a time; the platform page offers each account; TOP POSTS ranks only by what is reported.
    await page.locator('[data-mkb-add]').click();
    const companies = await listCompanies(ctx.auth.address);
    expect(await items(page)).toEqual(['PLATFORM · 6  ›', 'TOP POSTS', `FUNNEL · ${companies.filter((c) => !c.depth).length}  ›`, `COMPANY WATCH · ${companies.length}  ›`]);
    await item(page, 'PLATFORM').click();
    expect((await items(page))[0]).toBe('‹  PLATFORM');
    expect((await items(page)).slice(1)).toHaveLength(6);
    await page.keyboard.press('Escape');
    await page.locator('[data-mkb-add]').click();
    put = saved(page);
    await item(page, 'TOP POSTS').click();
    expect((await put).status()).toBe(200);
    const top = panel(page, 'top-posts');
    expect(await top.locator('.sub-panel-aside').innerText()).toBe('BY SEEN');
    expect(await top.locator('[data-top-post]').evaluateAll((els) => els.map((el) => el.dataset.topPost))).toEqual(['p1']);
    expect(await top.locator('.hud-bar-text').allInnerTexts()).toEqual(['4.1K']);
    await top.locator('[data-panel-menu]').click();
    await item(page, 'ON').click();
    // Telegram reports nothing to rank by, so it is never offered.
    expect((await items(page)).slice(0, 2)).toEqual(['‹  ON', 'ALL']);
    expect((await items(page)).slice(2).sort()).toEqual(['BLUESKY', 'X']);
    put = saved(page);
    await item(page, 'BLUESKY').click();
    expect((await put).status()).toBe(200);
    expect(await top.locator('.sub-panel-aside').innerText()).toBe('BY LIKES');
    expect(await top.locator('[data-top-post]').evaluateAll((els) => els.map((el) => el.dataset.topPost))).toEqual(['p2']);
    await top.screenshot({ path: path.join(SHOTS, 'kind-top-posts-1400.png') });

    // FUNNEL and COMPANY WATCH, each on its company.
    for (const [group, label, part] of [['FUNNEL', 'FUNNEL · Northwind', 'funnel:northwind'], ['COMPANY WATCH', 'WATCH · Northwind', 'company-watch:northwind']]) {
      await page.locator('[data-mkb-add]').click();
      await item(page, group).click();
      put = saved(page);
      await page.locator('.cmenu-item', { hasText: new RegExp(`^${label}$`) }).click();
      expect((await put).status()).toBe(200);
      await panel(page, part).waitFor();
    }
    const funnel = panel(page, 'funnel:northwind');
    expect(await funnel.locator('[data-step]').evaluateAll((els) => els.map((el) => el.dataset.step))).toEqual(['reach', 'engaged', 'clicked', 'converted']);
    expect(await funnel.locator('.mkk-step-total').allInnerTexts()).toEqual(['4.1K', '88', '61', '22']);
    const watch = panel(page, 'company-watch:northwind');
    await watch.locator('[data-mkk-watch]').waitFor({ timeout: 30000 });
    expect(await watch.locator('[data-watch-row]').evaluateAll((els) => els.map((el) => el.dataset.watchRow))).toEqual(['release', 'added', 'fixed']);
    expect(await watch.locator('[data-watch-row="added"] a').getAttribute('href')).toBe(`https://github.com/northwind/app/commit/${ctx.repo.add}`);
    expect(await watch.locator('.mkk-watch-unread').getAttribute('title')).toMatch(/^the website: your operator has not let you read it/);
    await funnel.screenshot({ path: path.join(SHOTS, 'kind-funnel-1400.png') });
    await watch.screenshot({ path: path.join(SHOTS, 'kind-company-watch-1400.png') });

    // What the operator chose is what the store holds.
    const board = await (await boardStoreFor(ctx.auth.address)).load('house');
    expect(board.find((p) => p.id === 'platform:x').show).toEqual(['views', 'likes', 'replies', 'linkClicks']);
    expect(board.find((p) => p.id === 'top-posts')).toMatchObject({ sort: 'likes', count: 5, scope: { companyId: null, platform: 'bluesky' } });
    expect(errors).toEqual([]);
    await page.close();
  }, 180000);

  it('NEXT 7 DAYS: a post\'s press lands on its own card in the desk', async () => {
    const page = await (await ctx.browser.newContext()).newPage();
    await page.setViewportSize({ width: 1400, height: 1200 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const fixture = JSON.stringify({ token: ctx.auth.token, wallet: ctx.auth.address });
    await page.route('**/kinds-desk', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body style="background:#000"><script>window.doorsFixture=${fixture}</script><div id="root"></div><script type="module" src="/test/helpers/sdt-doors-page.jsx"></script></body></html>`,
    }));
    await page.goto(ctx.url('kinds-desk'));
    await page.locator('#title').waitFor({ timeout: 60000 });
    await page.evaluate(() => window.deskOpen('marketing'));
    const office = page.locator('[data-window-id="marketing"]');
    const post = office.locator(`[data-part="next-7-days"] [data-week-post="${ctx.week[0]}"]`);
    await post.waitFor({ timeout: 30000 });
    await post.click();
    const card = page.locator(`[data-window-id="marketing"] [data-mkt-level="account"] .queue-card[data-entry-id="${ctx.week[0]}"]`);
    await card.waitFor({ timeout: 30000 });
    await expect.poll(() => card.evaluate((el) => el.classList.contains('is-wait-landed')), { timeout: 10000 }).toBe(true);
    await page.screenshot({ path: path.join(SHOTS, 'next-7-days-press-lands-1400.png') });
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('legible: every kind on the board, no label under 13px and nothing spilling, at 1400 / 720 / 420, HOUSE and a company', async () => {
    const store = await boardStoreFor(ctx.auth.address);
    const h = await house();
    const at = (companyId) => (id, kind, span, extra = {}) => ({ id, kind, span, ...extra, scope: { companyId, ...(extra.scope || {}) } });
    const hp = at(null);
    expect((await store.save('house', [
      hp('tiles', 'tiles', 12), hp('platform:x', 'platform', 4, { scope: { platform: 'x' }, show: ['views', 'likes', 'linkClicks'] }), hp('platform:telegram', 'platform', 4, { scope: { platform: 'telegram' } }),
      hp('top-posts', 'top-posts', 4, { sort: 'views', count: 5 }), hp('funnel:northwind', 'funnel', 6, { scope: { company: 'northwind' } }),
      hp('next-7-days', 'next-7-days', 6), hp('company-watch:northwind', 'company-watch', 6, { scope: { company: 'northwind' } }), hp('cmo-log', 'cmo-log', 6),
    ], { ...h, setBy: 'operator' })).ok).toBe(true);
    const cp = at('northwind');
    expect((await store.save('northwind', [
      cp('platform:x:x-2', 'platform', 3, { scope: { platform: 'x', accountId: 'x-2' } }), cp('top-posts', 'top-posts', 3, { scope: { platform: 'bluesky' }, sort: 'likes', count: 3 }),
      cp('funnel:northwind', 'funnel', 6, { scope: { company: 'northwind' } }), cp('next-7-days', 'next-7-days', 8),
      cp('company-watch:northwind-labs', 'company-watch', 4, { scope: { company: 'northwind-labs' } }),
    ], { ...h, setBy: 'operator' })).ok).toBe(true);
    for (const width of [1400, 720, 420]) {
      const { page, errors } = await openOffice(ctx, width, { height: 1000 });
      await ready(page);
      await panel(page, 'company-watch:northwind').locator('[data-mkk-watch]').waitFor({ timeout: 30000 });
      await page.waitForTimeout(300);
      expect(await page.evaluate(smallText), `HOUSE at ${width}px`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `HOUSE ${width}px spills`).toBeLessThanOrEqual(1);
      expect(await page.evaluate(spill), `HOUSE ${width}px`).toEqual([]);
      if (width !== 720) await page.screenshot({ path: path.join(SHOTS, `house-${width}.png`), fullPage: true });
      await page.locator('[data-company-tile="northwind"]').click();
      await ready(page, 'northwind');
      await panel(page, 'company-watch:northwind-labs').locator('.mkb-empty').waitFor({ timeout: 30000 });
      expect(await panel(page, 'company-watch:northwind-labs').locator('.mkb-empty').innerText()).toMatch(/^No repo\s*SITE & CODE/);
      await page.waitForTimeout(300);
      expect(await page.evaluate(smallText), `company at ${width}px`).toEqual([]);
      expect(await page.evaluate(spill), `company ${width}px`).toEqual([]);
      if (width !== 720) await page.screenshot({ path: path.join(SHOTS, `company-${width}.png`), fullPage: true });
      expect(errors).toEqual([]);
      await page.close();
    }
  }, 180000);
});
