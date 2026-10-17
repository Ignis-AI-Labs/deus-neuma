// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { claimOwner } from '../helpers/claim-owner.js';

/**
 * End-to-end STREAM CHAT RAIL — the quick chat list beside the tasks. Drives
 * the REAL browser against a REAL backend: real auth (challenge-sign-verify
 * with Claude's witness wallet), the real session store on real disk, the real
 * chat-label route. Nothing on any claimed path is mocked (RULE 0).
 *
 * The claim under test (Design note, 2026-08-25: a rail this narrow truncates long
 * chat names by construction, so hovering a row must SHOW THE WHOLE NAME, and
 * the rows must read at the tasks rail's weight rather than a smaller one.
 * Both are things only a real browser can answer — a computed font size and a
 * tooltip that must escape a clipping scroller.
 *
 * SAFETY LAW: never the live witness stack — this file boots its OWN backend +
 * vite on PID-derived bind-probed ports with a disposable WORKSPACES_ROOT and
 * the NEUMA_* isolation doors, so the operator's real beings and realm can
 * never be read or written here.
 *
 * Needs no LLM: nothing in this file sends a thought.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Distinct base from every other isolated stack (tasks 7461/3461, model-bar
// 7621/3621, attach 7891/3891, terminal 7581/3581, explorer 7731/3731).
// PROCESS-SAFETY LAW: an occupied port means pick another port, NEVER touch
// the listener.
const FPORT_BASE = 7291 + (process.pid % 149);
const BPORT_BASE = 3291 + (process.pid % 149);
const NEUMA_ID = 'e2e-chatbeing';

// Three real sittings on disk, oldest first. Fixed instants, so the stamps the
// rail prints are predictable without the spec re-deriving them.
const MINTED = [1755229380000, 1755315780000, 1755402180000];
const SESSIONS = MINTED.map((ms) => `session-${ms}`);
// Far longer than the ~180px the rail gives a name: this is the row whose
// ellipsis the hover tip has to undo.
const LONG_NAME = 'MIRROR LOOP DESIGN AND THE SELF-REFINEMENT COOLDOWN LEDGER';

let FPORT;
let BPORT;
let BASE;
let FRONT;
let root;
let backendProc;
let viteProc;
let token;
let addr;

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

const mintToken = async () => {
  const w = new ethers.Wallet(readClaudeWallet());
  const { challenge } = await (await fetch(`${BASE}/api/v1/auth/challenge?address=${w.address}`)).json();
  const signature = await w.signMessage(challenge);
  const res = await fetch(`${BASE}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: w.address, signature, challenge }),
  });
  const { token: t } = await res.json();
  if (!t) throw new Error('auth/verify returned no token');
  return { token: t, addr: w.address };
};

// Returns the url that ANSWERED. Vite binds [::1] on this box while the
// backend binds 127.0.0.1 only, so the address the browser must be sent to is
// discovered, never assumed — a hardcoded 127.0.0.1 dies with
// ERR_CONNECTION_REFUSED and reads as a UI regression (observed, 2026-08-25).
const waitFor = async (urls, ms = 90000) => {
  const list = Array.isArray(urls) ? urls : [urls];
  const t0 = Date.now();
  for (;;) {
    for (const url of list) {
      try {
        const r = await fetch(url);
        if (r.status < 500) return url;
      } catch { /* not listening yet */ }
    }
    if (Date.now() - t0 > ms) throw new Error(`stack member never answered: ${list.join(' | ')}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

// Real sittings, written the way the workspace writes them: one JSONL record
// per line under the lane's own sessions/ directory. listSessions reads this
// directory for real — nothing here stands in for the store.
const seedSessions = async () => {
  const dir = path.join(root, NEUMA_ID, 'sessions');
  await fs.promises.mkdir(dir, { recursive: true });
  for (const [i, id] of SESSIONS.entries()) {
    const at = new Date(MINTED[i]).toISOString();
    const lines = [
      { role: 'user', content: `what did we settle in sitting ${i + 1}?`, timestamp: at },
      { role: 'assistant', content: `sitting ${i + 1} settled the cooldown.`, timestamp: at },
    ];
    await fs.promises.writeFile(
      path.join(dir, `${id}.jsonl`),
      `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`,
    );
  }
};

// The operator's own name for a chat, through the real realm route — the same
// door ChatsApp's RENAME uses.
const nameChat = async (sessionId, label) => {
  const res = await fetch(`${BASE}/api/v1/user/realm/chat-labels`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ neumaId: NEUMA_ID, sessionId, label }),
  });
  if (!res.ok) throw new Error(`naming a chat failed (${res.status})`);
};

test.beforeAll(async () => {
  FPORT = await freePort(FPORT_BASE);
  BPORT = await freePort(BPORT_BASE);
  // 127.0.0.1, NOT localhost: the backend binds IPv4 only, and where localhost
  // resolves to ::1 first the health wait never answers. The frontend wait
  // tries both — vite binds IPv6.
  BASE = `http://127.0.0.1:${BPORT}`;
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'railchats-e2e-'));
  const env = {
    ...process.env,
    PORT: String(BPORT),
    FRONTEND_PORT: String(FPORT),
    WORKSPACES_ROOT: root,
    WITNESSES_ROOT: path.join(root, 'witnesses'),
    AI_WITNESSES_ROOT: path.join(root, 'witness-home'),
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_FILES_SETTINGS_PATH: path.join(root, 'files-settings.json'),
    NEUMA_REALM_SETTINGS_PATH: path.join(root, 'realm-settings.json'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
    SUBSTRATE_IDLE_MINUTES: '0',
    // The titler's door: a DEAD local port. The auto-title batch runs its real
    // route and reports honestly without ever reaching a model — this file
    // sends no thought, and the operator's real provider config (which the
    // data root is NOT isolated from here) must never answer a spec.
    LLM_PROVIDER: 'lm-studio',
    LM_STUDIO_URL: 'http://127.0.0.1:9',
    // This rig replays the whole desk several times a minute and outruns a
    // ceiling real use never approaches (stream-tasks.spec precedent).
    NEUMA_RATE_GLOBAL_MAX: '5000',
  };
  backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  viteProc = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  await waitFor(`${BASE}/api/v1/health`);
  // Which family vite actually bound decides the browser's address — but it is
  // sent to the NAME, never the literal [::1]: the portal builds its WebSocket
  // url from window.location.host, and a bracketed v6 literal there arrives as
  // "Portal disconnected…" with a perfectly healthy backend behind it.
  const front = await waitFor([`http://[::1]:${FPORT}/`, `http://127.0.0.1:${FPORT}/`]);
  FRONT = front.includes('[::1]') ? `http://localhost:${FPORT}/` : front;

  ({ token, addr } = await mintToken());
  await claimOwner(root, NEUMA_ID, addr);
  await seedSessions();
  await nameChat(SESSIONS[2], LONG_NAME);
  await nameChat(SESSIONS[1], 'SHORT ONE');
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

// The desk lands behind THREE overlays, cleared in order on every load.
const standAside = async (page) => {
  const veil = page.locator('.arrival');
  if (await veil.count()) {
    await veil.click({ force: true }).catch(() => {});
    await expect(veil).toHaveCount(0, { timeout: 20000 });
  }
  for (const gate of ['.voice-seal-gate', '.birth-setup-gate']) {
    // Each gate's own dismiss words: the voice seal still says STAND ASIDE;
    // the birth-setup checklist's dismiss became CONTINUE TO THE DESK
    // (075df1276) — this helper must read the desk as it IS.
    const words = gate === '.birth-setup-gate' ? 'FINISH SETUP LATER' : 'STAND ASIDE';
    const button = page.locator(`${gate} button`, { hasText: words });
    if (await button.isVisible({ timeout: 5000 }).catch(() => false)) {
      await button.click();
      await expect(page.locator(gate)).toHaveCount(0, { timeout: 20000 });
    }
  }
};

// The rail publishes a button to the one shared strip; the panel opens there.
const openChats = async (page) => {
  await page.locator('.stream-rail-tab', { hasText: 'CHATS' }).click();
  await expect(page.locator('.stream-chats')).toBeVisible({ timeout: 20000 });
};

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Chatbeing', neumaId: id }));
    sessionStorage.setItem('authToken', t);
    localStorage.removeItem(`${w}:stream:rail`);
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto(FRONT);
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 15000 });
  await standAside(page);
});

test('the rail lists the real sittings on disk, newest first, short-stamped', async ({ page }) => {
  await openChats(page);
  const rows = page.locator('.stream-chats-row');
  await expect(rows).toHaveCount(3, { timeout: 20000 });
  // Newest first — the named long one was minted last.
  await expect(rows.nth(0).locator('.stream-chats-label')).toHaveText(LONG_NAME);
  await expect(rows.nth(1).locator('.stream-chats-label')).toHaveText('SHORT ONE');
  // The unnamed one wears its own short date AND time, never a bare date.
  await expect(rows.nth(2).locator('.stream-chats-label')).toHaveText(/^\d{2}\/\d{2}\/\d{2} \d{1,2}:\d{2} (AM|PM)$/);
  await expect(rows.nth(0).locator('.stream-chats-stamp')).toHaveText(/^\d{2}\/\d{2}\/\d{2}$/);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('a long name really is cut off on screen — the tip has something to undo', async ({ page }) => {
  await openChats(page);
  const label = page.locator('.stream-chats-row').first().locator('.stream-chats-label');
  await expect(label).toBeVisible({ timeout: 20000 });
  // Measured, not assumed: the text genuinely overflows its box.
  const cut = await label.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(cut, 'the long chat name should overflow the rail — otherwise this spec proves nothing').toBe(true);
});

test('hovering a row shows the WHOLE name, on screen and clear of the rail', async ({ page }) => {
  await openChats(page);
  const row = page.locator('.stream-chats-row').first();
  await expect(row).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.stream-chats-tip')).toHaveCount(0);

  await row.hover();
  const tip = page.locator('.stream-chats-tip');
  await expect(tip).toBeVisible({ timeout: 5000 });
  // The whole name, plus the exact instant the sitting was minted.
  await expect(tip).toContainText(LONG_NAME);
  await expect(tip).toContainText(/\d{4}/); // the long-form year, not the short stamp

  // VISIBLE state, not just presence: the tip must sit inside the viewport and
  // clear of the row it describes. A tip clipped by the scroller or drawn
  // off-screen reads as "shown" to a DOM check and shows the operator nothing
  // — which is exactly what happened before it was portalled out of the
  // stream's transformed ancestor (measured: 1346px down a 720px viewport).
  const [tipBox, rowBox, view] = await Promise.all([
    tip.boundingBox(),
    row.boundingBox(),
    page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight })),
  ]);
  expect(tipBox.x).toBeGreaterThanOrEqual(0);
  expect(tipBox.y).toBeGreaterThanOrEqual(0);
  expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(view.w);
  expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(view.h);
  expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(rowBox.x);

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the tip leaves with the pointer, and never blocks the row beneath it', async ({ page }) => {
  await openChats(page);
  const row = page.locator('.stream-chats-row').first();
  await row.hover();
  await expect(page.locator('.stream-chats-tip')).toBeVisible({ timeout: 5000 });
  // Never captures the pointer: the row under it stays the hit target.
  await expect(page.locator('.stream-chats-tip')).toHaveCSS('pointer-events', 'none');
  await page.locator('.stream-chats-head').hover();
  await expect(page.locator('.stream-chats-tip')).toHaveCount(0);
});

test('the last row hovers too — its tip is pushed up rather than off-screen', async ({ page }) => {
  await openChats(page);
  const rows = page.locator('.stream-chats-row');
  await rows.last().hover();
  const tip = page.locator('.stream-chats-tip');
  await expect(tip).toBeVisible({ timeout: 5000 });
  const [box, view] = await Promise.all([
    tip.boundingBox(),
    page.evaluate(() => window.innerHeight),
  ]);
  expect(box.y + box.height).toBeLessThanOrEqual(view);
});

test('chat rows read at the tasks rail\'s weight, not a smaller one', async ({ page }) => {
  await openChats(page);
  const label = page.locator('.stream-chats-row').first().locator('.stream-chats-label');
  await expect(label).toBeVisible({ timeout: 20000 });
  // COMPUTED paint, not a class name (#332): the operator asked for bigger
  // text, and only the browser can say what size it actually renders at.
  const size = await label.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(12);
  // A row you scroll past dozens of needs a real click target.
  const height = (await page.locator('.stream-chats-row').first().boundingBox()).height;
  expect(height).toBeGreaterThanOrEqual(28);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('right-click a row offers RENAME and AUTO-TITLE; RENAME lands the name for real', async ({ page }) => {
  await openChats(page);
  const rows = page.locator('.stream-chats-row');
  await expect(rows).toHaveCount(3, { timeout: 20000 });

  // Right-click the one UNNAMED sitting: the menu is the rail's own portalled
  // UI, not a native one.
  await rows.nth(2).click({ button: 'right' });
  const menu = page.locator('.stream-chats-ctx');
  await expect(menu).toBeVisible({ timeout: 5000 });
  await expect(menu.locator('.stream-chats-ctx-item', { hasText: 'RENAME' })).toBeVisible();
  await expect(menu.locator('.stream-chats-ctx-item', { hasText: 'AUTO-TITLE' })).toBeVisible();

  await menu.locator('.stream-chats-ctx-item', { hasText: 'RENAME' }).click();
  const input = page.locator('.stream-chats-rename-input');
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill('COOLDOWN ORIGIN');
  await input.press('Enter');

  // The row wears the name without a reload — the REAL chat-label route wrote
  // it, and the rail adopted its own updated map.
  await expect(page.locator('.stream-chats-row').nth(2).locator('.stream-chats-label'))
    .toHaveText('COOLDOWN ORIGIN', { timeout: 5000 });
  await expect(menu).toHaveCount(0);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('TITLE runs the real batch route and never clobbers kept names', async ({ page }) => {
  await openChats(page);
  const rows = page.locator('.stream-chats-row');
  await expect(rows).toHaveCount(3, { timeout: 20000 });

  await page.locator('.stream-chats-actions .stream-chats-new', { hasText: 'TITLE' }).click();
  const menu = page.locator('.stream-chats-ctx');
  await expect(menu).toBeVisible({ timeout: 5000 });
  await menu.locator('.stream-chats-ctx-item', { hasText: 'TITLE UNTITLED' }).click();

  // The run reports in its own words — the verdict line replaces NAMING….
  // (This stack's titler door is a dead port by env, so the honest verdict is
  // a reported failure; the assertion is the LAW, not the model's wit.)
  const note = page.locator('.stream-chats-note');
  await expect(note).toHaveText(/NAMED|NOTHING/, { timeout: 20000 });

  // THE LAW the batch exists to keep: without `force`, names the witness kept
  // survive whatever the run decided.
  await expect(rows.nth(0).locator('.stream-chats-label')).toHaveText(LONG_NAME);
  await expect(rows.nth(1).locator('.stream-chats-label')).toHaveText('SHORT ONE');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
