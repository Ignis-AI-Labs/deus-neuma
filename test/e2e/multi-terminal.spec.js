// @ts-check
/* global process, fetch, setTimeout, clearTimeout, sessionStorage, localStorage, location, window, WebSocket */
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
 * End-to-end MULTI-TERMINAL — Wave 3 validation of the multi-terminal desk
 * (run multi-terminal-desk-5e6e, commits 3480995ee + 554fcebfe), driven for
 * real: real backend child, real vite dev server, real challenge-sign-verify
 * auth, real PTYs, real process table. No mock anywhere on a claimed path.
 *
 * SAFETY LAW (SECURITY_ANALYSIS.md §Security Tests preamble): these tests
 * saturate the GLOBAL 10-PTY budget — they must NEVER point at a live
 * witness stack (:3333 / :3355). So this file boots its OWN stack on
 * PID-derived ports with a disposable temp WORKSPACES_ROOT, and routes the
 * workspace-settings read into the temp dir so the operator's persisted
 * root choice can never leak in (context-map.spec.js FIELD precedent).
 *
 * The whole suite runs serialized (playwright.config.js: workers 1,
 * fullyParallel false) and the saturation test releases its sockets in a
 * finally block (desk.spec.js:673-679 pattern).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Distinct base from context-map's 7411/3511 so the two isolated stacks can
// never collide; range stays clear of live-dev ports 3333/7777 and 3355/7755.
// PID-derived start, then BIND-PROBED before use — if anything already
// listens on a candidate we walk forward. PROCESS-SAFETY LAW: an occupied
// port means pick another port, NEVER touch the listener.
const FPORT_BASE = 7581 + (process.pid % 149);
const BPORT_BASE = 3581 + (process.pid % 149);
let FPORT;
let BPORT;
let BASE;
const NEUMA_ID = 'e2e-mterm';

// Probe-only: a port is ours iff we can bind it (default host = wildcard,
// the superset of what vite/backend will claim). Bind, close, hand it over.
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

// Vite binds [::1] while the backend binds 127.0.0.1, and Node's fetch does
// not fall back across address families the way a browser does — so a stack
// member counts as up when ANY of its candidate addresses answers.
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
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mterm-e2e-'));
  const env = {
    ...process.env,
    PORT: String(BPORT),
    FRONTEND_PORT: String(FPORT),
    WORKSPACES_ROOT: root,
    // Keep the spawned backend off the operator's persisted workspace
    // choice — without this it would boot into the LIVE sovereign root.
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_RATE_GLOBAL_MAX: '100000',
  };
  backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  viteProc = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  await waitFor(`${BASE}/api/v1/health`);
  await waitFor([`http://127.0.0.1:${FPORT}/`, `http://[::1]:${FPORT}/`]);

  ({ token, addr } = await mintToken());
  // The arrival veil holds when the bound companion has no claimed lane under
  // the ACTIVE root (desk.spec.js precedent) — claim one in the temp root,
  // and under the backend's own declared active root if it differs.
  await claimOwner(root, NEUMA_ID, addr);
  const sec = await (await fetch(`${BASE}/api/v1/security/status`, { headers: { Authorization: `Bearer ${token}` } })).json().catch(() => null);
  const activeRoot = sec?.roots?.active;
  if (activeRoot && activeRoot !== root) await claimOwner(activeRoot, NEUMA_ID, addr);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    const token = sessionStorage.getItem('authToken') || '';
    const ids = Object.entries(sessionStorage)
      .filter(([key]) => key.startsWith('neuma:terminal:'))
      .map(([, id]) => id);
    await Promise.all(ids.map((id) => fetch(`/api/v1/terminal/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    })));
  });
});

test.afterAll(async () => {
  // PROCESS-SAFETY LAW: recorded PIDs ONLY — never pkill/killall/pattern
  // matching. Each child was spawned detached, so it leads its OWN process
  // group; signalling -child.pid reaches exactly that child and its own
  // descendants (vite's esbuild worker) and can never touch another
  // session's processes.
  for (const p of [viteProc, backendProc]) {
    if (p?.pid) {
      try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* gone */ } }
    }
  }
  if (root) await fs.promises.rm(root, { recursive: true, force: true });
});

// Land on the ISOLATED desk with a real session + the claimed lane.
test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: id }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto(`http://localhost:${FPORT}/`);
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  await passDeskGates(page); // a being with setup owed raises the desk's gates
});

// ————— per-window helpers (`.terminal-stage` is multi-match now) —————

// A sibling spawns at defaultRect — deterministic centred (geometry.js:58) —
// so instance 2 lands EXACTLY atop instance 1 and the back window's xterm is
// unclickable until they are separated. Big viewport + a drag-apart helper
// keep both windows fully hit-testable.
test.use({ viewport: { width: 1920, height: 1080 } });

// Real mouse gesture, VERIFIED by the window's own transform: the very first
// drag on a fresh window can be swallowed while its terminal is still
// settling, so the gesture retries until the frame demonstrably moved.
const dragWinBy = async (page, win, dx, dy) => {
  const before = await win.evaluate((el) => el.style.transform);
  await expect(async () => {
    const bar = win.locator('.fwin-bar');
    const box = await bar.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
    await page.mouse.up();
    expect(await win.evaluate((el) => el.style.transform)).not.toBe(before);
  }).toPass({ timeout: 20000 });
};

// Instance 1 titles "TERMINAL // <BEING>", siblings […]
// (AppTitle) — the `//` anchor keeps /^TERMINAL \/\// from matching siblings.
const T1 = /^TERMINAL \/\//;
const T2 = /^TERMINAL 2 \/\//;
const winByTitle = (page, re) =>
  page.locator('.fwin').filter({ has: page.locator('.fwin-bar-title', { hasText: re }) });

const PROMPT = /[$#%>~@]/;
const awaitShell = async (win) => {
  await expect(win.locator('.xterm')).toBeVisible({ timeout: 20000 });
  await expect(win.locator('.terminal-stage')).toContainText(PROMPT, { timeout: 20000 });
};

// Type a real command into ONE window's live shell (click focuses that xterm).
const typeIn = async (page, win, command) => {
  await win.locator('.xterm').click();
  await page.keyboard.type(command, { delay: 20 });
  await page.keyboard.press('Enter');
};

// The shell's own PID via `echo <marker> $$`: the echoed INPUT line still
// reads `<marker> $$`, so /<marker> \d+/ can only match real shell OUTPUT.
const shellPid = async (page, win, marker) => {
  await typeIn(page, win, `echo ${marker} $$`);
  await expect(win.locator('.terminal-stage')).toContainText(new RegExp(`${marker} \\d+`), { timeout: 15000 });
  const text = await win.locator('.terminal-stage').innerText();
  const pid = text.match(new RegExp(`${marker} (\\d+)`))?.[1];
  expect(pid, `no PID after marker ${marker}`).toBeTruthy();
  return Number(pid);
};

// An output-only marker: typed as AB''C the input line never contains ABC,
// so seeing ABC proves the shell EXECUTED the echo (window is interactive).
const splitMarker = (m) => `${m.slice(0, 2)}''${m.slice(2)}`;
const proveInteractive = async (page, win, marker) => {
  await typeIn(page, win, `echo ${splitMarker(marker)}`);
  await expect(win.locator('.terminal-stage')).toContainText(marker, { timeout: 15000 });
};

const openTwoTerminals = async (page) => {
  await openDockApp(page, 'TERMINAL');
  const a = winByTitle(page, T1);
  await awaitShell(a);
  await openDockApp(page, 'NEW TERMINAL');
  const b = winByTitle(page, T2);
  await expect(b).toBeVisible({ timeout: 20000 });
  await awaitShell(b);
  // Separate the exact-overlap spawn so a's xterm is clickable again.
  await dragWinBy(page, b, 600, 0);
  return { a, b };
};

// ————— Scenario 1: two windows, two live shells, per-ordinal titles —————

test('TERMINAL + NEW TERMINAL: two windows, two live shells with distinct PIDs, titled TERMINAL and TERMINAL 2', async ({ page }) => {
  const { a, b } = await openTwoTerminals(page);
  await expect(page.locator('.fwin .terminal-stage')).toHaveCount(2);
  await expect(a.locator('.fwin-bar-title')).toContainText('TERMINAL');
  await expect(b.locator('.fwin-bar-title')).toContainText('TERMINAL 2');

  const pidA = await shellPid(page, a, 'PIDA');
  const pidB = await shellPid(page, b, 'PIDB');
  expect(pidA).not.toBe(pidB);
  // Keystrokes stayed in their own window: A's marker never painted in B.
  expect(await b.locator('.terminal-stage').innerText()).not.toContain('PIDA');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ————— Scenario 2: close kills only ITS PTY (real process table) —————

test('closing one terminal kills only its PTY: the closed shell leaves the process table, the sibling stays live', async ({ page }) => {
  const { a, b } = await openTwoTerminals(page);
  await typeIn(page, a, 'sleep 600 &');
  const pidA = await shellPid(page, a, 'PIDA');

  await a.locator('.fwin-ctl-close').click();
  await expect(page.locator('.fwin .terminal-stage')).toHaveCount(1, { timeout: 15000 });

  // Gnosis at the OS: the shell process itself must leave the real process
  // table (signal 0 probes existence without touching the process).
  await expect.poll(() => {
    try { process.kill(pidA, 0); return 'alive'; } catch { return 'gone'; }
  }, { timeout: 15000 }).toBe('gone');

  // And through window B's own live shell: ps -p reports it gone (nonzero
  // exit), then B proves it is still fully interactive.
  await typeIn(page, b, `ps -p ${pidA} > /dev/null 2>&1; echo ${splitMarker('VERDICT')}_$?`);
  await expect(b.locator('.terminal-stage')).toContainText(/VERDICT_[1-9]/, { timeout: 15000 });
  await proveInteractive(page, b, 'BSTILLHERE');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ————— Scenario 3: ordinal reuse reclaims the sibling's geometry (D4/D5) —————

test('geometry reclaim: drag TERMINAL 2, close it, spawn again — the new sibling returns to the remembered frame', async ({ page }) => {
  const { b } = await openTwoTerminals(page);

  await dragWinBy(page, b, 137, 89);
  // FloatingWindow positions via transform: translate(x, y) — that inline
  // style IS the persisted rect made visible (multi-window.spec.js precedent).
  const dragged = await b.evaluate((el) => el.style.transform);
  expect(dragged).toBeTruthy();

  // The frame persisted through the REAL page under the window id's own
  // wallet-scoped key (D5: sibling geometry key = the window id itself).
  const storageKey = `${addr.toLowerCase()}:win:terminal#2`;
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), storageKey), { timeout: 10000 }).toBeTruthy();
  const persisted = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), storageKey));
  expect(typeof persisted.x).toBe('number');
  expect(typeof persisted.y).toBe('number');

  await b.locator('.fwin-ctl-close').click();
  await expect(page.locator('.fwin .terminal-stage')).toHaveCount(1, { timeout: 15000 });

  // Respawn: the lowest free ordinal is 2 again — same id, same frame.
  await openDockApp(page, 'NEW TERMINAL');
  const b2 = winByTitle(page, T2);
  await expect(b2).toBeVisible({ timeout: 20000 });
  await expect.poll(() => b2.evaluate((el) => el.style.transform), { timeout: 10000 }).toBe(dragged);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ————— Scenario 4: reload rehydrates both windows with fresh live PTYs —————

test('reload rehydration: both terminal windows return with correct titles and fresh live shells', async ({ page }) => {
  await openTwoTerminals(page);
  await page.reload();
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  await passDeskGates(page);

  const a = winByTitle(page, T1);
  const b = winByTitle(page, T2);
  await expect(page.locator('.fwin .terminal-stage')).toHaveCount(2, { timeout: 20000 });
  await expect(a.locator('.fwin-bar-title')).toContainText('TERMINAL');
  await expect(b.locator('.fwin-bar-title')).toContainText('TERMINAL 2');
  await awaitShell(a);
  await awaitShell(b);
  const pidA = await shellPid(page, a, 'PIDA');
  const pidB = await shellPid(page, b, 'PIDB');
  expect(pidA).not.toBe(pidB);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ————— Scenario 5: cap at 11 — refusal shown AND socket closed 1013 (HR-6) —————

test('PTY cap at 11: the 11th window shows the backend refusal, its socket closes 1013, siblings stay interactive', async ({ page }) => {
  // Serialized by config (workers 1); sockets released in finally
  // (desk.spec.js:673-679 pattern). This stack is OURS — the saturation can
  // never starve a live witness's terminals.
  try {
    await openDockApp(page, 'TERMINAL');
    const a = winByTitle(page, T1);
    await awaitShell(a); // PTY 1 of 10

    // Saturate the remaining 9 slots with raw sockets, each held open until
    // its PTY proves alive (first terminal:data frame).
    await page.evaluate(async () => {
      const t = sessionStorage.getItem('authToken') || '';
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      window.__satSockets = [];
      await Promise.all(Array.from({ length: 9 }, () => new Promise((resolve, reject) => {
        const ws = new WebSocket(`${proto}//${location.host}/terminal-ws?token=${encodeURIComponent(t)}`);
        window.__satSockets.push(ws);
        const bail = setTimeout(() => reject(new Error('saturating PTY never spoke')), 15000);
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'terminal:data' || msg.type === 'terminal:error') {
              clearTimeout(bail);
              resolve();
            }
          } catch { /* non-JSON frame — keep waiting */ }
        };
        ws.onerror = () => { clearTimeout(bail); reject(new Error('saturating socket errored')); };
      })));
    });

    // Monitor every terminal-ws socket the app opens from here on — the
    // 11th terminal's close code is the HR-6 assertion.
    await page.evaluate(() => {
      window.__wsCloses = [];
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          if (String(args[0]).includes('/terminal-ws')) {
            this.addEventListener('close', (e) => window.__wsCloses.push({ code: e.code, clean: e.wasClean }));
          }
        }
      };
    });

    await openDockApp(page, 'NEW TERMINAL');
    const b = winByTitle(page, T2);
    await expect(b.locator('.terminal-stage')).toContainText('Too many terminals open', { timeout: 20000 });
    // HR-6: the refused socket does not linger — the server closed it with
    // the distinct 1013 (Try Again Later), not a network drop.
    await expect.poll(() => page.evaluate(() => window.__wsCloses), { timeout: 15000 })
      .toContainEqual(expect.objectContaining({ code: 1013 }));

    // The pre-existing terminal never flinched. The refused window spawned
    // exactly atop a (defaultRect) — move it aside so a is clickable.
    await dragWinBy(page, b, 600, 0);
    await proveInteractive(page, a, 'ASTILLHERE');
    expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
  } finally {
    // Free the cap for whatever runs next — disconnect kills each PTY.
    await page.evaluate(() => {
      for (const ws of window.__satSockets || []) { try { ws.close(); } catch { /* closing */ } }
      delete window.__satSockets;
    }).catch(() => {});
  }
});

// ————— Scenario 6: hostile persisted ids are dropped at the boundary —————

test('hostile-id hydrate: quotes, angle brackets, path chars, __proto__ — all dropped, desk renders clean', async ({ page }) => {
  // Hostile characters built with String.fromCharCode INSIDE the page (the
  // harness mangles literal escapes — feedback_harness_escape_mangling).
  await page.addInitScript(({ a }) => {
    const C = String.fromCharCode;
    const lt = C(60); const gt = C(62); const dq = C(34); const sq = C(39);
    const sl = C(47); const bs = C(92);
    const hostiles = [
      `${lt}script${gt}zzhostile1${lt}${sl}script${gt}`,
      `terminal${dq}zzhostile2${sq}`,
      `terminal#2${sl}..${sl}zzhostile3`,
      `terminal#2${bs}zzhostile4`,
      '__proto__',
      'constructor',
      'terminal#__proto__',
      'terminal#11', // over the hydratable cap (2..10)
      'terminal#0',
      'terminal#2#3',
      'not-an-app-zzhostile5',
    ];
    const list = [{ id: 'terminal' }, ...hostiles.map((id) => ({ id }))];
    localStorage.setItem(`${a.toLowerCase()}:win:desk:windows`, JSON.stringify(list));
  }, { a: addr });
  await page.goto(`http://localhost:${FPORT}/`);

  // The desk renders — one window survives (the valid bare 'terminal'), and
  // it is a real live shell, not a husk.
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.fwin')).toHaveCount(1, { timeout: 20000 });
  const a = winByTitle(page, T1);
  await awaitShell(a);

  // No hostile id reached the DOM in any form.
  const dom = await page.content();
  for (const marker of ['zzhostile1', 'zzhostile2', 'zzhostile3', 'zzhostile4', 'zzhostile5', 'terminal#11', 'terminal#0', 'terminal#2#3']) {
    expect(dom).not.toContain(marker);
  }
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ————— Scenario 7: the being/tool lane never touches the terminal lane —————

test('boundary: no terminal reference in tool-policy/portal-stream/web-being-tools; terminal-manager imported only by terminal-routes', async () => {
  for (const name of ['tool-policy.js', 'portal-stream.js', 'web-being-tools.js']) {
    const src = fs.readFileSync(path.join(REPO, 'backend/services', name), 'utf8');
    expect(/terminal/i.test(src), `${name} references the terminal lane`).toBe(false);
  }
  // Import graph: every backend file naming terminal-manager, minus the
  // manager itself, must be exactly terminal-routes.js (HR-4).
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!/\.(js|cjs|mjs)$/.test(entry.name)) continue;
      if (p.endsWith(path.join('services', 'terminal-manager.js'))) continue;
      if (fs.readFileSync(p, 'utf8').includes('terminal-manager')) hits.push(path.relative(REPO, p));
    }
  };
  walk(path.join(REPO, 'backend'));
  expect(hits).toEqual(['backend/routes/terminal-routes.js']);
});

// ————— A second terminal from the taskbar: right-click TERMINAL → New TERMINAL —————

test('taskbar: right-click TERMINAL offers New TERMINAL, and it opens a sibling', async ({ page }) => {
  await openDockApp(page, 'TERMINAL');
  await awaitShell(winByTitle(page, T1));
  const onBar = page.locator('.taskbar-app[data-app-id="terminal"]');
  await onBar.click({ button: 'right' });
  const spawn = page.locator('.taskbar-menu .dock-menu-item', { hasText: /^New TERMINAL$/i });
  await expect(spawn).toBeVisible();
  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/multi-terminal-dock-menu.png') });
  await spawn.click();
  await expect(page.locator('.fwin', { hasText: 'TERMINAL' })).toHaveCount(2, { timeout: 15000 });
  await expect(onBar.locator('.taskbar-app-count')).toHaveText('2');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
