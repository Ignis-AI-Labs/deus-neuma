// @ts-check
import { test, expect } from '@playwright/test';
import { setupExplorerPanel } from './helpers/explorer-panel-harness.js';
import { openDockApp } from './helpers/dock.js';

/**
 * THE MOTION BUDGET — choreography must ride the compositor. Founder
 * (2026-09-25): build the motion graphics in, […] A window's arrival and its close are the motion every
 * operator sees most; while they play, the main thread must not re-lay-out
 * or re-style the page frame after frame.
 *
 * Measured from the browser's own counters (CDP Performance.getMetrics)
 * across the choreography's window AFTER the mount settles, on the isolated
 * stack (never the live desk). Real app, real windows, no mocks.
 */

setupExplorerPanel();

const METRICS = ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration'];

const read = async (cdp) => {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.filter((m) => METRICS.includes(m.name)).map((m) => [m.name, m.value]));
};
const delta = (a, b) => Object.fromEntries(METRICS.map((k) => [k, b[k] - a[k]]));

// impure — count the frames the page painted over `ms`, and the worst gap.
const frames = (page, ms) => page.evaluate((span) => new Promise((resolve) => {
  const stamps = [];
  const t0 = performance.now();
  const step = (t) => {
    stamps.push(t);
    if (t - t0 < span) requestAnimationFrame(step);
    else resolve({ count: stamps.length, worstMs: Math.max(0, ...stamps.slice(1).map((s, i) => s - stamps[i])) });
  };
  requestAnimationFrame(step);
}), ms);

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test('a window arrives and closes on the compositor — no per-frame layout or style work', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const launcher = page.locator('.taskbar-app[data-app-id="wallet"]').first();
  const win = page.locator('.fwin').filter({ has: page.locator('.fwin-bar-title', { hasText: /WALLET/ }) });
  // The desk at rest, for the ledger: whatever lays out with no window moving.
  await page.waitForTimeout(1500);
  const idle0 = await read(cdp);
  const idleFrames = await frames(page, 800);
  // eslint-disable-next-line no-console
  console.log('MOTION-IDLE', JSON.stringify({ ...delta(idle0, await read(cdp)), ...idleFrames }));
  const opens = [];
  const closes = [];
  for (let i = 0; i < 5; i += 1) {
    /* eslint-disable no-await-in-loop -- one choreography at a time */
    await launcher.click();
    await expect(win).toHaveCount(1);
    await page.waitForTimeout(120); // the mount settles; the choreography plays on
    let before = await read(cdp);
    const openFrames = await frames(page, 800);
    opens.push({ ...delta(before, await read(cdp)), ...openFrames });

    await win.getByRole('button', { name: 'Close window' }).click();
    before = await read(cdp);
    const closeFrames = await frames(page, 420);
    closes.push({ ...delta(before, await read(cdp)), ...closeFrames });
    await expect(win).toHaveCount(0);
    await page.waitForTimeout(200);
    /* eslint-enable no-await-in-loop */
  }
  const summary = (runs) => Object.fromEntries(['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration', 'count', 'worstMs']
    .map((k) => [k, median(runs.map((r) => r[k]))]));
  const open = summary(opens);
  const close = summary(closes);
  // eslint-disable-next-line no-console -- the budget's own readout, for the ledger
  console.log('MOTION-BUDGET', JSON.stringify({ open, close }));
  // ~48 frames play in 800ms at 60Hz; a choreography that lays out per frame
  // spends one layout per frame. The budget: a handful, not one per frame.
  expect(open.LayoutCount).toBeLessThanOrEqual(8); // was 25 before the overlay choreography
  expect(close.LayoutCount).toBeLessThanOrEqual(5); // was 18
});

// impure — the running animations whose target is an SVG node. Chromium never
// composites those: each one re-lays out its SVG every frame it plays.
const svgAnimations = (page) => page.evaluate(() => document.getAnimations()
  .filter((a) => a.playState === 'running' && a.effect?.target instanceof SVGElement)
  .map((a) => `${a.animationName ?? a.transitionProperty}@${a.effect.target.tagName}.${a.effect.target.className?.baseVal ?? ''}`));

test('no animation ever runs on an SVG node — the desk at rest and every window as it opens', async ({ page }) => {
  expect(await svgAnimations(page)).toEqual([]);
  for (const app of ['WALLET', 'BENCH', 'SUBSTRATE', 'FILES']) {
    /* eslint-disable no-await-in-loop -- one window at a time */
    await openDockApp(page, app);
    await page.waitForTimeout(350); // mid-choreography, and the body's first loading state
    expect(await svgAnimations(page), app).toEqual([]);
    /* eslint-enable no-await-in-loop */
  }
});

test('calm lands every choreography on its final frame (reduced motion)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.taskbar-app[data-app-id="wallet"]').first().click();
  const win = page.locator('.fwin').filter({ has: page.locator('.fwin-bar-title', { hasText: /WALLET/ }) });
  await expect(win.locator('.fwin-body')).toHaveCSS('opacity', '1');
  await page.waitForTimeout(50);
  // Calm leaves nothing longer than its 1ms landing, and nothing looping.
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running')
    .filter((a) => { const t = a.effect?.getTiming(); return t.iterations === Infinity || Number(t.duration) > 1; })
    .map((a) => `${a.animationName ?? a.transitionProperty}@${a.effect?.target?.className}:${a.effect?.getTiming().duration}x${a.effect?.getTiming().iterations}`));
  expect(running).toEqual([]);
});

test('the line of light leaves with its entrance — a focused window at rest carries no hairline', async ({ page }) => {
  // Design note, 2026-09-26: a 1px line across BENCH, only while it had focus. The
  // entrance line rested transparent in the tree; the focus filter swap
  // re-rastered it. At rest the line must not exist at all.
  const launcher = page.locator('.taskbar-app[data-app-id="wallet"]').first();
  const win = page.locator('.fwin').filter({ has: page.locator('.fwin-bar-title', { hasText: /WALLET/ }) });
  await launcher.click();
  await expect(win.locator('.fwin-light')).toHaveCount(1); // the entrance draws it
  await expect(win.locator('.fwin-light')).toHaveCount(0); // and takes it with it
  await win.locator('.fwin-body').click({ position: { x: 20, y: 20 } });
  await expect(win).toHaveClass(/is-focused/);
  await page.waitForTimeout(300);
  await expect(win.locator('.fwin-light')).toHaveCount(0);
  // The close still plays its sever on the line.
  await win.getByRole('button', { name: 'Close window' }).click();
  await expect(win.locator('.fwin-light')).toHaveCount(1);
  await expect(win).toHaveCount(0);
});
