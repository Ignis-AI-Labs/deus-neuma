// @ts-check
// THE GATEWAY FITS EVERY FRAME (release smoke, 2026-10-20: at 1366×768 and
// 1280×832 the ENTER AS switch sat over the ignition strip and was cut off at
// the foot). Driven through a real browser against the ISOLATED stack
// (perf-harness: its own backend, data root and vault, bind-probed ports),
// through the real ignition a new witness sees, skipped onto the gateway.
// Real auth, real field, no mocks.
//
// Proven here by VISIBLE geometry, never classes: at each frame the switch's
// box (and each of its two options) lies wholly inside the viewport, clear of
// the status line's box and of the entry above it, and the topmost element at
// each option's centre IS that option. Frames land in test/e2e/shots/.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupPerfStack, perf } from './helpers/perf-harness.js';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
const FRAMES = [[1280, 720], [1366, 768], [1280, 832], [1440, 900], [1920, 1080], [3840, 2160]];

setupPerfStack({ dev: true });

const boxOf = (page, sel) => page.locator(sel).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
});
const intersects = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
const inside = (b, w, h) => b.x >= 0 && b.y >= 0 && b.right <= w && b.bottom <= h && b.w > 0 && b.h > 0;

for (const [w, h] of FRAMES) {
  test(`the gateway at ${w}×${h}: ENTER AS is whole, clear of the status line`, async ({ browser }) => {
    test.setTimeout(2 * 60 * 1000);
    fs.mkdirSync(SHOTS, { recursive: true });
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // the real road a new witness takes: the ignition plays, a click skips it
    // onto the gateway, whose strip carries the ignition's true report
    await page.goto(`http://localhost:${perf.FPORT}/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.ign-film')).toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.mouse.click(w / 2, 8);
    await expect(page.locator('.ign-film')).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('.portal')).toBeVisible();
    await expect(page.locator('#portal-ignition')).not.toHaveText('', { timeout: 30000 });
    // the field has placed the threshold beneath the painted name, and every rise has settled
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--armillary-below') !== '');
    await page.waitForTimeout(3500);

    const sw = await boxOf(page, '.portal-enter-as');
    const strip = await boxOf(page, '#portal-ignition');
    const entry = await boxOf(page, '#portal-enter');
    const at = `${w}×${h} switch=${JSON.stringify(sw)} strip=${JSON.stringify(strip)} entry=${JSON.stringify(entry)}`;
    expect(inside(sw, w, h), at).toBe(true);
    expect(inside(strip, w, h), at).toBe(true);
    expect(intersects(sw, strip), at).toBe(false);
    expect(intersects(sw, entry), at).toBe(false);
    expect(sw.bottom, at).toBeLessThanOrEqual(strip.y);
    console.log(`${w}×${h}: switch ${Math.round(sw.y)}–${Math.round(sw.bottom)}, strip from ${Math.round(strip.y)} (air ${Math.round(strip.y - sw.bottom)}px), entry ${Math.round(entry.y)}–${Math.round(entry.bottom)}`);

    // each option is whole and on top where it is drawn — nothing paints over it
    const opts = page.locator('.portal-enter-as-opt');
    await expect(opts).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      const b = await opts.nth(i).evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { x: r.left, y: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height, onTop: top === el || el.contains(top) };
      });
      expect(inside(b, w, h), `${at} opt${i}=${JSON.stringify(b)}`).toBe(true);
      expect(b.onTop, `${at} opt${i} covered`).toBe(true);
    }
    // and it answers the hand where it is seen
    await opts.nth(1).click();
    await expect(opts.nth(1)).toHaveAttribute('aria-checked', 'true');
    await opts.nth(0).click();
    await expect(opts.nth(0)).toHaveAttribute('aria-checked', 'true');

    await page.screenshot({ path: path.join(SHOTS, `gateway-${w}x${h}.png`) });
    expect(errors, errors.join(' | ')).toEqual([]);
    await ctx.close();
  });
}
