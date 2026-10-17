// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { openDockApp } from './helpers/dock.js';
import { claimOwner } from '../helpers/claim-owner.js';

/**
 * TASKS — the wider rhythms, driven through the real desk (RULE 0: real
 * auth, real backend, real realm disk): the witness designs a CUSTOM
 * Mon/Wed/Fri rhythm on the weekday chips and the row carries it; MONTHLY
 * and BIWEEKLY stand in the picker and group under their own headers.
 *
 * Requires the dev stack running (same law as desk.spec.js).
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
const MADE = []; // task ids this spec added — dropped again in afterAll

test.beforeAll(async () => {
  ({ token, addr } = await mintToken());
  // The arrival veil HOLDS when the bound companion has no lane under the
  // ACTIVE root (desk.spec's law) — seed the synthetic companion a real
  // claimed lane, torn down in afterAll.
  const sec = await (await fetch(`${BACKEND}/api/v1/security/status`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const activeRoot = sec?.roots?.active;
  if (activeRoot) {
    await claimOwner(activeRoot, 'e2e-desk', addr);
    seededLane = path.join(activeRoot, 'e2e-desk');
  }
});

test.afterAll(async () => {
  // Leave the test wallet's list as found — everything this spec added drops.
  await Promise.all(MADE.map((id) =>
    fetch(`${BACKEND}/api/v1/tasks/mine/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'dropped' }),
    })));
  if (seededLane) await fs.promises.rm(seededLane, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: 'e2e-desk' }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr });
  // ?noboot=1: the ignition never mounts. The desk is interactive BENEATH
  // the boot while it plays, and the boot's completion swaps phases and
  // REMOUNTS the whole relink tree — an open dropdown driven mid-boot dies
  // to that remount (seen live via MutationObserver: `.relink` removed at
  // t≈2.2s). The escape hatch makes the desk the first and only mount.
  await page.goto('/?noboot=1');
});

// A floating window materializes (line, shutters, veil, ~1s) — clicking
// through the animation hit-tests against moving geometry. And the TASKS
// body settles in two async beats (roster recovery re-renders the scope
// chips; the plan fetch lands the list) — driving the picker before both
// have landed loses the open panel to the re-render. Wait for the frame's
// animations AND both loaded markers.
const settleWindow = async (page) => {
  await page.locator('.fwin-frame').first().evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).filter((a) => a.effect?.getTiming().iterations !== Infinity)
      .map((a) => a.finished.catch(() => {}))));
  await expect(page.locator('.todo-body, .todo').first()).toBeVisible();
  // Roster recovered: the standing switch stands, and HOUSE carries a count —
  // the chip-per-being wall it replaced was the old proxy for this
  // (per-chat task lists, 2026-08-02).
  await expect(page.locator('.todo-standing')).toBeVisible();
  await expect(page.locator('.todo-standing-tab', { hasText: 'HOUSE' })
    .locator('.todo-standing-n')).toBeVisible();
  // These cases work the operator's OWN list, so ME is the standing on screen.
  await expect(page.locator('.todo-standing-tab.is-on')).toHaveText('ME');
  // Plan loaded: either a LIVE section or the honest empty state. `.todo-sec`
  // alone also matches the SETTLED drawer, so with nothing open both arms of the
  // `.or()` matched at once and tripped strict mode.
  await expect(
    page.locator('.todo-sec:not(.todo-settled)').first()
      .or(page.getByText('NOTHING STANDING')).first(),
  ).toBeVisible();
};

test('the witness designs a custom Mon/Wed/Fri rhythm on the chips and the row carries it', async ({ page }) => {
  await openDockApp(page, 'TASKS');
  await expect(page.locator('.todo-form')).toBeVisible();
  await settleWindow(page);

  // The picker offers the wider rhythms.
  await page.locator('.todo-form .lc-sel-trigger').click();
  await expect(page.locator('.lc-sel-opt', { hasText: 'BIWEEKLY' })).toBeVisible();
  await expect(page.locator('.lc-sel-opt', { hasText: 'MONTHLY' })).toBeVisible();
  await page.locator('.lc-sel-opt', { hasText: 'CUSTOM' }).click();

  // The weekday chips appear; ADD refuses until a day is chosen.
  await expect(page.locator('.todo-days')).toBeVisible();
  await page.locator('.todo-in').first().fill('E2E custom rhythm');
  await expect(page.locator('.todo-add')).toBeDisabled();
  for (const d of ['MON', 'WED', 'FRI']) {
    await page.locator('.todo-day', { hasText: d }).click();
  }
  await expect(page.locator('.todo-add')).toBeEnabled();
  await page.locator('.todo-add').click();

  // The row lands under CUSTOM wearing its designed days.
  const row = page.locator('.todo-item', { hasText: 'E2E custom rhythm' });
  await expect(row).toBeVisible();
  await expect(row.locator('.todo-row-tag', { hasText: 'MON/WED/FRI' })).toBeVisible();
  await expect(page.locator('.todo-h', { hasText: 'CUSTOM' })).toBeVisible();

  // The backend holds the same truth (normalized days on real realm disk).
  const { plan } = await (await fetch(`${BACKEND}/api/v1/tasks/mine`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const made = plan.tasks.find((t) => t.title === 'E2E custom rhythm');
  expect(made?.days).toEqual([1, 3, 5]);
  MADE.push(made.id);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('monthly and biweekly tasks group under their own headers', async ({ page }) => {
  await openDockApp(page, 'TASKS');
  await expect(page.locator('.todo-form')).toBeVisible();
  await settleWindow(page);

  const addWith = async (title, cadence) => {
    await page.locator('.todo-in').first().fill(title);
    await page.locator('.todo-form .lc-sel-trigger').click();
    await page.locator('.lc-sel-opt', { hasText: cadence }).click();
    await page.locator('.todo-add').click();
    await expect(page.locator('.todo-item', { hasText: title })).toBeVisible();
  };
  await addWith('E2E monthly sweep', 'MONTHLY');
  await addWith('E2E biweekly clean', 'BIWEEKLY');

  await expect(page.locator('.todo-h', { hasText: 'MONTHLY' })).toBeVisible();
  await expect(page.locator('.todo-h', { hasText: 'BIWEEKLY' })).toBeVisible();

  const { plan } = await (await fetch(`${BACKEND}/api/v1/tasks/mine`, { headers: { Authorization: `Bearer ${token}` } })).json();
  for (const title of ['E2E monthly sweep', 'E2E biweekly clean']) {
    const made = plan.tasks.find((t) => t.title === title);
    expect(made).toBeTruthy();
    MADE.push(made.id);
  }
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
