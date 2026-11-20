// @ts-check
// explorer-panel-focus.spec.js — the rail and the focus lens: expanded by
// default, dock FILES toggles, OPEN FOLDER as a lens, the loud release,
// hostile persisted focus, the /files palette command.
// Split from explorer-panel.spec.js (SIZE-033); bodies byte-identical.

import { test, expect } from '@playwright/test';
import path from 'path';
import { openDockApp } from './helpers/dock.js';
import {
  setupExplorerPanel, makeFolder, settleDesk, openFolderViaPanel, awaitShell, typeInShell, REPO, addr,
} from './helpers/explorer-panel-harness.js';

setupExplorerPanel();

// ————— 1: the rail — expanded by default, dock FILES toggles, persists —————

test('panel renders expanded with the FILES tree; dock FILES entry toggles the 34px rail and back; collapse persists across reload', async ({ page }) => {
  // Expanded by default: the rail hosts the one FILES mount (D12).
  const panel = page.locator('.xp');
  await expect(panel).toBeVisible();
  await expect(panel).not.toHaveClass(/is-collapsed/);
  await expect(panel.locator('.files')).toBeVisible();
  await expect(panel.locator('.xp-none')).toContainText('NO WORKING FOCUS');

  // The dock FILES entry toggles the panel — no floating FILES window ever.
  await openDockApp(page, 'FILES');
  await expect(panel).toHaveClass(/is-collapsed/);
  await expect(panel.locator('.files')).toBeHidden();
  await expect(page.locator('.fwin .files')).toHaveCount(0);
  const rail = await panel.boundingBox();
  expect(rail?.width).toBe(34);

  // …and back.
  await openDockApp(page, 'FILES');
  await expect(panel).not.toHaveClass(/is-collapsed/);
  await expect(panel.locator('.files')).toBeVisible();

  // Collapse persists across reload (wallet+slot key, validated on read).
  await openDockApp(page, 'FILES');
  await expect(panel).toHaveClass(/is-collapsed/);
  await page.reload();
  await settleDesk(page);
  await expect(page.locator('.xp')).toHaveClass(/is-collapsed/);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ————— 2: OPEN FOLDER = a lens (D5/D7) —————

test('OPEN FOLDER via the panel header: tree scopes to it, strip reads FOLDER, terminal cwds there', async ({ page }) => {
  const dir = await makeFolder('scope');
  const base = path.basename(dir);

  await openFolderViaPanel(page, dir);

  // The window's lens: strip + panel header both read FOLDER — <name>.
  await expect(page.locator('.relink-status-folder')).toContainText(`FOLDER — ${base}`);
  await expect(page.locator('.xp-kind')).toHaveText('FOLDER');
  await expect(page.locator('.xp-name')).toHaveText(base);

  // Tree scoping proven through a reload: a fresh mount pulls the real roots
  // and slot-1 focus RESTORES across reload (D11), so the scoped tree renders
  // its one root. (The no-reload path is proven directly by scenario 2b.)
  await page.reload();
  await settleDesk(page);
  await expect(page.locator('.relink-status-folder')).toContainText(`FOLDER — ${base}`);
  const rootName = page.locator('.files-name', { hasText: base });
  await expect(rootName).toBeVisible();
  await rootName.click(); // expand the root onto its real contents
  await expect(page.locator('.files-name', { hasText: 'probe.txt' })).toBeVisible();

  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/explorer-panel-folder-focus.png') });

  // A terminal opened NOW cwds into the focus (D4) — proven by the shell.
  await openDockApp(page, 'TERMINAL');
  await awaitShell(page);
  await typeInShell(page, 'pwd');
  await expect(page.locator('.fwin .terminal-stage')).toContainText(base, { timeout: 15000 });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ————— 2b: the open gesture refreshes the mounted tree (D6) —————
//
// Regression for the stale-roots product gap this wave fixed: useOpenFolder
// POSTs the new root, then dispatches neuma:files-focus-root so the ONE
// mounted FilesApp re-fetches roots and expands the folder — the scoped tree
// shows the just-opened focus root with NO reload.

test('the tree shows the just-opened focus root WITHOUT a reload (D6)', async ({ page }) => {
  const dir = await makeFolder('stale');
  const base = path.basename(dir);
  await openFolderViaPanel(page, dir);
  await expect(page.locator('.relink-status-folder')).toContainText(`FOLDER — ${base}`);
  await expect(page.locator('.files-name', { hasText: base })).toBeVisible({ timeout: 15000 });
});

// ————— 4: D9 — closing the focused root releases the focus LOUDLY —————

test('closing the focused root in the tree releases the focus loudly: strip empties, the release note shows', async ({ page }) => {
  const dir = await makeFolder('release');
  const base = path.basename(dir);
  await openFolderViaPanel(page, dir);
  await expect(page.locator('.relink-status-folder')).toContainText(`FOLDER — ${base}`);

  // Remount so the focused root renders from a fresh root list; slot-1 focus
  // restores across the reload (D11). (The gesture itself already refreshes
  // the mounted tree — proven no-reload by scenario 2b.)
  await page.reload();
  await settleDesk(page);
  await expect(page.locator('.relink-status-folder')).toContainText(`FOLDER — ${base}`);

  const rootRow = page.locator('.files-rowwrap', { hasText: base }).first();
  await rootRow.hover();
  await rootRow.locator('.files-rootx').click();

  // Loud release — never a silent refocus: the strip EMPTIES and the tree
  // says exactly what happened.
  await expect(page.locator('.relink-status-folder')).toHaveCount(0);
  await expect(page.locator('.xp-none')).toContainText('NO WORKING FOCUS');
  await expect(page.locator('.files-note')).toContainText(`Working focus released — ${base} closed`);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ————— 5: hostile persisted focus is dropped at the boundary (T3/scenario 7) —————

test('hostile persisted focus — control chars, relative path, __proto__ kind, non-object — desk renders clean, focus null', async ({ page }) => {
  // Hostile payloads built INSIDE the page with String.fromCharCode (the
  // harness mangles literal escapes — feedback_harness_escape_mangling).
  const write = (which) => page.evaluate(({ a, which: w }) => {
    const C = String.fromCharCode;
    const hostiles = {
      relative: JSON.stringify({ kind: 'folder', path: `rel${C(47)}x` }),
      controlPath: JSON.stringify({ kind: 'folder', path: `${C(47)}tmp${C(47)}a${C(0)}b` }),
      controlId: JSON.stringify({ kind: 'project', id: `a${C(1)}b` }),
      protoKind: JSON.stringify({ kind: '__proto__' }),
      nonObject: JSON.stringify('just-a-string'),
      junk: 'not json at all {',
    };
    localStorage.setItem(`${a.toLowerCase()}:win:desk:focus`, hostiles[w]);
  }, { a: addr, which });

  for (const which of ['relative', 'controlPath', 'controlId', 'protoKind', 'nonObject', 'junk']) {
    await write(which);
    await page.reload();
    await settleDesk(page);
    // The boundary dropped it: no strip label, the panel reads unfocused.
    await expect(page.locator('.xp-none')).toContainText('NO WORKING FOCUS');
    await expect(page.locator('.relink-status-folder')).toHaveCount(0);
  }
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ————— 6: the /files palette command toggles the panel (D12) —————

test('/files in the slash palette toggles the Explorer panel, both directions', async ({ page }) => {
  const panel = page.locator('.xp');
  await expect(panel).not.toHaveClass(/is-collapsed/);

  const runFiles = async () => {
    await page.locator('.relink-input-field').click();
    await page.keyboard.type('/files');
    const row = page.locator('.relink-palette-row', { hasText: '/files' });
    await expect(row).toBeVisible();
    await row.click();
  };

  await runFiles();
  await expect(panel).toHaveClass(/is-collapsed/);
  await runFiles();
  await expect(panel).not.toHaveClass(/is-collapsed/);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

