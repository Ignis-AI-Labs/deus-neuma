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
import { claimOwner } from '../helpers/claim-owner.js';

/**
 * End-to-end PROJECTS create-form browse defaults — each register browses
 * from its own ground, set up ahead of time (Design note, 2026-07-24: […]). HOUSE tab → <root>/repos, the being's
 * tab → <root>/workspaces/<neumaId> (raised idempotently the moment the
 * window knows the being). Driven for real: real backend child, real vite
 * dev server, real challenge-sign-verify auth, real disk, real PUT
 * /house-workspace + POST /being-ground. No mock anywhere on a claimed
 * path (RULE 0).
 *
 * SAFETY LAW: NEVER a live witness stack — this file boots its OWN stack on
 * PID-derived bind-probed ports with a disposable temp WORKSPACES_ROOT and
 * routes workspace-settings, files-settings AND the realm into the temp dir
 * (explorer-panel.spec.js precedent) so the operator's persisted realm —
 * including any REAL house-workspace.json — is never read or written. The
 * house ground itself must be a durable (non-tmpdir) path by backend law, so
 * it lives under the repo's own data/temp and is removed in afterAll.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Distinct base from explorer-panel (7731/3731), multi-terminal (7581/3581)
// and the other isolated stacks; clear of live-dev 3333/7777+3355/7755.
// PROCESS-SAFETY LAW: an occupied port means pick another port, NEVER touch
// the listener.
const FPORT_BASE = 8331 + (process.pid % 149);
const BPORT_BASE = 4331 + (process.pid % 149);
let FPORT;
let BPORT;
let BASE;
const NEUMA_ID = 'e2e-projhome';
const REPO_NAME = 'umbrae-e2e';

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
// The house ground must survive a reboot by backend law (isTempPath refuses
// os.tmpdir), so it lives under the repo's own ephemeral data/temp instead.
const houseRoot = path.join(REPO, 'data', 'temp', `e2e-house-ground-${process.pid}`);
const reposDir = path.join(houseRoot, 'repos');
const repoDir = path.join(reposDir, REPO_NAME);
let typedDir;

test.beforeAll(async () => {
  FPORT = await freePort(FPORT_BASE);
  BPORT = await freePort(BPORT_BASE);
  BASE = `http://localhost:${BPORT}`;
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projhome-e2e-'));
  typedDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projhome-typed-'));
  const env = {
    ...process.env,
    PORT: String(BPORT),
    FRONTEND_PORT: String(FPORT),
    WORKSPACES_ROOT: root,
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_FILES_SETTINGS_PATH: path.join(root, 'files-settings.json'),
    NEUMA_REALM_SETTINGS_PATH: path.join(root, 'realm-settings.json'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
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
  if (typedDir) await fs.promises.rm(typedDir, { recursive: true, force: true });
  await fs.promises.rm(houseRoot, { recursive: true, force: true });
});

test.use({ viewport: { width: 1600, height: 900 } });

const initSession = (page) => page.addInitScript(({ t, a, id }) => {
  const w = a.toLowerCase();
  localStorage.setItem('walletAddress', a);
  localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: id }));
  sessionStorage.setItem('authToken', t);
}, { t: token, a: addr, id: NEUMA_ID });

// The synthetic companion owes its custody acts, so the birth-setup gate can
// rise over the desk and intercept every pointer; standing aside is the gate's
// own honest door. EVERY fresh document settles through here before driving.
const settleDesk = async (page) => {
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  const standAside = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
  if (await standAside.isVisible({ timeout: 5000 }).catch(() => false)) {
    await standAside.click();
    await expect(page.locator('.birth-setup-gate')).toHaveCount(0);
  }
};

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await initSession(page);
  await page.goto(`http://localhost:${FPORT}/`);
  await settleDesk(page);
});

// Open the create form's BROWSE on a given register ('neuma' is the default
// tab whenever a companion is bound; HOUSE must be clicked explicitly).
const openCreateBrowse = async (page, tab = null) => {
  await openDockApp(page, 'PROJECTS');
  if (tab) await page.locator('.proj-tab', { hasText: tab }).click();
  await expect(page.locator('.proj-new')).toBeVisible();
  await page.locator('.proj-new').click();
  await page.locator('.proj-browse').click();
  await expect(page.locator('.picker')).toBeVisible();
};

test('unset ground: an empty folder field still browses from home (unchanged fallback)', async ({ page }) => {
  await openCreateBrowse(page);
  await expect(page.locator('.picker-cwd')).toHaveText(os.homedir());
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('HOUSE tab: BROWSE lands in <root>/repos, a repo picks through, and a typed path still wins', async ({ page }) => {
  // The witness sets the house's shared ground for real, and a repo stands in
  // it — the exact surface Founder's projects flow browses toward.
  const put = await fetch(`${BASE}/api/v1/user/realm/house-workspace`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: houseRoot }),
  });
  expect(put.ok, `PUT house-workspace failed: ${put.status}`).toBe(true);
  await fs.promises.mkdir(repoDir, { recursive: true });
  await page.reload();
  await settleDesk(page);

  // Empty folder field on the HOUSE register → the collective repos ground.
  await openCreateBrowse(page, 'HOUSE');
  await expect(page.locator('.picker-cwd')).toHaveText(reposDir);
  const repoRow = page.locator('.picker-row', { hasText: REPO_NAME });
  await expect(repoRow).toBeVisible();

  // Pick-through: enter the repo, OPEN — the folder field carries its path.
  await repoRow.click();
  await expect(page.locator('.picker-cwd')).toHaveText(repoDir);
  await page.locator('.picker-open').click();
  await expect(page.locator('.picker')).toHaveCount(0);
  await expect(page.locator('.proj-input').nth(1)).toHaveValue(repoDir);

  // A typed path always beats the house default — the witness's explicit
  // choice is never overridden.
  await page.locator('.proj-input').nth(1).fill(typedDir);
  await page.locator('.proj-browse').click();
  await expect(page.locator('.picker')).toBeVisible();
  await expect(page.locator('.picker-cwd')).toHaveText(typedDir);
  await page.locator('.picker-cancel').click();
  await expect(page.locator('.picker')).toHaveCount(0);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// Depends on the ground PUT in the HOUSE test above (workers:1, in-file order).
test("being's tab: BROWSE lands in the being's own ground, raised ahead of time", async ({ page }) => {
  const beingGround = path.join(houseRoot, 'workspaces', NEUMA_ID);
  // Knock the being's ground down and re-arrive: the PLATFORM must raise it
  // again the moment the PROJECTS window knows the being ([…]) — this spec never mkdirs it.
  await fs.promises.rm(beingGround, { recursive: true, force: true });
  await page.reload();
  await settleDesk(page);
  expect(fs.existsSync(beingGround)).toBe(false);

  // The being's register is the default tab with a companion bound.
  await openCreateBrowse(page);
  await expect(page.locator('.picker-cwd')).toHaveText(beingGround);
  expect(fs.existsSync(beingGround)).toBe(true);
  await page.locator('.picker-cancel').click();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
