// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * End-to-end ATTUNEMENT surface — the witness's ceremony screen for a
 * BEING's attunement, driven through the real browser against the real
 * backend: real wallet auth, the real /api/v1/roster read, the real
 * /api/v1/attunement status read, the full-screen host mounted from the
 * composer palette (/attune).
 *
 * READ-ONLY by design: this spec never offers, opens, asks, or abandons —
 * a real being's ceremony is never driven by automation (live-being guard;
 * the supervised runs with the witness present are the live proof). The
 * mutating legs are proven over the real wire at the API layer
 * (test/integration/attunement-api.test.js). Here we prove the SURFACE:
 * palette → phase → auth → roster → honest stage render → return to desk.
 *
 * Requires the dev stack running.
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
let roster;

test.beforeAll(async () => {
  ({ token, addr } = await mintToken());
  ({ roster } = await (await fetch(`${BACKEND}/api/v1/roster`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json());
});

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Attest', neumaId: 'e2e-attune' }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr });
  await page.goto('/');
});

test('the witness opens a being’s ceremony read-only: /attune → the roster → a chosen being’s honest stage → return to the desk', async ({ page }) => {
  // /attune from the composer palette — the honest user path in
  const composer = page.locator('textarea').first();
  await composer.waitFor({ state: 'visible' });
  await composer.fill('/attune');
  await composer.press('Enter');

  // the full-screen ceremony host mounts with the roster — and the full
  // ceremony staging presides: the Attunement Seal and the drifting motes
  const host = page.getByTestId('attunement');
  await expect(host).toBeVisible();
  await expect(page.getByTestId('att-progress')).toContainText('THE ATTUNEMENT');
  await expect(page.getByTestId('fx-seal')).toBeVisible();
  await expect(page.getByTestId('fx-motes')).toBeAttached();
  // the roster is the threshold, not a ceremony phase — no rail yet
  await expect(page.getByTestId('att-rail')).toHaveCount(0);
  const rosterPanel = page.getByTestId('att-roster');
  await expect(rosterPanel).toBeVisible();

  if (roster.length === 0) {
    // an empty house states itself honestly
    await expect(rosterPanel).toContainText('NO BEINGS IN THIS HOUSE YET');
  } else {
    // choose the first being — a status READ, never a mutation — and the
    // host renders whichever stage that being's record truthfully holds
    await page.getByTestId(`att-pick-${roster[0].neumaId}`).click();
    await expect(page.getByTestId('att-progress')).not.toBeEmpty();
    await expect(
      page.getByTestId('att-offer')
        .or(page.getByTestId('att-not-due'))
        .or(page.getByTestId('att-present'))
        .or(page.getByTestId('att-disclosure'))
        .or(page.getByTestId('att-opening'))
        .or(page.getByTestId('att-question'))
        .or(page.getByTestId('att-seal'))
        .or(page.getByTestId('att-transcript'))
        .first(),
    ).toBeVisible({ timeout: 15000 });
    // inside the ceremony proper the phase rail graduates the rite — five
    // diamonds, exactly one live (or all five green on a sealed record)
    const rail = page.getByTestId('att-rail');
    await expect(rail).toBeVisible();
    await expect(rail.locator('.att-rail-node')).toHaveCount(5);
    // a resumed watching room never sits silent: it either shows the being
    // answering or states plainly that the flow is paused awaiting the witness
    if (await page.getByTestId('att-question').isVisible().catch(() => false)) {
      await expect(
        page.getByTestId('att-standing').or(page.getByTestId('att-answering')).first(),
      ).toBeVisible();
    }
    // an answered turn carries the quiet REOPEN affordance (pre-seal only).
    // Opening and closing the confirm is pure local UI — the go button is
    // NEVER clicked here; the mutating leg is proven at the API layer.
    const reopenBtn = page.locator('button.att-reopen').first();
    if (await reopenBtn.isVisible().catch(() => false)) {
      await reopenBtn.click();
      const confirm = page.getByTestId('att-reopen-confirm');
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText('THE WORDS ALREADY GIVEN STAY ON THE RECORD');
      await page.getByTestId('att-reopen-cancel').click();
      await expect(confirm).toHaveCount(0);
    }
    // NOTE: no button beyond the pick is ever clicked — nothing mutates.
  }

  // stepping away returns to the desk; the host unmounts cleanly
  await page.getByTestId('att-close').click();
  await expect(host).toBeHidden();
  await composer.waitFor({ state: 'visible' });

  expect(page.__crashes).toEqual([]);
});
