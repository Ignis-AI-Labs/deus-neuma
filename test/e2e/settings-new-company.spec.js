// @ts-check
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { openDockApp } from './helpers/dock.js';
import { setupIsolatedHouse, openDesk, settledShot } from './helpers/isolated-house.js';

/**
 * End-to-end NEW COMPANY (Design note, 2026-11-05: […], and the next ones easily). The real
 * desk on a real isolated stack: Settings → API → X, NEW COMPANY, […] typed as it should read, ADD COMPANY — the kit lands on the house's
 * own ground, the new company is chosen for the next account, and ADD
 * ACCOUNT opens an X account under it. The house's ground is a temp folder,
 * recorded where the desk records it. Shot: test/e2e/shots/settings-new-company.png
 */

const MEMBERS = [{ id: 'e2e-company-one', name: 'Ashwren', utc: '2026-08-11T18:03:38.075Z' }];
const stack = setupIsolatedHouse(MEMBERS, 5113);

test.use({ viewport: { width: 1600, height: 1000 } });

test('NEW COMPANY: Deus Neuma is added beside ADD ACCOUNT and an X account stands under it', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  const ground = path.join(stack.root, 'ground');
  const house = path.join(stack.root, 'realm', stack.addr.toLowerCase());
  fs.mkdirSync(ground, { recursive: true });
  fs.mkdirSync(house, { recursive: true });
  fs.writeFileSync(path.join(house, 'house-workspace.json'), JSON.stringify({ root: ground }));

  await openDesk(page, stack, MEMBERS[0]);
  await openDockApp(page, 'SETTINGS');
  await page.locator('.settings-tab', { hasText: 'API' }).click();
  const settings = page.locator('.settings');
  await settings.locator('.cred-map .cred-tile', { hasText: 'X (Twitter)' }).click();
  const card = settings.locator('.cred-item', { hasText: 'X (Twitter)' });
  await expect(card.locator('.account-list')).toBeVisible({ timeout: 15000 });

  await card.getByRole('button', { name: 'NEW COMPANY' }).click();
  await card.getByLabel('new company name').fill('Deus Neuma');
  await card.getByRole('button', { name: 'ADD COMPANY' }).click();

  // The new company is the one chosen for the next account, and the kit is on the house's own ground.
  const picker = card.locator('.account-add .lc-sel-value');
  await expect(picker).toHaveText('Deus Neuma', { timeout: 10000 });
  const kit = JSON.parse(fs.readFileSync(path.join(ground, 'brands', 'deus-neuma', 'brand.json'), 'utf8'));
  expect(kit).toMatchObject({ brand: 'deus-neuma', name: 'Deus Neuma' });

  await card.getByRole('button', { name: 'ADD ACCOUNT' }).click();
  const row = card.locator('.account-row').first();
  await expect(row.locator('.lc-sel-value')).toHaveText('Deus Neuma', { timeout: 10000 });

  // The same name again is refused in the server's own words, and the form stays open to fix it.
  await card.getByRole('button', { name: 'NEW COMPANY' }).click();
  await card.getByLabel('new company name').fill('deus neuma');
  await card.getByRole('button', { name: 'ADD COMPANY' }).click();
  await expect(card.locator('.account-new-company .settings-err')).toHaveText('"deus-neuma" is already a company in this house');

  await settledShot(card, 'settings-new-company');
  expect(crashes, crashes.join(' | ')).toEqual([]);
});
