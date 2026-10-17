// @ts-check
import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import { settleDesk } from './helpers/explorer-panel-harness.js';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { claimOwner } from '../helpers/claim-owner.js';

/**
 * End-to-end THE SOUND DIAL — the desk's level, reachable at last (Founder,
 * 2026-08-06: […]).
 *
 * This can only be proven in a real browser: the dial is a React control whose
 * whole job is to move a persisted preference the sound engine reads before
 * every cue. The assertions ride BOTH ends — the DOM the operator touches, and
 * the real `sound-engine.js` module loaded in the same page, asked what level
 * it would now play at. No mock anywhere on the claimed path (RULE 0).
 *
 * SAFETY LAW: never the live witness stack — its own backend + vite on
 * PID-derived bind-probed ports and a disposable WORKSPACES_ROOT, so nothing
 * here can read or write the operator's real desk.
 *
 * Needs no LLM and no network: no thought is sent.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Distinct base from every other isolated stack (rail 7461/3461, model-bar
// 7621/3621, attach 7891/3891, terminal 7581/3581, queue 7941/3941).
// PROCESS-SAFETY LAW: an occupied port means pick another port, NEVER touch
// the listener.
const FPORT_BASE = 7671 + (process.pid % 149);
const BPORT_BASE = 3671 + (process.pid % 149);
const NEUMA_ID = 'e2e-soundbeing';

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

test.beforeAll(async () => {
  FPORT = await freePort(FPORT_BASE);
  BPORT = await freePort(BPORT_BASE);
  BASE = `http://localhost:${BPORT}`;
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'soundvol-e2e-'));
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
    NEUMA_DATA_ROOT: path.join(root, 'data'),
    // ROOT LOCK's own test door — an isolated stack looks exactly like a
    // settings root that moved and came up empty, which the lock refuses.
    NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'),
    SUBSTRATE_IDLE_MINUTES: '0',
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

// The desk's gates (the FIRST SEAL gate, the custody checklist) stand over
// it on a fresh lane and swallow pointer events — the shared harness stands
// each aside by its current wording (the old STAND ASIDE-only match missed
// the seal gate and timed out on the header's SND button).
const standAside = (page) => settleDesk(page);

const arrive = async (page) => {
  await page.goto(`http://localhost:${FPORT}/`);
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 15000 });
  await standAside(page);
};

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Soundbeing', neumaId: id }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr, id: NEUMA_ID });
  await arrive(page);
});

// SETTINGS is a system app — the Start menu, not a dock section.
const openSettings = async (page) => {
  await openDockApp(page, 'SETTINGS');
  const win = page.locator('.fwin', { has: page.locator('.settings-host') }).first();
  await expect(win.locator('.settings-h', { hasText: 'SOUND' })).toBeVisible({ timeout: 20000 });
  return win;
};

// The dial as a witness actually moves it: focus, then the keyboard the
// control itself defines. `Home` is the slider's own way to reach its floor.
const turnDial = async (page, dial, keys) => {
  await dial.focus();
  for (const key of keys) await page.keyboard.press(key);
};

// What the REAL engine would play at, asked of the real module in this page.
const engineLevel = (page) =>
  page.evaluate(async () => {
    const engine = await import('/services/sound-engine.js');
    return { volume: engine.getSoundVolume(), on: engine.isSoundOn() };
  });

test('the dial stands in GENERAL and starts at the default level', async ({ page }) => {
  const win = await openSettings(page);

  const dial = win.locator('.settings-vol-dial');
  await expect(dial).toBeVisible();
  // An untouched dial reads the DEFAULT, not silence — the failure this
  // guards is `Number(null) === 0` reaching the gain node.
  await expect(dial).toHaveValue('0.5');
  await expect(win.locator('.settings-vol-value')).toHaveText('50%');
  expect((await engineLevel(page)).volume).toBe(0.5);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('a level set on the dial is the level the engine plays at, and it survives a reload', async ({ page }) => {
  const win = await openSettings(page);
  const dial = win.locator('.settings-vol-dial');

  // Six steps down from the default: 0.5 → 0.20.
  await turnDial(page, dial, Array(6).fill('ArrowLeft'));
  await expect(dial).toHaveValue('0.2');
  await expect(win.locator('.settings-vol-value')).toHaveText('20%');
  // The engine — the real module, not the React state — now answers 0.2.
  expect((await engineLevel(page)).volume).toBe(0.2);

  // The preference outlives the window AND the session.
  await arrive(page);
  const reopened = await openSettings(page);
  await expect(reopened.locator('.settings-vol-dial')).toHaveValue('0.2');
  await expect(reopened.locator('.settings-vol-value')).toHaveText('20%');
  expect((await engineLevel(page)).volume).toBe(0.2);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('silence is a level a witness can choose — the dial reaches zero', async ({ page }) => {
  const win = await openSettings(page);
  const dial = win.locator('.settings-vol-dial');
  await turnDial(page, dial, ['Home']);
  await expect(dial).toHaveValue('0');
  await expect(win.locator('.settings-vol-value')).toHaveText('0%');
  expect((await engineLevel(page)).volume).toBe(0);
});

test('the settings switch and the chat header SND button hold the SAME truth', async ({ page }) => {
  // The desk starts silent — sound is opt-in — and the header says so.
  const snd = page.locator('.relink-snd').filter({ hasText: /^SND (ON|OFF)$/ }).first();
  await expect(snd).toHaveText('SND OFF');

  // Voice given from the header, THEN settings opened: the section reads the
  // preference, not a stale default.
  await snd.click();
  await expect(snd).toHaveText('SND ON');
  const win = await openSettings(page);
  const toggle = win.locator('.settings-desk-toggle', { hasText: 'SOUND —' });
  await expect(toggle).toHaveText('SOUND — ON');
  expect((await engineLevel(page)).on).toBe(true);

  // And taking it back from SETTINGS reaches the header button live — it
  // follows the preference now, not the state it mounted with.
  await toggle.click();
  await expect(toggle).toHaveText('SOUND — OFF');
  await expect(snd).toHaveText('SND OFF');
  expect((await engineLevel(page)).on).toBe(false);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
