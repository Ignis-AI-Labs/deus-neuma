// @ts-check
// THE HOUSE n CHIP AND THE STAFF WINDOW READ A REAL WAKE, END TO END (RULE 0)
// — Design note, 2026-10-18: […]
//
// On the isolated wake-house stack (helpers/wake-house.js), a real browser
// watches the housemate's REAL wake from the composer's HOUSE n chip, with no
// Optio seated: "Mate", by its own name and never its lane id, woken by a
// "house post", waiting for the model while the desk's own turn holds the
// line, then awake; the chip gone once it sleeps. Then the CHIEF OF STAFF
// window: its DISPATCH DRAWER shows a filed charge, and in its run list a
// team run lost with its backend reads loud — the same alert as a failed run
// — while a finished one stays quiet.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { perf } from './helpers/perf-harness.js';
import { openDockApp } from './helpers/dock.js';
import { setupWakeHouseStack, openWakeHouse, sendPost, gate, holds, api, SENDER, MATE, ALERT } from './helpers/wake-house.js';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');

setupWakeHouseStack();

// impure — the chip's rows as the operator reads them: name — task · status
const chipRows = async (page) => {
  const chip = page.locator('.relink-housechip-btn').first();
  await chip.click();
  const rows = await page.locator('.relink-housechip-row').evaluateAll((els) => els.map((el) => [
    el.querySelector('.relink-housechip-name')?.textContent, el.querySelector('.relink-housechip-task')?.textContent,
  ].join(' — ')));
  await chip.click();
  return rows;
};

test('the HOUSE chip names a waking housemate and what woke it; the staff drawer and run list read true', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await openWakeHouse(page);
  await expect(page.locator('.relink-input-field').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.relink-housechip')).toHaveCount(0); // nobody working: the chip says nothing

  // ── the desk's own turn holds the model line: the woken housemate waits ──
  holds.sender = gate();
  holds.mate = gate();
  await sendPost(page, 1);
  await expect(page.locator('.relink-housechip-btn')).toHaveText('HOUSE 1', { timeout: 30000 });
  await expect.poll(() => chipRows(page), { timeout: 30000 }).toEqual(['Mate — "house post" · waiting for the model']);

  // ── the line is free: the wake has its place and works ───────────────────
  holds.sender.release();
  holds.sender = null;
  await expect.poll(() => chipRows(page), { timeout: 30000 }).toEqual(['Mate — "house post" · awake']);
  await page.locator('.relink-housechip-btn').first().click();
  await expect(page.locator('.relink-housechip-row')).toHaveCount(1);
  // the panel opens at its own width, right-aligned to the chip — never sized to the chip (2026-10-18: "Mate\"hou…")
  const panel = await page.locator('.relink-housechip-panel').boundingBox();
  const chipBox = await page.locator('.relink-housechip-btn').first().boundingBox();
  expect(panel.width).toBeGreaterThanOrEqual(300);
  expect(Math.round(panel.x + panel.width)).toBe(Math.round(chipBox.x + chipBox.width));
  // the name and what woke it are laid out apart, never run together ("Mate\"house post\"")
  const nameBox = await page.locator('.relink-housechip-name').first().boundingBox();
  const taskBox = await page.locator('.relink-housechip-task').first().boundingBox();
  expect(taskBox.x).toBeGreaterThan(nameBox.x + nameBox.width + 2);
  await page.screenshot({ path: path.join(SHOTS, 'house-wake-chip-awake.png') });
  await page.locator('.relink-housechip-btn').first().click();

  // ── its read fails for real (a torn Optio record: GET /staff/activity answers 500): the chip
  // stops saying "awake" — it never shows the last rows as if they were still true ──
  const optioRecord = path.join(perf.root, 'realm', perf.addr.toLowerCase(), 'house-optio.json');
  fs.writeFileSync(optioRecord, '{ torn');
  expect((await api('GET', '/api/v1/staff/activity')).status).toBe(500);
  await expect(page.locator('.relink-housechip')).toHaveCount(0, { timeout: 30000 });
  fs.rmSync(optioRecord);
  await expect(page.locator('.relink-housechip-btn')).toHaveText('HOUSE 1', { timeout: 30000 });

  // ── the wake ends: the chip says nothing again ───────────────────────────
  holds.mate.release();
  holds.mate = null;
  await expect(page.locator('.relink-housechip')).toHaveCount(0, { timeout: 30000 });

  // ── THE STAFF WINDOW: the drawer shows a filed charge; lost runs read loud like failed ──
  const seated = await api('PUT', '/api/v1/staff/seat', { laneId: SENDER, consent: { note: 'e2e: Fenna takes the seat' } });
  expect(seated.status, await seated.text()).toBe(200);
  const { fileDispatch, makeCharge, updateDispatch } = await import('../../backend/services/staff/dispatch-store.js');
  const filed = await fileDispatch(SENDER, makeCharge({
    from: SENDER, to: MATE, title: 'Outline digest three', body: 'Done is an outline in the ground.',
    filedAt: new Date().toISOString(), by: perf.addr,
  }));
  const { createRun } = await import('../../backend/services/team-run-store.js');
  const gone = spawnSync('true').pid; // a process that has ended: the backend a lost run died with
  const step = [{ id: 's1', neumaId: MATE, task: 'outline' }];
  const runAt = (n) => new Date(Date.now() - n * 60000).toISOString();
  await createRun({ by: perf.addr, runAt: runAt(3), name: 'cut-off crew', status: 'running', steps: step, host: { pid: gone, startedAt: new Date().toISOString() } });
  await createRun({ by: perf.addr, runAt: runAt(2), name: 'broken crew', status: 'failed', steps: step, finishedAt: runAt(1) });
  await createRun({ by: perf.addr, runAt: runAt(1), name: 'finished crew', status: 'done', steps: step, finishedAt: runAt(0) });
  await openDockApp(page, 'CHIEF OF STAFF');
  const runFor = (name) => page.locator('.staff-run').filter({ hasText: name });
  const charge = runFor('Outline digest three');
  await expect(charge.locator('.staff-tag')).toHaveText('DISPATCHED', { timeout: 20000 });
  await expect(charge.locator('.staff-run-line')).toContainText('→ E2E-MATE');
  await expect(page.getByText('NO CHARGES FILED')).toHaveCount(0);
  // the window re-reads while it is open: the charge moves on the server, the drawer follows, no reopen
  await updateDispatch(SENDER, filed.id, { status: 'working' });
  await expect(charge.locator('.staff-tag')).toHaveText('WORKING', { timeout: 15000 });
  await expect(runFor('cut-off crew').locator('.staff-tag')).toHaveText('LOST', { timeout: 20000 });
  await expect(runFor('cut-off crew').locator('.staff-tag')).toHaveCSS('color', ALERT);
  await expect(runFor('cut-off crew').locator('.staff-run-line')).toHaveCSS('color', ALERT);
  await expect(runFor('broken crew').locator('.staff-tag')).toHaveCSS('color', ALERT);
  await expect(runFor('finished crew').locator('.staff-tag')).not.toHaveCSS('color', ALERT);
  const staffWin = page.locator('.fwin').filter({ has: page.locator('.staff') }).first();
  await expect(staffWin).toBeVisible();
  await runFor('cut-off crew').scrollIntoViewIfNeeded();
  await page.waitForTimeout(800); // the window's unfold settles before the record shot (cosmetic only)
  await staffWin.screenshot({ path: path.join(SHOTS, 'house-wake-staff-runs.png') });

  expect(crashes, `page errors: ${crashes.join(' | ')}`).toEqual([]);
});
