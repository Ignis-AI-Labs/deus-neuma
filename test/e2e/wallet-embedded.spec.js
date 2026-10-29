// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * End-to-end for the embedded witness wallet — drives the REAL WalletPicker UI
 * against the running stack. Two kinds of proof, no assumptions:
 *
 *  1. FUNCTION proofs (deterministic): create / copy / save / import each
 *     produce real, inspectable state — the 24-word phrase, the clipboard, a
 *     keystore file that decrypts back to the secret, and the correct wallet
 *     persisted locally. These need no backend, so they are not subject to
 *     dev-proxy jitter.
 *  2. AUTH proof (one integration test, retried): a created wallet locks,
 *     unlocks, and actually signs the backend's challenge to mint a session
 *     token — the full sign-in, start to finish (no mocked data path). This is
 *     the only path that crosses the Vite dev proxy; retries absorb dev jitter.
 *
 * The browser wallet backend runs here (no Electron in Playwright); the Electron
 * main-process backend is covered by the wallet-service unit suite + the desktop
 * checklist. Requires the dev stack (:7755 / :3355) running.
 */

test.describe.configure({ retries: 2 });

const PW = 'e2e-witness-passphrase-2026'; // ≥ the 12-char floor

const authToken = (page) => page.evaluate(() => sessionStorage.getItem('authToken'));
const storedAddress = (page) =>
  page.evaluate(() => {
    try {
      const r = JSON.parse(localStorage.getItem('neuma-wallets'));
      const a = r.wallets.find((w) => w.id === r.activeId);
      return a ? a.address : null;
    } catch {
      return null;
    }
  });
const walletCount = (page) =>
  page.evaluate(() => {
    try {
      return (JSON.parse(localStorage.getItem('neuma-wallets')).wallets || []).length;
    } catch {
      return 0;
    }
  });

const openPicker = async (page) => {
  await expect(page.locator('#portal-enter')).toBeVisible();
  await page.locator('#portal-enter').click();
  await expect(page.locator('.wallet-picker-overlay')).toBeVisible();
};

const createWallet = async (page) => {
  await page.locator('#wp-create').click();
  await page.locator('#wp-password').fill(PW);
  await page.locator('#wp-password-confirm').fill(PW);
  await page.locator('#wp-submit').click();
  await expect(page.locator('.mnemonic-word')).toHaveCount(24);
};

// The full sign-in: the browser embedded provider shows an in-app confirm for
// the auth-challenge signature — approve it, then the real token must land.
const approveSignAndAuth = async (page) => {
  await expect(page.locator('.wallet-confirm-overlay')).toBeVisible({ timeout: 30000 });
  await page.locator('.wallet-confirm-approve').click();
  await expect.poll(() => authToken(page), { timeout: 30000, message: 'wallet never authenticated' }).toBeTruthy();
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('create: 24-word phrase shown, Copy works, encrypted keystore saves, wallet stored', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await openPicker(page);
  await createWallet(page);

  // The words start hidden; show them, then read the phrase (the word is the text node after the index span).
  await page.locator('#wp-reveal').click();
  const phrase = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.mnemonic-word'))
      .map((el) => el.lastChild.textContent.trim())
      .join(' ')
  );
  expect(phrase.split(' ')).toHaveLength(24);

  // Copy → clipboard holds the exact phrase.
  await page.locator('#wp-copy').click();
  await expect(page.locator('#wp-backup-msg')).toContainText('Copied');
  expect((await page.evaluate(() => navigator.clipboard.readText())).trim()).toBe(phrase);

  // Save encrypted file → a real keystore that decrypts back to this phrase.
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#wp-save').click()]);
  const restored = await ethers.Wallet.fromEncryptedJson(fs.readFileSync(await download.path(), 'utf8'), PW);
  expect(restored.mnemonic.phrase).toBe(phrase);

  // The wallet is genuinely persisted, and its address derives from the shown phrase.
  expect(await storedAddress(page)).toBe(ethers.HDNodeWallet.fromPhrase(phrase).address);
});

test('import: a recovery phrase stores the right wallet', async ({ page }) => {
  const phrase = 'test test test test test test test test test test test junk';
  const expected = ethers.HDNodeWallet.fromPhrase(phrase).address;

  await openPicker(page);
  await page.locator('#wp-import').click();
  await page.locator('#wp-secret').fill(phrase);
  await page.locator('#wp-password').fill(PW);
  await page.locator('#wp-submit').click();

  await expect.poll(() => storedAddress(page), { timeout: 15000 }).toBe(expected);
});

test('import: a raw private key stores the right wallet', async ({ page }) => {
  const w = ethers.Wallet.createRandom();

  await openPicker(page);
  await page.locator('#wp-import').click();
  await page.locator('#wp-secret').fill(w.privateKey);
  await page.locator('#wp-password').fill(PW);
  await page.locator('#wp-submit').click();

  await expect.poll(() => storedAddress(page), { timeout: 15000 }).toBe(w.address);
});

test('import: an encrypted keystore file stores the right wallet', async ({ page }) => {
  const src = ethers.HDNodeWallet.fromPhrase(
    'legal winner thank year wave sausage worth useful legal winner thank yellow'
  );
  // Light-scrypt fixture so the in-browser decrypt is fast in the test; real
  // exports use geth-strength N=2^18 (intentionally slower to import).
  const account = { address: src.address, privateKey: src.privateKey, mnemonic: { entropy: src.mnemonic.entropy, path: src.path, locale: 'en' } };
  const tmp = path.join(os.tmpdir(), `neuma-e2e-keystore-${process.pid}.json`);
  fs.writeFileSync(tmp, await ethers.encryptKeystoreJson(account, PW, { scrypt: { N: 1024 } }));
  try {
    await openPicker(page);
    await page.locator('#wp-import').click();
    await page.locator('#wp-password').fill(PW); // the keystore password (decrypt + re-seal)
    await page.locator('#wp-keystore-file').setInputFiles(tmp);

    await expect.poll(() => storedAddress(page), { timeout: 15000 }).toBe(src.address);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test('end-to-end: a created wallet locks, unlocks, and authenticates with the real backend', async ({ page }) => {
  // Create → authenticate (the freshly-created wallet signs the real challenge).
  await openPicker(page);
  await createWallet(page);
  await page.locator('#wp-saved-check').check();
  await page.locator('#wp-continue').click();
  await approveSignAndAuth(page);

  // Drop the session + the in-memory unlock, reload → must unlock to re-enter.
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.removeItem('walletConnected');
    localStorage.removeItem('walletAddress');
  });
  await page.reload();
  await openPicker(page);
  await page.locator('.wallet-picker-embedded').first().click(); // the stored wallet → unlock
  await page.locator('#wp-password').fill(PW);
  await page.locator('#wp-submit').click();
  await approveSignAndAuth(page);
});

test('locked-on-sign: an idle re-lock prompts unlock at sign time, then signs', async ({ page }) => {
  // A freshly created wallet is already unlocked locally — no backend round-trip
  // needed (the recovery being proven is purely client-side: lock → sign → unlock
  // prompt → sign). Keeps the test deterministic, off the flaky dev-proxy path.
  await openPicker(page);
  await createWallet(page);

  // Simulate the 15-min idle auto-lock that fires while the witness reads the
  // covenant, then request a signature exactly as the birth commitment does.
  // Before the fix this threw "Wallet is locked" with no recovery; now the
  // provider must prompt to unlock. Same cached module the app uses.
  await page.evaluate(async () => {
    const mod = await import('/services/EmbeddedWallet.js');
    mod.lockEmbeddedWallet();
    const p = mod.getEmbeddedProvider().request({ method: 'personal_sign', params: ['Covenant acceptance'] });
    p.then((s) => { window.__sig = s; }).catch((e) => { window.__sigErr = e.message; });
  });

  // The unlock prompt appears (the fix) — supply the password.
  await expect(page.locator('.wallet-unlock-input')).toBeVisible();
  await page.locator('.wallet-unlock-input').fill(PW);
  await page.locator('.wallet-confirm-approve').click();

  // After unlock the normal sign confirmation appears — approve it.
  await expect(page.locator('.wallet-confirm-message')).toBeVisible();
  await page.locator('.wallet-confirm-approve').click();

  // The signature resolves — the locked sign recovered end to end.
  await expect.poll(() => page.evaluate(() => window.__sig || null), { timeout: 15000 })
    .toMatch(/^0x[0-9a-f]{130}$/i);
});

test('multi: a second wallet — the picker lists the first and still offers Create', async ({ page }) => {
  await openPicker(page);
  await createWallet(page); // wallet #1 (created on submit; recovery shown)
  expect(await walletCount(page)).toBe(1);

  // Abandon the recovery screen; wallet #1 persists in the registry.
  await page.reload();
  await openPicker(page);
  await expect(page.locator('.wallet-picker-embedded')).toHaveCount(1);
  await expect(page.locator('#wp-create')).toBeVisible();

  await createWallet(page); // wallet #2
  expect(await walletCount(page)).toBe(2);
});

test('multi: at the cap, Create is hidden with a limit note', async ({ page }) => {
  await page.evaluate(() => {
    const wallets = Array.from({ length: 5 }, (_, i) => ({ id: `seed${i}`, address: '0x' + String(i).padStart(40, '0') }));
    localStorage.setItem('neuma-wallets', JSON.stringify({ activeId: wallets[0].id, wallets }));
  });
  await openPicker(page);
  await expect(page.locator('.wallet-picker-embedded')).toHaveCount(5);
  await expect(page.locator('#wp-create')).toHaveCount(0);
  await expect(page.locator('.wallet-picker-note')).toContainText('limit reached');
});
