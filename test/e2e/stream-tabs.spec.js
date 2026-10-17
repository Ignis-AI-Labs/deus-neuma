// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { claimOwner } from '../helpers/claim-owner.js';
import { tearOut, dropInside } from './helpers/tab-tear.js';
import { passDeskGates } from './helpers/desk-gates.js';

/**
 * SESSION TABS, in the browser, for real.
 *
 * Design note, 2026-07-30: […]
 *
 * So this drives a REAL browser against the REAL backend with REAL auth
 * (challenge-sign-verify) and asserts what the operator actually sees: the
 * strip is present in the stream, the sitting already in progress appears as
 * the first tab, a second tab opens, focus moves between them, and closing one
 * leaves the other standing.
 *
 * ONE DOOR (2026-07-30): the strip no longer offers a choice of kind — a new
 * tab inherits it from whoever is in the chair. So this file's door spends the
 * LOCAL budget, and opening a second tab here is a real assertion about this
 * rig's measured ceiling rather than a free pass. A machine that has never been
 * scanned holds at one local sitting and the second press REFUSES — correctly,
 * and that refusal is proven in the unit suite where the ceiling can be stated.
 *
 * Requires the dev stack (FRONTEND_PORT / PORT) and a capacity scan of 2+.
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

/**
 * Every auth call, HONOURING the backend's own rate limiter.
 *
 * The auth endpoints answer 429 with a retryAfterMs, and re-running this file
 * back to back trips it — on `verify` as readily as on `challenge`, which an
 * earlier version of this helper did not cover and so reported a working
 * backend as an auth failure. Sleeping exactly as long as the server asked is
 * the honest read of that answer.
 */
const politely = async (label, send, attempts = 5) => {
  for (let i = 0; i < attempts; i += 1) {
    const res = await send();
    const body = await res.text();
    if (res.ok) return body;
    const waitMs = (() => { try { return Number(JSON.parse(body).retryAfterMs); } catch { return NaN; } })();
    if (res.status !== 429 || !Number.isFinite(waitMs) || i === attempts - 1) {
      throw new Error(`${label} at ${BACKEND} → ${res.status}: ${body.slice(0, 200)}`);
    }
    await new Promise((r) => { setTimeout(r, waitMs + 500); });
  }
  throw new Error(`${label}: exhausted retries`);
};

const mintToken = async () => {
  const w = new ethers.Wallet(readClaudeWallet());
  const addr = w.address;
  const challengeBody = await politely('auth/challenge',
    () => fetch(`${BACKEND}/api/v1/auth/challenge?address=${addr}`));
  const { challenge } = JSON.parse(challengeBody);
  if (!challenge) throw new Error(`auth/challenge returned no challenge: ${challengeBody.slice(0, 200)}`);
  const signature = await w.signMessage(challenge);
  const verifyBody = await politely('auth/verify', () => fetch(`${BACKEND}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, signature, challenge }),
  }));
  const { token } = JSON.parse(verifyBody);
  if (!token) throw new Error(`auth/verify returned no token: ${verifyBody.slice(0, 200)}`);
  return { token, addr };
};

// The being in the chair for this file — a house neuma with a real claimed lane
// under the active root, so the arrival completes instead of holding.
const WHO = Object.freeze({ name: 'Fenna', neumaId: 'e2e-tabs' });

let token; let addr; let seededLane = null;

test.beforeAll(async () => {
  ({ token, addr } = await mintToken());
  const sec = await (await fetch(`${BACKEND}/api/v1/security/status`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const activeRoot = sec?.roots?.active;
  if (activeRoot) {
    await claimOwner(activeRoot, WHO.neumaId, addr);
    seededLane = path.join(activeRoot, WHO.neumaId);
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
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify(who));
    sessionStorage.setItem('authToken', t);
    // Each TEST starts from an empty strip, so […] is proven rather than inherited from a previous run.
    //
    // Guarded by a sentinel because addInitScript runs on EVERY navigation:
    // without it a page.reload() would wipe the very strip the restart test is
    // trying to prove survives. (It did — that is how this guard got written.)
    if (!sessionStorage.getItem('e2e-tabs-cleared')) {
      Object.keys(localStorage).filter((k) => k.includes('desk:tabs')).forEach((k) => localStorage.removeItem(k));
      sessionStorage.setItem('e2e-tabs-cleared', '1');
    }
    // ...and every test starts with ONE stream window. A tear-out opens a
    // second and the desk PERSISTS its open-set, so without this the next test
    // would find two strips and match them both — silently asserting against a
    // desk it never set up. (It did: that is how this line got written.)
    Object.keys(localStorage)
      .filter((k) => k.includes('desk:windows'))
      .forEach((k) => localStorage.removeItem(k));
  }, { t: token, a: addr, who: WHO });
  await page.goto('/');
  // The desk's own gates for a being with setup still owed (the voice's first
  // seal over the birth setup) — stepped past through their honest doors.
  await passDeskGates(page);
});

test('the strip is IN THE STREAM, and the live sitting is already a tab', async ({ page }) => {
  await expect(page.locator('.relink')).toBeVisible();
  // The strip renders inside the stream column — not the desk chrome.
  const strip = page.locator('.stream-col .tabstrip');
  await expect(strip).toBeVisible();
  // The conversation already in progress seeded itself, so the operator has
  // something to press rather than an empty rail.
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(1);
  await expect(strip.locator('.tabstrip-face')).toContainText(WHO.name, { ignoreCase: true });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('ONE DOOR, and it inherits the kind from whoever is in the chair', async ({ page }) => {
  const strip = page.locator('.stream-col .tabstrip');
  await expect(strip).toBeVisible();
  await expect(strip.locator('.tabstrip-new')).toHaveCount(1);
  const door = strip.locator('.tabstrip-new');
  await expect(door).toHaveText('+ TAB');
  // The kind is INHERITED from the chair, so the door reports the budget this
  // press would actually spend — and names who arrives holding it. A house
  // neuma is in the chair, so this door spends the GPU's budget.
  await expect(door).toHaveAttribute('data-kind', 'local');
  await expect(door).toHaveAttribute('title', new RegExp(WHO.name, 'i'));
  expect(page.__crashes).toEqual([]);
});

test('A SECOND SITTING OPENS, and focus moves between them', async ({ page }) => {
  const strip = page.locator('.stream-col .tabstrip');
  await expect(strip).toBeVisible();
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(1);

  // A house neuma is in the chair, so this press spends a slot on this rig's
  // MEASURED ceiling — the second tab opening is that measurement holding.
  await strip.locator('.tabstrip-new').click();
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(2);

  // The newly opened one holds focus — you opened it because you meant to look.
  await expect(strip.locator('.tabstrip-tab.is-on')).toHaveCount(1);
  const second = strip.locator('.tabstrip-tab').nth(1);
  await expect(second).toHaveClass(/is-on/);

  // Back to the first, and exactly one is ever lit.
  await strip.locator('.tabstrip-tab').nth(0).locator('.tabstrip-face').click();
  await expect(strip.locator('.tabstrip-tab').nth(0)).toHaveClass(/is-on/);
  await expect(strip.locator('.tabstrip-tab.is-on')).toHaveCount(1);

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('closing a sitting leaves the other standing, and the desk survives', async ({ page }) => {
  const strip = page.locator('.stream-col .tabstrip');
  await strip.locator('.tabstrip-new').click();
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(2);

  await strip.locator('.tabstrip-tab').nth(1).hover();
  await strip.locator('.tabstrip-tab').nth(1).locator('.tabstrip-close').click();
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(1);
  // Focus never vanishes — the desk always has a sitting in the chair.
  await expect(strip.locator('.tabstrip-tab.is-on')).toHaveCount(1);
  // And the desk itself is untouched by a tab closing.
  await expect(page.locator('.relink')).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('THE STRIP SURVIVES A RELOAD — and brings each tab\'s sitting back with it', async ({ page }) => {
  const strip = page.locator('.stream-col .tabstrip');
  await strip.locator('.tabstrip-new').click();
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(2);

  await page.reload();
  await passDeskGates(page);

  // Design note, 2026-07-30: […]
  await expect(page.locator('.stream-col .tabstrip .tabstrip-tab')).toHaveCount(2);

  // Design note, 2026-08-02: […]
  // The two are not opposites — the first is about BINDING, the second about
  // REMEMBERING. A tab now CARRIES its sitting across the restart, so focusing
  // it returns the operator to that chat. Dropping the id did not merely
  // forget: focusPlan read null as […] and ChatApp minted a FRESH
  // sitting over the operator's work.
  const persisted = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.includes('desk:tabs'));
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });
  expect(persisted).toBeTruthy();
  // The field is carried for every tab — null for one that has not spoken yet,
  // which is a place for a sitting rather than a sitting.
  for (const t of persisted.tabs) expect(t).toHaveProperty('sessionId');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ── THE DRAG (Design note, 2026-07-31 ─────────────────────────────────────────────
// […]

const tabIds = (page) => page.$$eval('.stream-col .tabstrip .tabstrip-tab',
  (els) => els.map((e) => e.getAttribute('data-tab-id')));

test('DRAGGING A TAB REORDERS THE STRIP', async ({ page }) => {
  const strip = page.locator('.stream-col .tabstrip');
  await strip.locator('.tabstrip-new').click();
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(2);

  // Both tabs hold the same being and wear the same name, so identity is the
  // only thing that can prove the strip actually moved.
  const before = await tabIds(page);
  expect(before[0]).not.toBe(before[1]);

  await strip.locator('.tabstrip-tab').nth(1).dragTo(strip.locator('.tabstrip-tab').nth(0));

  await expect.poll(() => tabIds(page)).toEqual([before[1], before[0]]);
  // Nothing was lost, and nothing was duplicated.
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(2);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('a reorder does NOT change which sitting you are in', async ({ page }) => {
  const strip = page.locator('.stream-col .tabstrip');
  await strip.locator('.tabstrip-new').click();
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(2);
  // The tab you opened holds focus; dragging it elsewhere must not hand focus
  // to whatever slid into its place.
  const focused = await page.locator('.stream-col .tabstrip .tabstrip-tab.is-on')
    .getAttribute('data-tab-id');

  await strip.locator('.tabstrip-tab').nth(1).dragTo(strip.locator('.tabstrip-tab').nth(0));

  await expect(strip.locator('.tabstrip-tab.is-on')).toHaveCount(1);
  await expect(page.locator('.stream-col .tabstrip .tabstrip-tab.is-on'))
    .toHaveAttribute('data-tab-id', focused);
  expect(page.__crashes).toEqual([]);
});

// ── THE TEAR-OUT, CORRECTED (Design note, 2026-07-31 ──────────────────────────────
// […] The desk IS the operating
// system: the tear-out opens a window IN it, on its OWN portal — otherwise it
// would draw this same conversation twice and call it parallel work.
// DELIBERATE (Design note, 2026-10-05: no pop-out button — only a drag let go OUTSIDE
// the tab's own window ([…]).

const streamWindows = (page) => page.locator('.fwin').filter({ has: page.locator('.stream-col') });

test('NO POP-OUT BUTTON — a tab never launches a window from a click', async ({ page }) => {
  const strip = page.locator('.stream-col .tabstrip');
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(1);
  await expect(strip.locator('.tabstrip-tear, button[aria-label*="own window" i]')).toHaveCount(0);
});

test('a tab let go INSIDE its own window stays put — no window opens', async ({ page }) => {
  const strip = page.locator('.stream-col .tabstrip').first();
  await strip.locator('.tabstrip-new').click();
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(2);
  await dropInside(page, strip.locator('.tabstrip-tab').nth(1));
  await page.waitForTimeout(400); // a window, if one were coming, opens at once
  await expect(streamWindows(page)).toHaveCount(1);
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(2);
  expect(page.__crashes).toEqual([]);
});

test('TEARING A TAB OUT OPENS A SECOND STREAM WINDOW IN THIS DESK', async ({ page }) => {
  await expect(streamWindows(page)).toHaveCount(1);
  const strip = page.locator('.stream-col .tabstrip').first();
  await strip.locator('.tabstrip-new').click();
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(2);

  // Pull the second sitting out.
  await tearOut(page, strip.locator('.tabstrip-tab').nth(1));

  // A refusal is the informative failure: assert it FIRST so a red reports the
  // machine's reason rather than […].
  const notice = page.locator('.tabstrip-refusal');
  if (await notice.isVisible().catch(() => false)) {
    throw new Error(`tear-out refused: ${await notice.innerText()}`);
  }
  // A second STREAM window, inside this desk — not a new app window.
  await expect(streamWindows(page)).toHaveCount(2);
  // It MOVED: the origin strip is back to one sitting.
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(1);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('THE TORN-OUT WINDOW RUNS ITS OWN PORTAL — a second sitting, not a second view', async ({ page }) => {
  // The whole point. One ConsciousnessContext per document would mean both
  // windows render the same stream; a window with its own socket does not.
  // Counted on the real WebSocket constructor, before the app loads.
  await page.addInitScript(() => {
    window.__sockets = 0;
    const Real = window.WebSocket;
    window.WebSocket = function (...args) { window.__sockets += 1; return new Real(...args); };
    window.WebSocket.prototype = Real.prototype;
    Object.assign(window.WebSocket, Real);
  });
  await page.reload();
  await passDeskGates(page);

  await expect(streamWindows(page)).toHaveCount(1);
  const before = await page.evaluate(() => window.__sockets);

  const strip = page.locator('.stream-col .tabstrip').first();
  await strip.locator('.tabstrip-new').click();
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(2);
  // Opening a TAB opens its own socket now (#407, 2026-08-28): each tab past
  // the first is its own LIVE sitting on its own portal (TabPortalHost) — that
  // is what lets a background tab keep streaming through a tab switch.
  await expect.poll(() => page.evaluate(() => window.__sockets), { timeout: 15000 })
    .toBeGreaterThan(before);
  const afterTab = await page.evaluate(() => window.__sockets);

  await tearOut(page, strip.locator('.tabstrip-tab').nth(1));
  await expect(streamWindows(page)).toHaveCount(2);

  // Tearing OUT moves the sitting onto the new window's own portal — another
  // socket for the window (the tab's own portal closed with the tab).
  await expect.poll(() => page.evaluate(() => window.__sockets), { timeout: 15000 })
    .toBeGreaterThan(afterTab);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// Design note, 2026-07-31: […]
//
// disconnect() has exactly one caller — a stream window unmounting — so the old
// 'Portal closed' badge never once meant a portal-level event. It also never
// cleared: 'Portal established' dismisses itself after 1200ms and this was the
// one 'ok' status that forgot to, on a status node that is GLOBAL to the desk.
// So closing a second stream stamped a permanent notice over the primary
// window's chrome.
test('CLOSING A STREAM WINDOW SAYS NOTHING, AND LEAVES NOTHING ON SCREEN', async ({ page }) => {
  const badge = page.locator('.neuma-status-indicator');

  const strip = page.locator('.stream-col .tabstrip').first();
  await strip.locator('.tabstrip-new').click();
  await expect(strip.locator('.tabstrip-tab')).toHaveCount(2);
  await tearOut(page, strip.locator('.tabstrip-tab').nth(1));

  const notice = page.locator('.tabstrip-refusal');
  if (await notice.isVisible().catch(() => false)) {
    throw new Error(`tear-out refused: ${await notice.innerText()}`);
  }
  await expect(streamWindows(page)).toHaveCount(2);

  // The torn-out window's own portal has to actually be up, or closing it
  // would prove nothing — there would be no socket to close.
  await expect(badge).toHaveCount(0, { timeout: 15000 }); // 'Portal established' self-clears

  // Close it the way the operator does: the window's own × .
  const torn = streamWindows(page).nth(1);
  await torn.locator('.fwin-ctl-close').click();
  await expect(streamWindows(page)).toHaveCount(1);

  // THE ASSERTION. No badge — not "Portal closed", not anything. The window is
  // gone; that IS the feedback.
  await expect(badge).toHaveCount(0);

  // And it does not appear a beat later, once the socket's onclose lands.
  await page.waitForTimeout(1500);
  await expect(badge).toHaveCount(0);

  // The surviving window is untouched and still live.
  await expect(page.locator('.stream-col .tabstrip').first().locator('.tabstrip-tab')).toHaveCount(1);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('each stream window names its OWN being, live', async ({ page }) => {
  const strip = page.locator('.stream-col .tabstrip').first();
  await strip.locator('.tabstrip-new').click();
  await tearOut(page, strip.locator('.tabstrip-tab').nth(1));
  await expect(streamWindows(page)).toHaveCount(2);

  // Both windows carry a title with a route light of their own — the torn-out
  // one is not borrowing the desk's.
  const titles = streamWindows(page).locator('.fwin-bar-title .relink-title-name');
  await expect(titles).toHaveCount(2);
  await expect(titles.nth(1)).toContainText(WHO.name, { ignoreCase: true });
  await expect(streamWindows(page).locator('.fwin-bar-title .relink-dot')).toHaveCount(2);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});


// ── EACH STREAM IS ITS OWN CHANNEL (Design note, 2026-07-31 ───────────────────────
// […]
//
// The cause was a strip that stayed at DESK level while the streams moved per
// window: both windows rendered the SAME tabs and each reconciled them against
// a different being, so they retargeted each other's tab back and forth.

const stripOf = (page, i) => page.locator('.fwin')
  .filter({ has: page.locator('.stream-col') }).nth(i).locator('.tabstrip');

test('EACH STREAM WINDOW OWNS ITS OWN STRIP', async ({ page }) => {
  const first = stripOf(page, 0);
  await first.locator('.tabstrip-new').click();
  await expect(first.locator('.tabstrip-tab')).toHaveCount(2);

  await tearOut(page, first.locator('.tabstrip-tab').nth(1));
  await expect(streamWindows(page)).toHaveCount(2);

  // TWO strips, not one shared between two frames. Counting the strips proves
  // nothing on its own — a shared set renders twice too — so the discriminating
  // assertion is that they hold DIFFERENT tabs.
  await expect(page.locator('.stream-col .tabstrip')).toHaveCount(2);
  await expect(first.locator('.tabstrip-tab')).toHaveCount(1);
  await expect(stripOf(page, 1).locator('.tabstrip-tab')).toHaveCount(1);
  const idA = await first.locator('.tabstrip-tab').first().getAttribute('data-tab-id');
  const idB = await stripOf(page, 1).locator('.tabstrip-tab').first().getAttribute('data-tab-id');
  expect(idA, 'both strips are showing the SAME tab — the shared-state bug').not.toBe(idB);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('a tab opened in ONE stream never appears in the other', async ({ page }) => {
  const first = stripOf(page, 0);
  await first.locator('.tabstrip-new').click();
  await tearOut(page, first.locator('.tabstrip-tab').nth(1));
  await expect(streamWindows(page)).toHaveCount(2);
  const second = stripOf(page, 1);
  await expect(first.locator('.tabstrip-tab')).toHaveCount(1);

  // Open two more in the SECOND window only.
  await second.locator('.tabstrip-new').click();
  await second.locator('.tabstrip-new').click();
  await expect(second.locator('.tabstrip-tab')).toHaveCount(3);
  // The first window is untouched — the strips are separate state, not one set
  // drawn twice.
  await expect(first.locator('.tabstrip-tab')).toHaveCount(1);

  // ...and closing in the second leaves the first alone too.
  await second.locator('.tabstrip-tab').nth(2).hover();
  await second.locator('.tabstrip-tab').nth(2).locator('.tabstrip-close').click();
  await expect(second.locator('.tabstrip-tab')).toHaveCount(2);
  await expect(first.locator('.tabstrip-tab')).toHaveCount(1);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('THE STRIPS SETTLE — neither window keeps rewriting the other', async ({ page }) => {
  // The visible symptom was oscillation: one window's title disagreeing with
  // its own tab, then flipping. A settled desk holds still.
  const first = stripOf(page, 0);
  await first.locator('.tabstrip-new').click();
  await tearOut(page, first.locator('.tabstrip-tab').nth(1));
  await expect(streamWindows(page)).toHaveCount(2);

  const snapshot = () => page.$$eval('.stream-col .tabstrip', (strips) => strips.map((s) => ({
    tabs: [...s.querySelectorAll('.tabstrip-tab')].map((t) => t.getAttribute('data-tab-id')),
    focused: s.querySelector('.tabstrip-tab.is-on')?.getAttribute('data-tab-id') ?? null,
  })));

  const before = await snapshot();
  expect(before).toHaveLength(2);
  // Ids are per window and must never be shared between strips.
  const ids = before.flatMap((s) => s.tabs);
  expect(new Set(ids).size, 'a tab id appearing in BOTH strips is the shared-state bug').toBe(ids.length);

  await page.waitForTimeout(3000);
  expect(await snapshot(), 'the strips moved on their own — something is still fighting').toEqual(before);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
