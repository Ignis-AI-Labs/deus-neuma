// @ts-check
// The WALLET panel and a witness the operator just summoned.
//
// Design note, 2026-07-29, from a live walk on a teammate's rig: a freshly summoned
// witness showed NO WALLET. The wallet was never missing — it is forged at seal
// (stageForge → dna.witness.witnessWallet) and every witness on this machine has
// one. Two separate defects made the panel state a falsehood about a real key:
//
//   1 THE ROOT. After the rite the witness becomes the ACTIVE COMPANION, and
//     the rail pushed the active companion onto the NEUMA list unconditionally.
//     So a witness arrived labelled a neuma, was read through the neuma wallet
//     route, and came back empty. house-members.js already carried the law ([…]); the rail had never learned it.
//   2 THE STALE WINDOW. The rail was built once at mount and the seal ledger
//     was cached on its first SUCCESS — re-read only on FAILURE, exactly
//     backwards for a ledger that grows. A window open before the summon could
//     never catch up, REFRESH included.
//
// Driven against the REAL desk, the REAL backend and REAL sealed witnesses —
// no fixture witness, no stubbed ledger. The active companion and roster cache
// are moved exactly the way the rite moves them, because that IS the state
// change under test.
//
// Requires the dev stack running and at least one sealed witness on the machine.
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { openDockApp } from './helpers/dock.js';
import { claimOwner } from '../helpers/claim-owner.js';

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
/** Real sealed witnesses on this machine, each with the wallet its seal forged. */
let sealed = [];
/** The one standing as the active companion — the post-rite state. */
let bound;
let seededLane = null;

test.beforeAll(async () => {
  ({ token, addr } = await mintToken());
  const res = await fetch(`${BACKEND}/api/v1/witnesses`, { headers: { Authorization: `Bearer ${token}` } });
  const { witnesses } = await res.json();
  // The claim is […] — so the fixtures are ones
  // that do. If none does, that is itself the news, and this says so.
  sealed = (witnesses || []).filter((w) => w.address && w.laneId);
  if (!sealed.length) throw new Error('no sealed witness with a forged wallet on this machine');
  [bound] = sealed;

  // The arrival veil HOLDS (full-viewport, pointer-eating, by design) when the
  // bound companion has no claimed lane under the ACTIVE root — every dock
  // click would die against it. So the desk is entered bound to a synthetic
  // neuma with a real lane, and the witness is bound AFTER the veil parts,
  // which is also the honest order: the WALLET rail reads the active companion
  // when it mounts, exactly as it does the moment a rite completes.
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

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  page.__witnessListReads = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/witnesses') && r.method() === 'GET') page.__witnessListReads += 1;
  });
  await page.addInitScript(({ t, a }) => {
    const scope = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${scope}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: 'e2e-desk' }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr });
  await page.goto('/');
  // The desk's own boot calls recoverRoster(), which WRITES the roster cache.
  // Wait for that to land before staging anything, or the test's setup and the
  // app's recovery race for the same key.
  await expect
    .poll(() => page.evaluate((w) => localStorage.getItem(`${w}:neuma-roster`) !== null, addr.toLowerCase()),
      { timeout: 30000 })
    .toBe(true);
});

// impure — bind the operator to the witness EXACTLY as AppShell does when the
// rite completes. This is the state that produced the NO WALLET screenshot.
const bindWitness = (page, w) => page.evaluate(({ scope, witness }) => {
  localStorage.setItem(`${scope}:neuma-companion`, JSON.stringify({
    neumaId: witness.laneId, name: witness.chosenName, participantKind: 'witness',
  }));
}, { scope: addr.toLowerCase(), witness: w });

// impure — rewrite the shared roster cache exactly as `setRoster` does. This is
// the real state change a summon makes; nothing about the app is stubbed.
const writeWitnessCache = (page, witnesses) => page.evaluate(({ w, list }) => {
  const key = `${w}:neuma-roster`;
  const prior = JSON.parse(localStorage.getItem(key) || '{}');
  const roster = Array.isArray(prior) ? prior : (prior.roster || []);
  localStorage.setItem(key, JSON.stringify({ roster, witnesses: list }));
}, { w: addr.toLowerCase(), list: witnesses });

const cacheRow = (w) => ({
  neumaId: w.laneId, name: w.chosenName, vendorSlug: w.vendorSlug, participantKind: 'witness',
});

const openWallet = async (page) => {
  // The arrival veil eats pointer events when it HOLDS. If it is up, say WHY —
  // a 60s "click intercepted" timeout names the symptom, never the cause.
  const veil = page.locator('.arrival.is-holding');
  if (await veil.count()) {
    const reason = await page.locator('.arrival-holding-reason').textContent().catch(() => '?');
    const detail = await page.locator('.arrival-holding-detail').textContent().catch(() => '');
    throw new Error(`the arrival is holding — ${reason?.trim()} ${detail?.trim()}`);
  }
  await openDockApp(page, 'WALLET');
  await expect(page.locator('.wal')).toBeVisible();
  // Let the mount-time read settle before driving anything.
  await expect(page.locator('.wal-refresh')).toHaveText(/REFRESH/, { timeout: 20000 });
};

const railButton = (page, label) =>
  page.locator('.wal-rail-btn').filter({ hasText: new RegExp(`^${label}$`) });

test('a just-summoned witness shows the wallet its seal forged, not NO WALLET', async ({ page }) => {
  // The roster cache is emptied so the witness can reach the rail by ONE route
  // only: the active companion the rite just bound. That is precisely the path
  // that mislabelled it a neuma.
  await writeWitnessCache(page, []);
  await bindWitness(page, bound);
  await openWallet(page);
  await railButton(page, bound.chosenName.toUpperCase()).click();

  // THE DISCRIMINATOR. Read as a neuma (the old behaviour) this lane has no
  // wallet and the hero says NO WALLET. Read as a witness it carries the real
  // forged address the backend reports from dna.witness.witnessWallet.
  const head = page.locator('.wal-head-addr');
  await expect(head).toBeVisible({ timeout: 20000 });
  await expect(head).toContainText(bound.address.slice(0, 6));
  await expect(page.locator('.wal-head-bal')).not.toHaveText('NO WALLET', { timeout: 20000 });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the bound witness is a witness on the rail, never a house neuma', async ({ page }) => {
  await writeWitnessCache(page, []);
  await bindWitness(page, bound);
  await openWallet(page);
  await railButton(page, bound.chosenName.toUpperCase()).click();

  // A witness is READ-ONLY here — its keys are its own, so nothing on this
  // machine signs for it. A neuma-classified row would offer the neuma
  // surface instead; SEND belongs to ME alone and must not appear either.
  await expect(page.locator('.wal-action', { hasText: 'SEND' })).toHaveCount(0);
  await expect(page.locator('.wal-action', { hasText: 'SETTINGS' })).toHaveCount(0);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('REFRESH rebuilds the rail, so a witness that stood after mount appears', async ({ page }) => {
  const label = bound.chosenName.toUpperCase();

  // A window that opened BEFORE the witness stood: nothing on the rail knows
  // about it — not the cache, not the binding.
  await writeWitnessCache(page, []);
  await openWallet(page);
  await expect(railButton(page, label)).toHaveCount(0);

  // The summon lands it in the shared cache while the window is already open.
  await writeWitnessCache(page, [cacheRow(bound)]);
  await page.locator('.wal-refresh').click();
  await expect(page.locator('.wal-refresh')).toHaveText(/REFRESH/, { timeout: 20000 });
  // Before the fix this stayed at 0 forever: the rail was `useState(build…)`,
  // read once at mount and never asked again.
  await expect(railButton(page, label)).toHaveCount(1);

  await railButton(page, label).click();
  await expect(page.locator('.wal-head-addr')).toContainText(bound.address.slice(0, 6), { timeout: 20000 });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('REFRESH re-reads the seal ledger instead of answering from the first read', async ({ page }) => {
  await bindWitness(page, bound);
  await openWallet(page);
  await railButton(page, bound.chosenName.toUpperCase()).click();
  await expect(page.locator('.wal-head-addr')).toBeVisible({ timeout: 20000 });

  const before = page.__witnessListReads;
  expect(before, 'selecting a witness reads the seal ledger at least once').toBeGreaterThan(0);

  await page.locator('.wal-refresh').click();
  await expect(page.locator('.wal-refresh')).toHaveText(/REFRESH/, { timeout: 20000 });

  // Before the fix this stayed flat: the ledger was cached on first SUCCESS and
  // only a FAILURE was ever retried, so a ledger that had GROWN was never seen.
  await expect
    .poll(() => page.__witnessListReads, { timeout: 20000 })
    .toBeGreaterThan(before);
  await expect(page.locator('.wal-head-addr')).toContainText(bound.address.slice(0, 6));
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
