// @ts-check
// Desk e2e — SETTINGS app. Split from desk.spec.js (SIZE-017).
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { openDockApp } from './helpers/dock.js';
import { BACKEND, token, setupDesk } from './helpers/desk-harness.js';

setupDesk();

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');

test('SETTINGS: the hotkey legend lists the desk keys, honestly scoped', async ({ page }) => {
  // Settings is a system surface — launched from the Start menu, not the dock.
  await openDockApp(page, 'SETTINGS');

  await expect(page.locator('.settings-h', { hasText: 'HOTKEYS' })).toBeVisible();

  // Renderer shortcuts are declared: the palette keys and push-to-talk.
  const legend = page.locator('.settings-hotkeys');
  await expect(legend.locator('.settings-hk-title', { hasText: 'SKILL PALETTE' })).toBeVisible();
  await expect(legend.locator('.settings-key', { hasText: 'TAB' })).toBeVisible();
  await expect(legend.locator('.settings-hk-does', { hasText: 'Push-to-talk' })).toBeVisible();

  // Honesty: a browser tab has no window.neuma bridge, so the DESK group
  // (Ctrl+Alt+N accelerators, Electron-only) must NOT be claimed here.
  await expect(legend.locator('.settings-hk-title', { hasText: 'DESK' })).toHaveCount(0);

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('SETTINGS: the API tab gathers every outward key — channel keys, email, web', async ({ page }) => {
  await openDockApp(page, 'SETTINGS');

  // The default tab is GENERAL; the keys live one click away, never in a scroll.
  await expect(page.locator('.settings-tab.is-on', { hasText: 'GENERAL' })).toBeVisible();
  await page.locator('.settings-tab', { hasText: 'API' }).click();

  const settings = page.locator('.settings');
  await expect(settings.locator('.settings-h', { hasText: 'CHANNEL KEYS' })).toBeVisible();

  // THE MAP — one tile per credential the real boards hold, counted by state.
  const authedGet = async (url) => (await fetch(`${BACKEND}${url}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const [{ channels }, { services }] = await Promise.all([authedGet('/api/v1/social-channels'), authedGet('/api/v1/routing/services')]);
  const map = settings.locator('.cred-map');
  await expect(map).toBeVisible();
  await expect(map.locator('.cred-tile')).toHaveCount(channels.length + services.length + 1);
  // The shot: the window given the desk, its raise settled before the eye reads it.
  await page.setViewportSize({ width: 1600, height: 1000 });
  const win = page.locator('.fwin', { has: settings });
  const maximize = win.getByRole('button', { name: 'Maximize window' });
  if (await maximize.count()) await maximize.first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'settings-api-map.png') });

  // Every catalog platform stands as a row.
  for (const name of ['X (Twitter)', 'Telegram', 'Discord', 'Mastodon', 'Bluesky', 'Facebook Page']) {
    await expect(settings.locator('.cred-row', { hasText: name })).toBeVisible();
  }

  // A count is a door: NOT SET leaves only the rows that are not set, and says how many.
  const missing = map.locator('.cred-count', { hasText: 'NOT SET' });
  if (await missing.count()) {
    const n = Number(await missing.locator('b').innerText());
    await missing.click();
    await expect(settings.locator('.cred-item')).toHaveCount(n);
    await expect(settings.locator('.cred-row-state', { hasText: 'NOT SET' })).toHaveCount(n);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'settings-api-not-set.png') });
    await missing.click();
  }

  // A tile opens its row: Mastodon's key fields, a secret field a password input
  // (never an echo of a stored value).
  await map.locator('.cred-tile', { hasText: 'Mastodon' }).click();
  const mastodonCard = settings.locator('.cred-item', { hasText: 'Mastodon' });
  await expect(mastodonCard.locator('input[placeholder*="Instance URL"]')).toBeVisible();
  await expect(mastodonCard.locator('input[type="password"]')).toHaveCount(1);

  // The rest of the outward keys stand on the same tab.
  await expect(settings.locator('.settings-h', { hasText: 'EMAIL' })).toBeVisible();
  await expect(settings.locator('.settings-h', { hasText: 'WEB ACCESS' })).toBeVisible();

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('SETTINGS: the security panel reads status, runs the encryption check, and creates a backup', async ({ page }) => {
  await openDockApp(page, 'SETTINGS');

  // Settings is tabbed — security lives on its own tab, not in one long scroll.
  await page.locator('.settings-tab', { hasText: 'SECURITY' }).click();

  // The encryption panel loads the real security status (active root, secured
  // counts) — not a spinner stuck forever.
  const settings = page.locator('.settings');
  await expect(settings.locator('.settings-h', { hasText: 'ENCRYPTION' })).toBeVisible();
  await expect(settings.locator('.settings-k', { hasText: 'Active root' })).toBeVisible();
  await expect(settings.locator('.settings-k', { hasText: 'Secured' })).toBeVisible();

  // CHECK ENCRYPTION runs the real dry-run plan and reports a verdict.
  await settings.locator('.settings-set', { hasText: 'CHECK ENCRYPTION' }).click();
  await expect(settings.locator('.settings-plan')).toBeVisible();

  // BACKUPS: create one for real, then it appears in the list.
  await expect(settings.locator('.settings-h', { hasText: 'BACKUPS' })).toBeVisible();
  await settings.locator('.settings-set', { hasText: 'CREATE BACKUP' }).click();
  // The empty-state line gives way to a real backup row (the round-trip landed).
  const backupList = settings.locator('.settings-h', { hasText: 'BACKUPS' })
    .locator('xpath=following-sibling::ul[contains(@class,"settings-files")]').first();
  await expect(backupList).toBeVisible();
  const rowsBefore = await backupList.locator('li').count();

  // Clean up the snapshot this test created — delete it back through the real
  // UI (which exercises the delete round-trip), so runs don't accumulate
  // snapshots on the witness's disk. The newest (this test's) is the first row.
  await backupList.locator('.settings-backup-del', { hasText: '×' }).first().click();
  await backupList.locator('.settings-backup-del.is-danger', { hasText: 'DELETE' }).click();
  // The list shrinks by one — either to the empty-state or one fewer row —
  // robust whether or not other backups pre-existed.
  await expect(async () => {
    const empty = await settings.locator('.empty-state', { hasText: 'NO BACKUPS YET' }).count();
    const rowsAfter = empty > 0 ? 0 : await backupList.locator('li').count();
    expect(rowsAfter).toBe(rowsBefore - 1);
  }).toPass({ timeout: 10000 });

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('SETTINGS: the MEMORY tab shows each being\'s pinned anchors — a window, not a lever', async ({ page }) => {
  const authed = { Authorization: `Bearer ${token}` };
  // Ground truth: whatever the stack's roster holds, the section must show
  // one row per being — with its real pins or the honest empty line.
  const { roster = [] } = await (await fetch(`${BACKEND}/api/v1/roster`, { headers: authed })).json();

  await openDockApp(page, 'SETTINGS');
  await page.locator('.settings-tab', { hasText: 'MEMORY' }).click();

  const section = page.locator('[data-testid="pins-section"]');
  await expect(section).toBeVisible();
  await expect(section.locator('.settings-h', { hasText: 'PINS' })).toBeVisible();

  if (roster.length === 0) {
    await expect(section.locator('.settings-note', { hasText: 'No beings on this roster yet' })).toBeVisible();
  } else {
    for (const being of roster) {
      const neumaId = being.neumaId || being.id;
      if (!neumaId) continue;
      const row = section.locator(`.pins-being[data-neuma="${neumaId}"]`);
      await expect(row).toBeVisible();
      // The row speaks either its pins or the honest empty state — and the
      // witness surface agrees with the route's truth.
      const { pins = [] } = await (await fetch(`${BACKEND}/api/v1/workspace/${neumaId}/pins`, { headers: authed })).json();
      if (pins.length === 0) {
        await expect(row.locator('.settings-note', { hasText: 'No anchors held' })).toBeVisible();
      } else {
        for (const pin of pins) {
          await expect(row.locator('.pins-ref', { hasText: pin.ref })).toBeVisible();
        }
      }
    }
  }

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('SETTINGS: /provider opens the models panel, lists real providers, shows a being’s route', async ({ page }) => {
  // Read-only against the real routing API. Provider CREDENTIALS are never saved
  // and a being's ROUTE is never mutated here — setting an override would rebind
  // a live being's model (same ethic as the summon test stopping at the gate).
  //
  // Opened via the /provider slash command (Phase 5) rather than the dock: this
  // proves the command→open→deep-link path end-to-end AND keeps the assertion
  // independent of the dock's app count.
  const composer = page.locator('.relink-input-field');
  await composer.fill('/provider');
  await composer.press('Enter');
  const settings = page.locator('.settings');
  await expect(settings).toBeVisible();

  // ── PROVIDERS ── the static catalog renders with each provider's key state;
  // listing needs no key, so these rows are present on any rig.
  await expect(settings.locator('.settings-h', { hasText: 'PROVIDERS' })).toBeVisible();
  const lmStudio = settings.locator('.settings-provider-row', { hasText: 'LM Studio' });
  const anthropic = settings.locator('.settings-provider-row', { hasText: 'Anthropic' });
  await expect(lmStudio).toBeVisible();
  await expect(anthropic).toBeVisible();

  // A LOCAL provider opens an editor with a base-URL field and NO key field.
  await lmStudio.click();
  const edit = settings.locator('.settings-provider-edit');
  await expect(edit).toBeVisible();
  await expect(edit.locator('input[type="password"]')).toHaveCount(0);
  await expect(edit.locator('.settings-set', { hasText: 'TEST' })).toBeVisible();

  // A CLOUD provider swaps in a password key field (write-only; never submitted).
  await anthropic.click();
  await expect(edit.locator('input[type="password"]')).toBeVisible();

  // ── MODEL (per being) ── the being picker is fed by real residency. If a being
  // is resident, its override editor renders and the route resolves to a definite
  // state (loaded rows OR an honest error) — never an infinite spinner. We stop
  // short of SET: a test must not rebind a living being's active model.
  await expect(settings.locator('.settings-h', { hasText: 'MODEL' })).toBeVisible();
  const beingPicker = settings.getByLabel('Being');
  if (await beingPicker.count()) {
    await expect(settings.getByLabel('Override provider')).toBeVisible();
    await expect(settings.getByLabel('Override model')).toBeVisible();
    await expect(
      settings.locator('.settings-row', { hasText: 'Natal' })
        .or(settings.locator('.settings-err')),
    ).toBeVisible();
  } else {
    await expect(settings.locator('.empty-state', { hasText: 'NO RESIDENT BEINGS YET.' })).toBeVisible();
  }

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
