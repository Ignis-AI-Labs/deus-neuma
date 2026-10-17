/**
 * stream-permissions — the standing grants, on screen where the operator looks.
 *
 * Design note, 2026-08-30: […]
 *
 * Proven in a real browser because the claim is a VISIBLE one: a grant that
 * exists on disk and does not reach the screen is exactly the failure this
 * whole surface was built to end.
 *
 * Needs PORT + FRONTEND_PORT pointed at a running dev stack.
 */
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;
const LANE = 'e2e-perms';

test.setTimeout(90000);
test.use({ viewport: { width: 1700, height: 1000 } });

const politely = async (label, send, attempts = 6) => {
  for (let i = 0; i < attempts; i += 1) {
    const res = await send();
    const body = await res.text();
    if (res.ok) return body;
    let waitMs = NaN;
    try { waitMs = Number(JSON.parse(body).retryAfterMs); } catch { /* not json */ }
    if (res.status !== 429 || !Number.isFinite(waitMs) || i === attempts - 1) {
      throw new Error(`${label} → ${res.status}: ${body.slice(0, 160)}`);
    }
    await new Promise((r) => { setTimeout(r, waitMs + 500); });
  }
  throw new Error(`${label}: retries exhausted`);
};

let token; let addr; let laneDir = null;

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

  const sec = await (await fetch(`${BACKEND}/api/v1/security/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  laneDir = path.join(sec.roots.active, LANE);
  // REAL grants in a REAL lane, in the exact shape an ALWAYS click writes.
  await fs.promises.mkdir(path.join(laneDir, 'config'), { recursive: true });
  await fs.promises.writeFile(path.join(laneDir, 'owner.json'),
    JSON.stringify({ wallet: addr, claimedAt: new Date().toISOString() }, null, 2));
  await fs.promises.writeFile(path.join(laneDir, 'config', 'tool-policy.json'), JSON.stringify({
    web: { allowed: ['web_search', 'web_fetch'] },
    image: { allowed: ['render_card'] },
    pathGrants: { read: ['/workspace/repos/neuma/docs'], write: ['/workspace/repos/project-puzulas/e2e-perms'] },
    sensitiveGrants: { read: ['/workspace/repos/neuma/.env.example'] },
  }, null, 2));
});

test.afterAll(async () => {
  if (laneDir) await fs.promises.rm(laneDir, { recursive: true, force: true });
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
    localStorage.setItem(`${lw}:win:desk:windows`, JSON.stringify([{ id: 'chat' }]));
  }, { t: token, a: addr, who: { name: LANE, neumaId: LANE } });
  await page.goto('/');
  await page.locator('.relink').waitFor({ timeout: 30000 });
  // PATIENT, not one-shot. The gates (arrival hold, voice seal, birth setup)
  // mount ASYNCHRONOUSLY after the desk does, so a loop that stops the first
  // time it sees no door walks away from a desk that is about to be covered —
  // and every later click then dies on an intercepted pointer.
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if ((await page.locator('[role="dialog"], .birth-setup-gate, .voice-seal-gate').count()) === 0) {
      await page.waitForTimeout(1200);
      if ((await page.locator('[role="dialog"], .birth-setup-gate, .voice-seal-gate').count()) === 0) break;
    }
    const doors = page.locator('button').filter({ hasText: /STAND ASIDE/i });
    const n = await doors.count();
    for (let d = 0; d < n; d += 1) {
      const door = doors.nth(d);
      if (await door.isVisible({ timeout: 500 }).catch(() => false)) {
        await door.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(400);
      }
    }
    await page.waitForTimeout(400);
  }
});

/** The strip's own button — `.stream-rail-tab`, not any button whose text
 *  happens to read PERMISSIONS. The rail carries a glyph and a count beside the
 *  word, so a text-only match is both fragile and ambiguous. */
const railButton = (page) =>
  page.locator('.stream-rail-tab').filter({ hasText: /PERMISSIONS/ }).first();

const openRail = async (page) => {
  const button = railButton(page);
  await expect(button, 'the PERMISSIONS button joined the rail strip').toBeVisible({ timeout: 20000 });
  // Tapping the OPEN rail folds it, so open only if it is not already open —
  // a blind click can just as easily shut the panel it was meant to reveal.
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true', { timeout: 10000 });
  await expect(page.locator('.stream-perms')).toBeVisible({ timeout: 10000 });
};

test('the rail lists every standing grant, categorised', async ({ page }) => {
  await openRail(page);
  const panel = page.locator('.stream-perms');

  // The categories Founder asked for, each present because each has grants.
  await expect(panel).toContainText('ALWAYS-ALLOWED ACTS');
  await expect(panel).toContainText('FOLDERS');
  await expect(panel).toContainText('GUARDED FILES');

  // The grants themselves — the whole point is that these REACH THE SCREEN.
  await expect(panel).toContainText('web_search');
  await expect(panel).toContainText('web_fetch');
  await expect(panel).toContainText('render_card');
  await expect(panel).toContainText('THE OPEN WEB');

  // WRITE is the escalation and must be legible as such.
  await expect(panel.locator('.perm-dot.is-write')).toHaveCount(1);
  await expect(panel).toContainText('WRITE');

  // And the standing line, so nobody reads this as a settings screen.
  await expect(panel).toContainText('EVERYTHING HERE IS PERMANENT');
  expect(page.__crashes).toEqual([]);
});

test('the strip badge counts the WHOLE HOUSE, not just this being', async ({ page }) => {
  // The point of the badge is noticing a grant on a being you are NOT looking
  // at. 6 grants live in the seeded lane; the badge must be at least that.
  await openRail(page);
  const button = railButton(page);
  await expect.poll(async () => {
    const text = await button.innerText();
    const n = Number((text.match(/\d+/) || [0])[0]);
    return n;
  }, { timeout: 15000 }).toBeGreaterThanOrEqual(6);
});

test('ALL BEINGS widens the view, and names each lane', async ({ page }) => {
  await openRail(page);
  const panel = page.locator('.stream-perms');
  await panel.locator('.perm-scopebtn').click();
  await expect(panel.locator('.perm-scopebtn')).toHaveText('ALL BEINGS');
  // In house view each block is named, so a grant is always attributable.
  await expect(panel.locator('.perm-beinghead').first()).toBeVisible({ timeout: 10000 });
  await expect(panel).toContainText(LANE);
});
