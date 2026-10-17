// THE OPERATOR'S EYE, in a real browser.
//
// The routes are proven live and the folds are proven pure; what is NOT proven
// by either is that the panel actually reaches the operator — renders under a
// real render, reads the real ledger, and lands a real grade from a click. That
// is what this spec is for, and it is the repo's law for any UI.
//
// Requires the desk stack on the ground that holds the proof lane:
//   WORKSPACES_PIN=env node --env-file=.env backend/server.js     (:3355)
//   npm run dev:frontend                                          (:7755)
// The wallet is the house key, which owns the lane the renders live in.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { ethers } from 'ethers';
import { openDockApp } from './helpers/dock.js';

const BACKEND = `http://localhost:${process.env.PORT || 3355}`;

const readClaudeWallet = () => {
  const text = readFileSync(new URL('../../claude.env', import.meta.url), 'utf8');
  const line = text.split('\n').find((l) => l.startsWith('CLAUDE_WALLET_PRIVATE_KEY='));
  return line.slice('CLAUDE_WALLET_PRIVATE_KEY='.length).trim();
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

// A being root that actually holds a forge render — the panel only exists for
// those, so a spec that opened any other tile would be asserting nothing.
const forgeRoot = async (token) => {
  const auth = { Authorization: `Bearer ${token}` };
  const { roots } = await (await fetch(`${BACKEND}/api/v1/gallery/roots`, { headers: auth })).json();
  for (const root of (roots || []).filter((r) => r.being)) {
    const { items } = await (await fetch(
      `${BACKEND}/api/v1/gallery/items?rootId=${encodeURIComponent(root.id)}`, { headers: auth },
    )).json();
    const render = (items || []).find((i) => /^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(i.name));
    if (render) return { root, render };
  }
  return null;
};

// The proof lane owes its custody acts, so the birth-setup gate rises over the
// desk and intercepts every pointer. Standing aside is the gate's own honest
// door — the acts remain owed; the desk becomes drivable. It can rise a beat
// AFTER the desk paints AND again once anchoring settles, so it is cleared
// both on landing and on the way into the gallery: a gate that returns between
// the two swallows the click and the failure reads as a fault that it isn't.
const standAside = async (page, timeout) => {
  const button = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
  if (await button.isVisible({ timeout }).catch(() => false)) {
    await button.click();
    await expect(page.locator('.birth-setup-gate')).toHaveCount(0);
  }
};

const openGallery = async (page) => {
  await openDockApp(page, 'GALLERY');
  await standAside(page, 2000);
};

let token;
let addr;
let found;
test.beforeAll(async () => {
  ({ token, addr } = await mintToken());
  found = await forgeRoot(token);
});

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    // The companion must be an INHABITED lane under the ACTIVE root, or the
    // desk holds at ANCHORING and never reaches the dock — correctly, it will
    // not invent a workspace. This ground's proof lane carries a true-name.
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'ComfyProof', neumaId: 'comfy-proof' }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr });
  await page.goto('/');
  await standAside(page, 15000);
});

test('GRADE: the operator judges a render, beside the being and never over it', async ({ page }) => {
  test.skip(!found, 'no being has made a forge render on this ground — nothing to judge');

  await openGallery(page);

  // Narrow to the being whose folder holds the render — […] (the roots rail is the roster of who made what).
  await page.locator('.gallery-root', { hasText: found.root.label }).first().click();

  const tile = page.locator('.gallery-tile', { hasText: found.render.name }).first();
  await expect(tile).toBeVisible({ timeout: 30000 });
  await tile.click();

  // THE PANEL — it renders only for a forge render, so its presence is itself
  // the join (root → lane, filename → image id) working end to end.
  const panel = page.locator('.verdict');
  await expect(panel).toBeVisible({ timeout: 30000 });

  // The ask is the anchor adherence is judged against; it must be READ from the
  // attempt log, not invented.
  await expect(panel.locator('.verdict-asked-text')).not.toBeEmpty();

  const rowsBefore = await panel.locator('.verdict-row').count();

  // The operator grades, in their own words.
  const note = `e2e ${Date.now()}`;
  await panel.locator('.verdict-input').fill(note);
  await panel.locator('.verdict-btn-keep').click();

  // The grade lands and the panel re-reads the ledger.
  await expect(panel.locator('.verdict-row', { hasText: note })).toBeVisible({ timeout: 30000 });
  expect(await panel.locator('.verdict-row').count()).toBe(rowsBefore + 1);

  // BESIDE, NEVER OVER: whatever the being had already said is still on screen,
  // unedited, under its own heading.
  const headings = await panel.locator('.verdict-standing-title').allTextContents();
  expect(headings.some((h) => /judged/i.test(h))).toBe(true);

  expect(page.__crashes, `page errors: ${page.__crashes.join(' | ')}`).toHaveLength(0);
});

test('a folder that is not a being\'s art carries no verdict panel', async ({ page }) => {
  test.skip(!found, 'no forge render on this ground');
  await openGallery(page);

  // The comfy OUTPUT root is raw engine output, not a being's recorded work: no
  // manifest row, no prompt behind it, nothing to judge adherence against.
  const raw = page.locator('.gallery-root', { hasText: /COMFY|OUTPUT/i }).first();
  const count = await raw.count();
  test.skip(count === 0, 'no comfy output root configured');
  await raw.click();

  const tile = page.locator('.gallery-tile').first();
  test.skip(await tile.count() === 0, 'comfy output root is empty');
  await tile.click();
  await expect(page.locator('.gallery-viewer')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.verdict')).toHaveCount(0);
});
