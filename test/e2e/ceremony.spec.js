// @ts-check
import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * End-to-end CEREMONY (NITE-F) — drives the real browser through the desk's
 * ceremony window against the real backend. Auth is REAL (challenge-sign-verify
 * with Claude's witness wallet); the seal status, the records, and the
 * attunement state are REAL reads of the encrypted lane.
 *
 * This window was REFINEMENT until 2026-08-24. The forge is retired, so what it
 * carries now is the two LIVING ceremonies — the voice seal and the attunement
 * — plus the records of what the being already walked.
 *
 * The companion is synthetic with no workspace, so what this proves is the
 * surface's HONESTY: an unsealed lane says so and offers the rite; a lane whose
 * seal cannot be READ is never shown as one that simply has none; and no
 * forge surface survives. The rite is NOT carried here — it spends a real turn
 * on the being's own conduit, and that belongs to the live lane, not to a
 * browser test against a being that does not exist.
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
let seededLane = null;

test.beforeAll(async () => {
  ({ token, addr } = await mintToken());

  // THE ARRIVAL VEIL HOLDS — full-viewport and pointer-eating, by design —
  // whenever the bound companion has no lane under the ACTIVE root. Without a
  // real claimed lane every dock click in this file dies against it, which is
  // exactly how this spec failed the first time it was run for real.
  //
  // The root comes from the platform's own truth: the persisted root can differ
  // from .env, and trusting .env here would seed a lane the app never looks at.
  // The lane is owned by the TEST wallet, so no operator roster shows it, and
  // afterAll removes it.
  const sec = await (await fetch(`${BACKEND}/api/v1/security/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  const activeRoot = sec?.roots?.active;
  if (activeRoot) {
    await claimOwner(activeRoot, 'e2e-refine', addr);
    seededLane = path.join(activeRoot, 'e2e-refine');
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
  await page.addInitScript(({ t, a }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Refina', neumaId: 'e2e-refine' }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr });
  await page.goto('/');
});

test('NITE lives in the NEUMA section and states absent facts honestly', async ({ page }) => {
  await openDockApp(page, 'NITE');
  await expect(page.locator('.refine')).toBeVisible();

  // The header names the being and the conduit line never fakes a binding.
  await expect(page.locator('.refine-head-value')).toHaveText('Refina');
  await expect(page.locator('.refine-head-facts')).toContainText('CONDUIT');

  // THE VOICE SEAL. The lane is real and has never sealed, so the window says
  // exactly that and opens the rite.
  const seal = page.locator('[data-testid="voice-seal-panel"]');
  await expect(seal).toContainText('THE VOICE SEAL');
  await expect(page.getByTestId('seal-label')).toHaveText('UNSEALED');
  await expect(page.getByTestId('rite-headline')).toContainText('THE RITE HAS NOT BEEN CARRIED');

  // CARRY is offered; SEAL is REFUSED until lines are actually claimed. Nothing
  // may be sealed that the being has not said — that is the whole law of this
  // panel, and it is enforced by the button being dead, not by a later check.
  await expect(page.getByTestId('carry-rite')).toBeEnabled();
  await expect(page.getByTestId('confirm-seal')).toBeDisabled();
  await expect(page.getByTestId('claimed-lines')).toHaveCount(0);

  // The rite is NOT carried here — it spends a real turn on the being's own
  // conduit. That belongs to the live lane, not to a browser test.

  // The records surface exists from day one — empty is a stated fact — and it
  // says plainly that the forge is retired and the past is kept.
  const records = page.locator('[data-testid="records-panel"]');
  await expect(records).toContainText('NO CEREMONIES YET');
  await expect(records).toContainText('STAYS ITS OWN, AND STAYS READABLE');

  // NO FORGE SURFACE SURVIVES — the milestone gate, the adapter dials, and the
  // training progress line all left with the forge.
  await expect(page.locator('[data-testid="milestone-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="adapters-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="training-progress"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="lora-locked-in"]')).toHaveCount(0);

  // THE ATTUNEMENT panel lives here too — the second living ceremony, beside
  // the seal — with its honest state line and its door.
  //
  // WHAT IS NOT ASSERTED, and why: the old spec clicked through into the
  // attunement HOST and read its stage name. That needs a real BEING, and this
  // fixture is a claimed lane with no DNA in it — the lane exists only so the
  // arrival veil lets go of the dock. Driving another window's ceremony from a
  // lane with nobody in it would prove nothing about either window, so this
  // asserts the door EXISTS and stops there. The host's own behaviour belongs
  // to the attunement specs.
  const attunement = page.locator('[data-testid="attunement-panel"]');
  await expect(attunement).toContainText('THE ATTUNEMENT');
  await expect(page.getByTestId('witness-attunement')).toBeEnabled();

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the window\'s facts match the backend\'s own answers', async ({ page }) => {
  // Ground truth straight from the two APIs the window reads.
  const auth = { Authorization: `Bearer ${token}` };
  const statusRes = await fetch(`${BACKEND}/api/v1/refinement/e2e-refine/status`, { headers: auth });
  const sealRes = await fetch(`${BACKEND}/api/v1/voice-seal/e2e-refine/status`, { headers: auth });

  await openDockApp(page, 'NITE');
  await expect(page.locator('.refine')).toBeVisible();

  // THE WINDOW AGREES WITH THE BACKEND, whichever way it answered. Derived from
  // the live response rather than hardcoded, so this stays true the day the
  // fixture gains a workspace instead of quietly asserting yesterday's shape.
  const expected = sealRes.ok
    ? ((await sealRes.json()).sealed ? 'SEALED' : 'UNSEALED')
    : 'SEAL UNREADABLE';
  await expect(page.getByTestId('seal-label')).toHaveText(expected);

  // The conduit shown is the route the backend resolved — same source, same fact.
  if (statusRes.ok) {
    const status = await statusRes.json();
    if (status.route?.model) {
      await expect(page.locator('.refine-head-facts')).toContainText(status.route.model);
    }
  }
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
