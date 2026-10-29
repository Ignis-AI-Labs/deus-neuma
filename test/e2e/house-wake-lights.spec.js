// @ts-check
// A MEMBER'S LIGHT READS A REAL WAKE, END TO END (RULE 0) — Design note, 2026-10-18:
// […]
//
// On the isolated wake-house stack (helpers/wake-house.js), a real browser
// holds the HOUSE window's member card for the housemate while its REAL wake
// runs, and reads what the operator sees: its soul light dim and ASLEEP;
// WAITING FOR THE MODEL, half-lit, while the desk's own turn holds the model
// line; AWAKE, fully lit, once the wake has its place; ASLEEP again when it
// ends; HELD · DAILY LIMIT and then HELD · PAUSED, alert, when a second post
// may not run — in the grid and the table alike, the soul color never
// replaced.
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { openDockApp } from './helpers/dock.js';
import { setupWakeHouseStack, openWakeHouse, sendPost, gate, holds, api, SIGNAL, ALERT } from './helpers/wake-house.js';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');

setupWakeHouseStack();

test('a member\'s light: asleep, waiting for the model, awake, asleep again, held — what the operator sees', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await openWakeHouse(page);

  await openDockApp(page, 'HOUSE');
  const house = page.locator('.house.hd');
  await expect(house).toBeVisible({ timeout: 20000 });
  const mate = house.locator('.house-seats-card').filter({ has: page.locator('.house-seats-who', { hasText: /mate/i }) });
  const label = mate.locator('.house-seats-wake');
  const light = mate.locator('.house-seats-light');
  const soul = await mate.evaluate((el) => getComputedStyle(el.querySelector('.house-seats-light')).backgroundColor);

  // ── ASLEEP: the light dim, its own color ─────────────────────────────────
  await expect(label).toHaveText('ASLEEP', { timeout: 20000 });
  await expect(light).toHaveCSS('opacity', '0.35');
  await expect(light).toHaveCSS('box-shadow', 'none');

  // ── WAITING FOR THE MODEL: the desk's own turn holds the line ────────────
  holds.sender = gate();
  holds.mate = gate();
  await sendPost(page, 1);
  await expect(label).toHaveText('WAITING FOR THE MODEL', { timeout: 30000 });
  await expect(label).toHaveCSS('color', 'rgba(79, 214, 232, 0.5)');
  await expect(light).toHaveCSS('opacity', '0.7');
  await expect(light).toHaveCSS('background-color', soul);
  await page.screenshot({ path: path.join(SHOTS, 'house-wake-01-waiting.png') });

  // ── AWAKE: the line is free, the wake has its place, its answer is held ──
  holds.sender.release();
  holds.sender = null;
  await expect(label).toHaveText('AWAKE', { timeout: 30000 });
  await expect(label).toHaveCSS('color', SIGNAL);
  await expect(light).toHaveCSS('opacity', '1');
  await expect(light).toHaveCSS('box-shadow', `${SIGNAL} 0px 0px 14px 2px`);
  await expect(light).toHaveCSS('background-color', soul);
  await page.screenshot({ path: path.join(SHOTS, 'house-wake-02-awake.png') });

  // ── ASLEEP again: the wake ends ──────────────────────────────────────────
  holds.mate.release();
  holds.mate = null;
  await expect(label).toHaveText('ASLEEP', { timeout: 30000 });
  await expect(light).toHaveCSS('opacity', '0.35');

  // ── HELD: a second post finds the daily limit spent; then the house paused ──
  await sendPost(page, 2);
  await expect(label).toHaveText('HELD · DAILY LIMIT', { timeout: 30000 });
  await expect(label).toHaveAttribute('title', /^DAILY LIMIT REACHED — /);
  await expect(label).toHaveCSS('color', ALERT);
  await expect(light).toHaveCSS('box-shadow', `${ALERT} 0px 0px 12px 1px`);
  await expect(light).toHaveCSS('background-color', soul);
  expect((await api('POST', '/api/v1/house-clock/charter/pause')).status).toBe(200);
  await expect(label).toHaveText('HELD · PAUSED', { timeout: 15000 });
  await page.screenshot({ path: path.join(SHOTS, 'house-wake-03-held.png') });
  // the table reads the same: the row's dot rings alert, the label beside the name
  await house.getByRole('button', { name: 'TABLE' }).click();
  const row = house.locator('.house-seats-row').filter({ hasText: /mate/i });
  await expect(row.locator('.house-seats-wake')).toHaveText('HELD · PAUSED');
  await expect(row.locator('.hd-light-dot')).toHaveCSS('box-shadow', `${ALERT} 0px 0px 12px 1px`);
  await house.getByRole('button', { name: 'GRID' }).click();

  expect(crashes, `page errors: ${crashes.join(' | ')}`).toEqual([]);
});
