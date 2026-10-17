// @ts-check
// THE TASKBAR + LAUNCHER, in the browser, for real (docs/work/os-taskbar-launcher.md).
// Design note, 2026-10-05: the desk navigates like an operating system — pinned icons on
// a bar, every app in a launcher with search, the bar the person's own.
import { test, expect } from '@playwright/test';
import { openDockApp, openLauncher } from './helpers/dock.js';
import { setupDesk } from './helpers/desk-harness.js';
import { passDeskGates } from './helpers/desk-gates.js';

setupDesk();

// Every test starts from the default bar: no saved pins, names or edge.
test.beforeEach(async ({ page }) => {
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.endsWith(':taskbar')).forEach((k) => localStorage.removeItem(k)));
  await page.reload();
  await expect(page.locator('.taskbar')).toBeVisible({ timeout: 30000 });
  await passDeskGates(page, 5000);
});

const bar = (page) => page.locator('.taskbar');
const pinnedIds = (page) => page.locator('.taskbar-apps .taskbar-app.is-pinned')
  .evaluateAll((els) => els.map((e) => e.getAttribute('data-app-id')));

test('the bar: launcher first, the pinned apps, the tray with the clock', async ({ page }) => {
  await expect(bar(page).locator('.taskbar-launcher')).toBeVisible();
  expect((await pinnedIds(page)).length).toBeGreaterThan(0);
  await expect(bar(page).locator('.taskbar-tray .taskbar-app[data-app-id="wallet"]')).toBeVisible();
  await expect(bar(page).locator('.taskbar-clock')).toHaveText(/\d/);
  await page.screenshot({ path: 'test/e2e/shots/taskbar-bar.png' });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the launcher: every app by category, search, Enter opens the first match', async ({ page }) => {
  await openLauncher(page);
  await expect(page.locator('.launcher-section').first()).toBeVisible();
  await expect(page.locator('.launcher-section[data-category="work"]')).toBeVisible();
  await page.screenshot({ path: 'test/e2e/shots/taskbar-launcher.png' });
  await page.locator('.launcher-search').fill('skil');
  await expect(page.locator('.launcher-tile').first()).toHaveAttribute('data-app-id', 'skills');
  await page.keyboard.press('Enter');
  await expect(page.locator('.launcher')).toHaveCount(0);
  await expect(page.locator('.fwin', { hasText: /SKILLS/i }).first()).toBeVisible();
  // the open app now shows on the bar, after the pins
  await expect(bar(page).locator('.taskbar-apps .taskbar-app[data-app-id="skills"]')).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('Ctrl+Space opens the launcher; Escape closes it', async ({ page }) => {
  await page.keyboard.press('Control+Space');
  await expect(page.locator('.launcher-search')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.launcher')).toHaveCount(0);
});

test('pin from the launcher, unpin from the bar — and it is remembered', async ({ page }) => {
  await openLauncher(page);
  await page.locator('.launcher-tile[data-app-id="skills"]').click({ button: 'right' });
  await page.locator('.taskbar-menu .dock-menu-item', { hasText: /pin to/i }).click();
  await page.keyboard.press('Escape');
  expect(await pinnedIds(page)).toContain('skills');
  await page.reload();
  await expect(page.locator('.taskbar')).toBeVisible({ timeout: 30000 });
  await passDeskGates(page, 5000);
  expect(await pinnedIds(page)).toContain('skills');
  await bar(page).locator('.taskbar-app[data-app-id="skills"]').click({ button: 'right' });
  await page.locator('.taskbar-menu .dock-menu-item', { hasText: /unpin/i }).click();
  expect(await pinnedIds(page)).not.toContain('skills');
});

test('drag a pinned app along the bar to reorder it', async ({ page }) => {
  const before = await pinnedIds(page);
  expect(before.length).toBeGreaterThanOrEqual(2);
  const last = bar(page).locator(`.taskbar-app[data-app-id="${before.at(-1)}"]`);
  const first = bar(page).locator(`.taskbar-app[data-app-id="${before[0]}"]`);
  const from = await last.boundingBox();
  const to = await first.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 - 10, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 16 });
  await page.mouse.up();
  await expect.poll(() => pinnedIds(page)).toEqual([before.at(-1), ...before.slice(0, -1)]);
});

test('right-click the bar: names on, then the bar moves to the left edge and the top', async ({ page }) => {
  await bar(page).locator('.taskbar-fill').click({ button: 'right' });
  await page.locator('.taskbar-menu .dock-menu-item', { hasText: /show names/i }).click();
  await expect(bar(page).locator('.taskbar-app-label').first()).toBeVisible();
  await page.screenshot({ path: 'test/e2e/shots/taskbar-names.png' });

  for (const edge of ['left', 'top']) {
    await bar(page).locator('.taskbar-fill').click({ button: 'right' });
    await page.locator('.taskbar-menu [role="menuitemradio"]', { hasText: new RegExp(edge, 'i') }).click();
    await expect(page.locator('.taskbar')).toHaveClass(new RegExp(`edge-${edge}`));
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.taskbarEdge)).toBe(edge);
    await openDockApp(page, 'SKILLS');
    // a window never sits under the bar
    const barBox = await bar(page).locator('.taskbar-bar').boundingBox();
    const win = await page.locator('.fwin').last().boundingBox();
    if (edge === 'left') expect(win.x).toBeGreaterThanOrEqual(barBox.x + barBox.width);
    if (edge === 'top') expect(win.y).toBeGreaterThanOrEqual(barBox.y + barBox.height);
    await page.screenshot({ path: `test/e2e/shots/taskbar-${edge}.png` });
  }
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
