// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { openDockApp } from './helpers/dock.js';
import { passDeskGates } from './helpers/desk-gates.js';
import { claimOwner } from '../helpers/claim-owner.js';

/**
 * End-to-end WINDOW SPLIT — the editor-group idiom on the desk (Founder
 * 2026-07-24: […]). Dragging one floating window over a sibling's side
 * band divides the sibling's space: the dragged window takes that half,
 * the sibling keeps the other, both persisted. Driven for real: real
 * backend child, real vite dev server, real challenge-sign-verify auth,
 * real pointer choreography on a real chromium page. No mock anywhere on
 * a claimed path (RULE 0).
 *
 * SAFETY LAW: NEVER a live witness stack — own stack on PID-derived
 * bind-probed ports, disposable temp WORKSPACES_ROOT, realm isolated into
 * the temp dir (explorer-panel.spec.js precedent).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Distinct base from the other isolated stacks (7731/3731, 7581/3581,
// 8331/4331, 8251/4251, 8181/4181, 7891/3891, 8051/4051, 7411/3511).
// PROCESS-SAFETY LAW: an occupied port means pick another port, NEVER
// touch the listener.
const FPORT_BASE = 8411 + (process.pid % 149);
const BPORT_BASE = 4411 + (process.pid % 149);
let FPORT;
let BPORT;
let BASE;
const NEUMA_ID = 'e2e-winsplit';

const canBind = (port) => new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.listen(port, () => srv.close(() => resolve(true)));
});
const freePort = async (start) => {
  for (let p = start; p < start + 120; p += 1) {
    if (await canBind(p)) return p;
  }
  throw new Error(`no free port in [${start}, ${start + 120})`);
};

const readClaudeWallet = () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  return pk;
};

// Real session token via the isolated backend's challenge-sign-verify.
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
  FPORT = await freePort(FPORT_BASE);
  BPORT = await freePort(BPORT_BASE);
  BASE = `http://localhost:${BPORT}`;
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'winsplit-e2e-'));
  const env = {
    ...process.env,
    PORT: String(BPORT),
    FRONTEND_PORT: String(FPORT),
    WORKSPACES_ROOT: root,
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_FILES_SETTINGS_PATH: path.join(root, 'files-settings.json'),
    NEUMA_REALM_SETTINGS_PATH: path.join(root, 'realm-settings.json'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
    // THE WHOLE DATA ROOT is disposable too (perf-harness.js precedent): the
    // repo's data/settings holds the live social queue and channel credentials,
    // and every backend starts the post scheduler at boot.
    NEUMA_DATA_ROOT: path.join(root, 'data'),
    NEUMA_VAULT_ROOT: path.join(root, 'vault'),
    NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'),
    NEUMA_RATE_GLOBAL_MAX: '5000',
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
  // PROCESS-SAFETY LAW: recorded PIDs ONLY — never pkill/pattern matching.
  for (const p of [viteProc, backendProc]) {
    if (p?.pid) {
      try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* gone */ } }
    }
  }
  if (root) await fs.promises.rm(root, { recursive: true, force: true });
});

test.use({ viewport: { width: 1600, height: 900 } });

// Seed a session AND a deliberate two-window layout: the target (TASKS)
// roomy enough to halve (halves must clear the 320x220 minimum), the
// dragged window (CHATS) beside it, both clear of the desk's aero bands.
const initSession = (page) => page.addInitScript(({ t, a, id }) => {
  const w = a.toLowerCase();
  localStorage.setItem('walletAddress', a);
  localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: id }));
  // Seed-if-absent: init scripts re-run on EVERY navigation, and a reload
  // must see what the desk PERSISTED (the divide), never a re-clobbered seed.
  const seed = (k, v) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(v)); };
  seed(`${w}:win:todo`, { x: 850, y: 120, w: 700, h: 500 });
  seed(`${w}:win:chats`, { x: 340, y: 120, w: 340, h: 300 });
  sessionStorage.setItem('authToken', t);
}, { t: token, a: addr, id: NEUMA_ID });

const settleDesk = async (page) => {
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  // the voice's first seal over the birth setup — both stood aside, topmost first
  await passDeskGates(page);
};

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await initSession(page);
  await page.goto(`http://localhost:${FPORT}/`);
  await settleDesk(page);
});

const winByTitle = (page, title) =>
  page.locator('.fwin').filter({ has: page.locator('.fwin-bar-title', { hasText: title }) });

// The very first drag on a fresh window can be swallowed while the desk is
// still settling (multi-terminal.spec.js precedent) — engage by the bar and
// retry until the window demonstrably follows, then leave the pointer DOWN
// for the caller to carry on.
const engageDrag = async (page, win) => {
  let engaged = false;
  for (let i = 0; i < 8 && !engaged; i += 1) {
    const box = await win.locator('.fwin-bar').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10, { steps: 4 });
    engaged = await win.evaluate((el) => el.classList.contains('is-dragging')).catch(() => false);
    if (!engaged) {
      await page.mouse.up();
      await page.waitForTimeout(250);
    }
  }
  expect(engaged, 'the drag gesture engaged').toBe(true);
};

const near = (a, b) => Math.abs(a - b) <= 3;
const expectRect = (box, want) => {
  expect(
    near(box.x, want.x) && near(box.y, want.y) && near(box.width, want.w) && near(box.height, want.h),
    `got ${JSON.stringify(box)}, want ${JSON.stringify(want)}`,
  ).toBe(true);
};

test('dragging a window onto a sibling\'s side divides the sibling\'s space perfectly in half — and the divide persists', async ({ page }) => {
  await openDockApp(page, 'TASKS');
  await openDockApp(page, 'CHATS');
  const tasks = winByTitle(page, 'TASKS');
  const chats = winByTitle(page, 'CHATS');
  await expect(tasks).toBeVisible();
  await expect(chats).toBeVisible();

  // The target's rect BEFORE the divide is the whole truth the halves must
  // tile — measured live, never assumed.
  const target = await tasks.boundingBox();

  // Real pointer choreography: grab CHATS by its bar, carry it into the
  // left quarter of TASKS (fx ≈ 0.06 — inside the split band, clear of
  // the desk's own aero bands), and let go.
  // A DIVIDE IS ASKED FOR (ruling, 2026-10-05): Shift held, and the pointer resting
  // on the seam until the preview lights — only then does a release apply it.
  await engageDrag(page, chats);
  await page.keyboard.down('Shift');
  await page.mouse.move(target.x + 40, target.y + target.height / 2, { steps: 12 });
  await expect(page.locator('.fwin-snap-cell')).toHaveCount(0);
  await expect(page.locator('.fwin-snap-cell')).toHaveCount(1, { timeout: 2000 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  // The divide: CHATS takes the left half, TASKS keeps the right.
  const half = { w: target.width / 2, h: target.height };
  await expect(async () => {
    expectRect(await chats.boundingBox(), { x: target.x, y: target.y, ...half });
    expectRect(await tasks.boundingBox(), { x: target.x + target.width / 2, y: target.y, ...half });
  }).toPass({ timeout: 10000 });

  // Both sides persisted: a fresh arrival re-raises the same divide.
  await page.reload();
  await settleDesk(page);
  await expect(winByTitle(page, 'TASKS')).toBeVisible();
  await expect(winByTitle(page, 'CHATS')).toBeVisible();
  expectRect(await winByTitle(page, 'CHATS').boundingBox(), { x: target.x, y: target.y, ...half });
  expectRect(await winByTitle(page, 'TASKS').boundingBox(), { x: target.x + target.width / 2, y: target.y, ...half });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the calm middle never splits — a drop there is a plain move', async ({ page }) => {
  await openDockApp(page, 'TASKS');
  await openDockApp(page, 'CHATS');
  const tasks = winByTitle(page, 'TASKS');
  const chats = winByTitle(page, 'CHATS');
  await expect(chats).toBeVisible();

  const target = await tasks.boundingBox();
  const source = await chats.boundingBox();

  // Drop dead-centre of TASKS: no divide — CHATS simply moves, TASKS
  // stands exactly where and how it stood.
  await engageDrag(page, chats);
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();

  expectRect(await tasks.boundingBox(), { x: target.x, y: target.y, w: target.width, h: target.height });
  const moved = await chats.boundingBox();
  expect(near(moved.width, source.width) && near(moved.height, source.height),
    'a plain move never resizes the dragged window').toBe(true);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// THE HELD SNAP (Design note, 2026-10-05: […]). Reaching a zone decides nothing; a
// window carried THROUGH one and let go stays exactly where it was let go.
test('resting on a sibling\'s seam WITHOUT Shift — a plain move, never a divide', async ({ page }) => {
  await openDockApp(page, 'TASKS');
  await openDockApp(page, 'CHATS');
  const tasks = winByTitle(page, 'TASKS');
  const chats = winByTitle(page, 'CHATS');
  await expect(chats).toBeVisible();
  const target = await tasks.boundingBox();
  const source = await chats.boundingBox();

  await engageDrag(page, chats);
  await page.mouse.move(target.x + 40, target.y + target.height / 2, { steps: 12 });
  await page.waitForTimeout(1200); // well past the hold — still no Shift, still no offer
  await expect(page.locator('.fwin-snap-cell')).toHaveCount(0);
  await page.mouse.up();

  expectRect(await tasks.boundingBox(), { x: target.x, y: target.y, w: target.width, h: target.height });
  const moved = await chats.boundingBox();
  expect(near(moved.width, source.width) && near(moved.height, source.height),
    'a window carried over another keeps its own size').toBe(true);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the top edge maximizes only when HELD there — touched in passing, it never does', async ({ page }) => {
  await openDockApp(page, 'CHATS');
  const chats = winByTitle(page, 'CHATS');
  await expect(chats).toBeVisible();
  const source = await chats.boundingBox();
  const { width } = page.viewportSize();

  // In passing: carried up against the very top and let go there at once.
  await engageDrag(page, chats);
  await page.mouse.move(width / 2, 1, { steps: 10 });
  await page.mouse.up();
  const passed = await chats.boundingBox();
  expect(near(passed.width, source.width), 'touching the top edge in passing never maximizes').toBe(true);

  // Held: the preview lights after the pause, and the release maximizes.
  await engageDrag(page, chats);
  await page.mouse.move(width / 2, 1, { steps: 10 });
  await expect(page.locator('.fwin-snap-cell')).toHaveCount(1, { timeout: 2000 });
  await page.mouse.up();
  await expect(async () => {
    expect((await chats.boundingBox()).width).toBeGreaterThan(source.width * 1.5);
  }).toPass({ timeout: 5000 });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ESCAPE ×5, OUTSIDE EVERYTHING, CLOSES EVERY WINDOW (ruling, 2026-10-05).
test('Escape five times on the bare desk closes every window — four never does, typing never does', async ({ page }) => {
  await openDockApp(page, 'TASKS');
  await openDockApp(page, 'CHATS');
  const open = page.locator('.fwin');
  const before = await open.count();
  expect(before).toBeGreaterThanOrEqual(2);
  const presses = async (n) => { for (let i = 0; i < n; i += 1) await page.keyboard.press('Escape', { delay: 40 }); };
  const bare = () => page.evaluate(() => document.activeElement?.blur?.());

  // While typing: never, however many times.
  const field = page.locator('.fwin textarea, .fwin input[type="text"]').first();
  if (await field.count()) { await field.focus(); await presses(6); await expect(open).toHaveCount(before); }

  await bare();
  await presses(4);
  await page.waitForTimeout(800); // the streak lapses
  await expect(open).toHaveCount(before);

  await bare();
  await presses(5);
  await expect(open).toHaveCount(0, { timeout: 5000 });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
