// @ts-check
// THE IGNITION — every startup after GENESIS (Design note, 2026-10-03, on its
// specimen: […]). Driven through a real
// browser against the ISOLATED stack (perf-harness: its own backend, data
// root and vault). Real auth, real instruments, no mocks.
//
// Proven here: it plays over the destination and opens onto it — the gateway
// for a new witness (it yields onto the same 3D armillary resting there; the
// strip reports what truly declared), the desk for a
// returning one (its being and session declared too); a click skips at once;
// a held key's autorepeat never does; ?noboot=1 and reduced motion open in
// stillness. Its frames land in test/e2e/shots/ for pause-frame review.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupPerfStack, initPerfSession, perf } from './helpers/perf-harness.js';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');

setupPerfStack({ dev: true });

// The gateway's strip states only what truly declared (SHINKEI).
const TRUTHFUL_STRIP = /^PLATFORM (OK · \d{3}MS|TIMEOUT)\s+·\s+MEMORY (OK · ROSTER HELD|EMPTY|BLOCKED)\s+·\s+PORTAL (BOUND|AWAITING IDENTITY)$/;

const open = async (browser, { url = '/', session = false, reducedMotion = null } = {}) => {
  const ctx = await browser.newContext({ reducedMotion, viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (session) await initPerfSession(page);
  await page.goto(`http://localhost:${perf.FPORT}${url}`, { waitUntil: 'domcontentloaded' });
  return { ctx, page, errors };
};

test('a new witness: the ignition plays, then opens onto the gateway with its truthful strip', async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const { ctx, page, errors } = await open(browser);
  const ign = page.locator('.ign-film');
  await expect(ign).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#first-paint-veil')).toHaveCount(0);
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(SHOTS, 'ignition-gateway.png') });
  await expect(ign).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator('.portal')).toBeVisible();
  await expect(page.locator('.portal-title')).toHaveText('DEUS NEUMA');
  await expect(page.locator('#portal-ignition')).toHaveText(TRUTHFUL_STRIP);
  // it yielded onto the very armillary resting beneath it: the gateway's field is the 3D logo
  await expect(page.locator('.of-canvas[data-armillary="on"]')).toHaveCount(1);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, 'gateway-rest.png') });
  // reaching for the threshold charges it; the threshold sits beneath the painted name
  await page.hover('#portal-enter');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, 'gateway-reach.png') });
  expect(errors, errors.join(' | ')).toEqual([]);
  await ctx.close();
});

test('a returning witness: it opens onto the desk', async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  const { ctx, page, errors } = await open(browser, { session: true });
  await expect(page.locator('.ign-film')).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(SHOTS, 'ignition-desk.png') });
  await expect(page.locator('.ign-film')).toHaveCount(0, { timeout: 20000 });
  await page.locator('.taskbar').waitFor({ timeout: 30000 });
  expect(errors, errors.join(' | ')).toEqual([]);
  await ctx.close();
});

test('a click skips at once', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  await expect(page.locator('.ign-film')).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(600);
  const skipped = Date.now();
  await page.mouse.click(800, 450);
  await expect(page.locator('.ign-film')).toHaveCount(0, { timeout: 4000 });
  expect(Date.now() - skipped).toBeLessThan(2500);
  await expect(page.locator('.portal')).toBeVisible();
  await ctx.close();
});

test('autorepeat is not a gesture — a held key never skips', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  await expect(page.locator('.ign-film')).toBeVisible({ timeout: 60000 });
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { repeat: true })));
  }
  await page.waitForTimeout(800);
  await expect(page.locator('.ign-film')).toHaveAttribute('data-ignition', 'playing');
  await ctx.close();
});

test('?noboot=1 and reduced motion open in stillness — no ignition at all', async ({ browser }) => {
  for (const opts of [{ url: '/?noboot=1' }, { reducedMotion: 'reduce' }]) {
    const { ctx, page } = await open(browser, opts);
    await expect(page.locator('.portal')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('.ign-film')).toHaveCount(0);
    await expect(page.locator('#first-paint-veil')).toHaveCount(0);
    await ctx.close();
  }
});
