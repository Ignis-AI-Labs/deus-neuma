// @ts-check
// Desk e2e — the FILES rail. Split from desk.spec.js (SIZE-017); the PROJECTS
// app it also covered was removed (2026-11-10).
import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDockApp } from './helpers/dock.js';
import { REPO, setupDesk } from './helpers/desk-harness.js';

setupDesk();

test('FILES: open a folder via the picker, browse the tree, open a file', async ({ page }) => {
  // Panel era (D12): FILES lives in the always-mounted Explorer rail — the
  // dock entry toggles the rail (no floating FILES window). Default-expanded.
  await expect(page.locator('.xp .files')).toBeVisible();

  // Open via the folder picker (no typed root field anymore): paste, GO, OPEN.
  await page.locator('.files-open').click();
  await expect(page.locator('.picker')).toBeVisible();
  await page.locator('.picker-pathinput').fill(REPO);
  await page.locator('.picker-go').click();
  await expect(page.locator('.picker-cwd')).toContainText(path.basename(REPO));
  await page.locator('.picker-open').click();
  await expect(page.locator('.picker')).toHaveCount(0);

  const rootRow = page.locator('.files-name', { hasText: path.basename(REPO) });
  await expect(rootRow).toBeVisible();

  // The picker auto-expands the opened root, so its children are already shown.
  const pkg = page.locator('.files-name', { hasText: 'package.json' });
  await expect(pkg).toBeVisible();

  await pkg.click();
  await expect(page.locator('.cm-content')).toContainText('neuma', { timeout: 20000 });

  // Reopen the picker — the just-opened folder now appears under RECENT.
  await page.locator('.files-open').click();
  await expect(page.locator('.picker-recent', { hasText: path.basename(REPO) }).first()).toBeVisible();
  await page.locator('.picker-x').click();

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('FILES: create, rename, and delete inside an opened folder', async ({ page }) => {
  // A throwaway folder on disk — the CRUD rides the real backend filesystem
  // (no mocked path) and is cleaned up after.
  const tmp = path.join(os.tmpdir(), `neuma-e2e-files-${process.pid}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    // Panel era (D12): the tree is already mounted in the expanded rail.
    await expect(page.locator('.xp .files')).toBeVisible();

    await page.locator('.files-open').click();
    await expect(page.locator('.picker')).toBeVisible();
    await page.locator('.picker-pathinput').fill(tmp);
    await page.locator('.picker-go').click();
    await page.locator('.picker-open').click();
    await expect(page.locator('.picker')).toHaveCount(0);
    const rootRow = page.locator('.files-rowwrap', { hasText: path.basename(tmp) }).first();
    await expect(rootRow).toBeVisible();

    // Create a file via the root's New-file action → inline prompt → CREATE.
    await rootRow.getByLabel('New file').click();
    await page.locator('.files-prompt-input').fill('made-by-e2e.txt');
    await page.locator('.files-prompt-go').click();
    const fileRow = page.locator('.files-rowwrap', { hasText: 'made-by-e2e.txt' });
    await expect(fileRow).toBeVisible();
    expect(fs.existsSync(path.join(tmp, 'made-by-e2e.txt'))).toBe(true);

    // Rename it.
    await fileRow.getByLabel('Rename').click();
    await page.locator('.files-prompt-input').fill('renamed.txt');
    await page.locator('.files-prompt-go', { hasText: 'RENAME' }).click();
    const renamedRow = page.locator('.files-rowwrap', { hasText: 'renamed.txt' });
    await expect(renamedRow).toBeVisible();
    expect(fs.existsSync(path.join(tmp, 'renamed.txt'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'made-by-e2e.txt'))).toBe(false);

    // Delete it (popup confirm).
    await renamedRow.getByLabel('Delete').click();
    await page.locator('.delconfirm-go', { hasText: 'DELETE' }).click();
    await expect(page.locator('.files-rowwrap', { hasText: 'renamed.txt' })).toHaveCount(0);
    expect(fs.existsSync(path.join(tmp, 'renamed.txt'))).toBe(false);

    expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
  } finally {
    // Close the folder so the dev backend's roots don't retain a dead temp dir.
    await page.locator('.files-rowwrap', { hasText: path.basename(tmp) }).first()
      .getByLabel('Close folder').click().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
