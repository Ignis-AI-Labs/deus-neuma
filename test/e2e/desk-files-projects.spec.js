// @ts-check
// Desk e2e — FILES rail + PROJECTS app. Split from desk.spec.js (SIZE-017).
import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDockApp } from './helpers/dock.js';
import { REPO, BACKEND, token, setupDesk } from './helpers/desk-harness.js';

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

test('PROJECTS: create a project, hold it in the focus view, and a ground click re-points Files + status', async ({ page }) => {
  const projName = `e2e-proj-${process.pid}`;
  try {
    await openDockApp(page, 'PROJECTS');
    await expect(page.locator('.proj')).toBeVisible();

    // Create a project pointing at the repo (a stable, existing folder).
    await page.locator('.proj-new').click();
    await page.locator('.proj-input').first().fill(projName);
    await page.locator('.proj-input').nth(1).fill(REPO);
    await page.locator('.proj-create').click();

    // Creation ENTERS the project: the FOCUS view holds it — the heading
    // names the focus, the working column (new chat, grounds, conversations)
    // and the knowing rail (knowledge, memory) all stand, and the status
    // strip reflects the activation.
    const focus = page.locator('.proj-focus');
    await expect(focus).toBeVisible();
    await expect(focus.locator('.proj-focus-title')).toHaveText(projName);
    await expect(page.locator('.relink-status-project')).toContainText(projName);
    await expect(focus.locator('.proj-newchat')).toBeEnabled();
    await expect(focus.locator('.proj-files-title', { hasText: 'FOLDERS & REPOSITORIES' })).toBeVisible();
    await expect(focus.locator('.proj-files-title', { hasText: 'CONVERSATIONS' })).toBeVisible();
    await expect(focus.locator('.proj-files-title', { hasText: 'KNOWLEDGE' })).toBeVisible();
    await expect(focus.locator('.proj-memory')).toBeVisible();

    // ‹ ALL PROJECTS returns to the shelf (the entered project wears the
    // active mark), and picking it re-enters the focus view.
    await focus.locator('.proj-back').click();
    const projItem = page.locator('.proj-item', { hasText: projName });
    await expect(projItem).toBeVisible();
    await expect(projItem).toHaveClass(/is-active/);
    await projItem.locator('.proj-pick').click();
    await expect(focus.locator('.proj-focus-title')).toHaveText(projName);

    // The ground row is the "go work here" gesture: Files opens on the folder.
    // (Last — the raised Files window may cover the Projects window.)
    await focus.locator('.proj-folder-pick', { hasText: path.basename(REPO) }).click();
    await expect(page.locator('.files')).toBeVisible();
    await expect(page.locator('.files-name', { hasText: path.basename(REPO) }).first()).toBeVisible();

    expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
  } finally {
    // Clean up via the API, not the UI: activating opened the Files window over
    // the Projects window, so its buttons are obscured — an API delete is fast
    // and stacking-independent.
    await fetch(`${BACKEND}/api/v1/user/projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(({ projects }) => Promise.all((projects || [])
        .filter((p) => p.name === projName)
        .map((p) => fetch(`${BACKEND}/api/v1/user/projects/${p.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }))))
      .catch(() => {});
  }
});
