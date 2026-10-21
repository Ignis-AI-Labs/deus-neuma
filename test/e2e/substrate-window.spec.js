// @ts-check
import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { setupIsolatedHouse, openDesk, settledShot } from './helpers/isolated-house.js';

/**
 * End-to-end THE SUBSTRATE WINDOW OPENS WHOLE (2026-10-18) — it crashed on
 * open with React #31 ([…]): something it printed was
 * an object. Every server value it prints now goes through asText
 * (frontend/utils/as-text.js) and the failures feed it reads is text by the
 * logger's own law (backend/services/logger.js entryOf). This drives the real
 * window on a real isolated stack — its telemetry, its model bar, its
 * capacity card, its failures — and holds that it renders with no page error.
 * Read-only toward the machine's model server (the lens only reads).
 * Shot: test/e2e/shots/substrate-window.png
 */

const MEMBERS = [{ id: 'e2e-sub-one', name: 'Ashwren', utc: '2026-08-11T18:03:38.075Z' }];
const stack = setupIsolatedHouse(MEMBERS, 5081);

test.use({ viewport: { width: 1400, height: 1000 } });

test('the SUBSTRATE window opens whole — every printed value is text', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await openDesk(page, stack, MEMBERS[0]);
  await openDockApp(page, 'SUBSTRATE');
  const body = page.locator('.sub-body');
  await expect(body).toBeVisible({ timeout: 20000 });
  // its lens settles: either the live grid, or its honest UNAVAILABLE with the capacity card
  await expect(body.locator('.sub-grid')).toBeVisible({ timeout: 20000 });
  await expect(body).toContainText('PARALLEL CAPACITY');
  await page.waitForTimeout(3000); // a few polls land
  await settledShot(page.locator('.fwin', { has: body }), 'substrate-window');
  expect(crashes, crashes.join(' | ')).toEqual([]);
});
