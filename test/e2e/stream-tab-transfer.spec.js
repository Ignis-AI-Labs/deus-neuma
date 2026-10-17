/**
 * stream-tab-transfer — dragging a sitting BETWEEN two stream windows, and the
 * caret that says where it will land.
 *
 * Design note, 2026-08-30, after three fixes that each looked right and were not:
 *   […]
 *   […]
 *   […]
 *
 * He is right, and the reason is exact: a unit test cannot see an HTML5 drag.
 * Every defect in this feature so far — the drop event never firing, the drop
 * zone stopping at the tabs' edge, the caret blinking out over a tab's own
 * children — lived entirely in the browser's event plumbing, which is precisely
 * what unit tests do not run.
 *
 * ⚠️ NAMED `-live`? No — this needs no substrate and no GPU, only the dev stack.
 * It stays in the normal e2e lane. It DOES need PORT + FRONTEND_PORT pointed at
 * a running stack, like every other spec in this directory.
 */
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { claimOwner } from '../helpers/claim-owner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;
const WHO = Object.freeze({ name: 'Fenna', neumaId: 'e2e-transfer' });

const politely = async (label, send, attempts = 6) => {
  for (let i = 0; i < attempts; i += 1) {
    const res = await send();
    const body = await res.text();
    if (res.ok) return body;
    let waitMs = NaN;
    try { waitMs = Number(JSON.parse(body).retryAfterMs); } catch { /* not json */ }
    if (res.status !== 429 || !Number.isFinite(waitMs) || i === attempts - 1) {
      throw new Error(`${label} at ${BACKEND} → ${res.status}: ${body.slice(0, 200)}`);
    }
    await new Promise((r) => { setTimeout(r, waitMs + 500); });
  }
  throw new Error(`${label}: retries exhausted`);
};

// Bounded on purpose. A blocked click retries until the timeout, so an
// un-dismissed gate reads as a HANG rather than a failure — and a hang tells
// you nothing about which action was blocked.
test.setTimeout(90000);

// TWO WINDOWS SIDE BY SIDE NEED ROOM. The suite's default viewport is 1280
// wide; the second stream window would sit largely off-screen, and a drag
// cannot reach a target that is not on screen.
test.use({ viewport: { width: 1920, height: 1080 } });

let token; let addr; let seededLane = null;

/**
 * Clear every modal that intercepts pointer events, however late it arrives:
 * the birth-setup gate, the voice-seal notice, the arrival hold. They mount
 * asynchronously after the desk does, so this is a LOOP over the live dialog
 * count rather than a one-shot click — a single pass dismissed the gate that
 * was up and then the next one appeared behind it.
 */
const clearGates = async (page) => {
  for (let i = 0; i < 12; i += 1) {
    if ((await page.locator('[role="dialog"], .birth-setup-gate').count()) === 0) return;
    // EVERY visible door, not just the first. These gates mount ONCE PER STREAM
    // WINDOW, so with two windows there are two of them — and `.first()` can
    // resolve to the one that is still hidden behind the other, which reads as
    // "no door" and abandons a desk that is still covered.
    const doors = page.locator('button').filter({ hasText: /STAND ASIDE|CONTINUE TO THE DESK/i });
    const n = await doors.count();
    let clicked = false;
    for (let d = 0; d < n; d += 1) {
      const door = doors.nth(d);
      if (await door.isVisible({ timeout: 500 }).catch(() => false)) {
        await door.click({ timeout: 3000 }).catch(() => {});
        clicked = true;
        await page.waitForTimeout(400);
      }
    }
    if (!clicked) break;
    await page.waitForTimeout(400);
  }
};

test.beforeAll(async () => {
  const pk = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8')
    .match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  const w = new ethers.Wallet(pk);
  addr = w.address;
  const { challenge } = JSON.parse(await politely('auth/challenge',
    () => fetch(`${BACKEND}/api/v1/auth/challenge?address=${addr}`)));
  const signature = await w.signMessage(challenge);
  ({ token } = JSON.parse(await politely('auth/verify', () => fetch(`${BACKEND}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, signature, challenge }),
  }))));
  const sec = await (await fetch(`${BACKEND}/api/v1/security/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  if (sec?.roots?.active) {
    await claimOwner(sec.roots.active, WHO.neumaId, addr);
    seededLane = path.join(sec.roots.active, WHO.neumaId);
  }
});

test.afterAll(async () => {
  if (seededLane) await fs.promises.rm(seededLane, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;

  await page.addInitScript(({ t, a, who }) => {
    const lw = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${lw}:neuma-companion`, JSON.stringify(who));
    sessionStorage.setItem('authToken', t);
    Object.keys(localStorage).filter((k) => k.includes('desk:tabs')).forEach((k) => localStorage.removeItem(k));
    // TWO STREAM WINDOWS, SIDE BY SIDE.
    //
    // Both halves matter. Seeding the open-set avoids a tear-out click that the
    // arrival dialog intercepts; seeding the GEOMETRY is what makes the drag
    // possible at all — the default puts both windows at the same coordinates,
    // exactly stacked, and nothing can be dragged between two windows occupying
    // one rectangle.
    localStorage.setItem(`${lw}:win:desk:windows`, JSON.stringify([{ id: 'chat' }, { id: 'chat#2' }]));
    localStorage.setItem(`${lw}:win:chat`, JSON.stringify({ x: 20, y: 60, w: 900, h: 700 }));
    localStorage.setItem(`${lw}:win:chat#2`, JSON.stringify({ x: 960, y: 60, w: 900, h: 700 }));
  }, { t: token, a: addr, who: WHO });

  await page.goto('/');
  await page.locator('.relink').waitFor({ timeout: 30000 });
  await clearGates(page);
  await page.waitForTimeout(1200);
  await clearGates(page);
  await expect(page.locator('.tabstrip')).toHaveCount(2, { timeout: 20000 });
  // Say plainly what is still covering the desk, instead of letting a blocked
  // click time out with no explanation.
  const blocking = await page.locator('[role="dialog"], .birth-setup-gate').count();
  expect(blocking, 'a modal is still covering the desk; no click can land').toBe(0);
});

/** Tab ids on one window's strip, in order. */
const idsOf = (page, windowId) => page
  .locator(`.tabstrip[data-window-id="${windowId}"] .tabstrip-tab`)
  .evaluateAll((els) => els.map((e) => e.getAttribute('data-tab-id')));

/**
 * A REAL HTML5 drag, step by step.
 *
 * `dragTo` moves in one hop, which Chromium does not always read as a drag —
 * and a single hop would also never let us SEE the caret, which only exists
 * mid-gesture. Moving in steps is both more faithful and observable.
 */
const dragOver = async (page, source, target, { xFraction = 0.5 } = {}) => {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('drag endpoints are not on screen');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Away from the origin first — a drag does not start until the pointer leaves.
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 6 });
  const tx = to.x + to.width * xFraction;
  const ty = to.y + to.height / 2;
  await page.mouse.move(tx, ty, { steps: 24 });
  await page.mouse.move(tx, ty, { steps: 4 }); // settle on the target half
};

test('the caret shows WHICH SIDE of a tab the sitting would land on', async ({ page }) => {
  const strip = page.locator('.tabstrip[data-window-id="chat"]');
  await strip.locator('.tabstrip-open').click();
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(2, { timeout: 10000 });

  const tabs = strip.locator('.tabstrip-tab');
  await dragOver(page, tabs.nth(0), tabs.nth(1), { xFraction: 0.85 });
  await expect(strip.locator('.tabstrip-caret')).toHaveCount(1);
  // Aimed at the RIGHT half → the caret stands AFTER that tab.
  const afterRight = await strip.evaluate((el) => {
    const kids = [...el.querySelectorAll('.tabstrip-tab, .tabstrip-caret')];
    return kids.findIndex((k) => k.classList.contains('tabstrip-caret'));
  });

  await dragOver(page, tabs.nth(0), tabs.nth(1), { xFraction: 0.15 });
  const afterLeft = await strip.evaluate((el) => {
    const kids = [...el.querySelectorAll('.tabstrip-tab, .tabstrip-caret')];
    return kids.findIndex((k) => k.classList.contains('tabstrip-caret'));
  });
  await page.mouse.up();

  // The whole point: the two halves must not say the same thing.
  expect(afterRight).toBeGreaterThan(afterLeft);
  expect(page.__crashes).toEqual([]);
});

test('a sitting dragged into the OTHER stream lands in it, and leaves the first', async ({ page }) => {
  // THE FIRST TAB IS THE ONE THAT MOVES, deliberately.
  //
  // It is the oldest, which makes it the HOUSE tab — and it was refused for a
  // whole afternoon because of that. It is also the tab an operator naturally
  // grabs, so this is the exact gesture Founder kept reporting as broken. A second
  // sitting exists only so the source is not left empty.
  const left = page.locator('.tabstrip[data-window-id="chat"]');
  await left.locator('.tabstrip-open').click();
  await expect(left.locator('.tabstrip-tab')).toHaveCount(2, { timeout: 10000 });
  // Opening a tab on an UNMEASURED machine posts a budget notice ([…]). It is about running, not about dropping —
  // clear it, or the assertion below reads a stale notice as a drop refusal.
  const dismiss = page.locator('.tabstrip-refusal-dismiss').first();
  if (await dismiss.isVisible({ timeout: 1500 }).catch(() => false)) await dismiss.click();
  await expect(page.locator('.tabstrip-refusal')).toHaveCount(0, { timeout: 5000 });

  const before = { left: await idsOf(page, 'chat'), right: await idsOf(page, 'chat#2') };
  const moving = before.left[0];
  await dragOver(
    page,
    page.locator('.tabstrip[data-window-id="chat"] .tabstrip-tab').first(),
    page.locator('.tabstrip[data-window-id="chat#2"]'),
    { xFraction: 0.9 },
  );
  await page.mouse.up();
  await page.waitForTimeout(1500);

  const after = { left: await idsOf(page, 'chat'), right: await idsOf(page, 'chat#2') };
  // Surface the strip's own refusal if there was one — far more useful than
  // […].
  const refusal = await page.locator('.tabstrip-refusal-text').first()
    .textContent({ timeout: 500 }).catch(() => null);
  expect(refusal, 'the strip refused the drop').toBeNull();
  expect(after.right, 'the sitting joined the second stream').toContain(moving);
  expect(after.left, 'and left the first').not.toContain(moving);
  // Never in both: one conversation drawn twice is two composers on one session.
  expect(after.left.filter((id) => id === moving)).toHaveLength(0);
  // A transfer must not ALSO tear out a third window.
  await expect(page.locator('.tabstrip')).toHaveCount(2);
  expect(page.__crashes).toEqual([]);
});
