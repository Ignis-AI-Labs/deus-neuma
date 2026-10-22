// @ts-check
// THE WALLET BACKUP FILE — a real browser renders the real recovery-phrase screen
// (wallet-backup-panel.js) on a stack of its own, in both modes:
//  · a key made for the person (no password): they choose a backup password,
//    weak or mismatched ones are refused, and the saved file decrypts with the
//    chosen password back to the exact words shown;
//  · a wallet with a password: the file decrypts with that password.
// No mock anywhere (RULE 0): real ethers encryption in the page, real download,
// real decryption here.
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import { setupIsolatedHouse } from './helpers/isolated-house.js';

const ctx = setupIsolatedHouse([], 4730);
const PHRASE = ethers.Wallet.createRandom().mnemonic.phrase;

// impure — render the screen into the page and report what Continue did
const render = (page, password) => page.evaluate(async ({ phrase, pw }) => {
  const { showRecoveryPhrase } = await import('/components/WalletPicker/wallet-backup-panel.js');
  const panel = document.createElement('div');
  panel.id = 'proof-panel';
  document.body.replaceChildren(panel);
  window.__continued = false;
  showRecoveryPhrase(panel, { mnemonic: phrase, password: pw, onContinue: () => { window.__continued = true; } });
}, { phrase: PHRASE, pw: password });

const shownWords = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.mnemonic-word'))
  .map((el) => el.lastChild.textContent.trim()).join(' '));

test('a key made for you: choose a backup password, the file restores the same words', async ({ page }) => {
  await page.goto(`http://localhost:${ctx.fport}/?noboot=1`);
  await render(page, null);
  expect(await shownWords(page)).toBe(PHRASE);
  await expect(page.locator('#wp-later')).toBeVisible();

  // refused: too short, then mismatched — nothing downloads
  await page.locator('#wp-file-pass').fill('short');
  await page.locator('#wp-file-confirm').fill('short');
  await page.locator('#wp-save').click();
  await expect(page.locator('#wp-backup-msg')).toContainText('at least 12 characters');
  await page.locator('#wp-file-pass').fill('a-backup-password-1');
  await page.locator('#wp-file-confirm').fill('a-backup-password-2');
  await page.locator('#wp-save').click();
  await expect(page.locator('#wp-backup-msg')).toContainText('do not match');

  const chosen = 'a-backup-password-1';
  await page.locator('#wp-file-confirm').fill(chosen);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#wp-save').click()]);
  expect(download.suggestedFilename()).toMatch(/^deus-neuma-wallet-backup-\d{4}-\d{2}-\d{2}-\d+\.json$/);
  const restored = await ethers.Wallet.fromEncryptedJson(fs.readFileSync(await download.path(), 'utf8'), chosen);
  expect(restored.mnemonic.phrase).toBe(PHRASE);
  await expect(page.locator('#wp-backup-msg')).toContainText('backup password you just chose');

  // a saved file counts as saved: Continue opens and finishes
  await expect(page.locator('#wp-saved-check')).toBeChecked();
  await page.locator('#wp-continue').click();
  expect(await page.evaluate(() => window.__continued)).toBe(true);
  await page.screenshot({ path: 'test/e2e/shots/wallet-backup-file.png' });
});

test('a wallet with a password: the file opens with that password', async ({ page }) => {
  await page.goto(`http://localhost:${ctx.fport}/?noboot=1`);
  const walletPassword = 'the-wallet-password-1';
  await render(page, walletPassword);
  await expect(page.locator('#wp-file-pass')).toHaveCount(0);
  await expect(page.locator('#wp-later')).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#wp-save').click()]);
  const restored = await ethers.Wallet.fromEncryptedJson(fs.readFileSync(await download.path(), 'utf8'), walletPassword);
  expect(restored.mnemonic.phrase).toBe(PHRASE);
});
