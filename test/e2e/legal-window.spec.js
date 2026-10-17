// @ts-check
// THE LEGAL WINDOW — the CLO office on the desk (Design note, 2026-10-01: […]). The window opens from the dock's WATCH band, the watch runs
// for real over the house's own repo (read-only: licences, papers, commits),
// its matters land in the ledger, one opens whole, and the seat is held and
// released.
//
// Runs on the ISOLATED stack (perf-harness: its own backend, data root and
// vault) — never the live settings. Real auth, real browser, no mocks.
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupPerfStack, initPerfSession, perf } from './helpers/perf-harness.js';
import { passDeskGates } from './helpers/desk-gates.js';
import { openDockApp } from './helpers/dock.js';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');

setupPerfStack();
test.use({ viewport: { width: 1600, height: 900 } });

test('the LEGAL window: the watch runs, its matters open whole, the seat is held and released', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await initPerfSession(page);
  await page.goto(`http://localhost:${perf.FPORT}/`);
  await page.locator('.taskbar').waitFor({ timeout: 30000 });
  await passDeskGates(page, 5000);

  await openDockApp(page, 'LEGAL');
  const win = page.locator('.fwin').filter({ has: page.locator('.legal') }).first();
  await expect(win).toBeVisible({ timeout: 20000 });
  await win.getByRole('button', { name: 'Maximize window' }).click();
  await expect(win.locator('.sec-head-seat')).toHaveText(/NO PRAETOR SEATED/);

  // RUN WATCH — a real pass over the house's own repo
  await win.getByRole('button', { name: 'RUN WATCH' }).click();
  await expect(win.getByRole('button', { name: 'RUN WATCH' })).toBeEnabled({ timeout: 4 * 60 * 1000 });
  await expect(win.locator('.sec-strip-line').first()).toHaveText(/^LAST WATCH /);
  const rows = win.locator('.sec-row');
  await expect(rows.first()).toBeVisible();
  // the house ships an app: its papers are read, and the licence family is named
  await expect(win.locator('.sec-row-title', { hasText: 'LGPL-3.0-or-later' }).first()).toBeVisible();

  // one matter, whole
  await rows.first().click();
  const detail = win.locator('.legal-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("THE PRAETOR'S READINGS");
  await expect(detail).toContainText('NOT YET READ.');
  await page.screenshot({ path: path.join(SHOTS, 'legal-window.png') });
  await detail.getByRole('button', { name: 'CLOSE' }).click();

  // the NEW WORK filter narrows to build matters only
  await win.locator('.sec-chip', { hasText: /^NEW WORK$/ }).click();
  const shown = await win.locator('.sec-row-id').allInnerTexts();
  expect(shown.every((t) => t === 'NEW WORK')).toBe(true);

  // the seat: held (by the operator, through the real route), shown, released from the window
  const seated = await fetch(`${perf.BASE}/api/v1/legal/seat`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${perf.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ laneId: 'e2e-perf' }),
  });
  expect(seated.status).toBe(200);
  await win.getByRole('button', { name: 'RUN WATCH' }).click(); // reloads the office
  await expect(win.locator('.sec-head-seat')).toHaveText(/THE PRAETOR — /, { timeout: 4 * 60 * 1000 });
  await win.getByRole('button', { name: 'UNSEAT' }).click();
  await expect(win).toContainText('unseat the Praetor?');
  await win.locator('.legal-confirm').getByRole('button', { name: 'UNSEAT' }).click();
  await expect(win.locator('.sec-head-seat')).toHaveText(/NO PRAETOR SEATED/);

  expect(crashes, `page errors: ${crashes.join(' | ')}`).toEqual([]);
});
