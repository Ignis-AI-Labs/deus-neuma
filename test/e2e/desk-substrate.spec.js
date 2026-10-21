// @ts-check
// Desk e2e — SUBSTRATE / LINK / INFERENCE apps. Split from desk.spec.js (SIZE-017).
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { openDockApp } from './helpers/dock.js';
import { BACKEND, token, setupDesk } from './helpers/desk-harness.js';

setupDesk();

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');

test('SUBSTRATE: the engine-room HUD opens and renders the live lens', async ({ page }) => {
  await openDockApp(page, 'SUBSTRATE');
  const hud = page.locator('.sub-body');
  await expect(hud).toBeVisible();
  // Never a blank window: either the live instrument panels (substrate serving)
  // or the honest empty/loading state. One of them proves the lens wired through.
  await expect(page.locator('.sub-panel-title').first().or(page.locator('.empty-state'))).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('SUBSTRATE: the machine reads as instruments — dials, cores, DIMMs, drives — against the real readings', async ({ page }) => {
  // Ground truth: the same machine read the HUD draws (backend/services/machine-thermals.js).
  const machine = await (await fetch(`${BACKEND}/api/v1/substrate/machine`, { headers: { Authorization: `Bearer ${token}` } })).json();
  await page.setViewportSize({ width: 1680, height: 1050 });
  await openDockApp(page, 'SUBSTRATE');
  const win = page.locator('.fwin', { has: page.locator('.sub-body') });
  const maximize = win.getByRole('button', { name: 'Maximize window' });
  if (await maximize.count()) await maximize.first().click();
  const hud = page.locator('.sub-body');
  await expect(hud.locator('.sub-panel-title', { hasText: 'BOARD · COOLING' })).toBeVisible();
  // One heatmap cell per core the chip reports, one thermometer per DIMM,
  // one bar per drive's Composite — the console draws every reading it was given.
  const of = (kind, re) => machine.readings.filter((r) => r.kind === kind && r.type === 'temp' && re.test(r.label));
  await expect(hud.locator('.hud-core')).toHaveCount(of('cpu', /^core\s*\d+/i).length);
  await expect(hud.locator('.hud-thermo')).toHaveCount(of('memory', /./).length);
  await expect(hud.locator('.sub-panel', { hasText: 'STORAGE' }).locator('.hud-bar')).toHaveCount(of('storage', /^Composite$/).length);
  // Every alert the machine raised is counted in the strip.
  if (machine.alerts.length) await expect(hud.locator('.hud-alerts-count')).toHaveText(String(machine.alerts.length));
  else await expect(hud.locator('.hud-alerts')).toHaveCount(0);
  await expect(hud.locator('.hud-dial').first()).toBeVisible();
  // The window's open and maximize transitions settle before the eye reads it.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'substrate-hud.png') });
  await hud.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, 'substrate-hud-lower.png') });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('SUBSTRATE: the global ignite control stands, offering the rig catalog', async ({ page }) => {
  // Ground truth from the backend — the same catalog the picker loads.
  const cat = await (await fetch(`${BACKEND}/api/v1/llm/substrate/models`, { headers: { Authorization: `Bearer ${token}` } })).json();
  await openDockApp(page, 'SUBSTRATE');
  await expect(page.locator('.sub-body')).toBeVisible();
  // The switch itself always stands (IGNITE when down, UNLOAD when serving)…
  await expect(page.locator('.ignite-control .sub-btn').first()).toBeVisible();
  // …and when the rig declares models, every one of them is offered. The
  // picker is the shared LINE & CYCLE dropdown now (not a native <select>),
  // so its options live in the DOM only while the panel is open.
  if ((cat.models ?? []).length > 0) {
    const dropdown = page.locator('.ignite-control .lc-sel');
    await expect(dropdown.locator('.lc-sel-trigger')).toBeVisible();
    await dropdown.locator('.lc-sel-trigger').click();
    await expect(dropdown.locator('.lc-sel-opt[role="option"]')).toHaveCount(cat.models.length);
  }
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('LINK status honestly reflects substrate reachability, not just the socket', async ({ page }) => {
  // Ground truth from the backend — the same provider probe the header polls.
  const prov = await (await fetch(`${BACKEND}/api/v1/llm/provider`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const reachable = prov.status === 'connected';
  // Two lights share this class since the ROUTE light landed (#269): LOCAL
  // renders first, ROUTE second (RelinkShell renders local then route). This
  // test guards the LOCAL substrate light — strict mode needs the one element.
  const link = page.locator('.relink-status-link').first();
  await expect(link).toBeVisible();
  if (reachable) {
    await expect(link).toContainText('ACTIVE');
  } else {
    // The exact bug: portal open but substrate down must NOT read as ACTIVE.
    await expect(link).toContainText('OFFLINE');
    await expect(link).not.toContainText('ACTIVE');
  }
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('INFERENCE: the preset bar offers the modes and switches on one tap', async ({ page }) => {
  // The STREAM window opens by default; its preset bar loads the modes from the
  // real API. A preset is a default, not a cage — switching is one tap. (Tests
  // the switch, not the initial default, so it survives repeated runs.)
  const chips = page.locator('.relink-preset');
  await expect(chips).toHaveCount(3);
  await page.locator('.relink-preset', { hasText: 'GROUNDED' }).click();
  await expect(page.locator('.relink-preset', { hasText: 'GROUNDED' })).toHaveClass(/is-on/);
  await page.locator('.relink-preset', { hasText: 'EXPANSIVE' }).click();
  await expect(page.locator('.relink-preset', { hasText: 'EXPANSIVE' })).toHaveClass(/is-on/);
  await expect(page.locator('.relink-preset', { hasText: 'GROUNDED' })).not.toHaveClass(/is-on/);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
