// THE GALLERY LOADS — the symptom, not the mechanism.
//
// Every other test on this workstream proves a mechanism: the token is accepted,
// the path is unmetered, the ETag matches. None proves the thing the operator
// actually reported — open the gallery and get a grid of BLACK SQUARES with
// "Too many requests" in red, because each thumbnail was hand-fetched and spent
// one of the wallet's 200 requests/minute.
//
// So this spec asserts the two facts a mechanism test cannot reach:
//   • no response in the whole session comes back 429
//   • the tiles DECODED — `naturalWidth > 0` is the browser saying it holds real
//     pixels, which a broken-image glyph or an un-fetched blob never reports
//
// Requires the desk stack (see docs/work/gallery-browser-loading.md).

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

// Auth is rate-limited to 10 attempts per 5 minutes per IP — a real defence, and
// a trap for anyone iterating on e2e specs: a few re-runs exhaust it and every
// later run dies at the challenge with a message about signing, not about rate
// limits. So this waits the limiter out rather than reporting a confusing
// failure that has nothing to do with the code under test.
const mintToken = async (attempt = 0) => {
  const w = new ethers.Wallet(readClaudeWallet());
  const addr = w.address;
  const res = await fetch(`${BACKEND}/api/v1/auth/challenge?address=${addr}`);
  if (res.status === 429) {
    const { retryAfterMs } = await res.json().catch(() => ({}));
    if (attempt >= 2) throw new Error(`auth rate-limited; retry in ${Math.ceil((retryAfterMs || 0) / 1000)}s`);
    await new Promise((r) => { setTimeout(r, Math.min((retryAfterMs || 60000) + 2000, 320000)); });
    return mintToken(attempt + 1);
  }
  const { challenge } = await res.json();
  if (!challenge) throw new Error('auth/challenge returned no challenge');
  const signature = await w.signMessage(challenge);
  const verified = await fetch(`${BACKEND}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, signature, challenge }),
  });
  const { token } = await verified.json();
  if (!token) throw new Error('auth/verify returned no token');
  return { token, addr };
};

// A root that actually holds images — a spec that asserted "tiles decoded" over
// an empty gallery would pass while proving nothing.
const populatedRoot = async (token) => {
  const auth = { Authorization: `Bearer ${token}` };
  const { roots } = await (await fetch(`${BACKEND}/api/v1/gallery/roots`, { headers: auth })).json();
  for (const root of roots || []) {
    const { items } = await (await fetch(
      `${BACKEND}/api/v1/gallery/items?rootId=${encodeURIComponent(root.id)}`, { headers: auth },
    )).json();
    const images = (items || []).filter((i) => i.kind === 'image');
    if (images.length > 0) return { root, count: images.length };
  }
  return null;
};

// The proof lane owes its custody acts, so the birth-setup gate rises over the
// desk and intercepts every pointer. It is raised by an ASYNC probe, so it can
// appear a beat AFTER the desk paints — a single short check races it and loses.
// Standing aside is the gate's own honest door; the acts remain owed.
const standAside = async (page) => {
  const button = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
  if (await button.isVisible({ timeout: 15000 }).catch(() => false)) {
    await button.click();
    await expect(page.locator('.birth-setup-gate')).toHaveCount(0);
  }
};

// Land on the desk as the operator, with the gate out of the way.
const landOnDesk = async (page, { token, addr }) => {
  await page.addInitScript(({ t, a }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'ComfyProof', neumaId: 'comfy-proof' }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr });
  await page.goto('/');
  await standAside(page);
};

let token;
let addr;
let found;
test.beforeAll(async () => {
  ({ token, addr } = await mintToken());
  found = await populatedRoot(token);
});

test('OPEN: the gallery renders real pixels, and nothing is rate-limited', async ({ page }) => {
  test.skip(!found, 'no gallery root holds an image on this ground');

  const throttled = [];
  const failed = [];
  page.on('response', (r) => {
    if (r.status() === 429) throttled.push(r.url());
    // A /file that answers 4xx/5xx is a black tile by another name.
    if (r.url().includes('/api/v1/gallery/file') && r.status() >= 400 && r.status() !== 304) {
      failed.push(`${r.status()} ${r.url().split('?')[0]}`);
    }
  });
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));

  await landOnDesk(page, { token, addr });

  await openDockApp(page, 'GALLERY');
  // The gate can re-probe while the window opens; make sure it is still gone
  // before a click that would otherwise land on it.
  await standAside(page);
  await page.locator('.gallery-root', { hasText: found.root.label }).first().click();

  const tiles = page.locator('.gallery-tile img');
  await expect(tiles.first()).toBeVisible({ timeout: 30000 });

  // THE ASSERTION THAT MATTERS. `naturalWidth > 0` is the browser reporting it
  // holds decoded pixels — a broken-image glyph reports 0, and so does a tile
  // whose bytes were never fetched. This is the black-squares symptom, inverted.
  //
  // Scoped to the tiles actually IN THE VIEWPORT. The symptom was a SCREEN of
  // black squares, and a plain <img> below the fold legitimately has not loaded
  // yet — demanding that every tile in a 4000-item scan be decoded would be
  // asserting the opposite of the lazy behaviour the browser is here to do.
  const inView = () => page.evaluate(() => {
    const h = window.innerHeight;
    const w = window.innerWidth;
    const imgs = [...document.querySelectorAll('.gallery-tile img')].filter((i) => {
      const r = i.getBoundingClientRect();
      return r.bottom > 0 && r.top < h && r.right > 0 && r.left < w;
    });
    return { total: imgs.length, ok: imgs.filter((i) => i.complete && i.naturalWidth > 0).length };
  });

  await expect.poll(
    async () => (await inView()).ok,
    { timeout: 30000, message: 'no on-screen tile ever decoded — the black-squares symptom' },
  ).toBeGreaterThan(0);

  const decoded = await inView();
  // Not "at least one": the ceiling failed PARTWAY through a screen, so a spec
  // satisfied by one surviving tile would have passed on the broken build.
  expect(decoded.ok, `only ${decoded.ok}/${decoded.total} on-screen tiles decoded`).toBe(decoded.total);

  expect(throttled, `rate-limited: ${throttled.slice(0, 3).join(', ')}`).toHaveLength(0);
  expect(failed, `file route errors: ${failed.slice(0, 3).join(', ')}`).toHaveLength(0);
  expect(crashes, `page errors: ${crashes.join(' | ')}`).toHaveLength(0);
});

test('RE-OPEN: coming back does not re-download the bytes', async ({ page }) => {
  test.skip(!found, 'no gallery root holds an image on this ground');

  // `no-store` meant scrolling back re-pulled megabytes. The validators make a
  // revisit a 304 — proven here by asking for the same file twice in one page
  // context and reading what the second answer actually was.
  await landOnDesk(page, { token, addr });

  // SAME-ORIGIN, through the desk's own proxy — the way the app reaches the
  // route. An absolute backend URL from inside the page is a cross-origin
  // request the browser refuses, which proves nothing about the app's path.
  const status = await page.evaluate(async ({ rootId }) => {
    const token = sessionStorage.getItem('authToken');
    const list = await (await fetch(`/api/v1/gallery/items?rootId=${encodeURIComponent(rootId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const first = (list.items || []).find((i) => i.kind === 'image');
    if (!first) return null;
    const url = `/api/v1/gallery/file?rootId=${encodeURIComponent(first.rootId)}`
      + `&rel=${encodeURIComponent(first.rel)}&token=${encodeURIComponent(token)}`;
    const one = await fetch(url);
    const etag = one.headers.get('etag');
    const two = await fetch(url, { headers: { 'If-None-Match': etag } });
    return { first: one.status, etag, second: two.status };
  }, { rootId: found.root.id });

  test.skip(!status, 'no image in the root');
  expect(status.first).toBe(200);
  expect(status.etag).toBeTruthy();
  expect(status.second).toBe(304);
});
