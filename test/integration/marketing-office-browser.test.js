// The MARKETING window as the CMO's office, zoomed down the company tree
// (marketing-panel-plan.md slice 1) — real Chromium, the PRODUCTION window
// (title + body), the real routes over a real signed-wallet session, the real
// stores on tmp disk (marketing-office-kit.js). No double (RULE 0). Proves
// what the owner reads: the title names the CMO seat and never the chat's
// focus; HOUSE shows every top-level company as a tile whose numbers are the
// pure fold's own; the path zooms down three levels and back; each company's
// tabs are narrowed to it; card landings zoom to the campaign; the place is
// remembered per house; and no label is under 13px, wide or narrow. Slice 2:
// the BOARD's health strip is the pure health fold on the same reads, every
// cell's press lands, and a background read waits while the operator is there.
/* global document, window */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { startMarketingOffice, stopMarketingOffice, openOffice, smallText, spill } from '../helpers/marketing-office-kit.js';
import { campaignStoreFor } from '../../backend/services/marketing/campaign-store.js';
import { campaignContextFor } from '../../backend/services/marketing/campaign-context.js';

const SHOTS = path.join(os.tmpdir(), 'neuma-marketing-slice2-shots');
let ctx;

beforeAll(async () => {
  ctx = await startMarketingOffice('marketing-office-');
  await fs.mkdir(SHOTS, { recursive: true });
}, 180000);

afterAll(async () => { await stopMarketingOffice(ctx); }, 30000);

const title = (page) => page.locator('[data-title]').innerText();
const pathText = (page) => page.locator('[data-mkt-path]').innerText().then((t) => t.replace(/\s+/g, ' ').trim());
const tile = (page, id) => page.locator(`[data-company-tile="${id}"]`);

describe('MARKETING — the CMO office, zoomed down the company tree', () => {
  it('HOUSE: one tile per top-level company, each the fold\'s own numbers, never summed across trees; NO COMPANY apart', async () => {
    const { page, errors } = await openOffice(ctx, 1280);
    expect(await pathText(page)).toBe('HOUSE');
    expect(await page.locator('[data-mkt-tabs] [role="tab"], .mkt-tabs [role="tab"]').allTextContents())
      .toEqual(['BOARD', 'CAMPAIGNS', 'ACCOUNTS', 'BRAND', 'LEADS', 'SEAT']);

    // The pure fold over the same real reads the window made.
    // (a string, so the browser runs the import itself — vite serves the very modules the window loaded)
    const expected = await page.evaluate(`(async () => {
      const [{ houseTiles }, { getHouseAccounts }, { getCampaigns }, { getPostQueue }, { getHouseCheck }] = await Promise.all([
        import('/frontend/app/RelinkShell/marketing/zoom-fold.js'), import('/frontend/services/social-accounts-client.js'),
        import('/frontend/services/campaigns-client.js'), import('/frontend/services/social-channels-client.js'), import('/frontend/services/social-check-client.js')]);
      const [h, bench, queue, check] = await Promise.all([getHouseAccounts(), getCampaigns(), getPostQueue(), getHouseCheck()]);
      return houseTiles({ companies: h.companies, accounts: h.accounts, check: check.check, campaigns: bench.campaigns, queue: queue.queue });
    })()`);
    expect(expected.map((t) => t.name)).toEqual(['Brookmere', 'Ignis AI Labs', 'Northwind', 'Umbrae', 'NO COMPANY']);
    const drawn = await page.locator('[data-company-tile]').evaluateAll((els) => els.map((el) => el.dataset.companyTile));
    expect(drawn).toEqual(expected.map((t) => t.id || 'none'));
    for (const t of expected) {
      const el = tile(page, t.id || 'none');
      expect(await el.locator('.mkt-tile-name').textContent()).toBe(t.name);
      expect(await el.locator('.mkt-tile-subs > span').allTextContents()).toEqual(t.subs.map((s) => `└ ${s.name}`));
      const marks = await el.locator('.mkt-mark-n').allTextContents();
      expect(marks).toEqual(['clear', 'failing', 'idle'].filter((m) => t.accounts[m] > 0).map((m) => `${{ clear: '●', failing: '◐', idle: '○' }[m]}${t.accounts[m]}`));
      expect(await el.locator('[data-tile-active]').innerText()).toMatch(new RegExp(`^${t.active}\\s*/${t.campaigns}$`));
      expect(await el.locator('[data-tile-active] .mkt-segs i.is-on').count()).toBe(t.campaigns > 12 ? 0 : t.active);
      for (const k of ['drafts', 'asks', 'failed']) {
        expect(await el.locator(`[data-wait="${k}"] b`).allTextContents()).toEqual(t.waiting[k] ? [String(t.waiting[k])] : []);
      }
    }
    // The holding company: its legal form, its whole tree folded in, its own numbers only.
    const north = expected.find((t) => t.id === 'northwind');
    expect(await tile(page, 'northwind').locator('.mkt-tile-legal').textContent()).toBe('Northwind Holdings LLC · Delaware');
    expect(north.subs.map((s) => [s.name, s.depth])).toEqual([['Northwind Labs', 1], ['Northwind Studio', 2]]);
    expect(north.waiting).toEqual({ drafts: 2, asks: 0, failed: 1 });
    expect(expected.find((t) => t.id === 'brookmere').waiting).toEqual({ drafts: 0, asks: 0, failed: 0 });
    // NO COMPANY: its press narrows the board below to its accounts; again returns everything.
    await tile(page, 'none').click();
    expect(await page.locator('[data-showing]').textContent()).toBe('SHOWING 1 ACCOUNT · SHOW ALL');
    await tile(page, 'none').click();
    expect(await page.locator('[data-showing]').count()).toBe(0);
    // Below the tiles, the house-wide bands remain: every company's grid row.
    expect(await page.locator('[data-mko-grid] tbody th').count()).toBe(7);
    expect(errors).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, 'house-1280.png'), fullPage: true });
    await page.close();
  }, 120000);

  it('the title names the CMO seat, never the chat\'s focus, and follows a designation at once', async () => {
    const { page, errors } = await openOffice(ctx, 1100);
    await expect.poll(() => title(page)).toBe('MARKETING // NO CMO');
    await page.evaluate(() => window.marketingFixture.focus());
    await page.waitForTimeout(300);
    expect(await title(page)).toBe('MARKETING // NO CMO');

    await page.locator('.mkt-tabs [data-tab="seat"]').click();
    const seat = page.locator('[data-mkt-seat]');
    expect(await seat.locator('.settings-k', { hasText: 'CHIEF MARKETING OFFICER' }).count()).toBe(1);
    await seat.locator('section.mandate').waitFor();
    await seat.getByRole('button', { name: 'CMO holder', exact: true }).click();
    await page.getByRole('listbox', { name: 'CMO holder' }).getByText('Kestrel', { exact: true }).click();
    await seat.getByRole('button', { name: 'DESIGNATE' }).click();
    await expect.poll(() => title(page)).toBe('MARKETING // KESTREL');
    await page.evaluate(() => window.marketingFixture.focus());
    await page.waitForTimeout(300);
    expect(await title(page)).toBe('MARKETING // KESTREL');
    await seat.getByRole('button', { name: 'CLEAR' }).click();
    await expect.poll(() => title(page)).toBe('MARKETING // NO CMO');
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('the path zooms down three levels and every crumb is a door back up; each level is narrowed to its subtree', async () => {
    const { page, errors } = await openOffice(ctx, 1280);
    await tile(page, 'northwind').click();
    await page.locator('[data-mkt-level="northwind"]').waitFor();
    await page.locator('[data-mkt-level="northwind"] [data-mkt-board] .mkb-grid').waitFor();
    expect(await pathText(page)).toBe('HOUSE › Northwind');
    expect(await page.locator('.mkt-tabs [role="tab"]').allTextContents()).toEqual(['BOARD', 'CAMPAIGNS', 'ACCOUNTS', 'BRAND', 'LEADS']);
    expect(await page.locator('[data-company-tile]').evaluateAll((els) => els.map((el) => el.dataset.companyTile))).toEqual(['northwind-labs']);
    expect(await page.locator('[data-mko-grid] tbody th').allTextContents()).toEqual(['Northwind', '└ Northwind Labs', '└ Northwind Studio']);
    expect(await page.locator(`[data-campaign-card="${ctx.campaign.id}"]`).count()).toBe(1);

    await tile(page, 'northwind-labs').click();
    await page.locator('[data-mkt-level="northwind-labs"]').waitFor();
    await page.locator('[data-mkt-level="northwind-labs"] [data-mkt-board] .mkb-grid').waitFor();
    expect(await pathText(page)).toBe('HOUSE › Northwind › Northwind Labs');
    expect(await page.locator('[data-mko-grid] tbody th').allTextContents()).toEqual(['└ Northwind Labs', '└ Northwind Studio']);
    expect(await page.locator('[data-part="posts"] [data-post-row]').count()).toBe(1);
    expect(await page.locator('[data-cell="you"] .hlth-num').textContent()).toBe('1');
    expect(await page.locator('[data-campaign-card]').count()).toBe(0);

    await tile(page, 'northwind-studio').click();
    await page.locator('[data-mkt-level="northwind-studio"]').waitFor();
    expect(await pathText(page)).toBe('HOUSE › Northwind › Northwind Labs › Northwind Studio');
    expect(await page.locator('[data-company-tile]').count()).toBe(0);
    expect(await page.locator('[data-mkt-path] [aria-current="page"]').textContent()).toBe('Northwind Studio');

    await page.locator('[data-mkt-path] button', { hasText: /^Northwind$/ }).click();
    expect(await pathText(page)).toBe('HOUSE › Northwind');
    await page.locator('[data-mkt-path] button', { hasText: 'HOUSE' }).click();
    expect(await pathText(page)).toBe('HOUSE');
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('a company\'s tabs: its campaigns, its accounts\' check, its own brand kit, the house\'s one lead book', async () => {
    const { page, errors } = await openOffice(ctx, 1280);
    await tile(page, 'brookmere').click();
    const tab = async (id) => { await page.locator(`.mkt-tabs [data-tab="${id}"]`).click(); await page.locator(`[data-mkt-tab="${id}"]`).waitFor(); };

    await tab('campaigns');
    await page.locator('[data-campaigns-board] .settings-note', { hasText: 'No campaigns yet' }).waitFor();
    expect(await page.locator('[data-campaign-row]').count()).toBe(0);
    await page.locator('[data-mkt-path] button', { hasText: 'HOUSE' }).click();
    await tile(page, 'northwind').click();
    await tab('campaigns');
    await page.locator(`[data-campaign-row="${ctx.campaign.id}"]`).waitFor();
    // A campaign opens in place; the way back stands above it.
    await page.locator(`[data-campaign-row="${ctx.campaign.id}"]`).click();
    await page.locator(`[data-campaign-page="${ctx.campaign.id}"]`).waitFor();
    expect(await page.locator('[data-campaign-row]').count()).toBe(0);
    await page.locator('.outreach-back', { hasText: '← CAMPAIGNS' }).click();
    expect(await page.locator('[data-campaign-row]').count()).toBe(1);

    await tab('accounts');
    await page.locator('.social-check-company').first().waitFor({ timeout: 30000 });
    expect(await page.locator('.social-check-name').allTextContents()).toEqual(['Northwind', 'Northwind Labs', 'Northwind Studio']);
    expect(await page.locator('.social-check-name', { hasText: 'UNSORTED' }).count()).toBe(0);

    await tab('brand');
    await page.locator('[data-mkt-tab="brand"] .bk').waitFor({ timeout: 30000 });
    // The kit opened is the company's own (a company is its kit).
    await expect.poll(() => page.locator('[data-mkt-tab="brand"] .bk-head-facts').textContent()).toMatch(/^northwind · YOURS/);

    await tab('leads');
    expect(await page.locator('.mkt-whole').textContent()).toBe('LEADS · WHOLE HOUSE');
    // The ledger opens on its funnel (SDT-6): the tab names it, so no heading repeats it.
    await page.locator('[data-mkt-tab="leads"] .lfn').waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('a card\'s landing zooms to its campaign\'s company and page; a landing naming no campaign opens SEAT', async () => {
    const landing = encodeURIComponent(JSON.stringify({ campaignId: ctx.campaign.id }));
    const { page, errors } = await openOffice(ctx, 1280, { query: `?landing=${landing}`, ready: '[data-mkt-level="northwind"][data-mkt-tab="campaigns"] [data-campaign-page]' });
    expect(await pathText(page)).toBe('HOUSE › Northwind');
    expect(await page.locator('[data-campaign-page] .campaign-page-name').textContent()).toBe('Launch Week');
    // While the window is open (the tray's door on a mounted window).
    await page.locator('[data-mkt-path] button', { hasText: 'HOUSE' }).click();
    await tile(page, 'brookmere').click();
    await page.evaluate((id) => window.marketingFixture.land({ campaignId: id }), ctx.campaign.id);
    await page.locator('[data-mkt-level="northwind"][data-mkt-tab="campaigns"] [data-campaign-page]').waitFor();
    await page.evaluate(() => window.marketingFixture.land({ seat: true }));
    await page.locator('[data-mkt-level="house"][data-mkt-tab="seat"] [data-cmo-row]').waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('the last place is remembered per house: a reload returns to it, another wallet never sees it', async () => {
    const context = await ctx.browser.newContext();
    const first = await openOffice(ctx, 1100, { context });
    await tile(first.page, 'brookmere').click();
    await first.page.locator('.mkt-tabs [data-tab="accounts"]').click();
    await first.page.close();
    const again = await openOffice(ctx, 1100, { context, ready: '[data-mkt-level="brookmere"][data-mkt-tab="accounts"]' });
    expect(await pathText(again.page)).toBe('HOUSE › Brookmere');
    await again.page.close();
    const other = await openOffice(ctx, 1100, { context, query: '?wallet=0x00000000000000000000000000000000000000aa' });
    expect(await pathText(other.page)).toBe('HOUSE');
    await other.page.close();
    await context.close();
  }, 120000);

  it('legible: no label under 13px and no sideways spill, at HOUSE and at a company, wide and narrow', async () => {
    for (const width of [1400, 720, 420]) {
      const { page, errors } = await openOffice(ctx, width, { height: 1000 });
      await page.locator('[data-mkt-board] .hlth-cell').first().waitFor();
      await page.locator('[data-mko-grid]').waitFor();
      expect(await page.evaluate(smallText), `HOUSE at ${width}px`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `HOUSE ${width}px spills`).toBeLessThanOrEqual(1);
      expect(await page.evaluate(spill), `HOUSE ${width}px`).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `house-${width}.png`), fullPage: true });
      await tile(page, 'northwind').click();
      await page.locator('[data-mkt-level="northwind"] [data-mkt-board] .hlth-cell').first().waitFor();
      expect(await page.evaluate(smallText), `company at ${width}px`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `company ${width}px spills`).toBeLessThanOrEqual(1);
      expect(await page.evaluate(spill), `company ${width}px`).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `company-${width}.png`), fullPage: true });
      expect(errors).toEqual([]);
      await page.close();
    }
  }, 180000);
});

/**
 * In the page: the health fold over the same real reads the window made, at
 * `now` and a minute before (the board's clock is its read's; an age may
 * cross a minute between the two).
 */
const foldCells = (companyId) => `(async () => {
  const [{ marketingHealth }, { subtreeOf }, a, c, q, r, k, w, m] = await Promise.all([
    import('/frontend/app/RelinkShell/marketing/marketing-health.js'), import('/frontend/app/RelinkShell/marketing-overview/overview-fold.js'),
    import('/frontend/services/social-accounts-client.js'), import('/frontend/services/campaigns-client.js'), import('/frontend/services/social-channels-client.js'),
    import('/frontend/services/marketing-results-client.js'), import('/frontend/services/social-check-client.js'), import('/frontend/services/waiting-client.js'),
    import('/frontend/services/mandate-client.js')]);
  const [h, bench, queue, results, links, check, waiting, mandate] = await Promise.all([a.getHouseAccounts(), c.getCampaigns(), q.getPostQueue(),
    r.getResults(), r.getLinks(), k.getHouseCheck(), w.getWaiting(), m.getMandate()]);
  const data = { campaigns: bench.campaigns, queue: queue.queue, results, links: links.links, site: links.site, check: check.check };
  const scope = ${JSON.stringify(companyId)} ? subtreeOf(h.companies, ${JSON.stringify(companyId)}) : null;
  const at = (now) => marketingHealth({ data, errors: {}, waiting, mandate: { view: mandate, error: null }, accounts: h.accounts, scope, now })
    .map(({ part, level, value, what, title }) => ({ part, level, value, what, title }));
  return [at(Date.now()), at(Date.now() - 60000)];
})()`;

/** The strip as drawn, cell by cell. */
const drawnCells = (page) => page.locator('[data-mkt-board] .hlth-cell').evaluateAll((els) => els.map((el) => ({
  part: el.dataset.cell, level: [...el.classList].find((k) => k.startsWith('is-')).slice(3),
  value: el.querySelector('.hlth-num').textContent, what: el.querySelector('.hlth-what').textContent, title: el.title,
})));

const asDrawn = (cells) => cells.map((c) => ({ ...c, value: c.value === null ? '—' : String(c.value) }));
/** In the page: does a panel's top stand inside the viewport? */
const inView = (part) => `(() => { const r = document.querySelector('[data-part="${part}"]').getBoundingClientRect(); return r.top >= -1 && r.top < window.innerHeight; })()`;

describe('MARKETING — the BOARD: one health strip, panels on the 12-column grid', () => {
  it('the strip is the health fold on the same reads, at HOUSE (eight cells) and at a company (six)', async () => {
    const { page, errors } = await openOffice(ctx, 1400);
    await page.locator('[data-mkt-board] .hlth-cell').first().waitFor();
    for (const companyId of [null, 'northwind']) {
      if (companyId) { await tile(page, companyId).click(); await page.locator(`[data-mkt-level="${companyId}"] [data-mkt-board] .hlth-cell`).first().waitFor(); }
      const [now, before] = (await page.evaluate(foldCells(companyId))).map(asDrawn);
      const drawn = await drawnCells(page);
      expect(drawn.map((c) => c.part)).toEqual(companyId ? ['you', 'accounts', 'queue', 'campaigns', 'results', 'legal']
        : ['you', 'accounts', 'queue', 'campaigns', 'results', 'links', 'legal', 'mandate']);
      for (const [i, cell] of drawn.entries()) expect([now[i], before[i]], `${companyId || 'HOUSE'} ${cell.part}`).toContainEqual(cell);
    }
    // The band that used to repeat the tray is gone; READ NOW stands beside the path.
    expect(await page.locator('[data-mko-band]').count()).toBe(0);
    expect(await page.locator('.mkt-pathrow .mkt-read').textContent()).toBe('READ NOW');
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('every cell\'s press lands: posts narrowed, a tab, a panel brought into view, the platforms read now', async () => {
    const { page, errors } = await openOffice(ctx, 1280, { height: 600 });
    await page.locator('[data-mkt-board] .hlth-cell').first().waitFor();
    const cell = (part) => page.locator(`[data-cell="${part}"]`);
    const showing = () => page.locator('[data-showing]').textContent();
    const rows = () => page.locator('[data-part="posts"] [data-post-row]').evaluateAll((els) => els.map((el) => el.dataset.postRow));

    await cell('you').click();
    expect(await showing()).toBe('SHOWING AWAITING · SHOW ALL');
    expect((await rows()).length).toBe(2);
    await expect.poll(() => page.evaluate(inView('posts'))).toBe(true);
    await cell('queue').click();
    expect(await showing()).toBe('SHOWING FAILED · SHOW ALL');
    expect(await rows()).toEqual(['f1']);
    await cell('legal').click();
    expect(await showing()).toBe('SHOWING AWAITING · LEGAL MARK · SHOW ALL');
    await page.locator('[data-showing]').click();
    expect(await page.locator('[data-showing]').count()).toBe(0);

    for (const part of [`campaign:${ctx.campaign.id}`, 'links']) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await cell(part === 'links' ? 'links' : 'campaigns').click();
      await expect.poll(() => page.evaluate(inView(part)), part).toBe(true);
    }

    const sweep = page.waitForResponse((r) => r.url().endsWith('/api/v1/marketing/results/sweep') && r.request().method() === 'POST');
    await cell('results').click();
    expect((await sweep).status()).toBe(200);
    await expect.poll(() => page.locator('.mkt-read').textContent()).toBe('READ NOW');

    await cell('accounts').click();
    await page.locator('[data-mkt-tab="accounts"]').waitFor();
    await page.locator('.mkt-tabs [data-tab="board"]').click();
    await cell('mandate').click();
    await page.locator('[data-mkt-tab="seat"] section.mandate').waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('calm: a being\'s change to the bench waits while the operator is at the window, and lands when they leave', async () => {
    const { page, errors } = await openOffice(ctx, 1280, { height: 900 });
    const panels = () => page.locator('[data-mkt-board] [data-part^="campaign:"]').count();
    await page.locator('[data-mkt-board] .hlth-cell').first().waitFor();
    const before = await panels();
    await page.hover('[data-mkt-board] [data-part="posts"]');
    const house = ctx.auth.address;
    await (await campaignStoreFor(house)).add({ name: 'Late Add', companyId: 'brookmere', goal: { kind: 'signups' } }, await campaignContextFor(house), house);
    await page.evaluate(() => window.dispatchEvent(new window.Event('neuma:campaigns-changed')));
    await page.waitForTimeout(1500);
    expect(await panels(), 'held while the pointer is on the board').toBe(before);
    await page.mouse.move(2, 2);
    await expect.poll(panels, { timeout: 10000 }).toBe(before + 1);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);
});
