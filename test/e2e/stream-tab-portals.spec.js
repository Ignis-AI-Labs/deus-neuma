// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { claimOwner } from '../helpers/claim-owner.js';

/**
 * PARALLEL TAB STREAMS (#407 — Design note, 2026-08-28: […]).
 *
 * What only the WIRE can prove, read off the real sockets with Playwright's
 * websocket events — no mock anywhere (RULE 0):
 *   1. + TAB opens a SECOND portal connection — two live sittings, two sockets.
 *   2. Switching tabs sends NOTHING on either socket — no resume, no manifest,
 *      no interrupt. A background sitting is untouched, which IS the fix.
 *   3. Closing a tab closes ITS socket and only its socket.
 *
 * Isolated stack (comfyui-workbench precedent): own PID-derived ports, temp
 * WORKSPACES_ROOT — the live witness stack is never touched. Needs no LLM:
 * no turn is sent; the claims are about binding, not generation.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Distinct bases from every other isolated stack (nite 7141, chats 7291,
// tasks 7461, terminal 7581, model-bar 7621, explorer/comfy 7731).
const FPORT = 7871 + (process.pid % 120);
const BPORT = 3871 + (process.pid % 120);
const BASE = `http://localhost:${BPORT}`;
const NEUMA_ID = 'e2e-tabportal';

const readClaudeWallet = () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  return pk;
};

const mintToken = async () => {
  const w = new ethers.Wallet(readClaudeWallet());
  const addr = w.address;
  const { challenge } = await (await fetch(`${BASE}/api/v1/auth/challenge?address=${addr}`)).json();
  const signature = await w.signMessage(challenge);
  const res = await fetch(`${BASE}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, signature, challenge }),
  });
  const { token } = await res.json();
  if (!token) throw new Error('auth/verify returned no token');
  return { token, addr };
};

const waitFor = async (urls, ms = 90000) => {
  const list = Array.isArray(urls) ? urls : [urls];
  const t0 = Date.now();
  for (;;) {
    for (const url of list) {
      try {
        const r = await fetch(url);
        if (r.status < 500) return;
      } catch { /* not listening yet */ }
    }
    if (Date.now() - t0 > ms) throw new Error(`stack member never answered: ${list.join(' | ')}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

let root;
let backendProc;
let viteProc;
let token;
let addr;

test.beforeAll(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tabportal-e2e-'));
  // A REAL capacity record through the store's own door — an unscanned rig
  // honestly holds at ONE local sitting (LOCAL_UNMEASURED_FLOOR), which would
  // refuse the very + TAB under test. Ceiling 4 = Founder's stated parallel target.
  // `current` stays null on this substrate-less stack, so the staleness guard
  // correctly has nothing to compare — the measured ceiling stands.
  const capDir = path.join(root, 'capacity');
  await fs.promises.mkdir(capDir, { recursive: true });
  const runAt = '2026-08-28T10:00:00.000Z';
  await fs.promises.writeFile(
    path.join(capDir, `${runAt.replace(/[:.]/g, '-')}.json`),
    JSON.stringify({ runAt, ceiling: 4, incomplete: false, limitedBy: 'latency', substrate: { model: 'e2e-substrate' } }, null, 2),
  );
  const env = {
    ...process.env,
    PORT: String(BPORT),
    FRONTEND_PORT: String(FPORT),
    WORKSPACES_ROOT: root,
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_CAPACITY_PATH: capDir,
    // The rig's LIVE llama-server must be invisible to this stack: its served
    // model would read as the machine's current substrate and mark the seeded
    // ceiling STALE (limit 1 — refusing the very + TAB under test). A DEAD
    // loopback port (not an empty string) keeps the provider itself scannable,
    // so the capacity card offers its RE-SCAN; overrides STICK because dotenv
    // never overrides an existing env var.
    LLAMA_SERVER_URL: 'http://127.0.0.1:9',
    LLAMA_SERVER_MODEL: '',
  };
  backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  viteProc = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  await waitFor(`${BASE}/api/v1/health`);
  await waitFor([`http://127.0.0.1:${FPORT}/`, `http://[::1]:${FPORT}/`]);

  ({ token, addr } = await mintToken());
  await claimOwner(root, NEUMA_ID, addr);
  const sec = await (await fetch(`${BASE}/api/v1/security/status`, { headers: { Authorization: `Bearer ${token}` } })).json().catch(() => null);
  const activeRoot = sec?.roots?.active;
  if (activeRoot && activeRoot !== root) await claimOwner(activeRoot, NEUMA_ID, addr);
});

test.afterAll(async () => {
  for (const p of [viteProc, backendProc]) {
    if (p?.pid) {
      try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* gone */ } }
    }
  }
  if (root) await fs.promises.rm(root, { recursive: true, force: true });
});

// The owed-rites gates' way past: the voice seal still says STAND ASIDE; the birth-setup gate
// has said CONTINUE TO THE DESK — FINISH SETUP LATER since 075df1276.
const STAND_ASIDE = /STAND ASIDE|FINISH SETUP LATER/;

/** The frame types that would mean a tab switch TOUCHED a sitting. */
const REBIND_TYPES = ['portal:resume', 'portal:new-session', 'companion:manifest', 'portal:interrupt'];
const rebindsSince = (rec, mark) => rec.sent.slice(mark)
  .map((raw) => { try { return JSON.parse(raw)?.type; } catch { return null; } })
  .filter((t) => REBIND_TYPES.includes(t));

test('each tab is its own live portal, and a tab switch touches neither', async ({ page }) => {
  /** Every portal socket this page opens, with everything it ever sent. */
  const sockets = [];
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/ws?')) return;
    const rec = { ws, sent: [], closed: false };
    ws.on('framesent', (f) => rec.sent.push(String(f.payload)));
    ws.on('close', () => { rec.closed = true; });
    sockets.push(rec);
  });

  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: id }));
    sessionStorage.setItem('authToken', t);
    // The arrival veil is not under test, and holds pointer events while it
    // plays — the meditation-panel precedent skips it the same way.
    sessionStorage.setItem(`arrivalSeen:${w}`, '1');
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto(`http://localhost:${FPORT}/`);
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });

  // STAND ASIDE past the fixture lane's owed-rites gates (nite.spec pattern) —
  // a bare e2e lane owes its voice seal and birth setup, and both hold
  // pointer events; neither is under test here.
  for (const gate of ['.voice-seal-gate', '.birth-setup-gate']) {
    const button = page.locator(`${gate} button`, { hasText: STAND_ASIDE });
    if (await button.isVisible({ timeout: 5000 }).catch(() => false)) {
      await button.click();
      await expect(page.locator(gate)).toHaveCount(0, { timeout: 20000 });
    }
  }

  // The desk's own portal, and the seeded first tab.
  await expect(page.locator('.tabstrip-tab')).toHaveCount(1, { timeout: 20000 });
  await expect.poll(() => sockets.filter((s) => !s.closed).length, { timeout: 20000 }).toBe(1);

  // + TAB → a second sitting with the same being, focused, on ITS OWN socket.
  await page.locator('.tabstrip-new').click();
  await expect(page.locator('.tabstrip-tab')).toHaveCount(2);
  const strip = page.locator('.tabstrip-tab');
  await expect(strip.nth(1).locator('.tabstrip-face')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => sockets.filter((s) => !s.closed).length, { timeout: 20000 }).toBe(2);

  // Let the new portal finish seating (its manifest rides its own socket),
  // then mark both wires and START THE CLAIM: switching sends NOTHING.
  await page.waitForTimeout(1500);
  const marks = sockets.map((s) => s.sent.length);

  // Switch back to tab 1…
  await strip.nth(0).locator('.tabstrip-face').click();
  await expect(strip.nth(0).locator('.tabstrip-face')).toHaveAttribute('aria-selected', 'true');
  // …and forward to tab 2 again.
  await strip.nth(1).locator('.tabstrip-face').click();
  await expect(strip.nth(1).locator('.tabstrip-face')).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(1000);

  // NOTHING was rebound, resumed, re-manifested, or interrupted — on either
  // sitting's socket. This is the whole fix, read off the wire.
  sockets.forEach((rec, i) => {
    expect(rebindsSince(rec, marks[i]), `socket ${i} saw rebind frames on a mere tab switch`).toEqual([]);
  });

  // Closing tab 2 closes ITS portal and only its portal.
  await strip.nth(1).locator('.tabstrip-close').click();
  await expect(page.locator('.tabstrip-tab')).toHaveCount(1);
  await expect.poll(() => sockets.filter((s) => !s.closed).length, { timeout: 20000 }).toBe(1);
  expect(sockets[0].closed, 'the first sitting\'s socket must survive').toBe(false);

  // THE RE-SCAN LIVES WHERE THE REFUSAL SENDS YOU (Design note, 2026-08-28: […]): the SUBSTRATE window
  // offers the capacity card — with the seeded record, as RE-SCAN — even on a
  // stack whose serving lens is down (the record is a disk fact).
  await page.locator('.taskbar-app[data-app-id="substrate"]').click();
  await expect(page.locator('.sub-panel-title', { hasText: 'PARALLEL CAPACITY' })).toBeVisible();
  await expect(page.locator('.rec-run', { hasText: 'RE-SCAN CAPACITY' })).toBeVisible();
});

test('past the measured ceiling every tab still connects — nothing parks, nothing is held', async ({ page }) => {
  // Design note, 2026-10-15: […] A live portal is a view; generation waits its place in the house's line.
  const sockets = [];
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/ws?')) return;
    const rec = { ws, sent: [], closed: false };
    ws.on('close', () => { rec.closed = true; });
    sockets.push(rec);
  });
  const live = () => sockets.filter((s) => !s.closed).length;

  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: id }));
    sessionStorage.setItem('authToken', t);
    sessionStorage.setItem(`arrivalSeen:${w}`, '1');
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto(`http://localhost:${FPORT}/`);
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  for (const gate of ['.voice-seal-gate', '.birth-setup-gate']) {
    const button = page.locator(`${gate} button`, { hasText: STAND_ASIDE });
    if (await button.isVisible({ timeout: 5000 }).catch(() => false)) {
      await button.click();
      await expect(page.locator(gate)).toHaveCount(0, { timeout: 20000 });
    }
  }
  await expect(page.locator('.tabstrip-tab')).toHaveCount(1, { timeout: 20000 });
  const strip = page.locator('.tabstrip-tab');
  const face = (i) => strip.nth(i).locator('.tabstrip-face');

  // Five sittings on a rig measured for fewer: each tab opens, takes focus and connects its own portal.
  for (let n = 2; n <= 5; n += 1) {
    await page.locator('.tabstrip-new').click();
    await expect(strip).toHaveCount(n);
    await expect(face(n - 1)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(live, { timeout: 20000 }).toBe(n);
    await page.waitForTimeout(800);
  }
  await expect(page.locator('.tabstrip-refusal')).toHaveCount(0);
  await expect(page.locator('[data-held="true"]')).toHaveCount(0);

  // Back to an earlier tab: it is still connected — no reconnect, nothing was parked.
  const opened = sockets.length;
  await face(1).click();
  await expect(face(1)).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(1500);
  expect(sockets.length).toBe(opened);
  expect(live()).toBe(5);
  await expect(page.locator('.tabstrip-refusal')).toHaveCount(0);
});
