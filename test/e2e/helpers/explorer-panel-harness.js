// @ts-check
/* global process, fetch, setTimeout, localStorage, sessionStorage */
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { claimOwner } from '../../helpers/claim-owner.js';
import { ownerClaimHeaders } from './owner-claim.js';

/**
 * Shared harness for the EXPLORER PANEL e2e specs (test/e2e/explorer-panel-*.spec.js)
 * — split from explorer-panel.spec.js (SIZE-033) on the desk-harness.js pattern.
 * Driven for real: real backend child, real vite dev server, real
 * challenge-sign-verify auth, real PTYs, real disk. No mock anywhere on a
 * claimed path (RULE 0).
 *
 * SAFETY LAW: NEVER a live witness stack — this harness boots its OWN stack on
 * PID-derived bind-probed ports with a disposable temp WORKSPACES_ROOT, and
 * routes workspace-settings, files-settings AND the realm into the temp dir
 * (multi-terminal.spec.js precedent + NEUMA_FILES_SETTINGS_PATH /
 * NEUMA_REALM_* isolation doors) so the operator's persisted roots, projects
 * and leads can never leak in — and these suites' roots never land on the
 * live settings files.
 *
 * Each spec file calls `setupExplorerPanel()` at module scope and reads
 * `token`/`addr`/`BASE`/`FPORT` as live bindings — the beforeAll assigns
 * them before any test runs.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(__dirname, '../../..');
// Distinct base from multi-terminal (7581/3581) and context-map (7411/3511)
// so isolated stacks can never collide; clear of live-dev 3333/7777+3355/7755.
// PROCESS-SAFETY LAW: an occupied port means pick another port, NEVER touch
// the listener.
const FPORT_BASE = 7731 + (process.pid % 149);
const BPORT_BASE = 3731 + (process.pid % 149);
export let FPORT;
let BPORT;
export let BASE;
const NEUMA_ID = 'e2e-xpanel';

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

/** Authenticate a disposable test wallet through the isolated backend. Impure. */
export const mintToken = async (base = BASE, ownerHeaders = {}) => {
  const w = ethers.Wallet.createRandom();
  const addr = w.address;
  const { challenge } = await (await fetch(`${base}/api/v1/auth/challenge?address=${addr}`)).json();
  const signature = await w.signMessage(challenge);
  const res = await fetch(`${base}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ownerHeaders },
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
export let token;
export let addr;
const tempFolders = [];

export const makeFolder = async (tag) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `xpanel-${tag}-`));
  await fs.promises.writeFile(path.join(dir, 'probe.txt'), `probe ${tag}\n`);
  tempFolders.push(dir);
  return dir;
};

export const apiProjects = async () => {
  const r = await fetch(`${BASE}/api/v1/user/projects`, { headers: { Authorization: `Bearer ${token}` } });
  return (await r.json()).projects || [];
};

export const initSession = (page) => page.addInitScript(({ t, a, id }) => {
  const w = a.toLowerCase();
  localStorage.setItem('walletAddress', a);
  localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: id }));
  sessionStorage.setItem('authToken', t);
}, { t: token, a: addr, id: NEUMA_ID });

// The synthetic companion owes its custody acts, so the birth-setup gate
// rises over the desk and intercepts every pointer (desk.spec.js precedent);
// standing aside is the gate's own honest door — the acts remain owed, the
// desk becomes drivable. EVERY fresh document (goto and reload alike) can
// raise it again, so every load settles through here before driving.
export const settleDesk = async (page) => {
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  // The ARRIVAL veil intercepts every pointer while it lives. Mid-play it
  // skips on any key; under suite load a stage can miss its 15s watchdog and
  // the veil HOLDS (by design, with real actions) — RETRY re-runs the real
  // entry, which answers on a live stack. A veil that still stands after
  // that is a real failure worth failing on.
  const veil = page.locator('.arrival');
  if (await veil.isVisible({ timeout: 500 }).catch(() => false)) {
    await page.keyboard.press('Escape'); // skip while playing; no-op when holding
    const retry = page.locator('.arrival .arrival-action', { hasText: 'RETRY' });
    if (await retry.isVisible({ timeout: 1500 }).catch(() => false)) await retry.click();
    await expect(veil).toHaveCount(0, { timeout: 20000 });
  }
  // The custody gate and the FIRST SEAL gate (voice pack P6) each rise over
  // the desk and take every pointer; each STAND ASIDE is the gate's own honest
  // door — the owed acts remain owed. They can rise one AFTER the other, so
  // the desk is settled only once a pass finds neither standing.
  // The seal gate stacks ABOVE the custody gate when both stand, so it is
  // tried first; a door still covered by the other just waits for next pass.
  const doors = [
    ['.voice-seal-gate', page.locator('.voice-seal-gate button', { hasText: 'STAND ASIDE' })],
    // The custody gate's door reads […]
    // now; the old STAND ASIDE wording is still matched for older builds.
    ['.birth-setup-gate', page.locator('.birth-setup-gate button', { hasText: /FINISH SETUP LATER|STAND ASIDE/ })],
  ];
  for (let pass = 0; pass < 4; pass += 1) {
    let stood = false;
    for (const [gate, aside] of doors) {
      if (await aside.isVisible({ timeout: pass === 0 ? 5000 : 1500 }).catch(() => false)) {
        const opened = await aside.click({ timeout: 3000 }).then(() => true, () => false);
        if (opened) await expect(page.locator(gate)).toHaveCount(0);
        stood = true;
      }
    }
    if (!stood) break;
  }
};

// Drive the panel header's OPEN FOLDER through the real disk picker
// (desk.spec.js picker choreography, summoned from the rail instead).
export const openFolderViaPanel = async (page, dir) => {
  await page.locator('.xp-open').click();
  await expect(page.locator('.picker')).toBeVisible();
  // Let the picker land in its initial folder first — its async first load
  // would otherwise arrive late and overwrite the typed navigation
  // (repo-map.spec.js precedent).
  await expect(page.locator('.picker-cwd')).not.toBeEmpty();
  await expect(async () => {
    await page.locator('.picker-pathinput').fill(dir);
    await page.locator('.picker-go').click();
    await expect(page.locator('.picker-cwd')).toContainText(path.basename(dir), { timeout: 5000 });
  }).toPass({ timeout: 30000 });
  await page.locator('.picker-open').click();
  await expect(page.locator('.picker')).toHaveCount(0);
};

const PROMPT = /[$#%>~@]/;
export const awaitShell = async (page) => {
  await expect(page.locator('.fwin .xterm')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.fwin .terminal-stage')).toContainText(PROMPT, { timeout: 20000 });
};
export const typeInShell = async (page, command) => {
  await page.locator('.fwin .xterm').click();
  await page.keyboard.type(command, { delay: 20 });
  await page.keyboard.press('Enter');
};

// Register the suite lifecycle: boots the isolated stack once per file,
// settles every fresh document through the arrival veil + birth-setup gate,
// and tears down by recorded PIDs only.
export const setupExplorerPanel = () => {
  test.beforeAll(async () => {
    FPORT = await freePort(FPORT_BASE);
    BPORT = await freePort(BPORT_BASE);
    BASE = `http://localhost:${BPORT}`;
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xpanel-e2e-'));
    const env = {
      ...process.env,
      PORT: String(BPORT),
      FRONTEND_PORT: String(FPORT),
      WORKSPACES_ROOT: root,
      NEUMA_DATA_ROOT: path.join(root, 'data'),
      NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'),
      NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
      NEUMA_FILES_SETTINGS_PATH: path.join(root, 'files-settings.json'),
      NEUMA_REALM_SETTINGS_PATH: path.join(root, 'realm-settings.json'),
      NEUMA_REALM_ROOT: path.join(root, 'realm'),
      // This suite compresses hours of one witness's driving into minutes on
      // one wallet — at the live 200/min ceiling the burst 429s real passes
      // (root-close "TOO MANY REQUESTS", vanished git badges). Isolated stack
      // only; the live default stays law.
      NEUMA_RATE_GLOBAL_MAX: '5000',
    };
    backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
    viteProc = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
    await waitFor(`${BASE}/api/v1/health`);
    await waitFor([`http://127.0.0.1:${FPORT}/`, `http://[::1]:${FPORT}/`]);

    ({ token, addr } = await mintToken(BASE, ownerClaimHeaders(path.join(root, 'data'))));
    await claimOwner(root, NEUMA_ID, addr);
    const sec = await (await fetch(`${BASE}/api/v1/security/status`, { headers: { Authorization: `Bearer ${token}` } })).json().catch(() => null);
    const activeRoot = sec?.roots?.active;
    if (activeRoot && activeRoot !== root) await claimOwner(activeRoot, NEUMA_ID, addr);
  });

  test.afterAll(async () => {
    // PROCESS-SAFETY LAW: recorded PIDs ONLY — never pkill/pattern matching.
    // Detached children lead their own process groups; -pid reaches exactly
    // that child and its own descendants.
    for (const p of [viteProc, backendProc]) {
      if (p?.pid) {
        try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* gone */ } }
      }
    }
    if (root) await fs.promises.rm(root, { recursive: true, force: true });
    for (const dir of tempFolders) await fs.promises.rm(dir, { recursive: true, force: true });
  });

  test.use({ viewport: { width: 1600, height: 900 } });

  test.beforeEach(async ({ page }) => {
    const crashes = [];
    page.on('pageerror', (e) => crashes.push(e.message));
    page.__crashes = crashes;
    await initSession(page);
    await page.goto(`http://localhost:${FPORT}/`);
    await settleDesk(page);
  });
};
