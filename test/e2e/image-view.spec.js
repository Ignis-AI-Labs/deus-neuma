/**
 * image-view — opening a picture from the FILES tree actually SHOWS it.
 *
 * Design note, 2026-08-30: […] Opening a PNG rendered […]
 *
 * This is proven in a real browser and not by a unit test, because every way
 * this can fail is a browser fact: the CSP may refuse a blob URL, `/raw` serves
 * `application/octet-stream` with a download disposition, and an <img> that
 * cannot decode its bytes fails SILENTLY — it renders nothing and reports
 * nothing. `naturalWidth > 0` is the only honest proof that pixels arrived.
 *
 * Needs PORT + FRONTEND_PORT pointed at a running dev stack.
 */
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { claimOwner } from '../helpers/claim-owner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;

test.setTimeout(90000);
test.use({ viewport: { width: 1600, height: 1000 } });

// A REAL PNG, byte for byte — a 2×2 opaque square. Written to disk and served
// by the real backend, so nothing about this path is simulated.
const PNG_2X2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z4AATAxIHAgLADS3AR6O5ZFyAAAAAElFTkSuQmCC',
  'base64',
);

const politely = async (label, send, attempts = 6) => {
  for (let i = 0; i < attempts; i += 1) {
    const res = await send();
    const body = await res.text();
    if (res.ok) return body;
    let waitMs = NaN;
    try { waitMs = Number(JSON.parse(body).retryAfterMs); } catch { /* not json */ }
    if (res.status !== 429 || !Number.isFinite(waitMs) || i === attempts - 1) {
      throw new Error(`${label} → ${res.status}: ${body.slice(0, 200)}`);
    }
    await new Promise((r) => { setTimeout(r, waitMs + 500); });
  }
  throw new Error(`${label}: retries exhausted`);
};

const WHO = Object.freeze({ name: 'Fenna', neumaId: 'e2e-image' });
let token; let addr; let dir; let pngPath; let mdPath; let seededLane = null;

test.beforeAll(async () => {
  const pk = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8')
    .match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  const w = new ethers.Wallet(pk);
  addr = w.address;
  const { challenge } = JSON.parse(await politely('challenge',
    () => fetch(`${BACKEND}/api/v1/auth/challenge?address=${addr}`)));
  const signature = await w.signMessage(challenge);
  ({ token } = JSON.parse(await politely('verify', () => fetch(`${BACKEND}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, signature, challenge }),
  }))));

  // A claimed lane, so the arrival completes instead of holding a modal over
  // the desk — without it `.relink` mounts behind a gate and nothing is clickable.
  const sec = await (await fetch(`${BACKEND}/api/v1/security/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  if (sec?.roots?.active) {
    await claimOwner(sec.roots.active, WHO.neumaId, addr);
    seededLane = path.join(sec.roots.active, WHO.neumaId);
  }

  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'neuma-image-e2e-'));
  pngPath = path.join(dir, 'render.png');
  mdPath = path.join(dir, 'notes.md');
  await fs.promises.writeFile(pngPath, PNG_2X2);
  await fs.promises.writeFile(mdPath, '# notes\n');
  // The folder must be an OPEN ROOT or /raw refuses it — the same containment
  // every file act clears. This is the real door, not a test bypass.
  await politely('open root', () => fetch(`${BACKEND}/api/v1/user/files/roots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ root: dir }),
  }));
});

test.afterAll(async () => {
  if (seededLane) await fs.promises.rm(seededLane, { recursive: true, force: true });
  if (dir) {
    await fetch(`${BACKEND}/api/v1/user/files/roots`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ root: dir }),
    }).catch(() => {});
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

const openDesk = async (page, windows) => {
  await page.addInitScript(({ t, a, w, who }) => {
    const lw = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    // The seated being is what carries the desk past the gateway into `relink`.
    localStorage.setItem(`${lw}:neuma-companion`, JSON.stringify(who));
    sessionStorage.setItem('authToken', t);
    localStorage.setItem(`${lw}:win:desk:windows`, JSON.stringify(w));
  }, { t: token, a: addr, w: windows, who: WHO });
  await page.goto('/');
  await page.locator('.relink').waitFor({ timeout: 30000 });
  for (let i = 0; i < 8; i += 1) {
    const doors = page.locator('button').filter({ hasText: /STAND ASIDE/i });
    const n = await doors.count();
    let clicked = false;
    for (let d = 0; d < n; d += 1) {
      const door = doors.nth(d);
      if (await door.isVisible({ timeout: 500 }).catch(() => false)) {
        await door.click({ timeout: 3000 }).catch(() => {});
        clicked = true;
        await page.waitForTimeout(300);
      }
    }
    if (!clicked) break;
  }
};

test('a PNG opens in the VIEWER and real pixels arrive', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  // The window is born from the tree with the path as its payload; seeding it
  // is the same thing the tree's click does.
  //
  // ⚠️ It has to go in the FIRST seed, not a later evaluate + reload:
  // addInitScript re-runs on EVERY navigation, so a reload would rewrite
  // desk:windows back to the payload-less version and the window would open
  // empty. (It did — that is how this comment got written.)
  await openDesk(page, [{ id: 'image', payload: pngPath }]);

  const img = page.locator('.imageview-img');
  await expect(img).toBeVisible({ timeout: 20000 });

  // THE ONLY HONEST PROOF. An <img> whose bytes were refused — by the CSP, by a
  // wrong MIME, by a failed fetch — still renders an element and still reports
  // "visible". naturalWidth is 0 unless the browser actually DECODED it.
  await expect.poll(
    () => img.evaluate((el) => el.naturalWidth),
    { timeout: 15000, message: 'the image element exists but no pixels were decoded' },
  ).toBe(2);
  await expect.poll(() => img.evaluate((el) => el.naturalHeight)).toBe(2);

  // The bar reports what the file IS.
  await expect(page.locator('.imageview-bar')).toContainText('2 × 2');
  // And the editor's refusal is nowhere near it.
  await expect(page.getByText('BINARY FILE — NOT SHOWN.')).toHaveCount(0);
  expect(crashes).toEqual([]);
});

test('the blob URL is revoked when the window closes — bytes are not pinned', async ({ page }) => {
  await openDesk(page, [{ id: 'image', payload: pngPath }]);
  const img = page.locator('.imageview-img');
  await expect(img).toBeVisible({ timeout: 20000 });
  const url = await img.getAttribute('src');
  expect(url).toMatch(/^blob:/);

  await page.locator('.fwin-ctl-close').first().click({ timeout: 5000 });
  // The close plays a sever animation before the manager removes the window,
  // and the revoke rides the unmount that follows it.
  await expect(page.locator('.imageview-img')).toHaveCount(0, { timeout: 10000 });
  await page.waitForTimeout(600);

  // A revoked blob URL cannot be fetched. Without the revoke every image a
  // witness opened would hold its bytes until the desk reloaded.
  const stillThere = await page.evaluate(async (u) => {
    try { const r = await fetch(u); return r.ok; } catch { return false; }
  }, url);
  expect(stillThere, 'the blob URL outlived its window').toBe(false);
});

test('a NON-image still opens in the editor — routing did not overreach', async ({ page }) => {
  await openDesk(page, [{ id: 'editor', payload: mdPath }]);
  await expect(page.locator('.editor')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.imageview-img')).toHaveCount(0);
});
