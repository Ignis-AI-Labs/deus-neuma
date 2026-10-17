// @ts-check
// explorer-panel-editor.spec.js — per-file EDITOR windows: open, read-only
// non-UTF-8, disk-moved-under-buffer, rename/delete tracking, and the
// stale-chunk notice. Split from explorer-panel.spec.js (SIZE-033);
// bodies byte-identical.

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  setupExplorerPanel, makeFolder, settleDesk, openFolderViaPanel, REPO,
} from './helpers/explorer-panel-harness.js';

setupExplorerPanel();

// ————— 8: a file opens in ITS OWN editor window (witness law) —————

test('clicking a file spawns a per-file EDITOR window — re-click focuses, edit+save lands on disk, reload restores the window on its file', async ({ page }) => {
  const dir = await makeFolder('editor');
  const base = path.basename(dir);
  const filePath = path.join(dir, 'probe.txt');
  await openFolderViaPanel(page, dir);

  // The open gesture already expanded the root (2b) — the file row is live.
  // Clicking it must spawn a FLOATING editor window, never a pane squeezed
  // into the rail (the retired in-panel .files-pane stays gone).
  await page.locator('.files-name', { hasText: 'probe.txt' }).click();
  const win = page.locator('.fwin', { has: page.locator('.editor') });
  await expect(win).toBeVisible();
  await expect(win.locator('.files-panepath')).toContainText(filePath);
  await expect(win.locator('.relink-title-name')).toContainText('PROBE.TXT');
  await expect(page.locator('.xp .files-pane')).toHaveCount(0);
  await expect(win.locator('.cm-content')).toContainText('probe editor', { timeout: 15000 });

  // A re-click focuses the SAME window — never a duplicate.
  await page.locator('.files-name', { hasText: 'probe.txt' }).click();
  await expect(page.locator('.fwin', { has: page.locator('.editor') })).toHaveCount(1);

  // Edit + save for real — the write lands on disk through the real backend.
  await win.locator('.cm-content').click();
  await page.keyboard.type(' — touched by the witness');
  await expect(win.locator('.files-save')).toBeEnabled();
  await win.locator('.files-save').click();
  await expect(win.locator('.files-note')).toContainText('Saved probe.txt');
  const onDisk = await fs.promises.readFile(filePath, 'utf8');
  expect(onDisk).toContain('touched by the witness');

  // The payload rides the persisted open-set: a reload rebirths the window
  // on its file, content and all.
  await page.reload();
  await settleDesk(page);
  const reborn = page.locator('.fwin', { has: page.locator('.editor') });
  await expect(reborn).toBeVisible();
  await expect(reborn.locator('.files-panepath')).toContainText(filePath);
  await expect(reborn.locator('.cm-content')).toContainText('touched by the witness', { timeout: 15000 });

  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/explorer-editor-window.png') });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ————— 8b: a non-UTF-8 file opens to be READ, never written back (#239) —————

test('a Latin-1 file opens READ-ONLY with the cost named, SAVE stays disabled, and the bytes on disk survive typing into it', async ({ page }) => {
  const dir = await makeFolder('encoding');
  // The exact bytes from #252's fixture manifest — `Café naïve résumé señor`.
  const LATIN1 = Buffer.from('Caf\xE9 na\xEFve r\xE9sum\xE9 se\xF1or\n', 'latin1');
  const HEX = '436166e9206e61ef76652072e973756de9207365f16f720a';
  const filePath = path.join(dir, 'latin1.txt');
  await fs.promises.writeFile(filePath, LATIN1);
  expect(Buffer.from(await fs.promises.readFile(filePath)).toString('hex')).toBe(HEX);

  await openFolderViaPanel(page, dir);
  await page.locator('.files-name', { hasText: 'latin1.txt' }).click();
  const win = page.locator('.fwin', { has: page.locator('.editor') });
  await expect(win).toBeVisible();

  // It OPENS — the operator can read and identify their file. Before the fix
  // this showed `Caf� na�ve r�sum� se�or`: five replacement characters already
  // on screen, and no indication anything was wrong.
  await expect(win.locator('.cm-content')).toContainText('Café naïve résumé señor', { timeout: 15000 });

  // And it says so, in the operator's terms, naming the exact cost.
  const banner = win.locator('.files-lossy');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('NOT UTF-8');
  await expect(banner).toContainText('destroy 5 characters');
  await expect(win.locator('.files-readonly')).toHaveText('READ-ONLY');

  // The issue's exact operator sequence: click into the document, press End,
  // type a character. Before the fix this ENABLED save; the click then took the
  // file from 24 B to 35 B.
  await win.locator('.cm-content').click();
  await page.keyboard.press('End');
  await page.keyboard.type('X');

  // The document itself refuses the keystroke (EditorState.readOnly), so the
  // buffer never even goes dirty — and SAVE cannot arm.
  await expect(win.locator('.cm-content')).not.toContainText('señorX');
  await expect(win.locator('.files-save')).toBeDisabled();

  // Ctrl+S is the other way in, and it is withheld too.
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(500);

  // THE ASSERTION THIS TEST EXISTS FOR: byte-identical on real disk.
  expect(Buffer.from(await fs.promises.readFile(filePath)).toString('hex')).toBe(HEX);

  // The control must not regress — an ordinary UTF-8 file in the same folder
  // still opens writable, with no banner.
  await page.locator('.files-name', { hasText: 'probe.txt' }).click();
  const utf8Win = page.locator('.fwin', { has: page.locator('.files-panepath', { hasText: 'probe.txt' }) });
  await expect(utf8Win.locator('.cm-content')).toContainText('probe encoding', { timeout: 15000 });
  await expect(utf8Win.locator('.files-lossy')).toHaveCount(0);
  await utf8Win.locator('.cm-content').click();
  await page.keyboard.type(' — still writable');
  await expect(utf8Win.locator('.files-save')).toBeEnabled();

  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/explorer-editor-not-utf8.png') });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ————— 8c: disk moved under the buffer — SAVE refuses, the choice is explicit (#235) —————

test('an external write after open is never destroyed: SAVE raises the conflict; RELOAD takes disk, OVERWRITE is explicit, an announced change reloads a clean buffer', async ({ page }) => {
  const dir = await makeFolder('conflict');
  const filePath = path.join(dir, 'probe.txt');
  await openFolderViaPanel(page, dir);
  await page.locator('.files-name', { hasText: 'probe.txt' }).click();
  const win = page.locator('.fwin', { has: page.locator('.editor') });
  await expect(win).toBeVisible();
  await expect(win.locator('.cm-content')).toContainText('probe conflict', { timeout: 15000 });

  // Dirty the buffer, then land an external write the desk knows nothing of —
  // a plain shell-style append, the case that emits no NEUMA event (#235's
  // reproduction, and the one only the mtime precondition can catch).
  await win.locator('.cm-content').click();
  await page.keyboard.type('desk edit ');
  await expect(win.locator('.files-save')).toBeEnabled();
  await fs.promises.appendFile(filePath, 'EXTERNAL_MARKER external work\n');
  const externalBytes = await fs.promises.readFile(filePath, 'utf8');

  // SAVE must refuse: the conflict named, nothing written.
  await win.locator('.files-save').click();
  const bar = win.locator('.files-conflict');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('THE FILE CHANGED ON DISK');
  expect(await fs.promises.readFile(filePath, 'utf8')).toBe(externalBytes);

  // RELOAD FROM DISK — the external work fills the buffer; the desk edit is
  // discarded by the operator's own hand, never silently.
  await bar.locator('.files-conflict-btn', { hasText: 'RELOAD FROM DISK' }).click();
  await expect(win.locator('.cm-content')).toContainText('EXTERNAL_MARKER', { timeout: 15000 });
  await expect(win.locator('.files-conflict')).toHaveCount(0);
  await expect(win.locator('.files-note')).toContainText('Reloaded probe.txt');
  expect(await fs.promises.readFile(filePath, 'utf8')).toBe(externalBytes);

  // Round two: OVERWRITE is the other explicit road — the buffer wins and the
  // disk version dies BY CHOICE, said in the note.
  await win.locator('.cm-content').click();
  await page.keyboard.type('second desk edit ');
  await expect(win.locator('.files-save')).toBeEnabled();
  await fs.promises.appendFile(filePath, 'SECOND_EXTERNAL\n');
  await win.locator('.files-save').click();
  await expect(win.locator('.files-conflict')).toBeVisible();
  await win.locator('.files-conflict-btn', { hasText: 'OVERWRITE' }).click();
  await expect(win.locator('.files-note')).toContainText('overwritten');
  await expect(win.locator('.files-conflict')).toHaveCount(0);
  const afterOverwrite = await fs.promises.readFile(filePath, 'utf8');
  expect(afterOverwrite).toContain('second desk edit');
  expect(afterOverwrite).not.toContain('SECOND_EXTERNAL');

  // The announced path: the same `neuma:files-changed` both streams dispatch
  // for a being's act, on a CLEAN buffer — the editor re-reads on its own.
  await fs.promises.writeFile(filePath, 'ANNOUNCED external replacement\n');
  await page.evaluate((p) => {
    window.dispatchEvent(new CustomEvent('neuma:files-changed', { detail: { path: p } }));
  }, filePath);
  await expect(win.locator('.cm-content')).toContainText('ANNOUNCED external replacement', { timeout: 15000 });
  await expect(win.locator('.files-note')).toContainText('Reloaded probe.txt');

  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/explorer-editor-conflict.png') });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ————— 9: rename/delete in the tree tracks the open editor window —————

test('renaming an open file retargets its editor window (dirty buffer kept); deleting it closes the window', async ({ page }) => {
  const dir = await makeFolder('track');
  const renamedPath = path.join(dir, 'renamed.txt');
  await openFolderViaPanel(page, dir);
  await page.locator('.files-name', { hasText: 'probe.txt' }).click();
  const win = page.locator('.fwin', { has: page.locator('.editor') });
  await expect(win.locator('.cm-content')).toContainText('probe track', { timeout: 15000 });

  // Edit WITHOUT saving — the rename must retarget the window and keep the
  // dirty buffer aimed at the new path, never strand the witness's edits.
  await win.locator('.cm-content').click();
  await page.keyboard.type(' — edited before rename');
  await expect(win.locator('.files-save')).toBeEnabled();

  const row = page.locator('.files-rowwrap', { hasText: 'probe.txt' });
  await row.hover();
  await row.locator('.files-act[aria-label="Rename"]').click();
  await page.locator('.files-prompt-input').fill('renamed.txt');
  await page.locator('.files-prompt-go').click();
  await expect(win.locator('.files-panepath')).toContainText(renamedPath);
  await expect(win.locator('.relink-title-name')).toContainText('RENAMED.TXT');

  // Save through the retargeted window — the edits land on the NEW path.
  await win.locator('.files-save').click();
  await expect(win.locator('.files-note')).toContainText('Saved renamed.txt');
  expect(await fs.promises.readFile(renamedPath, 'utf8')).toContain('edited before rename');

  // Delete via the tree → the editor window closes with its file.
  const row2 = page.locator('.files-rowwrap', { hasText: 'renamed.txt' });
  await row2.hover();
  await row2.locator('.files-act[aria-label="Delete"]').click();
  await page.locator('.delconfirm-go').click();
  await expect(page.locator('.fwin', { has: page.locator('.editor') })).toHaveCount(0);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});


// ————— 18: a stale chunk renders an honest notice, never a crash —————
//
// Design note, 2026-07-24: a desk window that outlived a rebuild died with […] on
// the first file open. Driven here by REAL fault injection (the editor
// chunk's fetch is aborted at the network — no product code is mocked):
// the editor window renders the stale-build notice with the one remedy,
// and RELOAD DESK recovers into the real working editor.

test('a failed editor chunk shows the stale-build notice; RELOAD DESK recovers the real editor', async ({ page }) => {
  const dir = await makeFolder('chunkfail');
  await openFolderViaPanel(page, dir);

  // Kill the chunk at the network — exactly what a vanished hashed asset
  // does to a stale window.
  await page.route('**/CodeEditor.jsx*', (route) => route.abort());

  await page.locator('.files-name', { hasText: 'probe.txt' }).click();
  const win = page.locator('.fwin', { has: page.locator('.chunkfail') });
  await expect(win).toBeVisible();
  await expect(win.locator('.chunkfail-head')).toContainText('THE EDITOR FAILED TO LOAD');
  await expect(win.locator('.chunkfail-body')).toContainText('rebuilt underneath');
  // The desk did NOT crash: the rail still stands and no global overlay rose.
  await expect(page.locator('.xp')).toBeVisible();

  // The chunk returns (the rebuild settled) — RELOAD DESK picks up the
  // coherent build; the editor window rebirths on its file, working.
  await page.unroute('**/CodeEditor.jsx*');
  await win.locator('.chunkfail-reload').click();
  await settleDesk(page);
  const reborn = page.locator('.fwin', { has: page.locator('.editor') });
  await expect(reborn).toBeVisible();
  await expect(reborn.locator('.cm-content')).toContainText('probe chunkfail', { timeout: 15000 });

  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/explorer-chunkfail.png') });
  // The pageerror ledger stays clean — the failure was CONTAINED.
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
