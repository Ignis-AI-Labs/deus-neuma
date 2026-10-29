// SHOW, DON'T TELL slice SDT-3, "board diet" (show-dont-tell-audit.md findings
// 1, 7, 23, 24, 26) in real Chromium — the PRODUCTION MARKETING window on the
// real routes over a real signed-wallet session, the real stores on tmp disk
// (marketing-office-kit.js). No double (RULE 0). At HOUSE and at a company it
// measures the BOARD's read load panel by panel and takes every number the
// board shows, panel by panel — as text, and as the counts its marks draw
// (a mark that draws a count names it in its `aria-label`). With
// SDT3_MODE=before it only records them (run on the tree before the slice);
// otherwise it proves the words fell and that every number on the board
// before the slice is still on screen after it, but for the few said twice
// before, each named below with the place it is still said.
/* global document */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs/promises';
import { startMarketingOffice, stopMarketingOffice, openOffice } from '../helpers/marketing-office-kit.js';

const MODE = process.env.SDT3_MODE === 'before' ? 'before' : 'after';
const SHOTS = path.join('/tmp', 'neuma-sdt3-shots', MODE);
const LEVELS = [['house', null], ['company', 'northwind']];
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

// A number that changes from run to run is taken as what it is: the campaign's
// KPI-by date and window end (the kit's day(10) and day(7)), a clock time, the
// time share of the window, the counter's root (its port), and an age.
const norm = (t) => (t === day(10) ? 'KPI-BY' : t === day(7).slice(5) ? 'END' : /^\d{1,2}:\d{2}$/.test(t) ? 'HH:MM'
  : /^\d+%$/.test(t) ? 'PCT' : /^127\.0\.0\.1:\d+$/.test(t) ? 'ROOT' : /^\d+M$/.test(t) ? 'AGE' : t);

const POSTS_BEFORE = ['5', '5', '2', '1', '1', '1', '7', '4100', 'HH:MM', '5000', '4.1K', '61', '4', '9', '61', '22', '1', '2', '7', 'HH:MM', '1', '8', '1', '2', '1', '1', '503'];
const CAMPAIGN_BEFORE = ['22', '100', 'KPI-BY', 'PCT', 'END', '4.1K', '1', '2', '88', '2', '2', '61', '1', '2', '22', '1', '2', '1', '1'];
const ANGLES_BEFORE = ['1', '000', '1', '1', '5.4'];

// Every number on the board before the slice (SDT3_MODE=before on 7a69deee1's board), part by part.
const BEFORE = Object.freeze({
  house: {
    strip: ['2', '2', '0', '0', '2', '2', '1', '0', '1', '1', 'AGE', 'AGE', '1', '0'],
    tiles: ['4', '1', '0', '0', '0', '0', '0', '2', '1', '1', '1', '2', '1', '0', '0', '0', '1', '0', '0'],
    campaign: CAMPAIGN_BEFORE,
    accounts: ['10', '0', '0', '1', '0', '0', '0', '0'],
    angles: ANGLES_BEFORE,
    links: ['ROOT', '1', '1', '1'],
    posts: POSTS_BEFORE,
  },
  company: {
    strip: ['2', '2', '0', '0', '2', '2', '1', '0', '1', '1', 'AGE', '0'],
    tiles: ['1', '1', '0', '0', '1'],
    campaign: CAMPAIGN_BEFORE,
    accounts: ['1', '0', '0'],
    angles: ANGLES_BEFORE,
    posts: POSTS_BEFORE,
  },
});

// The numbers said twice before, each still said once — and where.
const SAID_ONCE = Object.freeze({
  posts: [
    ['4100', 'the 7-day trace\'s own numeral: the same reading as the row\'s SEEN 4.1K, which stays'],
    ['7', 'SEEN, 7 DAYS on each sent row: the window is said once, in the legend'],
  ],
  links: [['1', 'n NOT ON THE COUNTER: the same count PUBLISH n carries, which stays']],
});

// The read load (visible words in the window, the audit's method) before → the ceiling after.
const WORDS_BEFORE = Object.freeze({ house: 314, company: 240 });

let ctx;
const record = {};

beforeAll(async () => {
  ctx = await startMarketingOffice('marketing-diet-');
  await fs.mkdir(SHOTS, { recursive: true });
}, 180000);

afterAll(async () => {
  await fs.writeFile(path.join(SHOTS, 'board.json'), `${JSON.stringify(record, null, 2)}\n`);
  await stopMarketingOffice(ctx);
}, 30000);

/**
 * In the page: the board's words and numbers, part by part — the strip, each
 * panel by its `data-part`, and the whole window. A word is a run holding a
 * letter or digit (the audit's method); a number is every run of digits, with
 * its decimal, time or date joints and a K/M/% suffix, in the text or in the
 * `aria-label` of a mark that draws a count.
 */
const boardParts = () => {
  const words = (t) => String(t || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const numbers = (t) => String(t || '').match(/\d+(?:[.:-]\d+)*[KM%]?/g) || [];
  const marks = (el) => [...el.querySelectorAll('[role="img"][aria-label]')].filter((m) => m.getClientRects().length).map((m) => m.getAttribute('aria-label')).join(' ');
  const part = (el) => ({ words: words(el.innerText), numbers: [...numbers(el.innerText), ...numbers(marks(el))], text: el.innerText });
  const board = document.querySelector('[data-mkt-board]');
  const parts = { strip: part(board.querySelector('.hlth')) };
  for (const el of board.querySelectorAll('[data-part]')) parts[el.dataset.part.replace(/^campaign:.*/, 'campaign')] = part(el);
  return { window: words(document.querySelector('#root').innerText), parts };
};

const openLevel = async (companyId, width) => {
  const { page, errors } = await openOffice(ctx, width, { height: 1000 });
  if (companyId) await page.locator(`[data-company-tile="${companyId}"]`).click();
  await page.locator('[data-mkt-board] .hlth-cell').first().waitFor();
  await page.locator('[data-mkt-board] [data-part="posts"] [data-post-row]').first().waitFor();
  await page.waitForTimeout(300);
  return { page, errors };
};

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

describe('SDT-3 — the BOARD says less and keeps every number', () => {
  for (const [level, companyId] of LEVELS) {
    it(`${level.toUpperCase()}: read load per panel, every number still on screen, shots at 1400 and 420`, async () => {
      for (const width of [1400, 420]) {
        const { page, errors } = await openLevel(companyId, width);
        await page.screenshot({ path: path.join(SHOTS, `${level}-${width}.png`), fullPage: true });
        if (width === 1400) record[level] = await page.evaluate(boardParts);
        if (MODE === 'after' && !companyId) {
          // The saved token folds behind the key door: a press opens the field, a second folds it again.
          const site = page.locator('[data-mko-site]');
          expect(await site.locator('input').count()).toBe(0);
          await site.locator('button[aria-label="REPLACE TOKEN"]').click();
          expect(await site.locator('button[aria-label="REPLACE TOKEN"]').getAttribute('aria-expanded')).toBe('true');
          await site.locator('input[aria-label="site counter token"]').waitFor();
          await site.locator('button[aria-label="REPLACE TOKEN"]').click();
          expect(await site.locator('input').count()).toBe(0);
        }
        expect(errors).toEqual([]);
        await page.close();
      }
      const got = record[level];
      process.stdout.write(`\n${MODE} ${level}: window ${got.window} words · ${Object.entries(got.parts).map(([k, p]) => `${k} ${p.words}`).join(' · ')}\n`);
      if (MODE === 'before') return;
      expect(got.window, `${level}: the read load fell`).toBeLessThan(WORDS_BEFORE[level]);
      for (const [name, numbers] of Object.entries(BEFORE[level])) {
        const after = (got.parts[name]?.numbers || []).map(norm);
        const once = (SAID_ONCE[name] || []).map(([n]) => n);
        expect.soft(missing(missing(numbers, after), once), `${level} ${name}: numbers gone (after: ${after.join(' ')})`).toEqual([]);
        expect.soft(missing(once, missing(numbers, after)), `${level} ${name}: a number said twice before is now said twice still — lower SAID_ONCE`).toEqual([]);
      }
    }, 240000);
  }
});
