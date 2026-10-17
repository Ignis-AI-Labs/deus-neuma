// @ts-check
import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { claimOwner } from '../helpers/claim-owner.js';

/**
 * End-to-end REPO MAP — drives the real browser through the /map architecture
 * window against the real backend scanner. Auth is REAL (challenge-sign-verify
 * with Claude's witness wallet); the map data is REAL (the backend scans the
 * activated project folder on disk — no mocked graph). Proves the whole path:
 * activate a project → open REPO MAP → the honest architecture index renders, its
 * lenses switch, and the Tier-1/Tier-2 signals (classes, egress) actually show.
 *
 * Needs no LLM — the map is a pure filesystem scan.
 *
 * SAFETY LAW: NEVER a live witness stack — this file boots its OWN stack on
 * PID-derived bind-probed ports with a disposable temp WORKSPACES_ROOT, and
 * routes workspace-settings, files-settings AND the realm into the temp dir
 * (explorer-panel.spec.js precedent + the NEUMA_* isolation doors) so the
 * operator's persisted roots, projects and realm can never leak in — and this
 * suite's roots never land on the live settings files.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Distinct base from multi-terminal (7581/3581), context-map (7411/3511),
// explorer-panel (7731/3731) and composer-attach (7891/3891) so isolated
// stacks can never collide; clear of live-dev 3333/7777+3355/7755.
// PROCESS-SAFETY LAW: an occupied port means pick another port, NEVER touch
// the listener.
const FPORT_BASE = 8051 + (process.pid % 149);
const BPORT_BASE = 4051 + (process.pid % 149);
let FPORT;
let BPORT;
let BASE;
const NEUMA_ID = 'e2e-desk';

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
const projName = `e2e-repo-map-${process.pid}`;

test.beforeAll(async () => {
  FPORT = await freePort(FPORT_BASE);
  BPORT = await freePort(BPORT_BASE);
  BASE = `http://localhost:${BPORT}`;
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'repomap-e2e-'));
  const env = {
    ...process.env,
    PORT: String(BPORT),
    FRONTEND_PORT: String(FPORT),
    WORKSPACES_ROOT: root,
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_FILES_SETTINGS_PATH: path.join(root, 'files-settings.json'),
    NEUMA_REALM_SETTINGS_PATH: path.join(root, 'realm-settings.json'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
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
  // Clean slate for the next suite — deletes run SEQUENTIALLY (a backend from
  // before the store's mutation queue tears projects.json under parallel
  // read-modify-writes).
  const { projects } = await (await fetch(`${BASE}/api/v1/user/projects`, { headers: { Authorization: `Bearer ${token}` } })).json().catch(() => ({ projects: [] }));
  for (const p of (projects || []).filter((p) => p.name === projName)) {
    await fetch(`${BASE}/api/v1/user/projects/${p.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
  // PROCESS-SAFETY LAW: recorded PIDs ONLY — never pkill/pattern matching.
  // Detached children lead their own process groups; -pid reaches exactly
  // that child and its own descendants.
  for (const p of [viteProc, backendProc]) {
    if (p?.pid) {
      try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* gone */ } }
    }
  }
  if (root) await fs.promises.rm(root, { recursive: true, force: true });
});

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

  // The synthetic companion owes its custody acts, so the birth-setup gate
  // rises over the desk (async — it can land after the first window opens)
  // and intercepts every pointer. Standing aside is the gate's own honest
  // door (the desk e2e law: settle EVERY load before driving).
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  const standAside = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
  if (await standAside.isVisible({ timeout: 5000 }).catch(() => false)) {
    await standAside.click();
    await expect(page.locator('.birth-setup-gate')).toHaveCount(0);
  }

  // Activate a project on the repo via the real PROJECTS UI so the map has data.
  // Focus era: once the store loads, an already-active project (tests after the
  // first — the store persists across this file's tests) opens straight INTO
  // its focus view; a fresh stack opens on the shelf, where creating a project
  // enters it. Wait out LOADING, then take whichever register stands.
  await openDockApp(page, 'PROJECTS');
  await expect(page.locator('.proj')).toBeVisible();
  await expect(page.locator('.proj-panel .empty-state-title', { hasText: 'LOADING' })).toHaveCount(0);
  const focusTitle = page.locator('.proj-focus-title');
  if (!(await focusTitle.isVisible().catch(() => false))) {
    await page.locator('.proj-new').click();
    await page.locator('.proj-input').first().fill(projName);
    await page.locator('.proj-input').nth(1).fill(REPO);
    await page.locator('.proj-create').click();
  }
  await expect(focusTitle).toHaveText(projName);
  await expect(page.locator('.relink-status-project')).toContainText(projName);
});

test('REPO MAP renders the honest architecture index with real, non-zero signals', async ({ page }) => {
  await openDockApp(page, 'REPO MAP');
  const elo = page.locator('.elo');
  await expect(elo).toBeVisible();
  // It indexes, then shows the readout (not stuck on the loading state).
  // Focus era (D5): the map follows the window's lens — the header names the
  // focused FOLDER (the repo's basename), and the DEFAULT flag stays off:
  // that flag marks only the no-project fallback (proven two tests below).
  await expect(elo.locator('.elo-proj')).toContainText('neuma', { timeout: 30000 });
  await expect(elo.locator('.elo-default')).not.toBeVisible();
  // «INDEX COMPLETE» announcement means the scan resolved.
  await expect(elo.locator('.elo-ann-ok')).toContainText('INDEX COMPLETE');

  // The header stats carry REAL numbers from scanning this repo. Each must be a
  // finite value, and the ones that can't be zero for neuma are > 0.
  const statVal = (label) => elo.locator('.elo-stat', { hasText: new RegExp(label, 'i') }).locator('b');
  for (const label of ['systems', 'routes', 'channels', 'functions', 'classes', 'egress', 'disk i/o', 'env vars', 'dup copies']) {
    const txt = await statVal(label).first().innerText();
    expect(Number.isFinite(Number(txt)), `stat ${label} = "${txt}"`).toBe(true);
  }
  // Tier-1 (classes) and Tier-2 (egress, disk i/o) signals are actually present.
  expect(Number(await statVal('classes').first().innerText())).toBeGreaterThan(0);
  expect(Number(await statVal('egress').first().innerText())).toBeGreaterThan(0);
  expect(Number(await statVal('disk i/o').first().innerText())).toBeGreaterThan(0);

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('REPO MAP lenses switch and each renders its surface', async ({ page }) => {
  await openDockApp(page, 'REPO MAP');
  const elo = page.locator('.elo');
  await expect(elo.locator('.elo-ann-ok')).toContainText('INDEX COMPLETE', { timeout: 30000 });

  // SYSTEMS + CHANNELS are wiring boards (SVG); ROUTES/FUNCTIONS/EXTERNAL/ANOMALIES are lists.
  await elo.locator('.elo-lens', { hasText: 'SYSTEMS' }).click();
  await expect(elo.locator('.elo-wire').first()).toBeVisible();

  await elo.locator('.elo-lens', { hasText: 'ROUTES' }).click();
  await expect(elo.locator('.elo-grp-h').first()).toBeVisible(); // at least one route group

  await elo.locator('.elo-lens', { hasText: 'FUNCTIONS' }).click();
  // A file row tagged with a class count proves classes reach the UI (Tier-1).
  await expect(elo.locator('.elo-fn').first()).toBeVisible();
  await expect(elo.locator('.elo-tag', { hasText: /cls$/ }).first()).toBeVisible();

  // EXTERNAL is the Tier-2 egress lens — grouped by kind with host/dynamic tags.
  await elo.locator('.elo-lens', { hasText: 'EXTERNAL' }).click();
  await expect(elo.locator('.elo-grp-h', { hasText: /HTTP/ }).first()).toBeVisible();
  // At least one target is shown — a known host (signal) or an honest 'dynamic'.
  await expect(elo.locator('.elo-ext-hosts, .elo-ext-dyn').first()).toBeVisible();

  // STORAGE is the Tier-2 disk lens — read/write groups per file.
  await elo.locator('.elo-lens', { hasText: 'STORAGE' }).click();
  await expect(elo.locator('.elo-grp-h', { hasText: /READ|WRITE/ }).first()).toBeVisible();

  // ENV is the Tier-2 config lens — env vars with the files that read them.
  await elo.locator('.elo-lens', { hasText: 'ENV' }).click();
  await expect(elo.locator('.elo-env-n').first()).toBeVisible();

  // MIDDLEWARE is the request-pipeline lens — middleware by reach.
  await elo.locator('.elo-lens', { hasText: 'MIDDLEWARE' }).click();
  await expect(elo.locator('.elo-mw-n').first()).toBeVisible();

  // PRIMITIVES is the duplication lens — confirmed exact copies + same-name candidates.
  await elo.locator('.elo-lens', { hasText: 'PRIMITIVES' }).click();
  await expect(elo.locator('.elo-grp-h', { hasText: /EXACT COPIES/ }).first()).toBeVisible();
  await expect(elo.locator('.elo-dup-n').first()).toBeVisible();

  await elo.locator('.elo-lens', { hasText: 'ANOMALIES' }).click();
  await expect(elo.locator('.elo-list, .elo-empty').first()).toBeVisible();

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('with no active project the map defaults to the NEUMA repo, honestly flagged', async ({ page }) => {
  // Clear every project (the beforeEach just made one) — the true empty slate.
  // Sequential deletes: a pre-queue backend tears the store under parallel writes.
  const { projects } = await (await fetch(`${BASE}/api/v1/user/projects`, { headers: { Authorization: `Bearer ${token}` } })).json();
  for (const p of projects || []) {
    await fetch(`${BASE}/api/v1/user/projects/${p.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  }
  await page.reload();

  await openDockApp(page, 'REPO MAP');
  const elo = page.locator('.elo');
  // The map still renders — the app's own repo, marked DEFAULT (never invented).
  await expect(elo.locator('.elo-proj')).toContainText('neuma', { timeout: 30000 });
  await expect(elo.locator('.elo-default')).toBeVisible();
  await expect(elo.locator('.elo-ann-ok')).toContainText('INDEX COMPLETE');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('OPEN… re-points the map: the real disk picker lands a folder as the working focus', async ({ page }) => {
  await openDockApp(page, 'REPO MAP');
  const elo = page.locator('.elo');
  await expect(elo.locator('.elo-ann-ok')).toContainText('INDEX COMPLETE', { timeout: 30000 });
  await expect(elo.locator('.elo-default')).not.toBeVisible(); // a real project is active

  // Open a folder from the map itself — the ask that started this surface.
  await elo.locator('.elo-open--head').click();
  const picker = page.locator('.picker');
  await expect(picker).toBeVisible();
  // Let the picker land in its initial folder first — its async first load
  // rewrites the path field, and a fill racing it gets overwritten.
  await expect(picker.locator('.picker-cwd')).toContainText('/');
  await picker.locator('.picker-pathinput').fill(`${REPO}/backend`);
  await picker.locator('.picker-go').click();
  await expect(picker.locator('.picker-cwd')).toContainText('backend');
  await picker.locator('.picker-open').click();

  // Focus era (D5): the folder lands as THIS WINDOW's working focus (no
  // project mutation) and the map re-indexes through the focus lens.
  await expect(page.locator('.relink-status-folder')).toContainText('FOLDER — backend', { timeout: 15000 });
  await expect(elo.locator('.elo-ann-ok')).toContainText('INDEX COMPLETE', { timeout: 30000 });
  await expect(elo.locator('.elo-proj')).toContainText('backend');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
