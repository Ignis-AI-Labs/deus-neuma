// MARKETING slice 6 — ONE WINDOW (marketing-panel-plan.md §5), in real
// Chromium: the PRODUCTION registry's outreach windows inside the production
// WindowManager and taskbar (marketing-one-window-page.jsx), on the real routes
// over a real signed-wallet session and the real stores on tmp disk
// (marketing-office-kit.js, read-only). No double (RULE 0); placeholder keys,
// no scheduler — nothing here can reach a platform.
//
// Proven: each retired window's id opens MARKETING at its place (a platform →
// its account level; SOCIAL CHECK → ACCOUNTS, BRAND KITS → BRAND, LEADS →
// LEADS) and COMMUNITY's TELEGRAM and DISCORD still open their own; a saved
// layout naming old windows folds into one MARKETING, never a blank window;
// the AccountMark (and a platform named on the board) is the door to the
// account level from the BOARD, a PLATFORM panel's title, NEXT 7 DAYS and the
// ACCOUNTS cards; the account level shows one head (standing as marks, the
// month once — show-dont-tell SDT-6), its holder and crew in place, and its
// queue, narrowed to the account; the standing and queue doors land on it exactly;
// the launcher's REACH shows MARKETING, every public platform (each opening
// MARKETING on it — Design note, 2026-10-27: […]) and COMMUNITY; 13px and no
// spill at 1400 / 720 / 420.
/* global window */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { startMarketingOffice, stopMarketingOffice, smallText, spill } from '../helpers/marketing-office-kit.js';
import { postQueue } from '../../backend/services/social/post-queue.js';

const SHOTS = '/tmp/neuma-slice6-shots';
const OFFICE = '[data-window-id="marketing"] [data-marketing-office]';
let ctx;
let labsDraft;
let coreDraft;

beforeAll(async () => {
  ctx = await startMarketingOffice('marketing-one-window-');
  const queue = await postQueue.load();
  labsDraft = queue.find((e) => e.accountId === 'x-2' && e.status === 'draft').id;
  coreDraft = queue.find((e) => e.accountId === 'x-1' && e.status === 'draft').id;
  await fs.mkdir(SHOTS, { recursive: true });
}, 180000);

afterAll(async () => { await stopMarketingOffice(ctx); }, 30000);

// impure — this file's desk on the kit's own origin; `saved` is a layout written through the desk's own store first.
const openDesk = async ({ width = 1400, saved = null } = {}) => {
  const page = await (await ctx.browser.newContext()).newPage();
  await page.setViewportSize({ width, height: 1100 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const fixture = JSON.stringify({ token: ctx.auth.token, wallet: ctx.auth.address, saved });
  await page.route('**/one-window', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><body style="background:#000"><script>window.oneWindowFixture=${fixture}</script><div id="root"></div><script type="module" src="/test/helpers/marketing-one-window-page.jsx"></script></body></html>`,
  }));
  await page.goto(ctx.url('one-window'));
  await page.waitForFunction(() => Boolean(window.desk), null, { timeout: 60000 });
  return { page, errors };
};

const windowsOf = (page) => page.evaluate(() => window.desk.windows());
const level = (page, key) => page.locator(`${OFFICE} .mkt-body[data-mkt-level="account"][data-mkt-account="${key}"]`);
const crumbs = (page) => page.locator(`${OFFICE} [data-mkt-path]`).innerText();
const atHouseBoard = async (page) => page.locator(`${OFFICE} .mkt-body[data-mkt-level="house"][data-mkt-tab="board"] [data-mko-grid]`).waitFor({ timeout: 60000 });
const backToHouse = async (page) => { await page.locator(`${OFFICE} .mkt-crumb`, { hasText: 'HOUSE' }).click(); await atHouseBoard(page); };

describe('MARKETING slice 6 — one window', () => {
  it('each retired window\'s id opens MARKETING at its place; COMMUNITY\'s open their own', async () => {
    const { page, errors } = await openDesk();
    // x and bluesky: the house's first account on each (both Northwind's); the rest: the platform, no account yet.
    const PLACES = [['x', 'x:x-1', /HOUSE\s*›\s*Northwind\s*›\s*X/], ['bluesky', 'bluesky:bluesky-1', /Northwind\s*›\s*BLUESKY/],
      ['tiktok', 'tiktok:', /^HOUSE\s*›\s*TIKTOK$/], ['youtube', 'youtube:', /YOUTUBE/], ['facebook', 'facebook:', /FACEBOOK/],
      ['mastodon', 'mastodon:', /MASTODON/], ['linkedin', 'linkedin:', /LINKEDIN/]];
    for (const [id, key, path_] of PLACES) {
      await page.evaluate((w) => window.desk.open(w), id);
      await level(page, key).waitFor({ timeout: 30000 });
      expect(await crumbs(page), `${id}: the path`).toMatch(path_);
      expect(await windowsOf(page), `${id}: one window`).toEqual(['marketing']);
    }
    // A platform with no account: its first is added right here.
    await page.evaluate((w) => window.desk.open(w), 'tiktok');
    await level(page, 'tiktok:').waitFor();
    await expect.poll(() => page.locator(`${OFFICE} .account-strip [data-door="keys"]`).count(), { timeout: 30000 }).toBe(1);
    for (const [id, tab] of [['socialCheck', 'accounts'], ['brandKits', 'brand'], ['leads', 'leads']]) {
      await page.evaluate((w) => window.desk.open(w), id);
      await page.locator(`${OFFICE} .mkt-body[data-mkt-level="house"][data-mkt-tab="${tab}"]`).waitFor({ timeout: 30000 });
      expect(await windowsOf(page)).toEqual(['marketing']);
    }
    for (const id of ['telegram', 'discord']) {
      await page.evaluate((w) => window.desk.open(w), id);
      await page.locator(`[data-window-id="${id}"] .outreach-tabs [role="tab"]`, { hasText: 'CAMPAIGNS' }).waitFor({ timeout: 30000 });
    }
    expect(await windowsOf(page)).toEqual(['marketing', 'telegram', 'discord']);
    expect(await page.locator('.fwin.is-blank').count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 240000);

  it('a saved layout naming old windows folds into one MARKETING at the first one\'s place — never a blank window', async () => {
    const saved = [{ id: 'tiktok' }, { id: 'x' }, { id: 'leads' }, { id: 'telegram' }, { id: 'socialCheck' }];
    const { page, errors } = await openDesk({ saved });
    await level(page, 'tiktok:').waitFor({ timeout: 60000 });
    expect(await windowsOf(page)).toEqual(['marketing', 'telegram']);
    expect(await page.locator('.fwin.is-blank').count()).toBe(0);
    // The fold is written back: the next load reads MARKETING, not the old ids.
    const key = `${ctx.auth.address.toLowerCase()}:win:desk:windows`; // the desk's own key (storage-scope.js scopedKey, desk 1)
    expect(JSON.parse(await page.evaluate((k) => window.localStorage.getItem(k), key))).toEqual([{ id: 'marketing' }, { id: 'telegram' }]);
    // MARKETING already in the layout: its own remembered place stands (the account level it was left on).
    await page.reload();
    await level(page, 'tiktok:').waitFor({ timeout: 60000 });
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('the AccountMark is the door to the account level — from the BOARD, a PLATFORM panel, NEXT 7 DAYS and ACCOUNTS', async () => {
    const { page, errors } = await openDesk();
    await page.evaluate(() => window.desk.open('marketing'));
    await atHouseBoard(page);
    const presses = [
      ['a POSTS row\'s AccountMark', `${OFFICE} [data-post-row] button[data-account-mark="x-1"]`, 'x:x-1'],
      ['the PLATFORM panel\'s title', `${OFFICE} [data-part="platform:x"] button.mkk-plat[data-platform="x"]`, 'x:x-1'],
      ['a NEXT 7 DAYS lane', `${OFFICE} .mkk-lane[data-lane="x"] button.mkk-plat`, 'x:x-1'],
      ['a campaign\'s sub', `${OFFICE} .mko-subs button[data-account-mark="bluesky-1"]`, 'bluesky:bluesky-1'],
    ];
    for (const [what, selector, key] of presses) {
      await page.locator(selector).first().click();
      await level(page, key).waitFor({ timeout: 30000 });
      expect(await crumbs(page), what).toMatch(/Northwind/);
      await backToHouse(page);
    }
    // ACCOUNTS: the card's mark opens the account under its own company.
    await page.locator(`${OFFICE} .mkt-tabs [data-tab="accounts"]`).click();
    await page.locator(`${OFFICE} .sc-card[data-account="x-1"] button[data-account-mark="x-1"]`).click();
    await level(page, 'x:x-1').waitFor({ timeout: 30000 });
    expect(await crumbs(page)).toMatch(/HOUSE\s*›\s*Northwind\s*›\s*X/);
    // Any depth: an account under a subsidiary stands under its whole path.
    await page.evaluate(() => window.desk.door({ kind: 'account', channelId: 'x', accountId: 'x-2' }));
    await level(page, 'x:x-2').waitFor({ timeout: 30000 });
    expect(await crumbs(page)).toMatch(/HOUSE\s*›\s*Northwind\s*›\s*Northwind Labs\s*›\s*X/);
    // The crumb above is a door back up: the company's own board.
    await page.locator(`${OFFICE} .mkt-crumb`, { hasText: 'Northwind Labs' }).click();
    await page.locator(`${OFFICE} .mkt-body[data-mkt-level="northwind-labs"][data-mkt-tab="board"]`).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, 180000);

  it('the account level: one head (the account, its standing marks, the month once), its holder in place, its queue — and no CAMPAIGNS tab', async () => {
    const { page, errors } = await openDesk();
    await page.evaluate(() => window.desk.door({ kind: 'account', channelId: 'x', accountId: 'x-1' }));
    const at = level(page, 'x:x-1');
    await at.locator('.pc-head').waitFor({ timeout: 60000 });
    // One board, so no tab names it; the queue stands beneath the head.
    await at.locator('.qcal').waitFor({ timeout: 30000 });
    expect(await at.locator('.outreach-tabs [role="tab"]').count()).toBe(0);
    // The head: the account by its mark (not a door onto where it stands), then KEYS · HOLDER · CREW as marks.
    expect(await at.locator('.pc-head .ah-id > [data-account-mark="x-1"]').evaluate((el) => el.tagName)).toBe('SPAN');
    expect(await at.locator('.pc-head [data-standing]').evaluateAll((els) => els.map((el) => el.dataset.standing))).toEqual(['keys', 'holder', 'crew']);
    expect(await at.locator('[data-standing="crew"]').getAttribute('title')).toMatch(/works every X \(Twitter\) account/);
    // Narrowed to x-1: X holds two drafts awaiting the operator (x-1's and x-2's); this level counts and lists one — once, in the band.
    await expect.poll(() => at.locator('.waiting-band-row').count(), { timeout: 15000 }).toBe(1);
    expect(await at.locator('.waiting-band-h b').innerText()).toBe('1');
    expect(await at.locator('.pc-await').count()).toBe(0);
    expect(await at.locator('.waiting-band-row .waiting-band-text').innerText()).toContain('core account');
    // The month once: the head's strip; the queue's month draws no legend of the same counts.
    expect(await at.locator('.pc-head .amm-n').count()).toBe(5);
    expect(await at.locator('.qcal-legend').count()).toBe(0);
    // The holder, in place: only the marketing seats may hold it (no CMO here: none seated, SEAT A CMO beside), no
    // company picker, no other account's row.
    await at.locator('[data-standing="holder"]').click();
    await at.locator('[data-holder-drawer]').waitFor();
    expect(await at.locator('[data-holder-drawer] .ps-choice').count()).toBe(0);
    expect(await at.locator('[data-holder-drawer] .door-btn', { hasText: 'SEAT A CMO' }).count()).toBe(1);
    expect(await at.locator('.account-strip, .company-picker').count()).toBe(0);
    // A post's card opens on the queue: x-1's own, never x-2's beside it.
    await page.evaluate((id) => window.desk.queueJump({ kind: 'queue', channelId: 'x', entryId: id }), coreDraft);
    await at.locator(`.queue-card[data-entry-id="${coreDraft}"]`).waitFor({ timeout: 30000 });
    expect(await at.locator(`.queue-card[data-entry-id="${labsDraft}"]`).count()).toBe(0);
    // The crew, in place: the platform's, for every account.
    await at.locator('[data-standing="crew"]').click();
    await at.locator('.ps-drawer[aria-label="the crew"]').waitFor();
    // Campaigns are the company's: the account names the ones it carries, each a press to its page on Northwind's CAMPAIGNS (Design note, 2026-11-12.
    await at.locator('[data-account-campaigns] [data-account-campaign]').first().click();
    await page.locator(`${OFFICE} .mkt-body[data-mkt-level="northwind"][data-mkt-tab="campaigns"] [data-campaign-page]`).waitFor({ timeout: 30000 });
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('the standing and queue doors land on the account level exactly — STANDING open on its drawer, the post\'s card marked', async () => {
    const { page, errors } = await openDesk();
    await page.evaluate(() => window.desk.door({ kind: 'standing', channelId: 'x', accountId: 'x-1', drawer: 'crew' }));
    await level(page, 'x:x-1').locator('.ps-drawer[aria-label="the crew"]').waitFor({ timeout: 60000 });
    // A queue door onto x-2's post (no account named — the post's own is found), from a closed window and an open one.
    await page.evaluate((id) => window.desk.queueJump({ kind: 'queue', channelId: 'x', entryId: id }), labsDraft);
    const card = level(page, 'x:x-2').locator(`.queue-card[data-entry-id="${labsDraft}"]`);
    await card.waitFor({ timeout: 30000 });
    await expect.poll(() => card.evaluate((el) => el.classList.contains('is-wait-landed')), { timeout: 10000 }).toBe(true);
    // The backend's WAITING ON YOU row still names the platform as its app: it lands the same.
    await page.evaluate(() => window.desk.door({ kind: 'account', channelId: 'bluesky' }));
    await level(page, 'bluesky:bluesky-1').waitFor({ timeout: 30000 });
    await page.evaluate((id) => window.desk.jump({ app: 'x', channelId: 'x', entryId: id, section: 'posts' }), labsDraft);
    await level(page, 'x:x-2').locator(`.queue-card[data-entry-id="${labsDraft}"]`).waitFor({ timeout: 30000 });
    // A HOLDER door on the account it is already on opens its holder choice there, in place.
    await page.evaluate(() => window.desk.door({ kind: 'standing', channelId: 'x', accountId: 'x-2', drawer: 'holder' }));
    await level(page, 'x:x-2').locator('[data-holder-drawer]').waitFor({ timeout: 30000 });
    expect(await windowsOf(page)).toEqual(['marketing']);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('the launcher\'s REACH: MARKETING, every public platform, and COMMUNITY\'s TELEGRAM and DISCORD', async () => {
    const { page, errors } = await openDesk();
    await page.locator('.taskbar-launcher').click();
    const reach = page.locator('.launcher-section[data-category="reach"] .launcher-tile');
    await reach.first().waitFor();
    expect((await reach.evaluateAll((els) => els.map((el) => el.dataset.appId))).sort())
      .toEqual(['bluesky', 'discord', 'facebook', 'linkedin', 'marketing', 'mastodon', 'telegram', 'tiktok', 'x', 'youtube']);
    expect(await page.locator('.launcher-tile[data-app-id="brandKits"], .launcher-tile[data-app-id="leads"], .launcher-tile[data-app-id="socialCheck"]').count()).toBe(0);
    await page.locator('.launcher').screenshot({ path: path.join(SHOTS, 'dock-after.png') });
    await page.locator('.launcher-tile[data-app-id="marketing"]').click();
    await atHouseBoard(page);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('a platform\'s tile opens MARKETING on that platform — one window, never its own', async () => {
    const { page, errors } = await openDesk();
    await page.locator('.taskbar-launcher').click();
    await page.locator('.launcher-tile[data-app-id="tiktok"]').click();
    await page.locator(`${OFFICE} [data-mkt-level="account"][data-mkt-account^="tiktok:"]`).waitFor({ timeout: 60000 });
    expect(await page.locator('[data-window-id="tiktok"]').count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('legible: the account level at 1400 / 720 / 420 — no label under 13px, nothing spills', async () => {
    for (const width of [1400, 720, 420]) {
      const { page, errors } = await openDesk({ width });
      await page.evaluate(() => window.desk.door({ kind: 'account', channelId: 'x', accountId: 'x-1' }));
      const at = level(page, 'x:x-1');
      await at.locator('.qcal').waitFor({ timeout: 60000 });
      await at.locator('[data-standing="holder"]').click();
      await at.locator('[data-holder-drawer]').waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, `account-${width}.png`), fullPage: true });
      expect.soft(await page.evaluate(smallText, OFFICE), `account level at ${width}px: under 13px`).toEqual([]);
      expect.soft(await page.evaluate(spill, OFFICE), `account level at ${width}px: spills`).toEqual([]);
      expect(errors).toEqual([]);
      await page.close();
    }
  }, 240000);
});
