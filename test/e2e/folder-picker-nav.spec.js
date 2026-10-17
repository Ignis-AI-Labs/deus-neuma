// @ts-check
// folder-picker-nav.spec.js — the redesigned Open Folder instrument
// (2026-09-29): the rail (places lit by where you are), the breadcrumb trail,
// the name filter, keyboard travel, the hidden toggle and the row's OPEN.
// Real browser, real isolated backend, real disk — no mocks.

import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setupExplorerPanel, makeFolder, REPO } from './helpers/explorer-panel-harness.js';

setupExplorerPanel();

// A real tree to walk: <tmp>/xpanel-nav-*/{alpha/inner, gamma, .dot}.
const shot = (page, name) => page.screenshot({ path: path.join(REPO, `test/e2e/shots/folder-picker-${name}.png`) });

const makeTree = async () => {
  const dir = await makeFolder('nav');
  for (const sub of ['alpha/inner', 'gamma', '.dot']) {
    await fs.promises.mkdir(path.join(dir, sub), { recursive: true });
  }
  return dir;
};

// Open the picker from the explorer and land it on `dir`.
const openPickerAt = async (page, dir) => {
  await page.locator('.xp-open').click();
  await expect(page.locator('.picker')).toBeVisible();
  await expect(page.locator('.picker-cwd')).not.toBeEmpty();
  await expect(async () => {
    await page.locator('.picker-pathinput').fill(dir);
    await page.locator('.picker-go').click();
    await expect(page.locator('.picker-cwd')).toHaveText(dir, { timeout: 5000 });
  }).toPass({ timeout: 30000 });
};

test('the rail lists PLACES first and lights exactly the place that holds the cwd', async ({ page }) => {
  await page.locator('.xp-open').click();
  await expect(page.locator('.picker-cwd')).toHaveText(os.homedir());
  await expect(page.locator('.picker-railhead').first()).toContainText('PLACES');
  const lit = page.locator('.picker-railitem.is-active');
  await expect(lit).toHaveCount(1);
  await expect(lit).toContainText('Home');
  await expect(lit).toHaveAttribute('aria-current', 'location');

  // Every rail item says where it lives — no bare, colliding labels.
  const subs = await page.locator('.picker-railsub').allTextContents();
  expect(subs.length).toBeGreaterThan(0);
  expect(subs.every((s) => s.trim().length > 0)).toBe(true);
  await page.waitForTimeout(700); // the entrance has fully landed
  await shot(page, 'home');
  await page.locator('.picker-cancel').click();
});

test('the trail: the tail is where you are, an ancestor crumb climbs, typing still travels', async ({ page }) => {
  const dir = await makeTree();
  await openPickerAt(page, dir);
  await expect(page.locator('.picker-crumb.is-here')).toHaveText(path.basename(dir));

  await page.locator('.picker-crumb', { hasText: new RegExp(`^${path.basename(path.dirname(dir))}$`) }).click();
  await expect(page.locator('.picker-cwd')).toHaveText(path.dirname(dir));
  await page.locator('.picker-cancel').click();
});

test('filter narrows the rows and the count tells the truth; keyboard walks in and back out', async ({ page }) => {
  const dir = await makeTree();
  await openPickerAt(page, dir);
  await expect(page.locator('.picker-row')).toHaveCount(2); // alpha, gamma — .dot hidden
  await expect(page.locator('.picker-count')).toHaveText('02 FOLDERS');

  const filter = page.locator('.picker-filter-input');
  await filter.fill('ALP');
  await expect(page.locator('.picker-row')).toHaveCount(1);
  await expect(page.locator('.picker-count')).toHaveText('01 / 02 FOLDERS');
  await shot(page, 'filtered');

  // ↓ drops into the rows, Enter enters, Backspace climbs back.
  await filter.press('ArrowDown');
  await expect(page.locator('.picker-row', { hasText: 'alpha' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.picker-cwd')).toHaveText(path.join(dir, 'alpha'));
  await expect(filter).toHaveValue(''); // a new folder starts unfiltered
  await page.locator('.picker-row', { hasText: 'inner' }).focus();
  await page.keyboard.press('Backspace');
  await expect(page.locator('.picker-cwd')).toHaveText(dir);
  await page.locator('.picker-cancel').click();
});

test('HIDDEN shows dotfolders; a row\'s OPEN picks it without entering; Escape closes', async ({ page }) => {
  const dir = await makeTree();
  await openPickerAt(page, dir);
  await expect(page.locator('.picker-row', { hasText: '.dot' })).toHaveCount(0);
  await page.locator('.picker-toggle').click();
  await expect(page.locator('.picker-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.picker-row', { hasText: '.dot' })).toBeVisible();

  // Escape from the list closes the dialog.
  await page.locator('.picker-row', { hasText: 'gamma' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.picker')).toHaveCount(0);

  await openPickerAt(page, dir);
  const row = page.locator('.picker-rowwrap', { hasText: 'gamma' });
  await row.hover();
  await page.waitForTimeout(700);
  await shot(page, 'row-hover');
  await row.locator('.picker-row-pick').click();
  await expect(page.locator('.picker')).toHaveCount(0);
  await expect(page.locator('.xp-name')).toHaveText('gamma');
});
