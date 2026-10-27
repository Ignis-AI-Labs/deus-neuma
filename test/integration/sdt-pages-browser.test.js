// SHOW, DON'T TELL slice SDT-4, "pages show first" (show-dont-tell-audit.md
// findings 2, 3, 4, 6) in real Chromium — the PRODUCTION MARKETING window on
// the real routes over a real signed-wallet session, the real stores on tmp
// disk (marketing-office-kit.js). No double (RULE 0). A campaign's page, the
// grant screen and SEAT with a mandate standing: the read load of each, and
// every number each shows — as text, in a field a person reads, and as the
// counts its marks draw (`aria-label`). With SDT4_MODE=before it only records
// them (run on the tree before the slice); otherwise it proves the page opens
// on its instruments with EDIT behind a press, the log is a count door, the
// mandate is marks and a days-left bar, the checks are marks with only a
// failing one open, and every number before is still there — at rest, or (the
// log's stamps, the editor's fields) one named press away.
/* global document */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs/promises';
import { startMarketingOffice, stopMarketingOffice, openOffice, smallText, spill } from '../helpers/marketing-office-kit.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { grantMandate } from '../../backend/services/marketing/mandate/mandate-lifecycle.js';
import { TRIPS } from '../../backend/services/marketing/mandate/mandate-shape.js';

const MODE = process.env.SDT4_MODE === 'before' ? 'before' : 'after';
const SHOTS = path.join('/tmp', 'neuma-sdt4-shots', MODE);
const WIDTHS = [1400, 720, 420];
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

let ctx;
const record = {};

beforeAll(async () => {
  ctx = await startMarketingOffice('marketing-sdt4-');
  await fs.mkdir(SHOTS, { recursive: true });
}, 180000);

afterAll(async () => {
  await fs.writeFile(path.join(SHOTS, 'pages.json'), `${JSON.stringify(record, null, 2)}\n`);
  await stopMarketingOffice(ctx);
}, 30000);

/**
 * In the page: the window's words (the audit's method) and every number under
 * `sel` — in its text, in a filled field, and in the `aria-label` of a mark
 * that draws a count — leaving out the month calendar, which this slice does
 * not touch (its day numerals follow the month).
 */
const inventory = (sel) => {
  const words = (t) => String(t || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  // A month-name date (Oct 31, 2026) is one number; the rest, every run of digits with its joints.
  const MONTH = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}(?:, \d{4})?\b/gi;
  const numbers = (t) => [...(String(t || '').match(MONTH) || []).map(() => 'MDATE'), ...(String(t || '').replace(MONTH, ' ').match(/\d+(?:[.:/-]\d+)*[KMD%]?/g) || [])];
  const root = document.querySelector(sel);
  const shown = (el) => el.getClientRects().length && !el.closest('.qcal, .qcal-legend');
  const calendar = [...root.querySelectorAll('.qcal, .qcal-legend')].flatMap((el) => numbers(el.innerText));
  const text = numbers(root.innerText);
  for (const n of calendar) { const i = text.indexOf(n); if (i !== -1) text.splice(i, 1); }
  const fields = [...root.querySelectorAll('input, textarea')].filter((el) => shown(el) && el.value).flatMap((el) => numbers(el.value));
  const marks = [...root.querySelectorAll('[role="img"][aria-label]')].filter(shown).flatMap((el) => numbers(el.getAttribute('aria-label')));
  return { window: words(document.querySelector('#root').innerText), numbers: [...text, ...fields, ...marks], text: root.innerText };
};

// A number that changes from run to run is taken as what it is; a fraction
// (22/100, the KPI against its target) is its two numbers.
const norm = (list) => list.flatMap((t) => (/^\d+\/\d+$/.test(t) ? t.split('/') : [t])).map((t) => {
  const iso = { [day(-3)]: 'START', [day(7)]: 'END', [day(10)]: 'KPI-BY' };
  if (iso[t]) return iso[t];
  if (t === day(7).slice(5)) return 'END-MD';
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return 'CLOCK';
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) return 'STAMP-DAY';
  if (/^\d+%$/.test(t)) return 'PCT';
  return t;
});

// Every number each view showed before the slice (SDT4_MODE=before on 096fadd7c), and its read load.
const BEFORE = Object.freeze({
  // the log line's day and time; the sub rows' account numbers (x-1, bluesky-1); the editor's KPI target, by-day and window
  campaign: { words: 156, numbers: ['STAMP-DAY', 'CLOCK', '1', '1', '100', 'KPI-BY', 'START', 'END'] },
  // the account choices' numbers, the step numbers, the terms, the end day (twice), the custom days field
  grant: { words: 253, numbers: ['MDATE', 'MDATE', '1', '1', '2', '1', '2', '3', '2', '3', '7', '30', '90', '7', '14'] },
  // x-1 at 2 a day, the end day, DONE FOR YOU's row day and time
  seat: { words: 148, numbers: ['MDATE', 'MDATE', '1', '2', 'CLOCK'] },
});

// The read load measured after the slice: a later slice lowers it, never raises it.
const CEILING = Object.freeze({ campaign: 101, grant: 159, seat: 54 });

// The numbers that left the page at rest, each one named press away.
const BEHIND_A_PRESS = Object.freeze({ campaign: [['STAMP-DAY', 'LOG n'], ['CLOCK', 'LOG n']] });

// What is left of `before` once every number in `after` is taken from it (a multiset difference).
const missing = (before, after) => {
  const left = [...after];
  return before.filter((n) => {
    const i = left.indexOf(n);
    if (i === -1) return true;
    left.splice(i, 1);
    return false;
  });
};

// The words fell; every number before is still on the page at rest, but for
// those named in BEHIND_A_PRESS — and with that press made (`open`), those too.
const proveKept = (view, open = null) => {
  if (MODE === 'before') return;
  const got = record[view];
  expect(got.window, `${view}: the read load fell`).toBeLessThan(BEFORE[view].words);
  expect(got.window, `${view}: the read load grew past its ceiling`).toBeLessThanOrEqual(CEILING[view]);
  expect(missing(BEFORE[view].numbers, norm(got.numbers)), `${view}: numbers gone at rest (after: ${norm(got.numbers).join(' ')})`)
    .toEqual((BEHIND_A_PRESS[view] || []).map(([n]) => n));
  if (open) expect(missing(BEFORE[view].numbers, norm(record[open].numbers)), `${view}: numbers gone even with ${open}`).toEqual([]);
};

const tab = async (page, id) => {
  await page.locator(`.mkt-tabs [data-tab="${id}"]`).click();
  await page.locator(`[data-mkt-tab="${id}"]`).waitFor();
};

const legible = async (page, label) => {
  expect.soft(await page.evaluate(smallText, '[data-marketing-office]'), `${label}: under 13px`).toEqual([]);
  expect.soft(await page.evaluate(spill, '[data-marketing-office]'), `${label}: spills`).toEqual([]);
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${label}: page spills`).toBeLessThanOrEqual(1);
};

const openCampaign = async (page) => {
  await tab(page, 'campaigns');
  await page.locator(`[data-campaign-row="${ctx.campaign.id}"]`).click();
  if (MODE === 'before') await page.locator('.campaign-editor').first().waitFor();
  else await page.locator('[data-campaign-page] [data-campaign-card] .hud-dial').waitFor();
  await page.waitForTimeout(300);
};

const SEAT = 'section.mandate';

describe('SDT-4 — pages show first, every number kept', () => {
  it('a campaign\'s page opens on its instruments; EDIT and LOG are presses; legible at 1400 / 720 / 420', async () => {
    for (const width of WIDTHS) {
      const { page, errors } = await openOffice(ctx, width, { height: 1000 });
      await openCampaign(page);
      await page.screenshot({ path: path.join(SHOTS, `campaign-${width}.png`), fullPage: true });
      if (width === 1400) record.campaign = await page.evaluate(inventory, '[data-campaigns-board]');
      if (MODE === 'after') {
        await legible(page, `campaign at ${width}px`);
        const pageEl = page.locator('[data-campaign-page]');
        // The picture first: the board's own instruments (KPI dial, TIME + funnel bars), no form at rest.
        expect(await pageEl.locator('[data-campaign-card] .hud-dial').count()).toBe(1);
        expect(await pageEl.locator('[data-campaign-card] .hud-bar').count()).toBe(5);
        expect(await page.locator('.campaign-editor').count()).toBe(0);
        // The log is a count door, closed.
        const log = pageEl.locator('[data-log-door]');
        expect(await log.textContent()).toMatch(/^LOG \d+$/);
        expect(await log.getAttribute('aria-expanded')).toBe('false');
        expect(await page.locator('.campaign-log-line').count()).toBe(0);
        if (width === 1400) {
          const n = Number((await log.textContent()).split(' ')[1]);
          await log.click();
          expect(await page.locator('.campaign-log-line').count()).toBe(Math.min(n, 30));
          await pageEl.getByRole('button', { name: 'EDIT', exact: true }).click();
          await page.locator('.campaign-editor').waitFor();
          expect(await page.locator('.campaign-editor input[aria-label="Campaign name"]').inputValue()).toBe('Launch Week');
          await page.screenshot({ path: path.join(SHOTS, `campaign-open-${width}.png`), fullPage: true });
          record['campaign-open'] = await page.evaluate(inventory, '[data-campaigns-board]');
          await legible(page, `campaign, edit + log open, at ${width}px`);
          // CLOSE folds the editor back, the page stays.
          await page.locator('.campaign-editor').getByRole('button', { name: 'CLOSE' }).click();
          expect(await page.locator('.campaign-editor').count()).toBe(0);
          expect(await pageEl.count()).toBe(1);
        }
      }
      expect(errors).toEqual([]);
      await page.close();
    }
    process.stdout.write(`\n${MODE} campaign: ${record.campaign.window} words · numbers ${norm(record.campaign.numbers).join(' ')}\n`);
    proveKept('campaign', 'campaign-open');
  }, 240000);

  it('a NEW campaign opens straight on its form', async () => {
    if (MODE === 'before') return;
    const { page, errors } = await openOffice(ctx, 1400, { height: 1000 });
    await page.locator('[data-company-tile="northwind"]').click();
    await tab(page, 'campaigns');
    await page.getByRole('button', { name: 'NEW CAMPAIGN' }).click();
    await page.locator('.campaign-editor').waitFor();
    expect(await page.locator('[data-campaign-page]').count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('the grant screen: passing checks are marks, a failing one opens with its door; NEVER is six chips', async () => {
    await cmoDesignation.designate(ctx.auth.address, 'kestrel');
    for (const width of WIDTHS) {
      const { page, errors } = await openOffice(ctx, width, { height: 1000 });
      await tab(page, 'seat');
      await page.getByRole('button', { name: 'GRANT A MANDATE…' }).click();
      await page.locator('section.mandate-grant [data-check="accounts"][data-ok="false"]').waitFor({ timeout: 30000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, `grant-${width}.png`), fullPage: true });
      if (width === 1400) record.grant = await page.evaluate(inventory, 'section.mandate-grant');
      if (MODE === 'after') {
        await legible(page, `grant at ${width}px`);
        const grant = page.locator('section.mandate-grant');
        // Four checks pass: four marks in one row, each named on hover, no sentence on screen.
        const passed = grant.locator('[data-check-marks] [data-ok="true"]');
        expect(await passed.count()).toBe(4);
        for (const id of ['seat', 'security', 'legal', 'settled']) {
          const mark = grant.locator(`[data-check-marks] [data-check="${id}"]`);
          expect((await mark.getAttribute('title')).length).toBeGreaterThan(10);
          expect((await mark.innerText()).trim()).toBe('✓');
        }
        // The failing one opens: its words and its door.
        const open = grant.locator('[data-mandate-checks] [data-check="accounts"]');
        expect(await open.locator('.mandate-check-words').textContent()).toBe('Choose at least one account.');
        expect(await open.locator('.door-btn').count()).toBe(1);
        // NEVER: six chips, ≤3 words each, the whole sentence on hover.
        const chips = grant.locator('[data-never] .mandate-never-chip');
        expect(await chips.count()).toBe(6);
        for (const chip of await chips.all()) {
          expect((await chip.innerText()).trim().split(/\s+/).length).toBeLessThanOrEqual(3);
          expect(await chip.getAttribute('title')).toMatch(/\.$/);
        }
        // The danger line and the red button stand exactly as ruled.
        expect(await grant.locator('> *').first().textContent()).toBe('The CMO will post as your companies without asking you. What it posts goes public.');
        expect(await grant.locator('.mandate-hold').textContent()).toBe('NOT ARMED — EVERY CHECK MUST PASS');
      }
      expect(errors).toEqual([]);
      await page.close();
    }
    process.stdout.write(`\n${MODE} grant: ${record.grant.window} words · numbers ${norm(record.grant.numbers).join(' ')}\n`);
    proveKept('grant');
  }, 240000);

  it('SEAT with a mandate standing: the grant as marks, a days-left bar, the tripwires as marks; WITHDRAW plain', async () => {
    expect((await grantMandate(ctx.auth.address, { accounts: [{ id: 'x-1', pace: 2 }], days: 7, timeZone: 'UTC' })).ok).toBe(true);
    for (const width of WIDTHS) {
      const { page, errors } = await openOffice(ctx, width, { height: 1000 });
      await tab(page, 'seat');
      await page.locator(`${SEAT} .mandate-head[data-tone="live"]`).waitFor({ timeout: 30000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, `seat-mandate-${width}.png`), fullPage: true });
      if (width === 1400) record.seat = await page.evaluate(inventory, SEAT);
      if (MODE === 'after') {
        await legible(page, `seat with a mandate at ${width}px`);
        const seat = page.locator(SEAT);
        expect(await seat.locator('.mandate-words').count()).toBe(0);
        expect(await seat.locator('[data-mandate-marks]').textContent()).toContain('x-1 · 2/DAY');
        const left = seat.locator('[data-days-left]');
        expect(await left.locator('.hud-bar-text').textContent()).toMatch(/^7D · [A-Z][a-z]{2} \d{1,2}$/);
        // The tripwires: one mark per TRIPS entry, named on hover in its own words; the hostile-text hold beside them.
        const trips = seat.locator('[data-trips] [data-trip]');
        expect(await trips.count()).toBe(Object.keys(TRIPS).length);
        expect(await trips.evaluateAll((els) => els.map((el) => el.getAttribute('title')))).toEqual(Object.values(TRIPS));
        expect(await seat.locator('[data-trips] [data-hold-mark]').count()).toBe(1);
        expect(await seat.locator('.mandate-head .mandate-withdraw').textContent()).toBe('WITHDRAW');
      }
      expect(errors).toEqual([]);
      await page.close();
    }
    process.stdout.write(`\n${MODE} seat: ${record.seat.window} words · numbers ${norm(record.seat.numbers).join(' ')}\n`);
    proveKept('seat');
  }, 240000);
});
