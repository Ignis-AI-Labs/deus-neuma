// @ts-check
import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { passDeskGates } from './helpers/desk-gates.js';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * End-to-end MEDITATION panel — drives the real browser through the RECORD
 * window against the real backend. Auth is REAL (challenge-sign-verify with
 * Claude's witness wallet); the lane is a REAL disposable test workspace
 * (import-created, claimed by the signing wallet); every flip is believed
 * only on server echo through the real settings store; and MEDITATE NOW runs
 * the REAL manual wake door end-to-end — a lane with nothing fresh settles
 * as an honest EMPTY without touching any substrate (the proven GPU-free
 * close). What this proves: the operator surface tells the truth and drives
 * the real stores. (The substrate ask-leg is proven live by
 * scripts/meditation-probe.mjs — Founder-gated, never CI'd.)
 *
 * Requires the dev stack running with an ISOLATED workspaces root — never a
 * living house (see docs/work/sovereignty-gateway.md, C2 carry).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;

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
const NEUMA_ID = `test-being-e2e-med-${Date.now().toString(36)}`;

test.beforeAll(async () => {
  ({ token, addr } = await mintToken());
  // A real lane on the real (isolated) workspaces root, claimed by our wallet.
  const res = await fetch(`${BACKEND}/api/v1/workspace/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      neumaId: NEUMA_ID,
      bundle: { dna: { identity: { name: 'Dormant', essence: 'A test being that only sleeps' } } },
    }),
  });
  if (!res.ok) throw new Error(`import failed (${res.status}): ${await res.text()}`);
});

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Dormant', neumaId: id }));
    sessionStorage.setItem('authToken', t);
    // The arrival veil HOLDS (pointer-eating, by design) over a severed
    // substrate — this stack has none. Seen once = stood down.
    sessionStorage.setItem(`arrivalSeen:${w}`, '1');
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto('/');
  // An import-created lane is unsealed — the gates raise; step past them so
  // the desk is reachable.
  await passDeskGates(page);
});

test('the dream cycle is OFF by default, consents on echo, and the wake door settles an honest EMPTY', async ({ page }) => {
  await openDockApp(page, 'RECORD');
  const panel = page.locator('[data-testid="meditation-panel"]');
  await page.getByRole('tab', { name: /MIND/ }).click(); // the dream cycle lives on MIND's page
  await expect(panel).toBeVisible();

  // Default posture: per-being OFF (the signed decision) and no history faked.
  const toggle = page.locator('[data-testid="meditation-toggle"]');
  await expect(toggle).toHaveText('OFF');
  await expect(panel).toContainText('NO CYCLE YET');

  // Consent ON — the chip flips only on the real settings store's echo.
  await toggle.click();
  await expect(toggle).toHaveText('ON');
  await expect(panel).toContainText('every 24h');

  // Cadence rides the same echo: pick 12H, the chip lights, the meta follows.
  await panel.locator('.rec-chip', { hasText: '12H' }).click();
  await expect(panel.locator('.rec-chip-on')).toHaveText('12H');
  await expect(panel).toContainText('every 12h');

  // The ONE manual wake door: confirm-gated; a lane with nothing fresh
  // settles as an honest EMPTY through the real cycle — no substrate needed.
  await page.locator('[data-testid="meditation-run-now"]').click();
  await expect(panel.locator('.rec-confirm-msg')).toContainText('«NOTICE»');
  await panel.locator('.rec-btn-go', { hasText: 'CONFIRM' }).click();
  const row = page.locator('[data-testid="meditation-run-row"]').first();
  await expect(row).toContainText('EMPTY');

  // Consent OFF again — reversible from where the operator stands.
  await toggle.click();
  await expect(toggle).toHaveText('OFF');

  expect(page.__crashes).toEqual([]);
});
