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
 * End-to-end STREAM TASK RAIL — the collapsible task list pinned inside the
 * stream. Drives the REAL browser against a REAL backend: real auth
 * (challenge-sign-verify with Claude's witness wallet), the real task API, the
 * real plan on real disk. Nothing on any claimed path is mocked (RULE 0).
 *
 * SAFETY LAW: never the live witness stack — this file boots its OWN backend +
 * vite on PID-derived bind-probed ports with a disposable WORKSPACES_ROOT and
 * the NEUMA_* isolation doors (composer-attach.spec precedent), so the
 * operator's real beings, tasks and realm can never be read or written here.
 *
 * Needs no LLM: nothing in this file sends a thought.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Distinct base from every other isolated stack (model-bar 7621/3621, attach
// 7891/3891, terminal 7581/3581, context-map 7411/3511, explorer 7731/3731).
// PROCESS-SAFETY LAW: an occupied port means pick another port, NEVER touch the
// listener.
const FPORT_BASE = 7461 + (process.pid % 149);
const BPORT_BASE = 3461 + (process.pid % 149);
const NEUMA_ID = 'e2e-railbeing';
// A second lane, so the ALL BEINGS foot has someone to name.
const OTHER_ID = 'e2e-railother';

let FPORT;
let BPORT;
let BASE;
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

const tasks = (route, init = {}) => fetch(`${BASE}/api/v1/tasks${route}`, {
  ...init,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
});

// Setup that fails must SAY so: a silently refused assignment would read as […] when the truth is […].
const assign = async (fields) => {
  const res = await tasks(`/neuma/${NEUMA_ID}`, { method: 'POST', body: JSON.stringify(fields) });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 201) throw new Error(`assign failed (${res.status}): ${JSON.stringify(body)}`);
  return body.task;
};

// A clean slate per test: settle whatever the previous test assigned, so each
// starts from an honest empty plan (the lane is this suite's own being).
const clearAssigned = async () => {
  const { plan } = await (await tasks(`/neuma/${NEUMA_ID}`)).json();
  for (const t of (plan?.tasks || []).filter((x) => x.status === 'open')) {
    await tasks(`/neuma/${NEUMA_ID}/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'dropped' }) });
  }
};

test.beforeAll(async () => {
  FPORT = await freePort(FPORT_BASE);
  BPORT = await freePort(BPORT_BASE);
  // 127.0.0.1, NOT localhost: the backend binds IPv4 only, and where localhost
  // resolves to ::1 first the health wait never answers — the spec then dies in
  // beforeEach and reads as a UI regression. The frontend wait tries both.
  BASE = `http://127.0.0.1:${BPORT}`;
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'railtasks-e2e-'));
  const env = {
    ...process.env,
    PORT: String(BPORT),
    FRONTEND_PORT: String(FPORT),
    WORKSPACES_ROOT: root,
    // A witness lane resolves to dirname(WORKSPACES_ROOT)/witnesses; pin it
    // inside this stack's own temp root so nothing reaches a real lane.
    WITNESSES_ROOT: path.join(root, 'witnesses'),
    // …and the witness REGISTRY, or this stack enumerates the operator's real
    // sealed witnesses (observed: nine of them, every lane 404ing) — names that
    // have no business in an isolated run.
    AI_WITNESSES_ROOT: path.join(root, 'witness-home'),
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_FILES_SETTINGS_PATH: path.join(root, 'files-settings.json'),
    NEUMA_REALM_SETTINGS_PATH: path.join(root, 'realm-settings.json'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
    SUBSTRATE_IDLE_MINUTES: '0',
    // This rig replays a whole desk (roster, projects, settings, tasks) six
    // times in two minutes and outruns the 200/min-per-wallet ceiling that real
    // use never approaches. The env door exists for exactly this (window-split
    // .spec precedent, rate-limiter.test.js says so out loud). The 429 GUARD in
    // the deep-link test still stands, so a genuine limiter trip fails loudly.
    NEUMA_RATE_GLOBAL_MAX: '5000',
  };
  backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  viteProc = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  await waitFor(`${BASE}/api/v1/health`);
  await waitFor([`http://127.0.0.1:${FPORT}/`, `http://[::1]:${FPORT}/`]);

  ({ token, addr } = await mintToken());
  await claimOwner(root, NEUMA_ID, addr);
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

// The desk lands behind THREE overlays, and they must be cleared in order on
// every load — not just the first. Proven the hard way twice.
const standAside = async (page) => {
  // The arrival veil intercepts pointer events while it parts, so a gate click
  // beneath it times out against a button that is perfectly fine.
  const veil = page.locator('.arrival');
  if (await veil.count()) {
    await veil.click({ force: true }).catch(() => {});
    await expect(veil).toHaveCount(0, { timeout: 20000 });
  }
  // Then the gates, TOP FIRST: the voice seal gate lies over the birth setup
  // gate and BOTH wear a STAND ASIDE button.
  for (const gate of ['.voice-seal-gate', '.birth-setup-gate']) {
    const button = page.locator(`${gate} button`, { hasText: 'STAND ASIDE' });
    if (await button.isVisible({ timeout: 5000 }).catch(() => false)) {
      await button.click();
      await expect(page.locator(gate)).toHaveCount(0, { timeout: 20000 });
    }
  }
};

// One reload + re-stand, since the rail is read on mount.
const reload = async (page) => {
  await page.reload();
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 15000 });
  await standAside(page);
};

test.beforeEach(async ({ page }) => {
  await clearAssigned();
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Railbeing', neumaId: id }));
    sessionStorage.setItem('authToken', t);
    // The rail's own fold memory: start expanded so each test states its own
    // starting point instead of inheriting the last one's click.
    localStorage.removeItem(`${w}:stream:tasks`);
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto(`http://localhost:${FPORT}/`);
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 15000 });
  await standAside(page);
});

test('the rail is pinned inside the stream and names the being it is about', async ({ page }) => {
  const rail = page.locator('.stream-tasks');
  await expect(rail).toBeVisible({ timeout: 20000 });
  await expect(rail.locator('.stream-tasks-title')).toContainText('TASKS // RAILBEING');
  // Pinned INSIDE the stream, right of the conversation — not out on the desk.
  await expect(page.locator('.stream-row > .stream-col + .stream-tasks')).toHaveCount(1);
  const railBox = await rail.boundingBox();
  const colBox = await page.locator('.stream-col').boundingBox();
  expect(railBox.x).toBeGreaterThan(colBox.x);
  // An empty plan says so rather than showing a header over nothing.
  await expect(rail.locator('.stream-tasks-empty', { hasText: 'NOTHING ASSIGNED' })).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('assigned work appears in the rail, grouped by cadence', async ({ page }) => {
  await assign({ title: 'hold the post lane', cadence: 'baseline' });
  await assign({ title: 'review tone with Founder', cadence: 'daily' });
  await reload(page);

  const rail = page.locator('.stream-tasks');
  await expect(rail.locator('.stream-tasks-h', { hasText: 'BASELINE' })).toBeVisible({ timeout: 20000 });
  await expect(rail.locator('.stream-tasks-h', { hasText: 'DAILY' })).toBeVisible();
  await expect(rail.locator('.stream-tasks-row', { hasText: 'hold the post lane' })).toBeVisible();
  await expect(rail.locator('.stream-tasks-row', { hasText: 'review tone with Founder' })).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('checking a row off settles it in the real store', async ({ page }) => {
  await assign({ title: 'read the mentions feed', cadence: 'daily' });
  await reload(page);

  const row = page.locator('.stream-tasks-row', { hasText: 'read the mentions feed' });
  await expect(row).toBeVisible({ timeout: 20000 });
  await row.hover();
  await row.locator('.stream-tasks-act', { hasText: '✓' }).click();
  // It leaves the rail's open list…
  await expect(page.locator('.stream-tasks-row', { hasText: 'read the mentions feed' })).toHaveCount(0);
  // …because the STORE says done, not because the row was hidden.
  const { plan } = await (await tasks(`/neuma/${NEUMA_ID}`)).json();
  expect(plan.tasks.find((t) => t.title === 'read the mentions feed').status).toBe('done');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('folding hides the rows but never the fact that work exists, and the fold persists', async ({ page }) => {
  // Folds into its strip button now, not its own spine; the claim is unchanged.
  await assign({ title: 'launch calendar v2', cadence: 'milestone' });
  await reload(page);
  const rail = page.locator('.stream-tasks');
  await expect(rail.locator('.stream-tasks-row', { hasText: 'launch calendar v2' })).toBeVisible({ timeout: 20000 });

  const tab = page.locator('.stream-rail-tab', { hasText: 'TASKS' });
  await rail.locator('.stream-tasks-fold').click();
  await expect(tab).toBeVisible();
  await expect(tab.locator('.stream-rail-count')).toHaveText('1');
  await expect(page.locator('.stream-tasks-row')).toHaveCount(0);
  // The panel is gone; the way back in is not.
  await expect(rail).toHaveCount(0);

  // The choice survives a reload — the operator folded it away for a reason.
  await reload(page);
  await expect(page.locator('.stream-rail-tab', { hasText: 'TASKS' })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.stream-tasks-row')).toHaveCount(0);

  // And it opens again from the strip.
  await page.locator('.stream-rail-tab', { hasText: 'TASKS' }).click();
  await expect(page.locator('.stream-tasks-row', { hasText: 'launch calendar v2' })).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('ONE strip, and only one panel open at a time', async ({ page }) => {
  // Founder: […], […].
  await assign({ title: 'launch calendar v2', cadence: 'milestone' });
  await reload(page);
  await expect(page.locator('.stream-tasks')).toBeVisible({ timeout: 20000 });

  // ONE strip holding BOTH buttons — not one strip per rail — and it stays
  // reachable WHILE a panel is open, which is the whole point: before this you
  // had to fold one rail to get at the other.
  const tab = (word) => page.locator('.stream-rail-tab', { hasText: word });
  await expect(page.locator('.stream-rail-strip')).toBeVisible();
  await expect(page.locator('.stream-rail-strip')).toHaveCount(1);
  await expect(page.locator('.stream-rail-strip .stream-rail-tab')).toHaveCount(2);

  // Tapping another SWAPS in place; both open at once must be impossible.
  await tab('CHATS').click();
  await expect(page.locator('.stream-chats')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.stream-tasks')).toHaveCount(0);
  await tab('TASKS').click();
  await expect(page.locator('.stream-tasks')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.stream-chats')).toHaveCount(0);

  // Tapping the OPEN one folds it, leaving no panel and the strip still there.
  await tab('TASKS').click();
  await expect(page.locator('.stream-tasks')).toHaveCount(0);
  await expect(page.locator('.stream-rail-strip')).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the ALL BEINGS foot opens on demand and the editor is one click away', async ({ page }) => {
  const rail = page.locator('.stream-tasks');
  await expect(rail).toBeVisible({ timeout: 20000 });
  // Counting every other being costs a read each, so it happens only when asked.
  await rail.locator('.stream-tasks-others-h', { hasText: 'ALL BEINGS' }).click();
  await expect(rail.locator('.stream-tasks-others')).toBeVisible();

  await rail.locator('.stream-tasks-editor', { hasText: 'OPEN THE EDITOR' }).click();
  // The TASKS window — the one editor — opens on the desk.
  await expect(page.locator('.todo')).toBeVisible({ timeout: 20000 });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('a being named in ALL BEINGS opens the editor ON THAT BEING\'S TAB', async ({ page }) => {
  // A second being with live work, so the foot has someone to name. Its lane is
  // real: claimed on disk by this stack's own wallet.
  await claimOwner(root, OTHER_ID, addr);
  const res = await tasks(`/neuma/${OTHER_ID}`, {
    method: 'POST',
    body: JSON.stringify({ title: 'the other being\'s work', cadence: 'daily' }),
  });
  expect(res.status).toBe(201);
  await reload(page);

  // A standing guard, not a diagnostic: this test caught the rail fanning out a
  // read per being and tripping the rate limiter (429, ~42s lockout). If any
  // task read fails again, the failure names it instead of reading as […].
  const failures = [];
  page.on('response', async (r) => {
    if (r.url().includes('/api/v1/tasks/') && r.status() >= 400) {
      failures.push(`${r.status()} ${r.url()} :: ${await r.text().catch(() => '')}`);
    }
  });
  const rail = page.locator('.stream-tasks');
  await rail.locator('.stream-tasks-others-h', { hasText: 'ALL BEINGS' }).click();
  const other = rail.locator('.stream-tasks-other', { hasText: OTHER_ID.toUpperCase() });
  await expect(other).toBeVisible({ timeout: 20000 });
  await other.click();

  // The window opens ALREADY on that being — the latch survived the async mount.
  const todo = page.locator('.todo');
  await expect(todo).toBeVisible({ timeout: 20000 });
  // The switch followed the latch into the being's own standing, and the lane
  // picker names it — the chip wall this replaced could only ever show one
  // standing at a time by wrapping all of them (per-chat task lists, 2026-08-02).
  // contains, not equals: the tab also carries its lane count ("HOUSE2").
  await expect(todo.locator('.todo-standing-tab.is-on')).toContainText('HOUSE');
  await expect(todo.locator('.todo-lane-pick .lc-sel-value')).toHaveText(OTHER_ID.toUpperCase());
  await expect(todo.locator('.todo-row-title', { hasText: 'the other being\'s work' }),
    `task reads that failed: ${failures.join(' | ')}`).toBeVisible();
  expect(failures, 'no task read may fail — the rail asks ONCE for every count').toEqual([]);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the TASKS window groups a being\'s work BY CHAT, and the rail shows only this one', async ({ page }) => {
  // Two parallel sittings with work in each, plus one piece that stands
  // everywhere. This is Founder's ask made visible (2026-08-01): […]
  const CHAT_A = 'session-1754000000111';
  const CHAT_B = 'session-1754000000222';
  for (const [chatId, title] of [[CHAT_A, 'alpha sitting work'], [CHAT_B, 'beta sitting work']]) {
    const res = await tasks(`/neuma/${NEUMA_ID}`, {
      method: 'POST',
      body: JSON.stringify({ title, cadence: 'daily', chatId }),
    });
    expect(res.status).toBe(201);
  }
  const wide = await tasks(`/neuma/${NEUMA_ID}`, {
    method: 'POST',
    body: JSON.stringify({ title: 'stands in every sitting', cadence: 'baseline' }),
  });
  expect(wide.status).toBe(201);
  await reload(page);

  // THE RAIL, with NO chat bound. This suite never sends a thought, so the
  // portal has minted no session — and the law is that a missing chat narrows
  // NOTHING. Anything else would hide a being's work behind an absence, which
  // is the one failure mode worse than showing too much.
  const rail = page.locator('.stream-tasks');
  for (const title of ['stands in every sitting', 'alpha sitting work', 'beta sitting work']) {
    await expect(rail.locator('.stream-tasks-text', { hasText: title })).toBeVisible();
  }
  // (The narrowing itself, once a chat IS bound, is proven in
  // test/unit/todo-chat-groups.test.js — it needs a live session this
  // LLM-free suite deliberately never opens.)

  // THE WINDOW is the whole picture, so every sitting stands as its own block.
  await rail.locator('.stream-tasks-editor', { hasText: 'OPEN THE EDITOR' }).click();
  const todo = page.locator('.todo');
  await expect(todo).toBeVisible({ timeout: 20000 });
  // Opened with no being named, the window lands on ME — the operator's own
  // list, which is never chat-scoped and so shows plain cadence sections.
  await expect(todo.locator('.todo-standing-tab.is-on')).toContainText('OPERATOR');
  await expect(todo.locator('.todo-chat')).toHaveCount(0);

  // The standing switch is the way into the house — and it lands on a being,
  // not on an empty frame (the chip wall it replaced needed one click per lane
  // and wrapped to three rows at sixteen of them).
  await todo.locator('.todo-standing-tab', { hasText: 'HOUSE' }).click();
  await expect(todo.locator('.todo-standing-tab.is-on')).toContainText('HOUSE');
  await expect(todo.locator('.todo-lane-pick .lc-sel-value')).toHaveText(NEUMA_ID.toUpperCase());

  // Three blocks: one per sitting, plus the lane-wide bucket named for what it is.
  await expect(todo.locator('.todo-chat')).toHaveCount(3);
  await expect(todo.locator('.todo-chat.is-lane .todo-chat-name')).toHaveText('EVERY CHAT');

  // …and each task sits INSIDE its own chat's block, under its own cadence.
  const laneBlock = todo.locator('.todo-chat.is-lane');
  await expect(laneBlock.locator('.todo-row-title', { hasText: 'stands in every sitting' })).toBeVisible();
  await expect(laneBlock.locator('.todo-row-title', { hasText: 'alpha sitting work' })).toHaveCount(0);
  await expect(laneBlock.locator('.todo-h', { hasText: 'BASELINE' })).toBeVisible();

  const sittings = todo.locator('.todo-chat:not(.is-lane)');
  await expect(sittings).toHaveCount(2);
  await expect(sittings.filter({ hasText: 'alpha sitting work' })).toHaveCount(1);
  await expect(sittings.filter({ hasText: 'beta sitting work' })).toHaveCount(1);
  // A block that held both would be the bug this whole change exists to end.
  await expect(sittings.filter({ hasText: 'alpha sitting work' })
    .filter({ hasText: 'beta sitting work' })).toHaveCount(0);
  // Each block says how much is live in it.
  await expect(sittings.first().locator('.todo-chat-live')).toHaveText('1 LIVE');

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// SIZE AND ORDER — Design note, 2026-08-03: […]
//
// The order is the OPERATOR'S, so it is proven the way they experience it: a
// real click in a real browser, against the real store, and the choice still
// standing after a reload and in the other surface.
test('the operator chooses the order, and both surfaces obey the same choice', async ({ page }) => {
  await assign({ title: 'the epic one', cadence: 'daily', size: 'epic' });
  await assign({ title: 'the quick one', cadence: 'daily', size: 'quick' });
  await assign({ title: 'the deep one', cadence: 'daily', size: 'deep' });
  await reload(page);

  const rail = page.locator('.stream-tasks');
  const order = rail.locator('.stream-tasks-order');
  // The size rides the SAME line as the title, so the row's whole text is
  // compared: it proves the order and the visible size label in one assertion.
  const titles = async () => (await rail.locator('.stream-tasks-sec', { hasText: 'DAILY' })
    .locator('.stream-tasks-text').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());

  // MY ORDER is where it starts, and it claims nothing — the store's own order.
  await expect(order).toHaveText('MY ORDER', { timeout: 20000 });
  expect(await titles()).toEqual(['the epic one EPIC', 'the quick one QUICK', 'the deep one DEEP']);

  // The size is SHOWN, so the sort is accountable rather than invisible.
  await expect(rail.locator('.stream-tasks-row', { hasText: 'the epic one' })
    .locator('.stream-tasks-size')).toHaveText('EPIC');

  await order.click();
  await expect(order).toHaveText('HEAVIEST');
  expect(await titles()).toEqual(['the epic one EPIC', 'the deep one DEEP', 'the quick one QUICK']);

  await order.click();
  await expect(order).toHaveText('LIGHTEST');
  expect(await titles()).toEqual(['the quick one QUICK', 'the deep one DEEP', 'the epic one EPIC']);

  // IT SURVIVES A RELOAD — a preference reset on every load is not a preference.
  await reload(page);
  await expect(rail.locator('.stream-tasks-order')).toHaveText('LIGHTEST', { timeout: 20000 });

  // AND THE WINDOW AGREES. One stored choice, two surfaces: a rail sorted one
  // way over a window sorted another is the operator being told two things.
  await rail.locator('.stream-tasks-editor', { hasText: 'OPEN THE EDITOR' }).click();
  const todo = page.locator('.todo');
  await expect(todo).toBeVisible({ timeout: 20000 });
  await expect(todo.locator('.todo-order-pick.is-on')).toHaveText('LIGHTEST');
  await todo.locator('.todo-standing-tab', { hasText: 'HOUSE' }).click();
  await expect(todo.locator('.todo-row-title').first()).toHaveText('the quick one');

  // The window can set it too, and the rail follows AT ONCE — no reload. Both
  // read the choice on mount, so without a live notice the surface you did not
  // click keeps its old order: one choice, two answers, on screen together.
  await todo.locator('.todo-order-pick', { hasText: 'HEAVIEST' }).click();
  await expect(todo.locator('.todo-row-title').first()).toHaveText('the epic one');
  await expect(page.locator('.stream-tasks-order')).toHaveText('HEAVIEST');
  // …and it is still stored, not merely on screen.
  await reload(page);
  await expect(page.locator('.stream-tasks-order')).toHaveText('HEAVIEST', { timeout: 20000 });

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
