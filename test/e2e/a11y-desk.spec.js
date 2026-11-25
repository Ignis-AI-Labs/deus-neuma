// @ts-check
/**
 * THE DESK, SCANNED (AGENTS.md's accessibility rule; Design note, 2026-11-12: […]). A real backend and vite on their own
 * ports (isolated-house.js), a real Chromium, axe-core over the desk and the
 * windows a person opens first — each judged against its frozen baseline
 * (test/helpers/a11y-scan.js): a regression fails like any other bug. No
 * double (RULE 0).
 */
import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { setupIsolatedHouse, openDesk } from './helpers/isolated-house.js';
import { a11yCheck } from '../helpers/a11y-scan.js';

const MEMBERS = [{ id: 'e2e-a11y-one', name: 'Ashwren', utc: '2026-08-11T18:03:38.075Z' }];
const stack = setupIsolatedHouse(MEMBERS, 5187);

test.use({ viewport: { width: 1600, height: 1000 } });

const judged = async (page, screen, scope) => {
  const out = await a11yCheck(page, screen, scope);
  expect(out.grown, out.detail).toEqual([]);
};

test('the desk and its first windows: no accessibility finding past its baseline', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await openDesk(page, stack, MEMBERS[0]);
  await judged(page, 'desk');
  for (const [label, id] of [['SETTINGS', 'settings'], ['MARKETING', 'marketing']]) {
    await openDockApp(page, label);
    const win = page.locator(`[data-window-id="${id}"]`);
    await expect(win).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(800);
    await judged(page, `desk-${id}`, { include: `[data-window-id="${id}"]` });
  }
  expect(crashes).toEqual([]);
});
