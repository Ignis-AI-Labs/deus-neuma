// @ts-check
// Desk e2e — SUBSTRATE / LINK / INFERENCE apps. Split from desk.spec.js (SIZE-017).
import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { BACKEND, token, setupDesk } from './helpers/desk-harness.js';

setupDesk();

test('SUBSTRATE: the engine-room HUD opens and renders the live lens', async ({ page }) => {
  await openDockApp(page, 'SUBSTRATE');
  const hud = page.locator('.sub-body');
  await expect(hud).toBeVisible();
  // Never a blank window: either the live instrument panels (substrate serving)
  // or the honest empty/loading state. One of them proves the lens wired through.
  await expect(page.locator('.sub-panel-title').first().or(page.locator('.empty-state'))).toBeVisible();
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
