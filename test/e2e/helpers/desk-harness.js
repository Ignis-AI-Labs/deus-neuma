// @ts-check
import { test } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { claimOwner } from '../../helpers/claim-owner.js';
import { passDeskGates } from './desk-gates.js';

/**
 * Shared harness for the desk e2e specs (test/e2e/desk*.spec.js) — drives the
 * real browser through the post-birth work hub against the real backend. Auth
 * is REAL: a session token is minted via the backend's challenge-sign-verify
 * using Claude's witness wallet, then injected so the app lands on the relink
 * desk. No mocked data paths (per the no-mock rule) — every assertion rides
 * the real API/WS/filesystem.
 *
 * Requires the dev stack (:7777 / :3333) running.
 *
 * Each spec file calls `setupDesk()` at module scope and reads `token`/`addr`
 * as live bindings — the beforeAll assigns them before any test runs.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(__dirname, '../../..');
export const BACKEND = `http://localhost:${process.env.PORT || 3333}`;

const readClaudeWallet = () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  return pk;
};

// Real session token via the backend's challenge-sign-verify.
export const mintToken = async () => {
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

export let token;
export let addr;
let seededLane = null;

export const setupDesk = () => {
  test.beforeAll(async () => {
    ({ token, addr } = await mintToken());
    // Start from a clean project slate: a prior (or killed) run's ACTIVE project
    // would auto-focus its folder and perturb the FILES test. The test wallet is
    // used only by this suite, so clearing its projects is safe + deterministic.
    const { projects } = await (await fetch(`${BACKEND}/api/v1/user/projects`, { headers: { Authorization: `Bearer ${token}` } })).json();
    await Promise.all((projects || []).map((p) =>
      fetch(`${BACKEND}/api/v1/user/projects/${p.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })));

    // The arrival veil HOLDS (full-viewport, pointer-eating, by design) when
    // the bound companion has no lane under the ACTIVE root — so the synthetic
    // companion must have a REAL claimed lane or every dock click in this
    // suite dies against the veil. Root from the platform's own truth (the
    // persisted root can differ from .env); torn down in afterAll. The lane is
    // owned by the TEST wallet, so no operator roster ever shows it.
    const sec = await (await fetch(`${BACKEND}/api/v1/security/status`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const activeRoot = sec?.roots?.active;
    if (activeRoot) {
      await claimOwner(activeRoot, 'e2e-desk', addr);
      seededLane = path.join(activeRoot, 'e2e-desk');
    }
  });

  test.afterAll(async () => {
    // Leave the operator's root as found — the synthetic lane holds no being.
    if (seededLane) await fs.promises.rm(seededLane, { recursive: true, force: true });
  });

  // Land directly on the relink desk with a real session + a companion (needed
  // for initialPhase()). FILES/TERMINAL are wallet-scoped, not neuma-scoped.
  test.beforeEach(async ({ page }) => {
    // Track real JS exceptions (pageerrors). Resource 404s are not crashes — a
    // synthetic test companion has no workspace, so its history fetch 404s.
    const crashes = [];
    page.on('pageerror', (e) => crashes.push(e.message));
    page.__crashes = crashes;
    await page.addInitScript(({ t, a }) => {
      const w = a.toLowerCase();
      localStorage.setItem('walletAddress', a);
      localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: 'e2e-desk' }));
      sessionStorage.setItem('authToken', t);
    }, { t: token, a: addr });
    await page.goto('/');
    // A synthetic companion owes its custody acts and its founding words, so
    // the gates rise over the desk and intercept every pointer.
    await passDeskGates(page, 5000);
  });
};
