// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';

/**
 * External (injected) browser-wallet path — proves an EIP-6963 wallet like Rabby
 * or MetaMask connects and completes the REAL challenge-sign-verify auth in a
 * browser, against the REAL backend. No real extension is needed: a mock EIP-6963
 * provider is injected and proxies personal_sign to a Node-side test key (real
 * secp256k1, real backend address-recovery) — the honest headless proxy for
 * […].
 *
 * This is the same browser-side flow the Electron system-browser bridge reuses:
 * pick an injected wallet → connect → sign the challenge → mint a session token.
 * Requires the dev stack (:7755 / :3355).
 */

test.describe.configure({ retries: 2 });

const authToken = (page) => page.evaluate(() => sessionStorage.getItem('authToken'));
const storedAddress = (page) => page.evaluate(() => localStorage.getItem('walletAddress'));

test('external EIP-6963 wallet connects and authenticates with the real backend', async ({ page }) => {
  const wallet = ethers.Wallet.createRandom();

  // The injected provider proxies personal_sign to this real Node-side key, so
  // the backend recovers the same address it was handed — a genuine signature.
  await page.exposeFunction('__e2eSign', (message) => wallet.signMessage(message));

  // Inject a mock EIP-6963 wallet BEFORE app scripts run, so WalletDiscovery
  // announces + discovers it exactly as it would a real Rabby/MetaMask.
  await page.addInitScript((address) => {
    const provider = {
      request: async ({ method, params }) => {
        switch (method) {
          case 'eth_requestAccounts':
          case 'eth_accounts':
            return [address];
          case 'eth_chainId':
            return '0x2105'; // Base
          case 'personal_sign':
            // params: [message, address] for personal_sign
            return await window.__e2eSign(params[0]);
          default:
            throw new Error(`mock EIP-6963 provider: unhandled method ${method}`);
        }
      },
      on: () => {},
      removeListener: () => {},
    };
    const info = { uuid: 'e2e-mock-uuid-0001', name: 'Rabby (e2e mock)', icon: '', rdns: 'io.rabby.e2e' };
    const announce = () =>
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
    window.addEventListener('eip6963:requestProvider', announce);
    announce();
  }, wallet.address);

  await page.goto('/');

  // Open the picker → the injected wallet is listed as an external (non-embedded) option.
  await expect(page.locator('#portal-enter')).toBeVisible();
  await page.locator('#portal-enter').click();
  await expect(page.locator('.wallet-picker-overlay')).toBeVisible();

  const item = page.locator('.wallet-picker-item:not(.wallet-picker-embedded)', { hasText: 'Rabby (e2e mock)' });
  await expect(item).toBeVisible();
  await item.click();

  // WalletGate: setProvider → connect (eth_requestAccounts) → authenticate
  // (challenge → personal_sign via the mock → /verify) → real session token.
  await expect
    .poll(() => authToken(page), { timeout: 30000, message: 'external wallet never authenticated' })
    .toBeTruthy();

  // The authenticated identity is the injected wallet's own address.
  expect((await storedAddress(page))?.toLowerCase()).toBe(wallet.address.toLowerCase());
});
