// @ts-check
// explorer-panel-menu.spec.js — the FILES tree right-click menu and the
// DELETE confirmation (with the real, reversible "don’t ask again").
// Split from explorer-panel.spec.js (SIZE-033); bodies byte-identical.

import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import fs from 'fs';
import path from 'path';
import {
  setupExplorerPanel, makeFolder, settleDesk, openFolderViaPanel, REPO,
} from './helpers/explorer-panel-harness.js';

setupExplorerPanel();

// ————— 15: the FILES tree right-click menu (witness ask 2026-07-24) —————
//
// […] — every row action the tree offers, plus the
// shelf pin and the focus lens, driven for real: rename and new-folder land
// on the real disk, SET AS WORKING FOCUS flips the real strip, COPY PATH
// lands on the real clipboard, pin lands on the real shelf.

test('right-click in the tree: rename a file, pin the root, new folder + focus it, copy a real path', async ({ page }) => {
  const dir = await makeFolder('ctxtree');
  const base = path.basename(dir);
  await openFolderViaPanel(page, dir);
  await expect(page.locator('.files-name', { hasText: 'probe.txt' })).toBeVisible({ timeout: 15000 });

  const menuItem = (label) => page.locator('.cmenu-item', { hasText: label });

  // RENAME through the file row's menu — the same prompt flow, summoned by
  // right-click; the rename lands on the real disk.
  await page.locator('.files-rowwrap', { hasText: 'probe.txt' }).click({ button: 'right' });
  await expect(page.locator('.cmenu')).toBeVisible();
  // A file's menu carries no pin and no creation — folders' gestures only.
  await expect(menuItem('PIN TO FAVORITES')).toHaveCount(0);
  await expect(menuItem('NEW FILE')).toHaveCount(0);
  await menuItem('RENAME').click();
  await expect(page.locator('.cmenu')).toHaveCount(0);
  await page.locator('.files-prompt-input').fill('renamed-by-menu.txt');
  await page.locator('.files-prompt-go').click();
  await expect(page.locator('.files-name', { hasText: 'renamed-by-menu.txt' })).toBeVisible();
  expect(fs.existsSync(path.join(dir, 'renamed-by-menu.txt'))).toBe(true);

  // PIN the root from its own menu — the favorite lands on the shelf; the
  // reopened menu reads the new state honestly.
  const rootRow = page.locator('.files-rowwrap', { hasText: base }).first();
  await rootRow.click({ button: 'right' });
  await expect(menuItem('CLOSE FOLDER')).toBeVisible(); // root keeps its close
  await expect(menuItem('RENAME')).toHaveCount(0);      // an open root can't rename
  await menuItem('PIN TO FAVORITES').click();
  await expect(page.locator('.xps-favorites .xps-name')).toHaveText(base);
  await rootRow.click({ button: 'right' });
  await expect(menuItem('UNPIN FAVORITE')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cmenu')).toHaveCount(0);

  // COPY PATH — the real clipboard carries the absolute path. (Before the
  // focus flip below: focusing `sub` scopes the tree to it, D6 — this row
  // rightly leaves the view then.)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('.files-rowwrap', { hasText: 'renamed-by-menu.txt' }).click({ button: 'right' });
  await menuItem('COPY PATH').click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(path.join(dir, 'renamed-by-menu.txt'));

  // NEW FOLDER via the root's menu, then SET AS WORKING FOCUS on the child —
  // the strip flips to the subfolder through the one open gesture, and the
  // D6 lens narrows the tree to exactly it.
  await rootRow.click({ button: 'right' });
  await menuItem('NEW FOLDER').click();
  await page.locator('.files-prompt-input').fill('sub');
  await page.locator('.files-prompt-go').click();
  const subRow = page.locator('.files-rowwrap', { hasText: 'sub' }).first();
  await expect(subRow).toBeVisible();
  await subRow.click({ button: 'right' });
  await menuItem('SET AS WORKING FOCUS').click();
  await expect(page.locator('.relink-status-folder')).toContainText('FOLDER — sub');
  await expect(page.locator('.files-rowwrap', { hasText: 'renamed-by-menu.txt' })).toHaveCount(0);

  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/explorer-ctx-menu.png') });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});


// ————— 17: DELETE asks first; "don't ask again" is real and reversible —————
//
// The witness ask 2026-07-24: delete must confirm, the confirmation offers
// DON'T ASK AGAIN, and Settings › GENERAL can turn the asking back on. The
// arc is driven whole: a cancelled ask deletes nothing and silences nothing;
// an armed ask deletes and goes quiet; the next delete runs silently; the
// Settings toggle restores the ask — and the pref survives a reload.

test('delete confirmation: cancel keeps everything, DON’T ASK AGAIN goes quiet, Settings › DESK restores the ask, all of it persists', async ({ page }) => {
  const dir = await makeFolder('confirm');
  await openFolderViaPanel(page, dir);
  const menuItem = (label) => page.locator('.cmenu-item', { hasText: label });
  const newFile = async (name) => {
    await page.locator('.files-rowwrap', { hasText: path.basename(dir) }).first().click({ button: 'right' });
    await menuItem('NEW FILE').click();
    await page.locator('.files-prompt-input').fill(name);
    await page.locator('.files-prompt-go').click();
    await expect(page.locator('.files-name', { hasText: name })).toBeVisible();
  };
  const deleteViaMenu = async (name) => {
    await page.locator('.files-rowwrap', { hasText: name }).click({ button: 'right' });
    await page.locator('.cmenu-item.is-danger', { hasText: 'DELETE' }).click();
  };

  // A cancelled ask deletes nothing — and an ARMED-then-cancelled ask
  // silences nothing: the checkbox only binds when the delete runs.
  await deleteViaMenu('probe.txt');
  const bar = page.locator('.delconfirm'); // the popup (desk-level, body portal)
  await expect(bar).toContainText('DELETE probe.txt');
  await bar.locator('.delconfirm-noask').click();
  await expect(bar.locator('.delconfirm-noask')).toHaveClass(/is-on/);
  await bar.locator('.delconfirm-x').click();
  await expect(bar).toHaveCount(0);
  expect(fs.existsSync(path.join(dir, 'probe.txt'))).toBe(true);
  await deleteViaMenu('probe.txt');
  await expect(bar).toBeVisible(); // still asking — the cancel kept the guard
  await expect(bar.locator('.delconfirm-noask')).not.toHaveClass(/is-on/); // armed per ask, never sticky

  // Arm it and DELETE: the file goes, and the guard goes quiet.
  await bar.locator('.delconfirm-noask').click();
  await bar.locator('.delconfirm-go').click();
  await expect(page.locator('.files-name', { hasText: 'probe.txt' })).toHaveCount(0);
  expect(fs.existsSync(path.join(dir, 'probe.txt'))).toBe(false);

  // The next delete runs with NO confirmation — even across a reload (the
  // pref is the witness's, wallet-scoped, persisted).
  await newFile('quiet-one.txt');
  await page.reload();
  await settleDesk(page);
  // A fresh mount collapses the root — expand it onto its real contents
  // (scenario 2's reload choreography).
  await page.locator('.files-name', { hasText: path.basename(dir) }).click();
  await expect(page.locator('.files-name', { hasText: 'quiet-one.txt' })).toBeVisible();
  await deleteViaMenu('quiet-one.txt');
  await expect(page.locator('.files-name', { hasText: 'quiet-one.txt' })).toHaveCount(0);
  await expect(page.locator('.delconfirm')).toHaveCount(0);
  expect(fs.existsSync(path.join(dir, 'quiet-one.txt'))).toBe(false);

  // Settings › GENERAL › DESK: the toggle reads OFF honestly and turns the
  // asking back on.
  await openDockApp(page, 'SETTINGS');
  const toggle = page.locator('.settings-desk-toggle', { hasText: 'CONFIRM BEFORE DELETE' });
  await expect(toggle).toContainText('CONFIRM BEFORE DELETE — OFF');
  await toggle.click();
  await expect(toggle).toContainText('CONFIRM BEFORE DELETE — ON');

  // The very next delete asks again.
  await newFile('guarded.txt');
  await deleteViaMenu('guarded.txt');
  await expect(page.locator('.delconfirm')).toContainText('DELETE guarded.txt');
  await page.locator('.delconfirm .delconfirm-x').click();
  expect(fs.existsSync(path.join(dir, 'guarded.txt'))).toBe(true);

  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/explorer-delete-confirm.png') });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

