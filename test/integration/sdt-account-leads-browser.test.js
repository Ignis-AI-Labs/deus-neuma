// SHOW, DON'T TELL slice SDT-6 (show-dont-tell-audit.md findings 5, 8, 10, 11,
// 27, 28) in real Chromium — the PRODUCTION MARKETING window on the real routes
// over a real signed-wallet session, the real stores on tmp disk
// (marketing-office-kit.js; the desk fixture of sdt-doors-page.jsx where a
// hand-over needs the window manager). No double (RULE 0); placeholder keys,
// no scheduler — nothing here can reach a platform; the queue gains a DRAFT
// only, never an approved post. The ACCOUNT level, a post's card (a failed one
// and a draft) and LEADS: the read load of each and every number each shows —
// as text, and as the counts its marks draw (`aria-label`). With
// SDT6_MODE=before it only records them (run on the tree before the slice,
// 671f03179); otherwise it proves what each now shows by mark and press, and
// that every number before is still on screen — said once where it was said
// twice, or on the hover of the mark that carries it.
/* global window, document */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs/promises';
import { URL } from 'node:url';
import { startMarketingOffice, stopMarketingOffice, openOffice, smallText, spill } from '../helpers/marketing-office-kit.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';

const MODE = process.env.SDT6_MODE === 'before' ? 'before' : 'after';
const SHOTS = path.join('/tmp', 'neuma-sdt6-shots', MODE);
const ACCOUNT = `?landing=${encodeURIComponent(JSON.stringify({ account: { channelId: 'x', accountId: 'x-1' } }))}`;
const LEVEL = '[data-mkt-level="account"]';
const WIDTHS = [1400, 720, 420];

let ctx;
let draftId;
let ledger;
const record = {};

beforeAll(async () => {
  ctx = await startMarketingOffice('marketing-sdt6-');
  ledger = await leadLedgerFor(ctx.auth.address);
  for (const lead of [
    { name: 'Ada Brook', contact: 'ada@example.com', channelId: 'x', source: 'reply to the launch post' },
    { name: 'Jun Park', contact: '@junpark', channelId: 'bluesky', source: 'mention' },
    { name: 'Mira Holt', contact: 'mira@example.com', channelId: 'other', source: 'the site form' },
  ]) await ledger.add({ ...lead, addedBy: 'operator' });
  draftId = (await postQueue.load()).find((e) => e.status === 'draft' && e.accountId === 'x-1').id;
  await fs.mkdir(SHOTS, { recursive: true });
}, 180000);

afterAll(async () => {
  await fs.writeFile(path.join(SHOTS, 'inventory.json'), `${JSON.stringify(record, null, 2)}\n`);
  await stopMarketingOffice(ctx);
}, 30000);

/**
 * In the page: the window's words (the audit's method) and every number under
 * `sel` — in its text and in the `aria-label` of a mark that draws a count —
 * leaving out the queue's month calendar and the four-week strip, which this
 * slice draws as they were (their numerals follow the date). A relative time
 * ("2D 3H", "45M") is one number, as is a month-name date.
 */
const inventory = (sel) => {
  const words = (t) => String(t || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const MONTH = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}(?:, \d{4})?\b/gi;
  const REL = /\b\d+[DHM](?: \d+[DHM])*\b/g;
  const numbers = (t) => {
    const s = String(t || '');
    const dates = (s.match(MONTH) || []).map(() => 'MDATE');
    const rest = s.replace(MONTH, ' ');
    const rel = (rest.match(REL) || []).map(() => 'REL');
    return [...dates, ...rel, ...(rest.replace(REL, ' ').match(/\d+(?:[.:/-]\d+)*[KM%]?/g) || [])];
  };
  const root = document.querySelector(sel);
  const shown = (el) => el.getClientRects().length && !el.closest('.qcal, .pc-strip');
  const drawn = [...root.querySelectorAll('.qcal, .pc-strip')].flatMap((el) => numbers(el.innerText));
  const text = numbers(root.innerText);
  for (const n of drawn) { const i = text.indexOf(n); if (i !== -1) text.splice(i, 1); }
  const marks = [...root.querySelectorAll('[role="img"][aria-label]')].filter(shown).flatMap((el) => numbers(el.getAttribute('aria-label')));
  return { window: words(document.querySelector('#root').innerText), numbers: [...text, ...marks], text: root.innerText };
};

// A clock time is a CLOCK; a fraction (40/280) is its two numbers.
const norm = (list) => list.flatMap((t) => (/^\d+\/\d+$/.test(t) ? t.split('/') : [t]))
  .map((t) => (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t) ? 'CLOCK' : t));

// Every number each view showed before the slice (SDT6_MODE=before on 671f03179, this ground), and its read load.
const BEFORE = Object.freeze({
  // the band's 1; CREW 0; AWAITING YOU 1; the month S0 A0 Q1 F0, REPLIES OWED 0; the holder row's X-1;
  // POSTS 3, REPLIES 0; the queue month's legend S0 A0 Q1 F0 R0
  account: { words: 174, numbers: ['1', '0', '1', '0', '0', '1', '0', '0', '1', '3', '0', '0', '0', '1', '0', '0'] },
  // POSTS AS x-1 and its 1 again in the head's id ([…] carries none); 29 / 280; the time; HTTP 503
  card: { words: 35, numbers: ['1', '1', '29', '280', 'CLOCK', '503'] },
  'draft-card': { words: 44, numbers: ['REL', '1', '40', '280', 'CLOCK'] },
  leads: { words: 79, numbers: [] },
});

// The read load measured after the slice: a later slice lowers it, never raises it (marketing-floor-browser too).
const CEILING = Object.freeze({ account: 118, card: 23, 'draft-card': 26, leads: 26 });

// The numbers no longer drawn where they were, and where each now stands.
const MOVED = Object.freeze({
  account: [
    // the queue month's legend drew the head's month again (its R counted replies in a posts-only month: always 0)
    ['0', 'said once: the head\'s month strip'], ['0', 'said once'], ['1', 'said once'], ['0', 'said once'], ['0', 'said once'],
    ['1', 'said once: the band\'s 1 WAITING ON YOU (the head\'s AWAITING YOU)'],
    ['1', 'the AccountMark\'s hover (account x-1) and the path\'s X #1'],
  ],
  card: [['1', 'the AccountMark\'s hover (account x-1)']],
  'draft-card': [['1', 'the AccountMark\'s hover (account x-1)']],
});

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

const proveKept = (view) => {
  if (MODE === 'before') return;
  const got = record[view];
  expect(got.window, `${view}: the read load fell`).toBeLessThan(BEFORE[view].words);
  expect(got.window, `${view}: the read load grew past its ceiling`).toBeLessThanOrEqual(CEILING[view]);
  expect(missing(BEFORE[view].numbers, got.numbers).sort(), `${view}: numbers gone (after: ${got.numbers.join(' ')})`)
    .toEqual((MOVED[view] || []).map(([n]) => n).sort());
};

const legible = async (page, label, root = '[data-marketing-office]') => {
  expect.soft(await page.evaluate(smallText, root), `${label}: under 13px`).toEqual([]);
  expect.soft(await page.evaluate(spill, root), `${label}: spills`).toEqual([]);
};

const shoot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

const VIEWS = Object.freeze({
  account: { query: () => ACCOUNT, ready: `${LEVEL} .pc-head`, sel: LEVEL, settle: (page) => page.locator(`${LEVEL} .qcal`).waitFor({ timeout: 30000 }) },
  card: { query: () => '?card=f1', ready: '.queue-card', sel: '.queue-card' },
  'draft-card': { query: () => `?card=${draftId}`, ready: '.queue-card', sel: '.queue-card' },
  leads: {
    query: () => '', ready: '[data-mkt-tiles] [data-company-tile]', sel: '[data-mkt-tab="leads"]',
    settle: async (page) => {
      await page.locator('.mkt-tabs [data-tab="leads"]').click();
      await page.getByText('Mira Holt').waitFor({ timeout: 30000 });
    },
  },
});

const stand = async (view, width) => {
  const v = VIEWS[view];
  const { page, errors } = await openOffice(ctx, width, { height: 1000, query: v.query(), ready: v.ready });
  if (v.settle) await v.settle(page);
  await page.waitForTimeout(400);
  return { page, errors };
};

// impure — the desk of sdt-doors-page.jsx (the production WindowManager, MARKETING, a chat's composer) on this ground.
const openDesk = async (width = 1400) => {
  const page = await (await ctx.browser.newContext()).newPage();
  await page.setViewportSize({ width, height: 1100 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const fixture = JSON.stringify({ token: ctx.auth.token, wallet: ctx.auth.address });
  await page.route('**/sdt6-desk', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><body style="background:#000"><script>window.doorsFixture=${fixture}</script><div id="root"></div><script type="module" src="/test/helpers/sdt-doors-page.jsx"></script></body></html>`,
  }));
  await page.goto(ctx.url('sdt6-desk'));
  await page.locator('#title').waitFor({ timeout: 60000 });
  return { page, errors };
};

const leadsOf = async () => (await ledger.load()).reduce((m, l) => ({ ...m, [l.name]: l }), {});

describe('SDT-6 — the account level, the post card and LEADS show; every number kept', () => {
  for (const view of Object.keys(VIEWS)) {
    it(`${view}: the words fell and every number stays (said once, or on its mark's hover)`, async () => {
      for (const width of [1400, 420]) {
        const { page, errors } = await stand(view, width);
        await shoot(page, `${view}-${width}`);
        if (width === 1400) {
          const got = await page.evaluate(inventory, VIEWS[view].sel);
          record[view] = { ...got, numbers: norm(got.numbers) };
        }
        expect(errors).toEqual([]);
        await page.close();
      }
      proveKept(view);
    }, 120000);
  }

  it('the account head: the account by its mark, KEYS · HOLDER · CREW as marks (the holder\'s door SEAT A CMO), the next out "—", the month once', async () => {
    if (MODE === 'before') return;
    const { page, errors } = await stand('account', 1400);
    const head = page.locator(`${LEVEL} .pc-head`);
    expect(await head.locator('.ah-id > [data-account-mark="x-1"]').getAttribute('title')).toMatch(/Northwind · X \(Twitter\) · account x-1/);
    expect(await head.locator('.ah-id > [data-account-mark="x-1"]').innerText()).toBe('@northwind_x');
    expect(await head.locator('[data-standing="keys"]').getAttribute('title')).toBe('KEYS · proven as @northwind_x');
    expect(await head.locator('[data-standing="holder"]').getAttribute('title')).toMatch(/^HOLDER · none — no being may post/);
    expect(await head.locator('.door-btn').innerText()).toMatch(/^SEAT A CMO/);
    expect(await head.locator('[data-standing="crew"]').innerText()).toBe('0');
    expect(await head.locator('.ah-next .cdm.is-none').getAttribute('title')).toBe('nothing approved is scheduled ahead');
    expect(await head.locator('.amm-n').evaluateAll((els) => els.map((el) => el.innerText.trim()))).toEqual(['0', '0', '1', '0', '0']);
    expect(await head.locator('.pc-strip-date').count()).toBe(28);
    // Said once: no AWAITING YOU, no STANDING button, no sentences; the queue names no heading and draws no legend.
    expect(await page.locator(`${LEVEL} .pc-await, ${LEVEL} .pc-standing-btn, ${LEVEL} .ps-cells, ${LEVEL} .qcal-legend, ${LEVEL} .settings-h`).count()).toBe(0);
    expect(await page.locator(LEVEL).innerText()).not.toMatch(/EVERY X|NO BEING MAY POST|nothing approved|no holder — nobody posts|WAITING ON YOU — |THE HOUSE NEEDS/);
    // A month count lights the queue's days; again clears.
    await head.locator('.amm-n.is-awaiting').first().click();
    await expect.poll(() => page.locator(`${LEVEL} .qcal-cell.is-dim`).count(), { timeout: 10000 }).toBeGreaterThan(0);
    await page.locator(`${LEVEL} .pc-head .amm-n.is-awaiting`).first().click();
    await expect.poll(() => page.locator(`${LEVEL} .qcal-cell.is-dim`).count(), { timeout: 10000 }).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('the post card: identity once, status once, the length a bar against the limit, the time a countdown mark', async () => {
    if (MODE === 'before') return;
    const { page, errors } = await stand('draft-card', 1400);
    const card = page.locator('.queue-card');
    expect(await card.locator('[data-account-mark]').count()).toBe(1);
    expect(await card.locator('.stm').count()).toBe(1);
    expect(await card.innerText()).not.toMatch(/POSTS AS|X \(TWITTER\)/);
    expect(await card.locator('.queue-length').getAttribute('aria-label')).toBe('40 of 280 characters');
    expect(await card.locator('.queue-length .hud-bar-fill').evaluate((el) => el.style.transform)).toMatch(/scaleX\(0\.14/);
    expect(await card.locator('.queue-entry-meta .cdm .cdm-rel').innerText()).toMatch(/^\d+[DHM]( \d+[DHM])?$/);
    await page.close();
    const failed = await stand('card', 1400);
    const meta = await failed.page.locator('.queue-card .queue-entry-meta').innerText();
    expect(meta).toMatch(/^[A-Z]{3} \d{1,2}:\d{2} [AP]M — X answered HTTP 503$/);
    expect(errors.concat(failed.errors)).toEqual([]);
    await failed.page.close();
  }, 120000);

  it('LEADS: the funnel narrows the list (SHOWING … · SHOW ALL); ⋯ moves a lead — one recorded touch; legible at 1400 / 720 / 420', async () => {
    if (MODE === 'before') return;
    const { page, errors } = await stand('leads', 1400);
    const tab = page.locator('[data-mkt-tab="leads"]');
    const counts = () => tab.locator('.lfn-n b').allInnerTexts();
    expect(await counts()).toEqual(['3', '0', '0', '0', '0', '0']);
    expect(await tab.locator('.lfn').getAttribute('title')).toMatch(/^the house lead ledger/);
    // A lead from a platform carries the platform's mark; a holder is a name or '—'; no code, no "via".
    expect(await tab.locator('.lead-row[data-stage="cold"]').count()).toBe(3);
    expect(await tab.locator('.lead-row', { hasText: 'Ada Brook' }).locator('.lead-who svg').count()).toBe(1);
    expect(await tab.locator('.lead-row', { hasText: 'Mira Holt' }).locator('.lead-who svg').count()).toBe(0);
    expect(await tab.innerText()).not.toMatch(/via |unheld|HELD BY|TOUCH|REMOVE|The house lead ledger/);
    // ⋯ → CONTACTED: one touch on the real ledger, under the operator.
    await tab.locator('.lead-row', { hasText: 'Ada Brook' }).locator('.lead-more').click();
    await page.locator('.lead-menu .cmenu-item', { hasText: 'CONTACTED' }).click();
    await expect.poll(counts, { timeout: 15000 }).toEqual(['2', '1', '0', '0', '0', '0']);
    const ada = (await leadsOf())['Ada Brook'];
    expect(ada.status).toBe('contacted');
    expect(ada.touches.at(-1).by.toLowerCase()).toBe(ctx.auth.address.toLowerCase());
    // The funnel narrows: CONTACTED → Ada alone; the press back is SHOW ALL.
    await tab.locator('.lfn-part.is-contacted').click();
    await expect.poll(() => tab.locator('.lead-row').count(), { timeout: 10000 }).toBe(1);
    expect(await tab.locator('[data-showing]').innerText()).toBe('SHOWING CONTACTED · SHOW ALL');
    await tab.locator('[data-showing]').click();
    await expect.poll(() => tab.locator('.lead-row').count(), { timeout: 10000 }).toBe(3);
    await tab.locator('.lfn-n').first().click();
    await expect.poll(() => tab.locator('.lead-row').count(), { timeout: 10000 }).toBe(2);
    expect(errors).toEqual([]);
    await page.close();
    for (const width of WIDTHS) {
      const at = await stand('leads', width);
      await at.page.locator('.lead-row', { hasText: 'Jun Park' }).locator('.lead-more').click();
      await at.page.locator('.lead-menu').waitFor();
      await legible(at.page, `LEADS with its menu at ${width}px`);
      expect.soft(await at.page.evaluate(smallText, '.lead-menu'), `the lead menu at ${width}px: under 13px`).toEqual([]);
      expect(at.errors).toEqual([]);
      await at.page.close();
    }
  }, 180000);

  it('with a CMO seated: the account\'s holder bound by name, the notice in five words; on LEADS a holder by name and HAND TO the CMO drafts the ask — nothing is sent', async () => {
    if (MODE === 'before') return;
    await cmoDesignation.designate(ctx.auth.address, 'kestrel');
    // The account level: keys set and the CMO seated, so the window binds the CMO by itself and says so.
    const { page, errors } = await stand('account', 1400);
    const head = page.locator(`${LEVEL} .pc-head`);
    await expect.poll(() => head.locator('[data-standing="holder"]').innerText(), { timeout: 30000 }).toBe('Kestrel');
    expect(await page.locator(`${LEVEL} .ps-notice`).innerText()).toMatch(/^«NOTICE»\s*Kestrel holds X \(Twitter\) · CMO\s*change\s*dismiss$/);
    expect(await page.locator(`${LEVEL} .ps-notice`).getAttribute('title')).toMatch(/bound automatically/);
    // The holder's drawer: the marketing seats only — the CMO, held — and Release.
    await head.locator('[data-standing="holder"]').click();
    await expect.poll(() => page.locator(`${LEVEL} [data-holder-drawer] .ps-choice`).allInnerTexts(), { timeout: 10000 })
      .toEqual(['Kestrel\nCMO', 'Release\nno one may post']);
    expect(await page.locator(`${LEVEL} [data-holder-drawer] .ps-choice.is-on`).getAttribute('aria-pressed')).toBe('true');
    await shoot(page, 'account-held-1400');
    await page.close();
    // LEADS: Mira held by the CMO reads its name; Jun, held by no one, is one press to the CMO.
    const mira = (await leadsOf())['Mira Holt'];
    expect((await ledger.touch(mira.id, { ownerNeumaId: 'kestrel', by: ctx.auth.address })).ok).toBe(true);
    const desk = await openDesk();
    const asked = [];
    desk.page.on('request', (r) => { if (r.url().includes('/api/')) asked.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    desk.page.on('websocket', (ws) => asked.push(`WS ${ws.url()}`));
    await desk.page.evaluate(() => window.deskOpen('marketing'));
    const office = desk.page.locator('[data-window-id="marketing"] [data-marketing-office]');
    await office.locator('.mkt-tabs [data-tab="leads"]').click();
    const row = (name) => office.locator('.lead-row', { hasText: name });
    await row('Mira Holt').locator('.lead-holder', { hasText: 'Kestrel' }).waitFor({ timeout: 30000 });
    expect(await row('Mira Holt').locator('.lead-holder').innerText()).not.toContain('kestrel');
    await row('Jun Park').getByRole('button', { name: 'HAND TO KESTREL' }).click();
    const composer = desk.page.locator('[data-window-id^="chat#"] [data-composer]');
    await composer.waitFor({ timeout: 15000 });
    expect(await composer.getAttribute('data-neuma')).toBe('kestrel');
    const draft = await composer.locator('textarea').inputValue();
    expect(draft).toContain('lead_list');
    expect(draft).toContain('leads/touch');
    expect(draft).toContain('ownerNeumaId "kestrel"');
    expect(await row('Jun Park').locator('.door-handed').innerText()).toBe('DRAFTED');
    await desk.page.screenshot({ path: path.join(SHOTS, 'leads-hand-to-1400.png'), fullPage: true });
    await desk.page.waitForTimeout(500);
    expect(asked.filter((a) => !a.startsWith('GET '))).toEqual([]);
    expect((await leadsOf())['Jun Park'].ownerNeumaId ?? null).toBe(null);
    expect(errors.concat(desk.errors)).toEqual([]);
    await desk.page.close();
    for (const width of WIDTHS) {
      const at = await openDesk(width);
      await at.page.evaluate(() => window.deskOpen('marketing'));
      const o = at.page.locator('[data-window-id="marketing"] [data-marketing-office]');
      await o.locator('.mkt-tabs [data-tab="leads"]').click();
      await o.getByRole('button', { name: 'HAND TO KESTREL' }).first().waitFor({ timeout: 30000 });
      if (width === 420) await at.page.screenshot({ path: path.join(SHOTS, 'leads-hand-to-420.png'), fullPage: true });
      await legible(at.page, `LEADS with HAND TO at ${width}px`, '[data-window-id="marketing"] [data-marketing-office]');
      expect(at.errors).toEqual([]);
      await at.page.close();
    }
  }, 240000);

  it('the head folds by the VIEW\'s height, never its own content: a short window folds it, a tall one keeps the four weeks (#595)', async () => {
    if (MODE === 'before') return;
    const tall = await openOffice(ctx, 1400, { height: 1000, query: ACCOUNT, ready: `${LEVEL} .pc-head` });
    await tall.page.locator(`${LEVEL} .pc-head .pc-strip-date`).first().waitFor({ state: 'attached', timeout: 30000 });
    expect(await tall.page.locator(`${LEVEL} .pc-head .pc-strip-date`).count()).toBe(28);
    await tall.page.context().close();
    const short = await openOffice(ctx, 1400, { height: 600, query: ACCOUNT, ready: `${LEVEL} .pc-head` });
    await short.page.locator(`${LEVEL} .pc-whole`).waitFor({ timeout: 30000 });
    expect(await short.page.locator(`${LEVEL} .pc-head .pc-strip-date`).count()).toBe(0);
    await short.page.locator(`${LEVEL} .pc-whole`).click();
    await short.page.locator(`${LEVEL} .pc-head .pc-strip-date`).first().waitFor({ state: 'attached', timeout: 10000 });
    expect(await short.page.locator(`${LEVEL} .pc-head .pc-strip-date`).count()).toBe(28);
    expect(short.errors).toEqual([]);
    await short.page.context().close();
  }, 120000);

  it('STAGE DRAFT at the account level speaks as that account — no account picker; COMMUNITY\'s TELEGRAM keeps its own head and standing', async () => {
    if (MODE === 'before') return;
    const { page, errors } = await stand('account', 1400);
    // In the month view the composer stays mounted but is not shown (#595).
    const composer = page.locator(`${LEVEL} .settings-realm:has(input[placeholder="What should go out?"])`);
    await composer.waitFor({ state: 'attached', timeout: 15000 });
    expect(await composer.isVisible()).toBe(false);
    // Into a day (the four weeks' today): the composer belongs to the day view.
    await page.locator(`${LEVEL} .pc-strip-day.is-today`).click();
    await composer.waitFor({ timeout: 15000 });
    expect(await composer.locator('[aria-label="Account"]').count()).toBe(0);
    await composer.locator('input[placeholder="What should go out?"]').fill('SDT-6: staged on the account level.');
    await composer.getByRole('button', { name: 'STAGE DRAFT' }).click();
    await expect.poll(async () => (await postQueue.load()).find((e) => e.text === 'SDT-6: staged on the account level.')?.accountId ?? null, { timeout: 15000 }).toBe('x-1');
    const staged = (await postQueue.load()).find((e) => e.text === 'SDT-6: staged on the account level.');
    expect(staged.status).toBe('draft');
    expect(errors).toEqual([]);
    await page.close();
    for (const width of WIDTHS) {
      const tg = await openOffice(ctx, width, { height: 1000, query: '?platform=telegram', ready: '.pc-head' });
      expect(await tg.page.locator('.pc-head.is-account').count()).toBe(0);
      await tg.page.locator('.pc-standing-btn').click();
      expect(await tg.page.locator('.ps-cell-k').allInnerTexts()).toEqual(['KEYS', 'HOLDER', 'CREW']);
      // COMMUNITY's TELEGRAM also holds its CHATS (who may talk with the house through its bot, the chat bridge).
      expect(await tg.page.locator('.outreach-tabs [role="tab"]').allInnerTexts()).toEqual(['CAMPAIGNS', 'QUEUE', 'CHATS']);
      await legible(tg.page, `telegram at ${width}px`, '.outreach-panel .outreach-panel');
      expect(tg.errors).toEqual([]);
      await tg.page.close();
    }
  }, 180000);
});
