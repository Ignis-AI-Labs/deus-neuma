// @ts-check
// explorer-panel-picker.spec.js — the picker: one OPEN FOLDER gesture, the
// movable dialog, the FOLDER SHELF (FAVORITES / RECENTS), hostile persisted
// shelf, right-click while browsing. Split from explorer-panel.spec.js
// (SIZE-033); bodies byte-identical.

import { test, expect } from '@playwright/test';
import os from 'os';
import path from 'path';
import {
  setupExplorerPanel, makeFolder, settleDesk, openFolderViaPanel, REPO, addr,
} from './helpers/explorer-panel-harness.js';

setupExplorerPanel();

// ————— 11: ONE open-folder gesture, and the picker is a movable dialog —————

test('exactly one OPEN FOLDER affordance in the explorer; the picker opens at viewport scale and drags by its head', async ({ page }) => {
  // Witness law: one button, one global flow — the tree's duplicate (which
  // mounted the picker clipped INSIDE the rail) is gone.
  await expect(page.locator('.xp-open')).toBeVisible();
  await expect(page.locator('.files-open')).toHaveCount(0);

  await page.locator('.xp-open').click();
  const picker = page.locator('.picker');
  await expect(picker).toBeVisible();

  // Not rail-clipped: the dialog spans real viewport width (rail ≈ 280px).
  const before = await picker.boundingBox();
  expect(before).not.toBeNull();
  expect(before.width).toBeGreaterThan(480);

  // Grab the head and drag — the dialog follows the pointer, clamped to the
  // viewport.
  const head = page.locator('.picker-head');
  const headBox = await head.boundingBox();
  await page.mouse.move(headBox.x + headBox.width / 2, headBox.y + headBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(headBox.x + headBox.width / 2 + 160, headBox.y + headBox.height / 2 + 80, { steps: 5 });
  await page.mouse.up();
  const after = await picker.boundingBox();
  expect(Math.round(after.x - before.x)).toBe(160);
  expect(Math.round(after.y - before.y)).toBe(80);

  // …and the flow still completes from the dragged position: cancel closes.
  await page.locator('.picker-cancel').click();
  await expect(picker).toHaveCount(0);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ————— 13: the FOLDER SHELF — FAVORITES / RECENTS macros (witness ask 2026-07-24) —————
//
// The Outline/Timeline slot, repurposed: RECENTS self-populates from the ONE
// open-folder gesture (MRU), FAVORITES holds what the witness pins, rows
// re-run the gesture on click, and the shelf survives reload on its
// wallet-scoped (slot-free) key. Folders only, by construction.

test('the shelf records MRU recents, pin lands a favorite, a row click re-runs the open gesture, and shelf + folds survive reload', async ({ page }) => {
  const dirA = await makeFolder('shelfa');
  const dirB = await makeFolder('shelfb');
  const baseA = path.basename(dirA);
  const baseB = path.basename(dirB);
  const favs = page.locator('.xps-favorites');
  const recents = page.locator('.xps-recents');

  // Fresh desk: both sections open, honestly empty.
  await expect(favs.locator('.xps-empty')).toHaveText('NOTHING PINNED YET');
  await expect(recents.locator('.xps-empty')).toHaveText('NO FOLDERS OPENED YET');

  // Two opens land two recents, most-recent first — no reload needed.
  await openFolderViaPanel(page, dirA);
  await expect(recents.locator('.xps-row')).toHaveCount(1);
  await openFolderViaPanel(page, dirB);
  await expect(recents.locator('.xps-row')).toHaveCount(2);
  await expect(recents.locator('.xps-name').first()).toHaveText(baseB);

  // Pin A from its recents row — it lands in FAVORITES, and the recents row
  // now wears the filled pin.
  const rowA = recents.locator('.xps-row', { hasText: baseA });
  await rowA.locator('.xps-pin').click();
  await expect(favs.locator('.xps-name')).toHaveText(baseA);
  await expect(rowA.locator('.xps-pin')).toHaveClass(/is-pinned/);

  // Clicking the favorite re-runs the ONE open gesture: the strip flips to A
  // and A bumps to the head of RECENTS (a bump, never a duplicate).
  await favs.locator('.xps-go').click();
  await expect(page.locator('.relink-status-folder')).toContainText(`FOLDER — ${baseA}`);
  await expect(recents.locator('.xps-name').first()).toHaveText(baseA);
  await expect(recents.locator('.xps-row')).toHaveCount(2);

  // Fold FAVORITES, then reload: the shelf AND the fold both persist.
  await favs.locator('.xps-head').click();
  await expect(favs.locator('.xps-row')).toHaveCount(0);
  await page.reload();
  await settleDesk(page);
  await expect(favs.locator('.xps-head')).toHaveAttribute('aria-expanded', 'false');
  await expect(recents.locator('.xps-row')).toHaveCount(2);
  await expect(recents.locator('.xps-name').first()).toHaveText(baseA);

  // Unfold; unpin A — FAVORITES empties, the recents row keeps A (a dismiss
  // and an unpin are different gestures) and its pin hollows out.
  await favs.locator('.xps-head').click();
  await favs.locator('.xps-pin').click();
  await expect(favs.locator('.xps-empty')).toHaveText('NOTHING PINNED YET');
  await expect(recents.locator('.xps-row', { hasText: baseA }).locator('.xps-pin')).not.toHaveClass(/is-pinned/);

  // Dismiss B from recents — exactly B leaves.
  await recents.locator('.xps-row', { hasText: baseB }).locator('.xps-x').click();
  await expect(recents.locator('.xps-row')).toHaveCount(1);
  await expect(recents.locator('.xps-name')).toHaveText(baseA);

  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/explorer-folder-shelf.png') });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ————— 14: hostile persisted shelf is dropped at the boundary —————

test('hostile persisted shelf — junk, arrays, relative and control-char paths — degrades to a clean shelf, valid entries survive', async ({ page }) => {
  const write = (which) => page.evaluate(({ a, which: w }) => {
    const C = String.fromCharCode;
    const hostiles = {
      junk: 'not json {',
      array: JSON.stringify(['/a', '/b']),
      nonObject: JSON.stringify('shelf'),
      badEntries: JSON.stringify({
        favorites: [`rel${C(47)}x`, 42, `${C(47)}tmp${C(47)}a${C(0)}b`],
        recents: [`${C(47)}kept`, '', { path: `${C(47)}never` }],
      }),
    };
    localStorage.setItem(`${a.toLowerCase()}:win:desk:folder-shelf`, hostiles[w]);
  }, { a: addr, which });

  for (const which of ['junk', 'array', 'nonObject']) {
    await write(which);
    await page.reload();
    await settleDesk(page);
    await expect(page.locator('.xps-favorites .xps-empty')).toHaveText('NOTHING PINNED YET');
    await expect(page.locator('.xps-recents .xps-empty')).toHaveText('NO FOLDERS OPENED YET');
  }

  // Bad entries drop; the one valid path renders.
  await write('badEntries');
  await page.reload();
  await settleDesk(page);
  await expect(page.locator('.xps-favorites .xps-empty')).toHaveText('NOTHING PINNED YET');
  await expect(page.locator('.xps-recents .xps-name')).toHaveText('kept');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});


// ————— 16: right-click while BROWSING — the picker's rows and current folder —————
//
// […] —
// a browsed row pins to the shelf and opens as the pick; the list's empty
// space carries the CURRENT folder's own menu (new folder here, open here).

test('right-click in the picker: pin a browsed folder, enter it, new-folder from the background, open it as the focus', async ({ page }) => {
  const dir = await makeFolder('ctxpick');
  const base = path.basename(dir);
  const menuItem = (label) => page.locator('.cmenu-item', { hasText: label });

  await page.locator('.xp-open').click();
  await expect(page.locator('.picker')).toBeVisible();
  await expect(page.locator('.picker-cwd')).not.toBeEmpty();
  await expect(async () => {
    await page.locator('.picker-pathinput').fill(os.tmpdir());
    await page.locator('.picker-go').click();
    await expect(page.locator('.picker-row', { hasText: base })).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30000 });

  // PIN from the browsed row — the shelf behind the dialog hears it live;
  // the reopened menu reads the new state.
  await page.locator('.picker-row', { hasText: base }).click({ button: 'right' });
  await expect(page.locator('.cmenu')).toBeVisible();
  await menuItem('PIN TO FAVORITES').click();
  await expect(page.locator('.xps-favorites .xps-name')).toHaveText(base);
  await page.locator('.picker-row', { hasText: base }).click({ button: 'right' });
  await expect(menuItem('UNPIN FAVORITE')).toBeVisible();
  await page.keyboard.press('Escape');

  // ENTER FOLDER via the menu — the picker navigates in.
  await page.locator('.picker-row', { hasText: base }).click({ button: 'right' });
  await menuItem('ENTER FOLDER').click();
  await expect(page.locator('.picker-cwd')).toContainText(base);

  // The list background carries the CURRENT folder: NEW FOLDER summons the
  // foot's create row; creating navigates INTO the new folder.
  await page.locator('.picker-list').click({ button: 'right' });
  await expect(page.locator('.cmenu')).toBeVisible();
  await menuItem('NEW FOLDER').click();
  await page.locator('.picker-newfolder-input').fill('made-here');
  await page.locator('.picker-newfolder-go').click();
  await expect(page.locator('.picker-cwd')).toContainText('made-here');

  // OPEN THIS FOLDER from the background menu — the pick completes the whole
  // open-folder flow: dialog closes, the strip flips, recents record it.
  await page.locator('.picker-list').click({ button: 'right' });
  await menuItem('OPEN THIS FOLDER').click();
  await expect(page.locator('.picker')).toHaveCount(0);
  await expect(page.locator('.relink-status-folder')).toContainText('FOLDER — made-here');
  await expect(page.locator('.xps-recents .xps-name').first()).toHaveText('made-here');

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

