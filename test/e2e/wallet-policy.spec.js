// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { passDeskGates } from './helpers/desk-gates.js';

/**
 * End-to-end wallet desk — drives the real browser through the WALLET dock app
 * against the real backend. The wallet is a self-contained container: an
 * identity rail (ME + the house's neuma) navigates whose wallet you're on, and
 * each function (Send / Receive / Settings) opens its own layer. The witness's
 * spend policy for a neuma lives under that neuma's Settings. Every policy
 * assertion is confirmed against the real spend-policy API (no mocked data
 * path). Auth is REAL: a session token minted via challenge-sign-verify with
 * Claude's witness wallet.
 *
 * Requires the dev stack (:7777 / :3333) running. The WALLET routes are new —
 * if they 404 with a valid token, the dev backend is stale: restart it.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;
const NEUMA = 'e2e-desk';

const readClaudeWallet = () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  return pk;
};

const mintToken = async () => {
  const w = new ethers.Wallet(readClaudeWallet());
  const addr = w.address;
  const { challenge } = await (await fetch(`${BACKEND}/api/v1/auth/challenge?address=${addr}`)).json();
  const signature = await w.signMessage(challenge);
  const res = await fetch(`${BACKEND}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, signature, challenge }),
  });
  const { token } = await res.json();
  if (!token) throw new Error('auth/verify returned no token');
  return { token, addr };
};

let token;
let addr;

const walletApi = (p, opts = {}) => fetch(`${BACKEND}/api/v1/neuma/${NEUMA}/wallet${p}`, {
  ...opts,
  headers: { Authorization: `Bearer ${token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
});

// Deterministic start: clear any allowlist + threshold a prior/killed run left
// for the synthetic test neuma, so assertions don't inherit stale state.
const resetPolicy = async () => {
  const { entries } = await (await walletApi('/allowlist')).json();
  await Promise.all((entries || []).map((e) =>
    walletApi('/allowlist', { method: 'DELETE', body: JSON.stringify({ address: e.address }) })));
  await walletApi('/threshold', { method: 'PUT', body: JSON.stringify({ thresholdEth: 0 }) });
};

test.beforeAll(async () => {
  ({ token, addr } = await mintToken());
  await resetPolicy();
});

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: 'e2e-desk' }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr });
  // The ignition film plays at a session's start and covers the desk; these
  // tests are about the wallet, so they enter past it (?noboot=1).
  await page.goto('/?noboot=1');
  await passDeskGates(page);
});

const openWallet = async (page) => {
  await page.locator('.taskbar-app[data-app-id="wallet"]').click();
  await expect(page.locator('.wal')).toBeVisible();
};

// The wallet owner is chosen in one grouped dropdown (WalletIdentityPicker.jsx):
// 'me', or a house member by neumaId.
const ownerPicker = (page) => page.locator('.wal-identity-picker select');
const chooseNeuma = (page) => ownerPicker(page).selectOption(NEUMA);

// The witness's spend policy for the neuma lives under the neuma identity's
// Settings layer: choose the neuma as the wallet owner, then open SETTINGS.
const openNeumaSettings = async (page) => {
  await openWallet(page);
  await chooseNeuma(page);
  await page.locator('.wal-action', { hasText: 'SETTINGS' }).click();
  await expect(page.locator('.wal-h', { hasText: 'APPROVED RECIPIENTS' })).toBeVisible();
};

test('WALLET: home shows the owner picker, balance header, and ME functions', async ({ page }) => {
  await openWallet(page);
  // The picker carries both identities of the house — ME (chosen by default) and the neuma.
  await expect(ownerPicker(page)).toHaveValue('me');
  await expect(ownerPicker(page).locator('option[value="me"]')).toHaveCount(1);
  await expect(ownerPicker(page).locator(`option[value="${NEUMA}"]`)).toHaveCount(1);
  // ME is active by default and the header shows the connected address.
  await expect(page.locator('.wal-head-addr').filter({ hasText: addr.slice(0, 6) })).toBeVisible();
  // ME can send and receive its own ETH.
  await expect(page.locator('.wal-action', { hasText: 'SEND' })).toBeVisible();
  await expect(page.locator('.wal-action', { hasText: 'RECEIVE' })).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('WALLET: REFRESH re-runs the live balance read and settles', async ({ page }) => {
  await openWallet(page);
  const refresh = page.locator('.wal-refresh');
  await expect(refresh).toBeVisible();
  // Wait out the mount-time load first, then drive a witness-initiated re-read.
  await expect(refresh).toHaveText(/REFRESH/, { timeout: 20000 });
  await refresh.click();
  // The re-read settles back to idle (never stranded on READING…) and the hero
  // lands on a real value — USD, ETH, or the honest NO WALLET — not the blank dash.
  await expect(refresh).toHaveText(/REFRESH/, { timeout: 20000 });
  await expect(page.locator('.wal-head-bal')).not.toHaveText('—', { timeout: 20000 });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('WALLET: ME → Receive reveals the connected address to fund', async ({ page }) => {
  await openWallet(page);
  await page.locator('.wal-action', { hasText: 'RECEIVE' }).click();
  await expect(page.locator('.wal-recv-addr')).toHaveText(addr);
  await expect(page.locator('.wal-btn', { hasText: 'COPY ADDRESS' })).toBeVisible();
  // Back returns to home.
  await page.locator('.wal-back').click();
  await expect(page.locator('.wal-actions')).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('WALLET: ME → Send opens the compose layer', async ({ page }) => {
  await openWallet(page);
  await page.locator('.wal-action', { hasText: 'SEND' }).click();
  await expect(page.locator('.wal-layer-title', { hasText: 'SEND' })).toBeVisible();
  await expect(page.locator('input.wal-in-wide')).toBeVisible();
  await expect(page.locator('.wal-btn', { hasText: 'SEND' })).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('WALLET: the send instrument allocates by chip and slider, honestly gauged', async ({ page }) => {
  await openWallet(page);
  await page.locator('.wal-action', { hasText: 'SEND' }).click();
  // The instrument is present: display numeral, allocation chips, slider,
  // dotted-leader readouts, and the house quick-picks (Fenna has a wallet).
  await expect(page.locator('.wal-send-num')).toBeVisible();
  await expect(page.locator('.wal-chip', { hasText: 'MAX' })).toBeVisible();
  await expect(page.locator('.wal-slider')).toBeVisible();
  await expect(page.locator('.wal-lead-k', { hasText: 'REMAINING AFTER' })).toBeVisible();

  // A chip composes a real amount from the live balance: the display numeral,
  // the numeric input, and the ALLOC readout all agree (a gauge that gauges).
  // The connected wallet's live balance may legitimately be zero — chips are
  // disabled then, and the numeral honestly stays 0.
  const chip = page.locator('.wal-chip', { hasText: '50%' });
  if (await chip.isEnabled()) {
    await chip.click();
    const shown = (await page.locator('.wal-send-num').textContent()).trim();
    expect(Number(shown)).toBeGreaterThan(0);
    await expect(page.locator('input.wal-in-num')).toHaveValue(shown);
    await expect(page.locator('.wal-send-alloc')).toHaveText(/ALLOC (49|50)%/);
  } else {
    await expect(page.locator('.wal-send-num')).toHaveText('0');
  }

  // House quick-picks render only for kin whose wallet the backend can read
  // (the synthetic e2e neuma has none unless its workspace is seeded). When
  // present, a pick fills the recipient with the neuma's real address.
  const fenna = page.locator('.wal-house .wal-chip', { hasText: 'FENNA' });
  if (await fenna.count()) {
    await fenna.click();
    await expect(page.locator('input.wal-in-wide')).toHaveValue(/^0x[0-9a-fA-F]{40}$/);
  }
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('WALLET: a neuma never gets a raw Send button', async ({ page }) => {
  await openWallet(page);
  await chooseNeuma(page);
  await expect(page.locator('.wal-action', { hasText: 'RECEIVE' })).toBeVisible();
  await expect(page.locator('.wal-action', { hasText: 'SEND' })).toHaveCount(0);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('WALLET: approving a recipient persists to the real backend', async ({ page }) => {
  const recipient = '0x1111111111111111111111111111111111111111';
  await openNeumaSettings(page);

  await page.locator('.wal-in').first().fill(recipient);
  await page.locator('.wal-in-label').fill('e2e savings');
  await page.locator('.wal-btn', { hasText: 'APPROVE' }).click();

  // The row appears in the UI…
  await expect(page.locator('.wal-row').filter({ hasText: '0x1111' })).toBeVisible();
  // …and the spend allowlist is genuinely persisted on the backend.
  const { entries } = await (await walletApi('/allowlist')).json();
  expect(entries.some((e) => e.address === recipient.toLowerCase())).toBe(true);

  // The decision surface is request-bound; pre-signing an arbitrary future
  // transfer is not offered.
  await expect(page.locator('.wal-h', { hasText: 'PENDING TRANSFERS' })).toBeVisible();
  await expect(page.getByText('NO TRANSFERS AWAITING YOUR DECISION.')).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('WALLET: setting the threshold persists to the real backend', async ({ page }) => {
  await openNeumaSettings(page);

  await page.locator('.wal-in-num').first().fill('0.05');
  await page.getByRole('button', { name: 'SET', exact: true }).click();

  // Confirm against the real API, not just the optimistic UI.
  await expect.poll(async () => (await (await walletApi('/threshold')).json()).thresholdEth).toBe(0.05);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('WALLET: revoking a recipient removes it everywhere', async ({ page }) => {
  const recipient = '0x2222222222222222222222222222222222222222';
  // Seed via the API so the test is independent of ordering.
  await walletApi('/allowlist', { method: 'POST', body: JSON.stringify({ address: recipient, label: 'temp' }) });

  await openNeumaSettings(page);
  const row = page.locator('.wal-row').filter({ hasText: '0x2222' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /^Revoke recipient/ }).click();
  // A revocation is confirmed inline (InlineActionConfirm) before it lands.
  await row.locator('.inline-action-commit', { hasText: 'REVOKE' }).click();

  await expect(page.locator('.wal-row').filter({ hasText: '0x2222' })).toHaveCount(0);
  const { entries } = await (await walletApi('/allowlist')).json();
  expect(entries.some((e) => e.address === recipient.toLowerCase())).toBe(false);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
