// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { openDockApp, openLauncher } from './helpers/dock.js';
import { claimOwner } from '../helpers/claim-owner.js';

/**
 * End-to-end COMFYUI workbench card (FR-37, run comfyui-image-lane-2mw2):
 * the dock entry under WORKSPACE, the supervisor-sourced card states, and the
 * failed+RETRY face through a REAL failure path — the backend really spawns
 * the configured engine binary and it really dies (exit 7); no mock anywhere.
 *
 * Isolated stack (multi-terminal.spec.js precedent): own PID-derived ports,
 * temp WORKSPACES_ROOT + workspace-settings path, temp COMFYUI_DATA_DIR, and
 * a COMFYUI_URL port far from any live engine (8188/8190) — the live witness
 * stack and the operator's workbench are never touched.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Distinct bases from context-map (7411/3511) and multi-terminal (7581/3581).
const FPORT = 7731 + (process.pid % 149);
const BPORT = 3731 + (process.pid % 149);
const CPORT = 8300 + (process.pid % 149);
const BASE = `http://localhost:${BPORT}`;
const NEUMA_ID = 'e2e-forge';

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
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-e2e-'));
  // A REAL install layout whose engine binary REALLY fails: main.py exists,
  // .venv/bin/python is an executable that exits 7. The supervisor spawns it
  // for real and the exit lands in lastError — the genuine failure path the
  // FAILED+RETRY card asserts (CHANGE-2 acceptance; a doctored rig, never a
  // doctored code path).
  const install = path.join(root, 'comfy-install');
  await fs.promises.mkdir(path.join(install, '.venv', 'bin'), { recursive: true });
  await fs.promises.writeFile(path.join(install, 'main.py'), '# real file; the venv python below refuses to run it\n');
  await fs.promises.writeFile(path.join(install, '.venv', 'bin', 'python'), '#!/bin/sh\nexit 7\n', { mode: 0o755 });

  const env = {
    ...process.env,
    PORT: String(BPORT),
    FRONTEND_PORT: String(FPORT),
    WORKSPACES_ROOT: root,
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    COMFYUI_URL: `http://127.0.0.1:${CPORT}`,
    COMFYUI_INSTALL_DIR: install,
    COMFYUI_DATA_DIR: path.join(root, 'comfy-data'),
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: id }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto(`http://localhost:${FPORT}/`);
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
});

test('COMFY lives in the launcher\'s CREATE group beside the workspace tools', async ({ page }) => {
  await openLauncher(page);
  const create = page.locator('.launcher-section[data-category="create"] .launcher-tile');
  await expect(create.filter({ hasText: /^COMFY$/ })).toBeVisible();
  await expect(create.filter({ hasText: /^TERMINAL$/ }).first()).toBeVisible();
});

test('card wakes supervisor-sourced: STOPPED with the launch-on-open line', async ({ page }) => {
  await openDockApp(page, 'COMFY');
  const card = page.locator('.forgebench');
  await expect(card).toBeVisible();
  await expect(card.locator('.forgebench-word')).toHaveText('STOPPED', { timeout: 15000 });
  await expect(card.locator('.forgebench-line')).toContainText(String(CPORT));
  await expect(card.getByRole('button', { name: 'OPEN WORKBENCH' })).toBeEnabled();
});

test('a real launch failure lands as FAILED + the supervisor’s named error + RETRY — never a hung launching', async ({ page }) => {
  await openDockApp(page, 'COMFY');
  const card = page.locator('.forgebench');
  await expect(card.locator('.forgebench-word')).toHaveText('STOPPED', { timeout: 15000 });

  await card.getByRole('button', { name: 'OPEN WORKBENCH' }).click();
  // The engine binary really ran and really died (exit 7); the supervisor's
  // named cause reaches the card, and RETRY replaces OPEN WORKBENCH.
  await expect(card.locator('.forgebench-word')).toHaveText('FAILED', { timeout: 20000 });
  await expect(card.locator('.forgebench-line')).toContainText('exited (code 7');
  await expect(card.getByRole('button', { name: 'RETRY' })).toBeEnabled();

  // RETRY exercises the same lane and lands in the same honest face.
  await card.getByRole('button', { name: 'RETRY' }).click();
  await expect(card.locator('.forgebench-word')).toHaveText('FAILED', { timeout: 20000 });
});
