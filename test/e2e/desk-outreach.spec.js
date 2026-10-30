// @ts-check
// Desk e2e — OUTREACH: MARKETING (its account levels, LEADS) and COMMUNITY's windows. Split from desk.spec.js (SIZE-017).
import { test, expect } from '@playwright/test';
import { openDockApp, openLauncher } from './helpers/dock.js';
import { setupDesk } from './helpers/desk-harness.js';
import path from 'path';
import { fileURLToPath } from 'url';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');

setupDesk();

// The MARKETING window remembers its last place per house: step up to HOUSE when it stands lower.
const toHouse = async (office) => {
  await office.locator('[data-mkt-path]').waitFor();
  const home = office.locator('[data-mkt-path] button', { hasText: /^HOUSE$/ });
  if (await home.count()) await home.click();
};

test('REACH: MARKETING is one window beside COMMUNITY\'s; each public platform is its account level', async ({ page }) => {
  // Slice 6 (marketing-panel-plan.md §5, "less is more"): the launcher's REACH holds MARKETING and COMMUNITY's
  // TELEGRAM and DISCORD — the public platforms, LEADS, BRAND KITS and SOCIAL CHECK are places inside MARKETING.
  await openLauncher(page);
  const reach = page.locator('.launcher-section[data-category="reach"]');
  for (const label of ['MARKETING', 'TELEGRAM', 'DISCORD']) {
    await expect(reach.locator('.launcher-tile', { hasText: new RegExp(`^${label}$`) })).toBeVisible();
  }
  for (const label of ['X', 'FACEBOOK', 'MASTODON', 'BLUESKY', 'LINKEDIN', 'YOUTUBE', 'TIKTOK', 'LEADS', 'BRAND KITS', 'SOCIAL CHECK']) {
    await expect(page.locator('.launcher-tile', { hasText: new RegExp(`^${label}$`) })).toHaveCount(0);
  }
  await reach.screenshot({ path: path.join(SHOTS, 'launcher-reach-marks.png') });
  await page.keyboard.press('Escape');

  // X's account level: the standing reads as three marks in its head (SDT-6) —
  // keys, holder and crew are different decisions — and its one board is the
  // queue, so no tab names it (campaigns are the company's: a door, never a tab here).
  await openDockApp(page, 'X');
  const space = page.locator('[data-mkt-level="account"] .outreach-panel');
  for (const k of ['keys', 'holder', 'crew']) await expect(space.locator(`.pc-head [data-standing="${k}"]`)).toBeVisible();
  await expect(space.locator('.qcal')).toBeVisible();
  await expect(space.locator('.outreach-tab')).toHaveCount(0);
  const unfold = async (panel) => {
    const btn = panel.locator('.pc-standing-btn');
    if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
  };

  // No other platform bleeds into this level — the whole point of the rooms.
  await expect(space.locator('.pc-name', { hasText: 'Telegram' })).toHaveCount(0);

  // COMMUNITY's TELEGRAM keeps its own window, in the same format.
  await openDockApp(page, 'TELEGRAM');
  const telegram = page.locator('.outreach-panel', { has: page.locator('.pc-name', { hasText: 'Telegram' }) }).last();
  await unfold(telegram);
  await expect(telegram.locator('.ps-cell[aria-label="KEYS"]')).toBeVisible();
  await expect(telegram.locator('.outreach-tab', { hasText: 'QUEUE' })).toBeVisible();

  // MARKETING is the CMO's office: the seat stands in the house level's SEAT tab.
  await openDockApp(page, 'MARKETING');
  const office = page.locator('[data-marketing-office]');
  await toHouse(office);
  await office.locator('.mkt-tabs [data-tab="seat"]').click();
  await expect(office.locator('.settings-k', { hasText: 'CHIEF MARKETING OFFICER' })).toBeVisible();

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('OUTREACH: a campaign is opened in MARKETING for one company', async ({ page }) => {
  // Campaign shape v2 (campaign plan slice 5): a campaign belongs to ONE
  // company and runs a sub per account; MARKETING is where it is opened, and
  // a platform's window lists the campaigns with a sub on its accounts.
  await openDockApp(page, 'MARKETING');
  const bench = page.locator('.outreach-panel', { has: page.locator('[data-marketing-office]') });
  // Zoom to the company, then its CAMPAIGNS: a new campaign starts under the company you stand in.
  await toHouse(bench);
  await bench.locator('[data-company-tile]', { hasText: 'Ignis AI Labs' }).click();
  await bench.locator('.mkt-tabs [data-tab="campaigns"]').click();
  const probeName = `E2E Push ${Date.now()}`;
  await bench.locator('.settings-set', { hasText: 'NEW CAMPAIGN' }).click();
  await bench.locator('input[placeholder="Campaign name"]').fill(probeName);
  await bench.locator('.campaign-editor .settings-set', { hasText: /^SAVE$/ }).click();
  // The saved campaign's page opens in place; the way back returns to the list.
  await bench.locator('.outreach-back', { hasText: '← CAMPAIGNS' }).click();
  await expect(bench.locator('.settings-provider-row', { hasText: probeName })).toBeVisible();

  // Clean up through the real UI — the probe campaign is removed and the
  // live store left exactly as found.
  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('.fwin', { has: bench }).locator('.fwin-ctl-close').click();
  await openDockApp(page, 'MARKETING');
  // The window remembers where it stood: the company's CAMPAIGNS.
  const again = page.locator('.outreach-panel', { has: page.locator('[data-mkt-tab="campaigns"]') });
  await again.locator('.settings-provider-row', { hasText: probeName }).click();
  await again.locator('.campaign-editor .settings-set', { hasText: 'REMOVE' }).click();
  await expect(again.locator('.settings-provider-row', { hasText: probeName })).toHaveCount(0);

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('OUTREACH: MARKETING\'s LEADS tab renders with its capture composer honestly gated', async ({ page }) => {
  // The funnel is one book for the whole house — MARKETING's LEADS tab (slice 6).
  await openDockApp(page, 'LEADS');

  const settings = page.locator('.outreach-panel');
  // The ledger opens on its funnel (SDT-6); what the ledger is rides its hover.
  await expect(settings.locator('.lfn')).toBeVisible();
  await expect(settings.locator('.lfn')).toHaveAttribute('title', /house lead ledger/);

  // The capture form folds behind + LEAD. It refuses to capture a lead with
  // neither a name nor a way to reach them — the board never sends what the
  // ledger would refuse.
  await settings.locator('.lead-add').click();
  const capture = settings.locator('.settings-set', { hasText: 'CAPTURE' });
  await expect(capture).toBeDisabled();
  await settings.locator('input[placeholder="Where this lead came from"]').fill('a source without a person');
  await expect(capture).toBeDisabled();

  // The full mutation round-trip against the REAL stack and REAL ledger:
  // capture → the row renders → a note through its ⋯ → the note surfaces →
  // remove (confirmed) through its ⋯ → gone. The cycle ends clean — the probe
  // lead is removed, the live ledger left exactly as found.
  const probeName = `E2E Probe ${Date.now()}`;
  await settings.locator('input[placeholder="Who they are"]').fill(probeName);
  await expect(capture).toBeEnabled();
  await capture.click();

  const row = settings.locator('.lead-row', { hasText: probeName });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-stage', 'cold');

  await row.locator('.lead-more').click();
  await page.locator('.lead-menu .cmenu-item', { hasText: 'ADD A NOTE' }).click();
  await row.locator('input[placeholder="What happened?"]').fill('first porch reply received');
  await row.locator('.settings-set', { hasText: 'TOUCH' }).click();
  await expect(row.locator('.lead-note', { hasText: 'first porch reply received' })).toBeVisible();

  page.on('dialog', (dialog) => dialog.accept());
  await row.locator('.lead-more').click();
  await page.locator('.lead-menu .cmenu-item', { hasText: 'REMOVE' }).click();
  await expect(row).toHaveCount(0);

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('OUTREACH: a platform\'s account level carries its own queue, armed by words alone', async ({ page }) => {
  await openDockApp(page, 'X');
  // The account level's one board is its queue: no tab, no heading — the level names it (SDT-6).
  const settings = page.locator('[data-mkt-level="account"] .outreach-panel');
  // The queue opens on its month; a day holds the lanes (each lane's promise on its hover) and the composer.
  await settings.locator('.qcal-cell.is-today').click();
  await expect(settings.locator('.queue-lane', { hasText: 'QUEUED' })).toHaveAttribute('title', /nothing goes out until you approve it/i);

  // Inside a platform's space the channel IS the space — no channel picker;
  // on an account's level the account is too — no account picker; and the
  // composer arms on words alone. Read-only here (this stack's queue
  // store is live disk); stage/approve/reject round-trips are proven on temp
  // disk in test/integration/social-channel-routes.test.js and the being
  // door in test/integration/queue-post-gate.test.js.
  const stage = settings.locator('.settings-set', { hasText: 'STAGE DRAFT' });
  await expect(stage).toBeDisabled();
  await settings.locator('textarea[placeholder="What should go out?"]').fill('words for the X lane');
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
  await page.locator('.outreach-panel .lead-add').click();
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
