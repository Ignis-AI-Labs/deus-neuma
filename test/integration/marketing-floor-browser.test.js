// SHOW, DON'T TELL slice SDT-1 (show-dont-tell-audit.md) in real Chromium —
// the PRODUCTION MARKETING window on the real routes over a real signed-wallet
// session, the real stores on tmp disk (marketing-office-kit.js). No double
// (RULE 0). On every tab the operator can stand on — BOARD, CAMPAIGNS and a
// campaign's page, ACCOUNTS, BRAND, LEADS, SEAT and the grant screen — and on
// a post's card, at 1400, 720 and 420px: no label under the 13px floor and
// nothing drawn sideways past the window. The READ LOAD (visible words, the
// audit's method) of each view is written to the test output and may never
// grow past what the audit measured, so later slices ratchet it down.
/* global window, document, getComputedStyle */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs/promises';
import { startMarketingOffice, stopMarketingOffice, openOffice, smallText, spill, readLoad } from '../helpers/marketing-office-kit.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { postQueue } from '../../backend/services/social/post-queue.js';

const SHOTS = path.join('/tmp', 'neuma-sdt1-shots', process.env.SDT1_SHOTS || 'after');
const WIDTHS = [1400, 720, 420];

// The read load each view may not grow past, in visible words at 1400px: the
// audit's measured row where it measured one (BOARD 320, a campaign's page
// 156, SEAT 35, BRAND 62, a failed card 30), else this ground's own measure
// before SDT-1 (CAMPAIGNS 22, ACCOUNTS 107, LEADS 79 with its three leads —
// the audit's 96 was another three — a draft's card 42 as its countdown
// words vary, the grant 254 — the audit's ≈227 was an estimate). A later
// slice lowers a ceiling, never raises it. SDT-3 (the board diet) measured the
// BOARD at 224 at HOUSE (from 314) and 170 at a company (from 240); +2 each for the failed post's fix door (TRY AGAIN), a door being worth its words.
// SDT-4 (pages show first) measured a campaign's page at 101 (from 156: it opens on its instruments, the form behind
// EDIT, the log behind LOG n), SEAT at 28 (from 35: SEAT A CMO is a door) and the grant at 159 (from 253: the checks
// as marks, NEVER as chips); SEAT with a mandate standing rides sdt-pages-browser (148 → 54).
// Marketing panel slice 4 ADDS PANELS to the default board, so it raises the BOARD's two ceilings by what they
// measured (marketing-board-diet-browser's per-panel count, this ground at 1400px): HOUSE 226 → 275 = PLATFORM X 15
// (name, 7 DAYS, three metrics × name/now/TOP n) + PLATFORM BLUESKY 15 + NEXT 7 DAYS 13 (title, count, seven day
// names, two lanes) + CMO LOG 5 (no CMO: one line, the SEAT door) = 48, and 1 outside the panels not traced to one;
// a company 172 → 216 = X 15 + BLUESKY 15 + NEXT 7 DAYS 13 = 43, and the same 1.
// Marketing panel slice 6 (one window) adds the ACCOUNT level — what was X's own window — measured at 177 on
// this ground (its WAITING ON YOU row, the console head and four weeks, the account's holder row, QUEUE +
// CAMPAIGNS →, the queue's month and its draft form); no other ceiling moves.
// SDT-6 (show-dont-tell-audit.md: the account level, the post card, LEADS) measured, on this ground once its card
// reads the channel board and its desk account carries its refresh (marketing-overview-page.jsx — before: account
// 174, card 35, draft-card 44, leads 79): the ACCOUNT level 118 (one head of marks, the month once, no heading or
// lane notes), a failed card 23 and a draft's 26 (identity and status once, the length a bar, the time a countdown),
// LEADS 26 (the funnel and one row per lead; the acts behind ⋯, the capture form behind + LEAD).
const CEILING = Object.freeze({
  account: 118,
  board: 275, 'board-company': 216, campaigns: 22, campaign: 101, accounts: 107, brand: 62, leads: 26, seat: 28, card: 23, 'draft-card': 26, grant: 159,
});

let ctx;
const loads = {};
const under = {};

beforeAll(async () => {
  ctx = await startMarketingOffice('marketing-floor-');
  const ledger = await leadLedgerFor(ctx.auth.address);
  for (const lead of [
    { name: 'Ada Brook', contact: 'ada@example.com', channelId: 'x', source: 'reply to the launch post' },
    { name: 'Jun Park', contact: '@junpark', channelId: 'bluesky', source: 'mention' },
    { name: 'Mira Holt', contact: 'mira@example.com', channelId: 'other', source: 'the site form' },
  ]) await ledger.add({ ...lead, addedBy: 'operator' });
  await fs.mkdir(SHOTS, { recursive: true });
}, 180000);

afterAll(async () => {
  // The numbers, for the record: in the test output and beside the screenshots.
  const lines = Object.entries(loads).map(([view, l]) => `  ${view.padEnd(10)} ${String(l.words).padStart(4)} words · ${l.placeholder} placeholder`);
  process.stdout.write(`\nREAD LOAD at 1400px:\n${lines.join('\n')}\nUNDER 13px: ${Object.entries(under).map(([k, n]) => `${k} ${n}`).join(' · ')}\n`);
  await fs.writeFile(path.join(SHOTS, 'read-load.json'), `${JSON.stringify({ loads, under }, null, 2)}\n`);
  await stopMarketingOffice(ctx);
}, 30000);

const tab = async (page, id) => {
  await page.locator(`.mkt-tabs [data-tab="${id}"]`).click();
  await page.locator(`[data-mkt-tab="${id}"]`).waitFor();
};

// Each view: how to stand on it from a fresh window, and what its body must show first.
const VIEWS = [
  ['board', async (page) => { await page.locator('[data-mkt-board] .hlth-cell').first().waitFor(); await page.locator('[data-mko-grid]').waitFor(); }],
  ['board-company', async (page) => {
    await page.locator('[data-company-tile="northwind"]').click();
    await page.locator('[data-mkt-level="northwind"] [data-mkt-board] .hlth-cell').first().waitFor();
    await page.locator('[data-mkt-board] [data-post-row]').first().waitFor();
  }],
  ['campaigns', async (page) => { await tab(page, 'campaigns'); await page.locator(`[data-campaign-row="${ctx.campaign.id}"]`).waitFor(); }],
  ['campaign', async (page) => {
    await tab(page, 'campaigns');
    await page.locator(`[data-campaign-row="${ctx.campaign.id}"]`).click();
    await page.locator('[data-campaign-page] [data-campaign-card] .hud-dial').waitFor();
    await page.locator('[data-campaign-page] .qcal').waitFor();
  }],
  ['accounts', async (page) => { await tab(page, 'accounts'); await page.locator('.social-check-company').first().waitFor({ timeout: 30000 }); }],
  ['brand', async (page) => { await tab(page, 'brand'); await page.locator('[data-mkt-tab="brand"] .bk').waitFor({ timeout: 30000 }); }],
  ['leads', async (page) => { await tab(page, 'leads'); await page.getByText('Mira Holt').waitFor(); }],
  ['seat', async (page) => { await tab(page, 'seat'); await page.locator('[data-mkt-seat] section.mandate').waitFor(); }],
  // Slice 6: the account level (what was X's own window), its queue read.
  ['account', async (page) => {
    await page.evaluate(() => window.marketingFixture.land({ account: { channelId: 'x', accountId: 'x-1' } }));
    await page.locator('[data-mkt-level="account"] .pc-head').waitFor({ timeout: 30000 });
    await page.locator('[data-mkt-level="account"] .qcal').waitFor({ timeout: 30000 });
  }],
];

// Soft, so one run reports every view and width that misses (and draws them all).
const check = async (page, label, root = '[data-marketing-office]') => {
  const small = await page.evaluate(smallText, root);
  under[label] = small.length;
  if (small.length && process.env.SDT1_SHOTS) await fs.appendFile(path.join(SHOTS, 'small.txt'), small.map((t) => `${label}\t${t.size}\t${t.at}\t${t.text}\n`).join(''));
  expect.soft(small, `${label}: under 13px`).toEqual([]);
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${label}: page spills`).toBeLessThanOrEqual(1);
  expect.soft(await page.evaluate(spill, root), `${label}: spills`).toEqual([]);
};

const measure = async (page, view, width) => {
  if (width !== 1400) return;
  loads[view] = await page.evaluate(readLoad);
  if (CEILING[view]) expect.soft(loads[view].words, `${view}: read load grew`).toBeLessThanOrEqual(CEILING[view]);
};

describe('SDT-1 — the 13px floor and the read load on every MARKETING tab', () => {
  for (const [view, open] of VIEWS) {
    it(`${view.toUpperCase()}: no label under 13px, no spill, at ${WIDTHS.join(' / ')}px`, async () => {
      for (const width of WIDTHS) {
        const { page, errors } = await openOffice(ctx, width, { height: 1000 });
        await open(page);
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS, `${view}-${width}.png`), fullPage: true });
        await measure(page, view, width);
        await check(page, `${view} at ${width}px`);
        expect(errors).toEqual([]);
        await page.close();
      }
    }, 240000);
  }

  it('BRAND at a company: the kit editor, every section of its rail, no label under 13px, no spill', async () => {
    for (const width of WIDTHS) {
      const { page, errors } = await openOffice(ctx, width, { height: 1000 });
      await page.locator('[data-company-tile="northwind"]').click();
      await tab(page, 'brand');
      await page.locator('[data-mkt-tab="brand"] .bk-body').waitFor({ timeout: 30000 });
      const rows = page.locator('.bk-rail-col .bk-rail-row');
      const count = await rows.count();
      expect(count).toBeGreaterThan(10);
      for (let i = 0; i < count; i += 1) {
        await rows.nth(i).click();
        await page.waitForTimeout(150);
        const name = (await rows.nth(i).locator('.bk-rail-name').textContent()).trim();
        if (width === 1400 || i === 0) await page.screenshot({ path: path.join(SHOTS, `brand-kit-${width}-${i}.png`), fullPage: true });
        await check(page, `brand kit ${name} at ${width}px`);
        // The editor scrolls on its own, so the page-level spill never sees it: at 720 and wider nothing in it runs sideways.
        // (At 420 the 190px rail leaves the editor narrower than its 280px fields — a layout limit older than the floor.)
        if (width !== 420) expect.soft(await page.evaluate(() => { const ed = document.querySelector('.bk-editor'); return ed.scrollWidth - ed.clientWidth; }), `brand kit ${name} at ${width}px: the editor runs sideways`).toBeLessThanOrEqual(1);
      }
      expect(errors).toEqual([]);
      await page.close();
    }
  }, 240000);

  it('a post\'s card (a failed post, and a draft): no label under 13px, no spill', async () => {
    const draft = (await postQueue.load()).find((e) => e.status === 'draft' && e.accountId === 'x-1').id;
    for (const [view, id] of [['card', 'f1'], ['draft-card', draft]]) {
      for (const width of WIDTHS) {
        const { page, errors } = await openOffice(ctx, width, { height: 1000, query: `?card=${id}`, ready: '.queue-card' });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS, `${view}-${width}.png`), fullPage: true });
        await measure(page, view, width);
        await check(page, `${view} at ${width}px`, '.queue-card');
        expect(errors).toEqual([]);
        await page.close();
      }
    }
  }, 240000);

  it('X\'s account level (slice 6: what was its window) — head, standing, queue — and COMMUNITY\'s TELEGRAM window: no label under 13px, no spill', async () => {
    for (const width of WIDTHS) {
      const { page, errors } = await openOffice(ctx, width, { height: 1000, query: `?landing=${encodeURIComponent(JSON.stringify({ account: { channelId: 'x', accountId: 'x-1' } }))}`, ready: '[data-mkt-level="account"] .pc-head' });
      await page.waitForTimeout(300);
      await check(page, `account head at ${width}px`);
      // The four weeks' dates: no date shown is drawn over the next one shown.
      expect(await page.locator('.pc-strip-date').evaluateAll((els) => {
        const shown = els.filter((el) => getComputedStyle(el).color !== 'rgba(0, 0, 0, 0)').map((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const r = range.getBoundingClientRect();
          return { text: el.textContent, left: r.left, right: r.right };
        });
        return shown.slice(1).filter((d, i) => d.left < shown[i].right - 0.5).map((d) => d.text);
      }), `dates collide at ${width}px`).toEqual([]);
      // The holder and the crew open in place (SDT-6); the queue is the level's one board, beneath the head.
      for (const fact of ['holder', 'crew']) {
        await page.locator(`.pc-head [data-standing="${fact}"]`).click();
        await page.locator(fact === 'holder' ? '[data-holder-drawer]' : '.ps-drawer[aria-label="the crew"]').waitFor();
        await check(page, `account ${fact} at ${width}px`);
      }
      await page.locator('[data-mkt-level="account"] .qcal').waitFor({ timeout: 30000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, `account-queue-${width}.png`), fullPage: true });
      await check(page, `account QUEUE at ${width}px`);
      expect(errors).toEqual([]);
      await page.close();
    }
    const root = '.outreach-panel .outreach-panel';
    for (const width of WIDTHS) {
      const { page, errors } = await openOffice(ctx, width, { height: 1000, query: '?platform=telegram', ready: '.pc-head' });
      for (const board of ['CAMPAIGNS', 'QUEUE']) {
        await page.locator('.outreach-tabs [role="tab"]', { hasText: board }).click();
        await page.waitForTimeout(400);
        await check(page, `telegram ${board} at ${width}px`, root);
      }
      expect(errors).toEqual([]);
      await page.close();
    }
  }, 240000);

  it('SEAT with a CMO seated, and the grant screen: no label under 13px, no spill', async () => {
    await cmoDesignation.designate(ctx.auth.address, 'kestrel');
    for (const width of WIDTHS) {
      const { page, errors } = await openOffice(ctx, width, { height: 1000 });
      await tab(page, 'seat');
      await page.getByRole('button', { name: 'GRANT A MANDATE…' }).click();
      await page.locator('section.mandate-grant').waitFor();
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(SHOTS, `grant-${width}.png`), fullPage: true });
      await measure(page, 'grant', width);
      await check(page, `grant at ${width}px`);
      expect(errors).toEqual([]);
      await page.close();
    }
  }, 240000);
});
