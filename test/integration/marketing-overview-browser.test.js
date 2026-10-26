// The MARKETING overview (campaign plan slice 10) at the window's HOUSE
// level — real Chromium, the PRODUCTION window, the real routes over a real
// signed-wallet session, the real stores on tmp disk, and the house's results
// produced by the REAL stats sweep against local stand-ins
// (marketing-office-kit.js). No double (RULE 0). Screens at three widths are
// written for a person to look at.
/* global document */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { startMarketingOffice, stopMarketingOffice, openOffice } from '../helpers/marketing-office-kit.js';

const SHOTS = path.join(os.tmpdir(), 'neuma-marketing-slice2-shots');
let ctx; let campaign; let auth; let browser; let server;

beforeAll(async () => {
  ctx = await startMarketingOffice('marketing-overview-');
  ({ campaign, auth, browser, server } = ctx);
  await fs.mkdir(SHOTS, { recursive: true });
}, 180000);

afterAll(async () => { await stopMarketingOffice(ctx); }, 30000);

const open = async (width) => {
  const opened = await openOffice(ctx, width);
  await opened.page.locator('[data-mkt-board] .hlth-cell').first().waitFor({ timeout: 60000 });
  await opened.page.locator('[data-mko-grid]').waitFor({ timeout: 60000 });
  return opened;
};

describe('the MARKETING overview — the picture first, every count a door, every mark true', () => {
  it('the strip, the grid, the campaign panel and the posts read the house\'s real numbers; the waiting counts stay reachable', async () => {
    const { page, errors } = await open(1280);
    // What the WAITING ON YOU band counted, now the ◆ YOU cell: its number, and every kind in its hover.
    const you = page.locator('[data-cell="you"]');
    await expect.poll(() => you.locator('.hlth-num').textContent()).toBe('2');
    expect(await you.getAttribute('title')).toBe('◆ YOU — 2 to decide · 1 in groups · 0 asks for you · 0 legal marks · 1 failed · 1 accounts with no company');
    expect(await page.locator('[data-cell="queue"] .hlth-num').textContent()).toBe('1');
    expect(await page.locator('[data-mko-band]').count()).toBe(0);

    // COMPANIES × PLATFORMS: the tree in order, one mark per account.
    const grid = page.locator('[data-mko-grid]');
    // Every company of the house stands, the repo's own kits among them, three levels deep; an empty row reads ·.
    expect(await grid.locator('tbody th').allTextContents()).toEqual(['Brookmere', 'Ignis AI Labs', 'Northwind', '└ Northwind Labs', '└ Northwind Studio', 'Umbrae', 'UNSORTED']);
    expect(await grid.locator('.mko-mark').count()).toBe(5);
    expect(await grid.locator('tbody tr').nth(1).locator('.mko-none').count()).toBe(2);

    // The campaign card: the KPI dial reads the downloads its codes led to, the funnel says who reported.
    const card = page.locator(`[data-campaign-card="${campaign.id}"]`);
    expect(await card.locator('.hud-dial-value').textContent()).toBe('22/100');
    expect(await card.locator('.hud-bar').allTextContents()).toEqual([
      expect.stringMatching(/^TIME\d+% → \d\d-\d\d$/), 'SEEN4.1K', 'ENGAGED88', 'CLICKED61', 'ACTED22',
    ]);
    // How many of the two sent posts reported each step: one dot per post, lit for each that did.
    expect(await card.locator('.hud-bar .mko-frac').evaluateAll((els) => els.map((el) => `${el.getAttribute('aria-label')}:${el.querySelectorAll('i.is-on').length}/${el.querySelectorAll('i').length}`)))
      .toEqual(['1 of 2:1/2', '2 of 2:2/2', '1 of 2:1/2', '1 of 2:1/2']);

    // The posts: numbers where reported, "—" with the reason where not.
    const bsky = page.locator('[data-post-row="p2"]');
    expect(await page.locator('[data-posts-legend] .mko-col').allTextContents()).toEqual(['SEEN', 'LIKES', 'REPLIES', 'SHARES', 'CLICKS', 'DOWNLOADS']);
    expect(await bsky.locator('.mko-num').first().textContent()).toBe('—');
    expect(await bsky.locator('.mko-num').first().getAttribute('title')).toBe('Bluesky counts no views');
    expect(await page.locator('[data-post-row="p1"] .mko-num').allTextContents()).toEqual(['4.1K', '61', '4', '9', '61', '22']);
    // Each number stands under its legend word.
    const under = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('[data-posts-legend] .mko-col')].map((el) => { const r = el.getBoundingClientRect(); return [el.textContent, r.left, r.right]; });
      return [...document.querySelectorAll('[data-post-row="p1"] .mko-num')].map((el) => {
        const r = el.getBoundingClientRect();
        return heads.find(([, l, rt]) => r.left >= l - 1 && r.left <= rt)?.[0] || null;
      });
    });
    expect(under).toEqual(['SEEN', 'LIKES', 'REPLIES', 'SHARES', 'CLICKS', 'DOWNLOADS']);
    expect(await page.locator('[data-mko-matrix] .mko-mcell').allTextContents()).toEqual(['—', '5.4']);
    // A post not out yet opens on its own card, where it is decided; a failed one says why.
    expect(await page.locator('[data-post-row="f1"] [data-status="failed"]').getAttribute('aria-label')).toBe('FAILED');
    expect(await page.locator('[data-post-row="f1"] .mko-post-error').textContent()).toBe('X answered HTTP 503');
    // Its fix by cause: the platform stumbled (5xx), so its door is TRY AGAIN (this page mounts no
    // window manager, so the door draws as its words; sdt-doors-browser proves where it lands).
    expect((await page.locator('[data-post-row="f1"] .mko-post-fix').textContent()).trim()).toBe('TRY AGAIN');
    expect(await page.locator('[data-post-row] [data-status="draft"][aria-label="AWAITING"]').count()).toBe(2);
    // The doors are marks, named on hover: the post's address once it is out, else its card.
    expect(await page.locator('[data-post-row="p1"] a.mko-door').getAttribute('aria-label')).toBe('OPEN THE POST');
    expect(await page.locator('[data-post-row] button.mko-door[aria-label="OPEN ITS CARD"]').count()).toBe(3);
    expect(errors).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, 'overview-house-1280.png'), fullPage: true });
    await page.close();
  }, 120000);

  it('a count is a door: the posts narrow to it, say what they show, and SHOW ALL returns everything; a zoom narrows every panel', async () => {
    const { page } = await open(1280);
    const posts = page.locator('[data-part="posts"]');
    expect(await posts.locator('[data-post-row]').count()).toBe(5);
    await page.locator('[data-cell="you"]').click();
    expect(await posts.locator('[data-post-row]').count()).toBe(2);
    expect(await page.locator('[data-showing]').textContent()).toBe('SHOWING AWAITING · SHOW ALL');
    await page.locator('[data-showing]').click();
    expect(await posts.locator('[data-post-row]').count()).toBe(5);

    // A cell narrows to its accounts.
    await page.locator('[data-mko-grid] tbody tr').filter({ hasText: 'Northwind Labs' }).locator('.mko-cell').click();
    expect(await posts.locator('[data-post-row]').count()).toBe(1);
    expect(await posts.locator('[data-post-row]').first().textContent()).toContain('labs account');
    await page.locator('[data-showing]').click();

    // The zoom: one client company shows nothing of the core company's.
    await page.locator('[data-company-tile="brookmere"]').click();
    await page.locator('[data-mkt-level="brookmere"] [data-mko-grid]').waitFor();
    expect(await page.locator('[data-mko-grid] tbody th').allTextContents()).toEqual(['Brookmere']);
    expect(await page.locator('[data-cell="you"]').getAttribute('title')).not.toContain('no company');
    expect(await page.locator('[data-cell="links"], [data-cell="mandate"]').count()).toBe(0);
    expect(await page.locator('[data-campaign-card]').count()).toBe(0);
    expect(await posts.locator('[data-post-row]').count()).toBe(0);
    await page.close();
  }, 120000);

  it('OPEN on a card zooms to its company and opens its campaign page in place, on its picture, with its asks and its month', async () => {
    const { page, errors } = await open(1280);
    await page.locator(`[data-campaign-card="${campaign.id}"] .mko-open`).click();
    await page.locator('[data-mkt-level="northwind"][data-mkt-tab="campaigns"]').waitFor({ timeout: 15000 });
    expect(await page.locator('[data-mkt-path]').innerText()).toMatch(/^HOUSE\s*›\s*Northwind$/);
    expect(await page.locator('.outreach-back').textContent()).toBe('← CAMPAIGNS');
    expect(await page.locator('[data-campaign-row]').count()).toBe(0);
    // The page opens on the BOARD's own picture of the campaign; its form waits behind EDIT.
    const campaignPage = page.locator(`[data-campaign-page="${campaign.id}"]`);
    await campaignPage.locator('[data-campaign-card] .hud-dial').waitFor({ timeout: 15000 });
    expect(await campaignPage.locator('.campaign-page-name').textContent()).toBe('Launch Week');
    expect(await page.locator('.campaign-editor').count()).toBe(0);
    expect(await campaignPage.locator('[data-campaign-asks] .label-data').first().textContent()).toBe('ASKS');
    expect(await campaignPage.locator('.qcal').count()).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('a group\'s card: REVIEW GROUP reads every copy, APPROVE GROUP decides them with one press (the real route, the real queue)', async () => {
    const d1 = (await postQueue.load()).find((e) => e.accountId === 'x-1' && e.groupId === 'launch-clip');
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?card=${d1.id}`);
    const group = page.locator('[data-group="launch-clip"]');
    await group.waitFor({ timeout: 60000 });
    await group.getByRole('button', { name: 'REVIEW GROUP' }).click();
    const review = page.locator('[data-group-review]');
    await review.waitFor();
    expect(await review.locator('.queue-preview-text').allTextContents()).toEqual(['Thursday: the clip, on the core account.', 'Thursday: the clip, on the labs account.']);
    await page.screenshot({ path: path.join(SHOTS, 'group-review-900.png'), fullPage: true });
    await review.getByRole('button', { name: 'APPROVE GROUP (2 POSTS)' }).click();
    await expect.poll(async () => (await postQueue.load()).filter((e) => e.groupId === 'launch-clip').map((e) => e.status)).toEqual(['approved', 'approved']);
    expect((await postQueue.load()).filter((e) => e.groupId === 'launch-clip').every((e) => e.decidedBy.toLowerCase() === auth.address.toLowerCase())).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('three widths: the picture holds — screens written for a person to look at', async () => {
    for (const width of [1280, 760, 420]) {
      const { page, errors } = await open(width);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.screenshot({ path: path.join(SHOTS, `overview-${width}.png`), fullPage: false });
      expect(errors).toEqual([]);
      expect(overflow, `${width}px scrolls sideways`).toBeLessThanOrEqual(1);
      await page.close();
    }
  }, 180000);
});
