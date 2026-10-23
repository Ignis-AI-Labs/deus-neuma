// @ts-check
// Desk e2e — OUTREACH dock section (platforms, MARKETING, LEADS). Split from desk.spec.js (SIZE-017).
import { test, expect } from '@playwright/test';
import { openDockApp, openLauncher } from './helpers/dock.js';
import { setupDesk } from './helpers/desk-harness.js';
import path from 'path';
import { fileURLToPath } from 'url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');

setupDesk();

test('REACH: the launcher group is the platform roster — every platform its own window', async ({ page }) => {
  // The launcher's REACH group lists every platform beside MARKETING and LEADS —
  // navigation lives on the taskbar, never buried inside one window's tabs.
  await openLauncher(page);
  const reach = page.locator('.launcher-section[data-category="reach"]');
  for (const label of ['X', 'TELEGRAM', 'DISCORD', 'FACEBOOK', 'MASTODON', 'BLUESKY', 'MARKETING', 'LEADS']) {
    await expect(reach.locator('.launcher-tile', { hasText: new RegExp(`^${label}$`) })).toBeVisible();
  }
  // Each platform is named by its own mark — seven platforms, seven different drawings.
  const platforms = ['X', 'TELEGRAM', 'DISCORD', 'FACEBOOK', 'MASTODON', 'BLUESKY', 'LINKEDIN'];
  const marks = await Promise.all(platforms.map((label) => reach
    .locator('.launcher-tile', { hasText: new RegExp(`^${label}$`) }).locator('svg path').first().getAttribute('d')));
  expect(new Set(marks).size).toBe(platforms.length);
  await reach.screenshot({ path: path.join(SHOTS, 'launcher-reach-marks.png') });

  // X's own window: the standing reads as three labeled cells — keys,
  // holder and crew are different decisions (stacked unlabeled they read as
  // a contradiction) — and its boards hang as CAMPAIGNS / QUEUE.
  await reach.locator('.launcher-tile', { hasText: /^X$/ }).click();
  const space = page.locator('.outreach-panel');
  const unfold = async (panel) => {
    const btn = panel.locator('.pc-standing-btn');
    if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
  };
  await unfold(space);
  for (const k of ['KEYS', 'HOLDER', 'CREW']) await expect(space.locator(`.ps-cell[aria-label="${k}"]`)).toBeVisible();
  await expect(space.locator('.outreach-tab.is-on', { hasText: 'CAMPAIGNS' })).toBeVisible();

  // No other platform bleeds into this window — the whole point of the rooms.
  await expect(space.locator('.pc-name', { hasText: 'Telegram' })).toHaveCount(0);

  // Another platform's window renders the same format — the template holds
  // for every platform the catalog will ever carry.
  await openDockApp(page, 'MASTODON');
  const spaces = page.locator('.outreach-panel');
  await unfold(spaces.last());
  await expect(spaces.last().locator('.ps-cell[aria-label="KEYS"]')).toBeVisible();
  await expect(spaces.last().locator('.outreach-tab', { hasText: 'QUEUE' })).toBeVisible();

  // MARKETING carries the CMO seat and the deliberately house-wide bench.
  await openDockApp(page, 'MARKETING');
  await expect(page.locator('.settings-k', { hasText: 'CHIEF MARKETING OFFICER' })).toBeVisible();

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('OUTREACH: a campaign born in a platform window stays in that platform — never on the house bench', async ({ page }) => {
  // The whole point of the rework, proven on the real store: a campaign
  // declared inside X's window carries channelId 'x', renders in X's own
  // board, and does NOT surface on the MARKETING (house-wide) bench.
  await openDockApp(page, 'X');
  const xSpace = page.locator('.outreach-panel', { has: page.locator('.pc-name', { hasText: 'X (Twitter)' }) });
  const probeName = `E2E Push ${Date.now()}`;

  await xSpace.locator('.settings-set', { hasText: 'NEW CAMPAIGN' }).click();
  await xSpace.locator('input[placeholder="Campaign name"]').fill(probeName);
  await xSpace.locator('input[placeholder="Brand it speaks for"]').fill('Ignis');
  await xSpace.locator('.settings-set', { hasText: /^SAVE$/ }).click();
  const xRow = xSpace.locator('.settings-provider-row', { hasText: probeName });
  await expect(xRow).toBeVisible();

  // The house bench answers with the real board — and the X campaign is
  // not on it (scoping is the record's channelId, not a display filter).
  await openDockApp(page, 'MARKETING');
  const bench = page.locator('.outreach-panel', { has: page.locator('.settings-k', { hasText: 'CHIEF MARKETING OFFICER' }) });
  await expect(bench.locator('.settings-k', { hasText: 'CHIEF MARKETING OFFICER' })).toBeVisible();
  await expect(bench.locator('.settings-provider-row', { hasText: probeName })).toHaveCount(0);

  // Clean up through the real UI — the probe campaign is removed and the
  // live store left exactly as found. The MARKETING window cascades right
  // over X, so close it first; the saved campaign is already selected
  // (SAVE selects it), its editor's REMOVE standing open beneath.
  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('.fwin', { has: bench }).locator('.fwin-ctl-close').click();
  await xSpace.locator('.settings-set', { hasText: 'REMOVE' }).click();
  await expect(xSpace.locator('.settings-provider-row', { hasText: probeName })).toHaveCount(0);

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('OUTREACH: the leads window renders with its capture composer honestly gated', async ({ page }) => {
  // The funnel is one book for the whole house — its own window in OUTREACH.
  await openDockApp(page, 'LEADS');

  const settings = page.locator('.outreach-panel');
  await expect(settings.locator('.settings-h', { hasText: 'LEADS' })).toBeVisible();
  await expect(settings.locator('.settings-note', { hasText: 'house lead ledger' })).toBeVisible();

  // The composer refuses to capture a lead with neither a name nor a way to
  // reach them — the board never sends what the ledger would refuse.
  const capture = settings.locator('.settings-set', { hasText: 'CAPTURE' });
  await expect(capture).toBeDisabled();
  await settings.locator('input[placeholder="Where this lead came from"]').fill('a source without a person');
  await expect(capture).toBeDisabled();

  // The full mutation round-trip against the REAL stack and REAL ledger:
  // capture → the card renders → touch with a note → the note surfaces →
  // remove (confirmed) → gone. The cycle ends clean — the probe lead is
  // removed, the live ledger left exactly as found.
  const probeName = `E2E Probe ${Date.now()}`;
  await settings.locator('input[placeholder="Who they are"]').fill(probeName);
  await expect(capture).toBeEnabled();
  await capture.click();

  const card = settings.locator('.settings-realm', { has: page.locator('.settings-k', { hasText: probeName }) });
  await expect(card).toBeVisible();
  await expect(card.locator('.settings-v', { hasText: 'COLD' })).toBeVisible();

  await card.locator('input[placeholder*="What happened"]').fill('first porch reply received');
  await card.locator('.settings-set', { hasText: 'TOUCH' }).click();
  await expect(card.locator('.settings-note', { hasText: 'first porch reply received' })).toBeVisible();

  page.on('dialog', (dialog) => dialog.accept());
  await card.locator('.settings-set', { hasText: 'REMOVE' }).click();
  await expect(card).toHaveCount(0);

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('OUTREACH: a platform window carries its own queue, armed by words alone', async ({ page }) => {
  await openDockApp(page, 'X');
  await page.locator('.outreach-tab', { hasText: 'QUEUE' }).click();

  const settings = page.locator('.outreach-panel');
  await expect(settings.locator('.settings-h', { hasText: 'QUEUE — X (TWITTER)' })).toBeVisible();
  // The queue opens on its month; a day holds the lanes, their promise, and the composer.
  await settings.locator('.qcal-cell.is-today').click();
  await expect(settings.locator('.settings-note', { hasText: 'nothing goes out until you approve it' })).toBeVisible();

  // Inside a platform's space the channel IS the space — no channel picker,
  // and the composer arms on words alone. Read-only here (this stack's queue
  // store is live disk); stage/approve/reject round-trips are proven on temp
  // disk in test/integration/social-channel-routes.test.js and the being
  // door in test/integration/queue-post-gate.test.js.
  const stage = settings.locator('.settings-set', { hasText: 'STAGE DRAFT' });
  await expect(stage).toBeDisabled();
  await settings.locator('input[placeholder="What should go out?"]').fill('words for the X lane');
  await expect(stage).toBeEnabled();

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('OUTREACH: the dropdown is fully keyboard-operable (RULE 0)', async ({ page }) => {
  // The shared Select's headline upgrade over the old bespoke listboxes is real
  // keyboard operability — so prove it on the real component, not just the mouse
  // path: open with a key, move with arrows, choose with Enter, close with Esc
  // and land focus back on the trigger. The lead composer's lane picker is the
  // always-populated Select on the desk.
  await openDockApp(page, 'LEADS');
  const dropdown = page.locator('.outreach-panel .lc-sel').first();
  const trigger = dropdown.locator('.lc-sel-trigger');
  const panel = dropdown.locator('.lc-sel-panel[role="listbox"]');

  // Escape closes an opened panel and returns focus to the trigger.
  await trigger.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // ArrowDown on the focused trigger opens the panel (focus lands on the first
  // option); ArrowDown then moves to the next option; Enter chooses it.
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(panel).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(panel).toHaveCount(0); // choosing closes it
  await expect(trigger).not.toContainText('other'); // the keys moved the value off its start
  await expect(trigger).toBeFocused(); // focus returned to the trigger

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
