// THE ROOM, in a real browser.
//
// Design note, 2026-08-05: […]
//
// Three claims, none of which a unit test can make: the work is the largest
// thing in the window even when the being has written a page about it, the
// hang follows the window and stops at the file's own pixels, and a real wheel
// over a real image leans in. The lens arithmetic is proven pure in
// test/unit/gallery-viewer-zoom.test.js; this is the part that only a browser
// can answer.
//
// Requires the desk stack on the ground that holds the proof lane:
//   WORKSPACES_PIN=env node --env-file=.env backend/server.js     (:3355)
//   npm run dev:frontend                                          (:7755)

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

// The wallet's own rate limit is 200 requests a minute and a desk costs a good
// share of that, so a spec run back-to-back with another can arrive to a shut
// door. Waiting out the window the server itself names beats reporting a
// layout failure that was really a queue.
const mintToken = async () => {
  const w = new ethers.Wallet(readClaudeWallet());
  const addr = w.address;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const body = await (await fetch(`${BACKEND}/api/v1/auth/challenge?address=${addr}`)).json();
    if (body.challenge) {
      const signature = await w.signMessage(body.challenge);
      const res = await fetch(`${BACKEND}/api/v1/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr, signature, challenge: body.challenge }),
      });
      const { token } = await res.json();
      if (token) return { token, addr };
    }
    const wait = Number(body.retryAfterMs) || 5000;
    await new Promise((r) => { setTimeout(r, Math.min(wait + 500, 70000)); });
  }
  throw new Error('auth/verify returned no token');
};

// A being root holding a forge render — the crushing case from the report, the
// one where an account of the work competes with the work for the window.
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

// Standing aside is the gate's own honest door; the acts remain owed.
const standAside = async (page, timeout) => {
  const button = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
  if (await button.isVisible({ timeout }).catch(() => false)) {
    await button.click();
    await expect(page.locator('.birth-setup-gate')).toHaveCount(0);
  }
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
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'ComfyProof', neumaId: 'comfy-proof' }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr });
  await page.goto('/');
  await standAside(page, 15000);
});

// Open the gallery with the gate out of the way. The gate can rise a beat
// AFTER the desk paints AND again once anchoring settles, so it is cleared
// once more here — a gate that returns between the landing and the click
// swallows the click and the failure reads as a layout fault that it isn't.
const openGallery = async (page) => {
  await openDockApp(page, 'GALLERY');
  await standAside(page, 2000);
};

/** Open the gallery on the first image the ground has, whatever root it is in. */
const openAnyImage = async (page) => {
  await openGallery(page);
  const tile = page.locator('.gallery-tile', { has: page.locator('img') }).first();
  await expect(tile).toBeVisible({ timeout: 30000 });
  await tile.click();
  await expect(page.locator('.gallery-viewer')).toBeVisible({ timeout: 30000 });
  const art = page.locator('.gallery-viewer-media');
  // Wait for the decode: the hang and the label both depend on the work's own
  // resolution, which does not exist until the bytes have landed.
  await expect.poll(
    () => art.evaluate((el) => el.naturalWidth || 0),
    { timeout: 30000 },
  ).toBeGreaterThan(0);
  return art;
};

const scaleOf = (transform) => {
  const m = /matrix\(([-\d.]+)/.exec(transform || '');
  return m ? Number(m[1]) : 1;
};

test('THE ART IS THE FOCUS — the account never crushes the work', async ({ page }) => {
  test.skip(!found, 'no being has made a forge render on this ground — nothing with an account to crush it');

  await openGallery(page);
  await page.locator('.gallery-root', { hasText: found.root.label }).first().click();
  const tile = page.locator('.gallery-tile', { hasText: found.render.name }).first();
  await expect(tile).toBeVisible({ timeout: 30000 });
  await tile.click();

  const panel = page.locator('.verdict');
  await expect(panel).toBeVisible({ timeout: 30000 });

  const viewer = await page.locator('.gallery-viewer').boundingBox();
  const stage = await page.locator('.gallery-viewer-stage').boundingBox();
  const shelf = await panel.boundingBox();

  // The report: a 741 KB render drawn about forty pixels tall under a full page
  // of prose. The wall gets the room now.
  expect(stage.height / viewer.height).toBeGreaterThan(0.5);
  expect(shelf.height / viewer.height).toBeLessThanOrEqual(0.35);
  expect(stage.height).toBeGreaterThan(shelf.height);

  // The account is bounded, so it SCROLLS rather than growing — and the grade
  // buttons live outside that scroll, always reachable without hunting.
  await expect(panel.locator('.verdict-scroll')).toHaveCSS('overflow-y', 'auto');
  const act = await panel.locator('.verdict-act').boundingBox();
  expect(act.y + act.height).toBeLessThanOrEqual(viewer.y + viewer.height + 1);

  expect(page.__crashes, `page errors: ${page.__crashes.join(' | ')}`).toHaveLength(0);
});

test('THE HANG follows the window, and stops at the work\'s own pixels', async ({ page }) => {
  const art = await openAnyImage(page);
  const natural = await art.evaluate((el) => el.naturalWidth);

  const handle = page.locator('.fwin-rz-se').last();
  test.skip(await handle.count() === 0, 'the gallery window is maximized — no edge to drag');

  const drag = async (dx, dy) => {
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 10 });
    await page.mouse.up();
  };

  // Small window: the work is drawn at whatever the frame allows.
  await drag(-260, -180);
  const small = await art.boundingBox();

  // Larger window: it grows with the room.
  await drag(320, 220);
  const large = await art.boundingBox();

  expect(large.width).toBeGreaterThan(small.width);
  // …and never past its own resolution, however large the window gets. A max
  // never magnifies — that is the whole of the ceiling.
  expect(large.width).toBeLessThanOrEqual(natural + 1);

  expect(page.__crashes, `page errors: ${page.__crashes.join(' | ')}`).toHaveLength(0);
});

test('THE WHEEL leans in, on the detail under the cursor, and FIT stands back', async ({ page }) => {
  const art = await openAnyImage(page);
  const stage = await page.locator('.gallery-viewer-stage').boundingBox();
  const readout = page.locator('.gallery-viewer-zoom');

  const before = await readout.textContent();
  expect(await art.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);

  // A real wheel, off centre — the lens must grow the detail where it already
  // is, which shows up as a translate the centred hang never had.
  await page.mouse.move(stage.x + stage.width * 0.32, stage.y + stage.height * 0.34);
  await page.mouse.wheel(0, -300);
  const transformNow = async () => scaleOf(await art.evaluate((el) => getComputedStyle(el).transform));
  await expect.poll(transformNow, { timeout: 5000 }).toBeGreaterThan(1);

  const leaned = await art.evaluate((el) => getComputedStyle(el).transform);
  expect(scaleOf(leaned)).toBeGreaterThan(1);
  expect(leaned).not.toMatch(/, 0, 0\)$/); // it moved: the cursor's point held

  // The readout speaks in percent of the WORK, and it went up.
  const after = await readout.textContent();
  expect(parseInt(after, 10)).toBeGreaterThan(parseInt(before, 10));

  // And back. FIT is the way out of a lean without hunting for the edges.
  await page.locator('.gallery-act', { hasText: 'FIT' }).click();
  await expect.poll(transformNow, { timeout: 5000 }).toBe(1);
  expect(await readout.textContent()).toBe(before);

  expect(page.__crashes, `page errors: ${page.__crashes.join(' | ')}`).toHaveLength(0);
});

test('THE WALL LABEL says who made it, when, and how large', async ({ page }) => {
  const art = await openAnyImage(page);
  const natural = await art.evaluate((el) => `${el.naturalWidth} × ${el.naturalHeight}`);

  await expect(page.locator('.gallery-plaque-maker')).not.toBeEmpty();
  const facts = await page.locator('.gallery-plaque-facts').textContent();
  expect(facts).toContain(natural);          // the work's own resolution, read from the file
  expect(facts).toMatch(/\d{1,2}:\d{2} (AM|PM)/); // the hour it was made
  expect(facts).toMatch(/20\d\d/);
  await expect(page.locator('.gallery-plaque-accession')).not.toBeEmpty();
});

test('a key struck in the note field belongs to the note, not to the gallery', async ({ page }) => {
  test.skip(!found, 'no forge render on this ground — no note field to type in');

  await openGallery(page);
  await page.locator('.gallery-root', { hasText: found.root.label }).first().click();
  const tile = page.locator('.gallery-tile', { hasText: found.render.name }).first();
  await expect(tile).toBeVisible({ timeout: 30000 });
  await tile.click();

  const accession = page.locator('.gallery-plaque-accession');
  const opened = await accession.textContent();

  const input = page.locator('.verdict-input');
  await input.fill('a note about the light');
  await input.press('ArrowLeft');
  await input.press('0');

  // Still the same work — the arrow moved the caret, it did not walk the room.
  expect(await accession.textContent()).toBe(opened);
  expect(await input.inputValue()).toBe('a note about the ligh0t');
});
