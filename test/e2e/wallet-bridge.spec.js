// @ts-check
import process from 'node:process';
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';

/**
 * The wallet bridge no longer exposes initiation or token retrieval over HTTP.
 * The browser tab must ask for confirmation before any wallet connection, and
 * cancel must stop before a wallet picker appears. Happy-path association and
 * private desktop IPC are proven in test/integration/wallet-bridge-ipc.test.js
 * and test/unit/wallet-bridge.test.js against a real backend child.
 * Requires the dev stack; PORT and FRONTEND_PORT follow its assigned lane.
 */

const BACKEND = `http://localhost:${process.env.PORT || 3355}`;

test('bridge: initiation and polling are not public HTTP endpoints', async ({ request }) => {
  const start = await request.post(`${BACKEND}/api/v1/auth/bridge/start`);
  expect([401, 404]).toContain(start.status());
  const poll = await request.get(`${BACKEND}/api/v1/auth/bridge/poll?code=not-a-session`, {
    headers: { 'x-bridge-secret': 'not-a-secret' },
  });
  expect([401, 404]).toContain(poll.status());

  const wallet = ethers.Wallet.createRandom();
  const challengeResponse = await request.get(`${BACKEND}/api/v1/auth/challenge`, { params: { address: wallet.address } });
  const challenge = (await challengeResponse.json()).challenge;
  const signature = await wallet.signMessage(challenge);
  const verified = await request.post(`${BACKEND}/api/v1/auth/verify`, { data: { address: wallet.address, signature, challenge } });
  expect(verified.status()).toBe(200);
  const { token } = await verified.json();
  const headers = { Authorization: `Bearer ${token}` };
  expect((await request.post(`${BACKEND}/api/v1/auth/bridge/start`, { headers })).status()).toBe(404);
  expect((await request.get(`${BACKEND}/api/v1/auth/bridge/poll?code=not-a-session`, { headers })).status()).toBe(404);
});

test('bridge: cancelling a URL handoff never opens the wallet picker', async ({ page }) => {
  await page.goto('/?bridge=not-a-desktop-session');
  const cancel = page.getByRole('button', { name: 'CANCEL' });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.locator('.bridge-card')).toContainText('Cancelled');
  await expect(page.locator('.wallet-picker-item')).toHaveCount(0);
});
