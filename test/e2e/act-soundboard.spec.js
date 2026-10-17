// @ts-check
import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { passDeskGates } from './helpers/desk-gates.js';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { claimOwner } from '../helpers/claim-owner.js';

/**
 * End-to-end THE ACT BOARD — every act a being takes has its own voice, and
 * every cue is auditionable in one place (Design note, 2026-08-06: […]).
 *
 * The claim only a real browser can carry is the ARTIFACT one: the sprite is a
 * committed, re-baked binary, and the vocabulary is an index of byte offsets
 * into it. If the bake and the index ever disagree, every sound on the desk
 * dies silently — `playSlice` swallows its own errors by design, so nothing
 * else in the suite would notice. Here the real Chromium Web Audio decoder
 * opens the real committed file and is asked whether every act cue's slice
 * actually lies inside it.
 *
 * SAFETY LAW: never the live witness stack — its own backend + vite on
 * PID-derived bind-probed ports and a disposable WORKSPACES_ROOT.
 *
 * Needs no LLM and no network.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Distinct base from every other isolated stack (rail 7461/3461, model-bar
// 7621/3621, attach 7891/3891, terminal 7581/3581, queue 7941/3941,
// sound-volume 7671/3671).
// PROCESS-SAFETY LAW: an occupied port means pick another port, NEVER touch
// the listener.
const FPORT_BASE = 7731 + (process.pid % 149);
const BPORT_BASE = 3731 + (process.pid % 149);
const NEUMA_ID = 'e2e-actbeing';

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
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'actboard-e2e-'));
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

const standAside = async (page) => {
  const button = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
  if (await button.isVisible({ timeout: 5000 }).catch(() => false)) {
    await button.click();
    await expect(page.locator('.birth-setup-gate')).toHaveCount(0);
  }
};

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Actbeing', neumaId: id }));
    sessionStorage.setItem('authToken', t);
    // The board is dimmed and inert while the desk is silent — this suite is
    // about the cues themselves, so give the world its voice up front.
    localStorage.setItem('neuma-sound', 'on');
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto(`http://localhost:${FPORT}/`);
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 15000 });
  await standAside(page);
});

const openSettings = async (page) => {
  await passDeskGates(page); // the voice-seal / birth-setup gates rise late and cover the desk
  await openDockApp(page, 'SETTINGS');
  const win = page.locator('.fwin', { has: page.locator('.settings-host') }).first();
  await expect(win.locator('.settings-h', { hasText: 'SOUND' })).toBeVisible({ timeout: 20000 });
  return win;
};

test('the board shows every act cue, playable, beside the ratified world', async ({ page }) => {
  const win = await openSettings(page);

  const acts = win.locator('.settings-board-group', { hasText: 'ACTS' });
  await expect(acts.locator('.settings-board-h')).toHaveText('ACTS — 6');
  await expect(acts.locator('.settings-cue')).toHaveCount(6);
  const executions = win.locator('.settings-board-group', { hasText: 'EXECUTION & FILES' });
  await expect(executions.locator('.settings-cue')).toHaveCount(14);

  // The families a witness would look for, by name, each with a real length.
  for (const cue of ['actRead', 'actEdit', 'actSearch', 'actWrite', 'actDelete', 'actFailed']) {
    const row = win.locator(`[data-cue="${cue}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator('.settings-cue-len')).toHaveText(/^\d+ms$/);
  }

  // The 17 ratified cues stand beside them, untouched by this work.
  const world = win.locator('.settings-board-group', { hasText: 'THE WORLD' });
  await expect(world.locator('.settings-board-h')).toHaveText('THE WORLD — 17');
  await expect(world.locator('.settings-cue', { hasText: 'memoryCrystallized' })).toBeVisible();

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('a cue can be auditioned without the desk falling over', async ({ page }) => {
  const win = await openSettings(page);
  // Every act cue clicked in turn — this is the real playback path
  // (AudioContext, decode, buffer source), driven by real clicks.
  for (const cue of ['actRead', 'actWrite', 'actDelete', 'actSend', 'actFailed']) {
    await win.locator(`[data-cue="${cue}"]`).click();
  }
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the re-baked sprite really decodes, and every act slice lies inside it', async ({ page }) => {
  // The claim nothing else can make: the committed binary and the committed
  // index agree, proven by the browser's own decoder on the real artifact.
  const report = await page.evaluate(async () => {
    const index = await (await fetch('/sounds-baked/sprite.json')).json();
    const probe = document.createElement('audio');
    const opus = probe.canPlayType('audio/ogg; codecs="opus"') !== '';
    const url = opus ? '/sounds-baked/sprite.opus' : '/sounds-baked/sprite.wav';
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
    const overruns = Object.entries(index.events)
      .filter(([, s]) => s.start + s.duration > buffer.duration + 0.05)
      .map(([name]) => name);
    const empty = Object.entries(index.events)
      .filter(([, s]) => !(s.duration > 0))
      .map(([name]) => name);
    return {
      url,
      decoded: buffer.duration,
      indexTotal: index.total,
      events: Object.keys(index.events).length,
      overruns,
      empty,
    };
  });

  // The decoder opened the real file…
  expect(report.decoded).toBeGreaterThan(0);
  // …it is the length the index claims (opus adds a little encoder padding)…
  expect(Math.abs(report.decoded - report.indexTotal)).toBeLessThan(0.5);
  // …it holds the whole board, acts included — every event the committed index names…
  const committed = JSON.parse(fs.readFileSync(path.join(REPO, 'frontend/sounds-baked/sprite.json'), 'utf8'));
  expect(report.events).toBe(Object.keys(committed.events).length);
  // …and not one slice points past the end of the audio or at nothing.
  expect(report.overruns, `slices past the end of the sprite: ${report.overruns.join(', ')}`).toEqual([]);
  expect(report.empty, `zero-length slices: ${report.empty.join(', ')}`).toEqual([]);
});
