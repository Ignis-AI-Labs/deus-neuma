// The house social check, shown not told, every fix a door (2026-10-24) —
// real Chromium: the PRODUCTION check inside the production WindowManager,
// the windows its doors open drawn by their production bodies, against the
// real routes over a real signed-wallet session and the real stores on tmp
// disk (marketing-office-kit.js, reused read-only; this file's own page,
// social-check-doors-page.jsx, served by the kit's vite). No double (RULE 0);
// placeholder keys only. Proven: clear checks are marks, not rows; the
// guided path numbers every fix; a door lands on its exact place (Settings →
// API → the account's row; MARKETING → the company → BRAND → SITE & CODE;
// the platform's STANDING; the very post in its queue); the @handle is recorded in place and its step
// falls away on the result — which waits while the pointer is on the cards;
// HAND TO opens the holder's chat with the prompt drafted and sends nothing;
// no text under 13px and nothing spills at 1400 / 720 / 420.
/* global document, window, getComputedStyle */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';
import { startMarketingOffice, stopMarketingOffice } from '../helpers/marketing-office-kit.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';

const SHOTS = path.join(os.tmpdir(), 'neuma-social-check-shots');
const BARE = 'bbbbccccddddeeee';
let ctx;

beforeAll(async () => {
  ctx = await startMarketingOffice('social-check-doors-');
  // The keyed X account is held by the house's own lane, and a draft it wrote before the AI disclosure moved into
  // metadata waits, its image's alt text unmarked.
  await channelBindings.bind(ctx.auth.address, 'x-1', { neumaId: 'kestrel' });
  const file = process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
  const queue = JSON.parse(await fs.readFile(file, 'utf8'));
  queue.push({
    id: BARE, channelId: 'x', accountId: 'x-1', text: 'Written before the line.', scheduledFor: null, campaignId: null, pillar: '', media: [{ path: '/tmp/before-the-ruling.png', alt: 'the card' }],
    authorNeumaId: 'kestrel', queuedBy: 'kestrel', status: 'draft', createdAt: new Date().toISOString(),
  });
  await fs.writeFile(file, JSON.stringify(queue, null, 2));
  await fs.mkdir(SHOTS, { recursive: true });
}, 180000);

afterAll(async () => { await stopMarketingOffice(ctx); }, 30000);

// impure — this file's page on the kit's own origin (its vite serves the fixture module).
const openCheck = async (width, { height = 1100 } = {}) => {
  const page = await (await ctx.browser.newContext()).newPage();
  await page.setViewportSize({ width, height });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const fixture = JSON.stringify({ token: ctx.auth.token, wallet: ctx.auth.address });
  await page.route('**/social-check-doors', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><body style="background:#000"><script>window.doorsFixture=${fixture}</script><div id="root"></div><script type="module" src="/test/helpers/social-check-doors-page.jsx"></script></body></html>`,
  }));
  await page.goto(ctx.url('social-check-doors'));
  await page.locator('#check .sc-card').first().waitFor({ timeout: 60000 });
  return { page, errors, check: page.locator('#check') };
};

const steps = (check) => check.locator('.sc-step').evaluateAll((els) => els.map((el) => `${el.querySelector('.sc-step-n').textContent} ${el.querySelector('.sc-step-t').textContent}`));
const stepNamed = (check, title) => check.locator('.sc-step', { has: check.page().locator('.sc-step-t', { hasText: title }) }).first();
const card = (check, id) => check.locator(`.sc-card[data-account="${id}"]`);

/** In the page: every element inside the check carrying visible text under 13px. */
const smallText = () => [...document.querySelectorAll('#check *')]
  .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && el.getClientRects().length)
  .map((el) => ({ text: el.textContent.trim().slice(0, 40), size: parseFloat(getComputedStyle(el).fontSize) }))
  .filter((t) => t.size < 13);

/** In the page: anything drawn past the check's right edge, or a part scrolling sideways. */
const spill = () => {
  const root = document.querySelector('#check .social-check');
  const right = root.getBoundingClientRect().right + 1;
  return [...root.querySelectorAll('*')].filter((el) => el.getClientRects().length && el.getBoundingClientRect().right > right)
    .map((el) => `${el.className?.baseVal ?? el.className}: ${el.textContent.trim().slice(0, 30)}`)
    .concat([...root.querySelectorAll('.sc-card, .sc-path, .sc-fix')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => `scrolls: ${el.textContent.trim().slice(0, 30)}`));
};

describe('the house social check — shown, not told; every fix a door', () => {
  it('cards of marks, not rows of text; the path numbers every fix; legible at three widths', async () => {
    const { page, errors, check } = await openCheck(1400);
    const report = await page.evaluate(`(async () => (await (await import('/frontend/services/social-check-client.js')).getHouseCheck()).check)()`);
    const inUse = report.accounts.filter((a) => a.inUse);
    expect(await check.locator('.sc-card').count()).toBe(inUse.length);
    for (const row of inUse) {
      expect(await card(check, row.id).locator('.sc-check').count()).toBe(13);
      for (const verdict of ['pass', 'fail', 'unknown', 'na']) {
        expect(await card(check, row.id).locator(`.sc-check.is-${verdict}`).count()).toBe(row.checks.filter((c) => c.verdict === verdict).length);
      }
    }
    // A clear check takes no row of text: its sentence is on hover, never on the page.
    const shown = await check.locator('.sc-body').innerText();
    const passWords = inUse.flatMap((r) => r.checks.filter((c) => c.verdict === 'pass').map((c) => c.words));
    expect(passWords.length).toBeGreaterThan(0);
    for (const w of passWords) expect(shown).not.toContain(w);
    expect(await check.locator('.social-check-row').count()).toBe(0);

    // The path: every fix once, numbered, in the overview's order (the pure fold over the same read).
    const expected = await page.evaluate(`(async () => {
      const { fixSteps } = await import('/frontend/app/RelinkShell/social-check/social-check-view.js');
      const { check } = await (await import('/frontend/services/social-check-client.js')).getHouseCheck();
      return fixSteps(check).map((s) => s.n + ' ' + s.title);
    })()`);
    expect(expected.length).toBeGreaterThan(0);
    expect(await steps(check)).toEqual(expected);
    expect(expected.some((t) => t.endsWith('Add the company site'))).toBe(true);
    expect(expected.some((t) => t.endsWith('Record the @handle'))).toBe(true);

    // OPTIONAL stands folded, and says so.
    const optional = check.locator('.sc-optional');
    expect(await optional.getAttribute('open')).toBeNull();
    expect(await optional.locator('summary').innerText()).toMatch(/OPTIONAL \d+ · NOT COUNTED · FOLDED/);

    for (const width of [1400, 720, 420]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.waitForTimeout(150);
      expect(await page.evaluate(smallText)).toEqual([]);
      expect(await page.evaluate(spill)).toEqual([]);
      if (width !== 720) await check.screenshot({ path: path.join(SHOTS, `after-${width}.png`) });
    }
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('KEYS lands on the account\'s own row in Settings → API, open and marked', async () => {
    const { page, errors, check } = await openCheck(1400);
    await card(check, 'x-1').locator('.sc-card-head').click();
    const door = card(check, 'x-1').locator('.sc-fix', { hasText: 'Record the @handle' }).getByRole('button', { name: 'KEYS →' });
    await door.click();
    const row = page.locator('[data-window-id="settings"] .account-row[data-account="x-1"]');
    await row.waitFor({ timeout: 30000 });
    await expect.poll(() => row.evaluate((el) => el.classList.contains('is-wait-landed')), { timeout: 10000 }).toBe(true);
    expect(await page.locator('[data-window-id="settings"] .settings-tab.is-on').innerText()).toMatch(/API/i);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('"Add the company site" lands on MARKETING → that company → BRAND → SITE & CODE', async () => {
    const { page, errors, check } = await openCheck(1400);
    const report = await page.evaluate(`(async () => (await (await import('/frontend/services/social-check-client.js')).getHouseCheck()).check)()`);
    const owing = report.accounts.find((a) => a.checks.some((c) => c.id === 'site' && c.verdict === 'fail'));
    const companyId = owing.checks.find((c) => c.id === 'site').fix.door.companyId;
    await stepNamed(check, 'Add the company site').click();
    const office = page.locator('[data-window-id="marketing"] [data-marketing-office]');
    await office.locator(`.mkt-body[data-mkt-level="${companyId}"][data-mkt-tab="brand"]`).waitFor({ timeout: 30000 });
    await office.locator('.bk-rail-raw.is-on', { hasText: 'SITE & CODE' }).waitFor({ timeout: 30000 });
    // The SITE & CODE editor itself, once the company's sources are read.
    await office.locator('h4', { hasText: 'SITE & CODE' }).waitFor({ timeout: 30000 });
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('HOLDER lands on the platform\'s STANDING; QUEUE on the very post, marked', async () => {
    const { page, errors, check } = await openCheck(1400);
    const holderStep = stepNamed(check, 'Seat a holder');
    const accountId = await holderStep.getAttribute('data-accounts');
    const channelId = accountId.split('-')[0];
    await holderStep.click();
    // A public platform's STANDING is on MARKETING's account level (slice 6); COMMUNITY's on its own window.
    const home = ['telegram', 'discord'].includes(channelId) ? `[data-window-id="${channelId}"]` : `[data-window-id="marketing"] [data-mkt-level="account"][data-mkt-account^="${channelId}:"]`;
    await page.locator(`${home} section.ps`).waitFor({ timeout: 30000 });

    await card(check, 'x-1').locator('.sc-card-head').click();
    await card(check, 'x-1').locator('.sc-fix', { hasText: 'Mark the images' }).getByRole('button', { name: 'QUEUE →' }).click();
    const post = page.locator(`[data-window-id="marketing"] [data-mkt-level="account"] [data-entry-id="${BARE}"]`);
    await post.waitFor({ timeout: 30000 });
    await expect.poll(() => post.evaluate((el) => el.classList.contains('is-wait-landed')), { timeout: 10000 }).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('HAND TO opens the holder\'s chat with the prompt drafted — and sends nothing', async () => {
    const { page, errors, check } = await openCheck(1400);
    await card(check, 'x-1').locator('.sc-card-head').click();
    const fix = card(check, 'x-1').locator('.sc-fix', { hasText: 'Mark the images' });
    // Every request the page makes from the press on: a hand-over only reads (the being's sittings).
    const asked = [];
    page.on('request', (r) => { if (r.url().includes('/api/')) asked.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    page.on('websocket', (ws) => asked.push(`WS ${ws.url()}`));
    await fix.getByRole('button', { name: 'HAND TO KESTREL' }).click();
    const composer = page.locator('[data-window-id^="chat#"] [data-composer]');
    await composer.waitFor({ timeout: 15000 });
    expect(await page.evaluate(() => window.deskWindows())).toEqual(['chat', 'chat#2']);
    expect(await composer.getAttribute('data-neuma')).toBe('kestrel');
    const draft = await composer.locator('textarea').inputValue();
    expect(draft).toContain(BARE);
    expect(draft).toContain('x-1');
    expect(draft).toContain('queue_update');
    expect(draft).toContain('I will decide each card.');
    expect(await fix.locator('.sc-handed').innerText()).toBe('DRAFTED · KESTREL');
    // Nothing was sent: no socket, nothing but reads, and the post still waits as it was.
    await page.waitForTimeout(500);
    expect(asked.filter((a) => !a.startsWith('GET '))).toEqual([]);
    expect(asked).toContain('GET /api/v1/workspace/kestrel/sessions');
    const entry = JSON.parse(await fs.readFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, 'utf8')).find((e) => e.id === BARE);
    expect(entry.status).toBe('draft');
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('the @handle is recorded in place; the result waits while the pointer is on the cards, then its step falls away', async () => {
    const { page, errors, check } = await openCheck(1400);
    const handleSteps = () => steps(check).then((all) => all.filter((t) => t.endsWith('Record the @handle')).length);
    const before = await handleSteps();
    expect(before).toBeGreaterThan(0);
    const step = stepNamed(check, 'Record the @handle');
    const accountId = await step.getAttribute('data-accounts');
    await step.click();
    const field = check.locator(`[data-handle-for="${accountId}"]`);
    await expect.poll(() => field.evaluate((el) => el === document.activeElement), { timeout: 5000 }).toBe(true);
    await field.fill('northwind_core');
    await card(check, accountId).locator('.sc-fix', { hasText: 'Record the @handle' }).getByRole('button', { name: 'RECORD' }).click();
    // The pointer stays on the cards: the new result is held, the path as it was.
    await check.locator('.sc-held').waitFor({ timeout: 15000 });
    expect(await handleSteps()).toBe(before);
    // The pointer leaves: the result lands, and that account's step falls away.
    await page.mouse.move(2, 2);
    await expect.poll(handleSteps, { timeout: 15000 }).toBe(before - 1);
    expect(await check.locator('.sc-held').count()).toBe(0);
    expect(await card(check, accountId).locator('.sc-check[data-check="right-account"]').getAttribute('class')).not.toContain('is-fail');
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);
});
