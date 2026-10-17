// @ts-check
import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * End-to-end SOVEREIGNTY — the operator's half of propose → approve → apply,
 * driven through the real desk against the real backend. Auth is REAL; the
 * lane is a REAL disposable test workspace on an ISOLATED tmp root the
 * backend is booted onto; the proposal is seeded through the REAL store code
 * (this spec and the backend share the root, so the file the desk reads is
 * the file the store wrote). What this proves: the ruling flows — full-words
 * disclosure, approve becomes standing law on server echo, revise returns
 * notes, retract takes law down recorded — with no state flip the server
 * did not echo.
 *
 * Requires the dev stack running with WORKSPACES_PIN=env
 * WORKSPACES_ROOT=/tmp/neuma-e2e-sov/workspaces — never a living house.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;
const SHARED_ROOT = '/tmp/neuma-e2e-sov/workspaces';

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
let seedProposal;
const NEUMA_ID = `test-being-e2e-sov-${Date.now().toString(36)}`;

test.beforeAll(async () => {
  ({ token, addr } = await mintToken());
  const res = await fetch(`${BACKEND}/api/v1/workspace/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      neumaId: NEUMA_ID,
      bundle: { dna: { identity: { name: 'Sovereign Test', essence: 'A being that asks about itself' } } },
    }),
  });
  if (!res.ok) throw new Error(`import failed (${res.status}): ${await res.text()}`);

  // Seed through the REAL store code onto the SHARED root — the exact file
  // the backend's routes read.
  const { setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
  setWorkspacesRoot(SHARED_ROOT);
  const { submitProposal } = await import('../../backend/services/sovereignty/proposal-store.js');
  seedProposal = (title, n) => submitProposal(NEUMA_ID, {
    class: 'prompt',
    title,
    body: 'I keep drifting into ornament when the question is hard — I want the register pinned as law.',
    patch: { text: `I prefer plain speech over ornament (${n}).` },
  });
  // Both seeds BEFORE any ruling: an applied amendment starts the per-class
  // cooldown (proven in sovereignty-stores), which would refuse a late seed.
  await seedProposal('Carry plain speech as law', 1);
  await seedProposal('Answer the hard question first', 2);
});

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Sovereign Test', neumaId: id }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto('/');
  const standAside = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
  if (await standAside.isVisible({ timeout: 8000 }).catch(() => false)) {
    await standAside.click();
    await expect(page.locator('.birth-setup-gate')).toHaveCount(0);
  }
});

test('REVISE returns notes the being reads verbatim', async ({ page }) => {
  await openDockApp(page, 'SOVEREIGNTY');
  const card = page.locator('[data-testid="sov-proposal"]', { hasText: 'Answer the hard question first' });
  await expect(card).toBeVisible();

  await card.locator('[data-testid="sov-revise"]').click();
  const notes = 'Name which questions count as hard — this is too broad to stand.';
  await card.locator('[data-testid="sov-notes"]').fill(notes);
  await card.locator('.sov-btn', { hasText: 'RETURN WITH NOTES' }).click();

  // The card leaves the queue and the record shows RETURNED — on echo, not hope.
  await expect(card).toHaveCount(0);
  await expect(page.locator('.sov-record-row', { hasText: 'RETURNED' })).toBeVisible();

  expect(page.__crashes).toEqual([]);
});

test('the ruling flows whole: full words → APPROVE stands law → RETRACT takes it down, recorded', async ({ page }) => {
  await openDockApp(page, 'SOVEREIGNTY');
  const card = page.locator('[data-testid="sov-proposal"]', { hasText: 'Carry plain speech as law' });
  await expect(card).toBeVisible();

  // Full disclosure — the exact words, never a preview.
  await expect(card.locator('[data-testid="sov-words"]')).toHaveText('I prefer plain speech over ornament (1).');
  await expect(card).toContainText('no clock runs');

  // APPROVE — believed only on the server echo: the card leaves the queue
  // and the SAME words appear as standing law.
  await card.locator('[data-testid="sov-approve"]').click();
  await expect(page.locator('[data-testid="sov-standing"]')).toContainText('I prefer plain speech over ornament (1).');
  await expect(page.locator('.sov-record-row', { hasText: 'APPLIED' })).toBeVisible();

  // RETRACT — confirm-gated, then law stops standing (still in the record).
  await page.locator('[data-testid="sov-retract"]').click();
  await page.locator('[data-testid="sov-retract-confirm"]').click();
  await expect(page.locator('[data-testid="sov-standing"]')).toHaveCount(0);

  expect(page.__crashes).toEqual([]);
});
