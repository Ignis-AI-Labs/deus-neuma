// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';

/**
 * System-browser wallet bridge (WEB-001 / #126) — the browser side of the
 * Electron hand-off, proven end-to-end:
 *   - a /?bridge=<code> tab connects an injected (Rabby-style) wallet + authenticates
 *   - it ASSOCIATES the minted token with the bridge session
 *   - the token is retrievable with the pollSecret (what Electron holds), and NOT
 *     with the URL-exposed browserCode alone
 *   - retrieval is one-time
 * Requires the dev stack (:7755 / :3355).
 */

test.describe.configure({ retries: 2 });

const BACKEND = `http://localhost:${process.env.PORT || 3355}`;

test('bridge: a /?bridge tab connects an injected wallet and hands the token back via pollSecret', async ({ page, request }) => {
  // 1. Electron starts the bridge and keeps both secrets.
  const start = await request.post(`${BACKEND}/api/v1/auth/bridge/start`);
  expect(start.ok()).toBeTruthy();
  const { browserCode, pollSecret } = await start.json();

  // 2. Inject a mock EIP-6963 wallet that signs via a real Node-side key.
  const wallet = ethers.Wallet.createRandom();
  await page.exposeFunction('__e2eSign', (message) => wallet.signMessage(message));
  await page.addInitScript((address) => {
    const provider = {
      request: async ({ method, params }) => {
        switch (method) {
          case 'eth_requestAccounts':
          case 'eth_accounts':
            return [address];
          case 'eth_chainId':
            return '0x2105';
          case 'personal_sign':
            return await window.__e2eSign(params[0]);
          default:
            throw new Error(`mock EIP-6963 provider: unhandled ${method}`);
        }
      },
      on: () => {},
      removeListener: () => {},
    };
    const info = { uuid: 'e2e-bridge-uuid-0001', name: 'Rabby (e2e mock)', icon: '', rdns: 'io.rabby.e2e' };
    const announce = () =>
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
    window.addEventListener('eip6963:requestProvider', announce);
    announce();
  }, wallet.address);

  // 3. Open the bridge tab — it auto-prompts the wallet picker (no full app boot).
  await page.goto(`/?bridge=${encodeURIComponent(browserCode)}`);
  const item = page.locator('.wallet-picker-item:not(.wallet-picker-embedded)', { hasText: 'Rabby (e2e mock)' });
  await expect(item).toBeVisible({ timeout: 15000 });
  await item.click();

  // 4. The bridge page confirms once it associates the token.
  await expect(page.locator('.bridge-card')).toContainText('Signed in', { timeout: 30000 });

  // 5. browserCode ALONE (URL-exposed) cannot retrieve the token → 403.
  const wrong = await request.get(`${BACKEND}/api/v1/auth/bridge/poll?code=${encodeURIComponent(browserCode)}`, {
    headers: { 'x-bridge-secret': 'wrong-secret' },
  });
  expect(wrong.status()).toBe(403);

  // 6. Electron retrieves it with the pollSecret → the injected wallet's real token.
  const poll = await request.get(`${BACKEND}/api/v1/auth/bridge/poll?code=${encodeURIComponent(browserCode)}`, {
    headers: { 'x-bridge-secret': pollSecret },
  });
  expect(poll.ok()).toBeTruthy();
  const { token, address } = await poll.json();
  expect(token).toBeTruthy();
  expect(address.toLowerCase()).toBe(wallet.address.toLowerCase());

  // 7. One-time — a second retrieval is gone.
  const again = await request.get(`${BACKEND}/api/v1/auth/bridge/poll?code=${encodeURIComponent(browserCode)}`, {
    headers: { 'x-bridge-secret': pollSecret },
  });
  expect(again.status()).toBe(404);
});
