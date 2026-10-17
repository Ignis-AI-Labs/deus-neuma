// @ts-check
// CTRL+SHIFT+N — a new stream window (Design note, 2026-09-29: […]).
//
// Runs on the ISOLATED stack (perf-harness: production build, its own backend,
// data root and vault), so it never boots a backend against the live settings
// and its post scheduler. Real auth, real browser, no mocks (RULE 0).
import { test, expect } from '@playwright/test';
import { setupPerfStack, initPerfSession, perf } from './helpers/perf-harness.js';
import { passDeskGates } from './helpers/desk-gates.js';

setupPerfStack();
test.use({ viewport: { width: 1600, height: 900 } });

test('CTRL+SHIFT+N opens a new stream window — even from inside the composer, typing nothing', async ({ page }) => {
  await initPerfSession(page);
  await page.goto(`http://localhost:${perf.FPORT}/`);
  await page.locator('.taskbar').waitFor({ timeout: 30000 });
  await passDeskGates(page, 5000);
  // Maximized, as someone working in it holds it: at the default size the
  // tasks rail leaves the composer row no room (a separate finding).
  const streamWin = page.locator('.fwin').filter({ has: page.locator('.relink-input-field') }).first();
  await streamWin.waitFor({ timeout: 30000 });
  await streamWin.getByRole('button', { name: 'Maximize window' }).click();

  const streams = page.locator('.fwin').filter({ has: page.locator('.relink-input-field') });
  const draft = streamWin.locator('.relink-input-field');
  await expect(draft).toBeVisible({ timeout: 30000 });
  const before = await streams.count();

  // The chord types no character, so it answers inside the composer too —
  // and must leave the draft untouched.
  await draft.click();
  await draft.fill('draft');
  await page.keyboard.press('Control+Shift+N');
  await expect(streams).toHaveCount(before + 1);
  await expect(draft).toHaveValue('draft');
  // The new stream is the focused window.
  await expect(page.locator('.fwin.is-focused .relink-input-field')).toHaveCount(1);
  await expect(streamWin).not.toHaveClass(/is-focused/);

  // Plain Ctrl+N is not the chord.
  await page.keyboard.press('Control+N');
  await expect(streams).toHaveCount(before + 1);
});
