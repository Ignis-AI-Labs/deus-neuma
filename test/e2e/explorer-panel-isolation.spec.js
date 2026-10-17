// @ts-check
// explorer-panel-isolation.spec.js — two-window focus isolation and the
// tree’s git truth: badges, rollup, branch, the focus name wearing repo
// state. Split from explorer-panel.spec.js (SIZE-033); bodies byte-identical.

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { openDockApp } from './helpers/dock.js';
import {
  setupExplorerPanel, makeFolder, initSession, settleDesk, openFolderViaPanel, awaitShell, typeInShell, REPO, FPORT, addr,
} from './helpers/explorer-panel-harness.js';

setupExplorerPanel();

// ————— 7: two-window focus isolation — BROWSER-CONTEXT fallback mode —————
//
// The Electron slot path (multi-window.spec.js precedent) needs `npm run
// build` + the electron native-ABI flip (pretest:e2e:electron) — a shared
// node_modules mutation this validation wave must not perform under a live
// parallel session. So this proves TWO ISOLATED BROWSER CONTEXTS against one
// stack: each desk sets a different focus; strips, panels and terminal cwds
// stay independent, and the persisted focus keys never cross. This proves
// CONTEXT isolation of the focus lens — NOT slot (multi-desk) semantics.

test('two isolated desks: independent focus lenses — strips, trees and terminal cwds never cross', async ({ browser }) => {
  const dirA = await makeFolder('deska');
  const dirB = await makeFolder('deskb');
  const baseA = path.basename(dirA);
  const baseB = path.basename(dirB);

  const ctxA = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  try {
    const openDesk = async (ctx) => {
      const page = await ctx.newPage();
      const crashes = [];
      page.on('pageerror', (e) => crashes.push(e.message));
      page.__crashes = crashes;
      await initSession(page);
      await page.goto(`http://localhost:${FPORT}/`);
      await settleDesk(page);
      return page;
    };
    const pageA = await openDesk(ctxA);
    const pageB = await openDesk(ctxB);

    await openFolderViaPanel(pageA, dirA);
    await openFolderViaPanel(pageB, dirB);
    // Remount around the stale-roots product gap (2b reproducer) so each
    // tree renders its focus root; per-context focus restores (D11 slot 1).
    for (const page of [pageA, pageB]) {
      await page.reload();
      await settleDesk(page);
    }

    // Each strip carries ITS OWN lens — and never the sibling's.
    await expect(pageA.locator('.relink-status-folder')).toContainText(`FOLDER — ${baseA}`);
    await expect(pageB.locator('.relink-status-folder')).toContainText(`FOLDER — ${baseB}`);
    expect(await pageA.locator('.relink-status-folder').innerText()).not.toContain(baseB);
    expect(await pageB.locator('.relink-status-folder').innerText()).not.toContain(baseA);

    // Each tree scoped to its own focus root only.
    await expect(pageA.locator('.files-name', { hasText: baseA })).toBeVisible();
    await expect(pageA.locator('.files-name', { hasText: baseB })).toHaveCount(0);
    await expect(pageB.locator('.files-name', { hasText: baseB })).toBeVisible();
    await expect(pageB.locator('.files-name', { hasText: baseA })).toHaveCount(0);

    // Terminals opened in each desk cwd into THEIR window's focus (D4).
    for (const [page, base] of [[pageA, baseA], [pageB, baseB]]) {
      await openDockApp(page, 'TERMINAL');
      await awaitShell(page);
      await typeInShell(page, 'pwd');
      await expect(page.locator('.fwin .terminal-stage')).toContainText(base, { timeout: 15000 });
    }
    expect(await pageA.locator('.fwin .terminal-stage').innerText()).not.toContain(baseB);
    expect(await pageB.locator('.fwin .terminal-stage').innerText()).not.toContain(baseA);

    // The persisted focus keys never cross contexts.
    const key = `${addr.toLowerCase()}:win:desk:focus`;
    const storedA = JSON.parse(await pageA.evaluate((k) => localStorage.getItem(k), key));
    const storedB = JSON.parse(await pageB.evaluate((k) => localStorage.getItem(k), key));
    expect(storedA).toEqual({ kind: 'folder', path: dirA });
    expect(storedB).toEqual({ kind: 'folder', path: dirB });

    await pageA.screenshot({ path: path.join(REPO, 'test/e2e/shots/explorer-two-desks-a.png') });
    await pageB.screenshot({ path: path.join(REPO, 'test/e2e/shots/explorer-two-desks-b.png') });
    expect(pageA.__crashes, `A crashes: ${pageA.__crashes.join(' | ')}`).toEqual([]);
    expect(pageB.__crashes, `B crashes: ${pageB.__crashes.join(' | ')}`).toEqual([]);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});


// ————— 10: git status, VS Code-grade — badges, rollup, branch in the header —————

test('a repo root shows live git truth: clean = no badges, edit+save = M (rolled up to the root), new file = U, branch in the header', async ({ page }) => {
  const dir = await makeFolder('gitbadges');
  const base = path.basename(dir);
  // A REAL repo on the REAL disk (RULE 0) — one commit, clean tree.
  const git = (args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git(['init', '-b', 'trunk']);
  git(['config', 'user.email', 'e2e@void']);
  git(['config', 'user.name', 'e2e']);
  git(['add', '.']);
  git(['commit', '-m', 'birth']);

  await openFolderViaPanel(page, dir);

  // The header reads the branch (bare-folder probe, no upstream → no
  // divergence noise), and a clean tree wears NO badges.
  await expect(page.locator('.xp-sub')).toContainText('trunk', { timeout: 15000 });
  await expect(page.locator('.xp .files-git')).toHaveCount(0);

  // Edit + save through the file's own editor window — the M badge lands on
  // the row and rolls up to the root, no reload.
  await page.locator('.files-name', { hasText: 'probe.txt' }).click();
  const win = page.locator('.fwin', { has: page.locator('.editor') });
  await expect(win.locator('.cm-content')).toContainText('probe gitbadges', { timeout: 15000 });
  await win.locator('.cm-content').click();
  await page.keyboard.type(' — dirty now');
  await win.locator('.files-save').click();
  const probeRow = page.locator('.xp .files-rowwrap', { hasText: 'probe.txt' });
  await expect(probeRow.locator('.files-git.g-M')).toHaveText('M', { timeout: 15000 });
  const rootRow = page.locator('.xp .files-rowwrap', { hasText: base }).first();
  await expect(rootRow.locator('.files-git.g-M')).toHaveText('M');

  // A new file through the tree's own action wears U.
  await rootRow.hover();
  await rootRow.locator('.files-act[aria-label="New file"]').click();
  await page.locator('.files-prompt-input').fill('fresh.md');
  await page.locator('.files-prompt-go').click();
  await expect(page.locator('.xp .files-rowwrap', { hasText: 'fresh.md' }).locator('.files-git.g-U')).toHaveText('U', { timeout: 15000 });

  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/explorer-git-badges.png') });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});


// ————— 12: the focus name wears the repo state; ignored files gray out —————

test('the header name is green when clean and amber when dirty; ignored rows gray out', async ({ page }) => {
  const dir = await makeFolder('gitstate');
  const git = (args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git(['init', '-b', 'trunk']);
  git(['config', 'user.email', 'e2e@void']);
  git(['config', 'user.name', 'e2e']);
  await fs.promises.writeFile(path.join(dir, '.gitignore'), 'secret.log\n');
  git(['add', '.']);
  git(['commit', '-m', 'birth']);
  // An ignored file present on disk: grayed in the tree, never a badge, and
  // it does NOT make the repo dirty.
  await fs.promises.writeFile(path.join(dir, 'secret.log'), 'ignored\n');

  await openFolderViaPanel(page, dir);

  const name = page.locator('.xp-name');
  await expect(name).toHaveClass(/is-clean/, { timeout: 15000 });
  await expect(page.locator('.xp .files-rowwrap', { hasText: 'secret.log' })).toHaveClass(/is-ignored/, { timeout: 15000 });

  // Edit + save through the file's own editor window — the name turns AMBER
  // with no reload (the save's files-changed event re-probes the header).
  await page.locator('.files-name', { hasText: 'probe.txt' }).click();
  const win = page.locator('.fwin', { has: page.locator('.editor') });
  await expect(win.locator('.cm-content')).toContainText('probe gitstate', { timeout: 15000 });
  await win.locator('.cm-content').click();
  await page.keyboard.type(' — dirty');
  await win.locator('.files-save').click();
  await expect(name).toHaveClass(/is-dirty/, { timeout: 15000 });

  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/explorer-git-state.png') });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

