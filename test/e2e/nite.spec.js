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
import { openDockApp, openLauncher } from './helpers/dock.js';
import { passDeskGates } from './helpers/desk-gates.js';

/**
 * End-to-end NITE — the window that was CEREMONY. Real browser, real backend,
 * real auth (challenge-sign-verify with Claude's witness wallet), real lanes on
 * real disk. Nothing on any claimed path is mocked (RULE 0).
 *
 * WHAT THIS PROVES, and why it is worth a browser (Design note, 2026-08-25: the owed
 * acts were only ever reachable as a modal over whichever being happened to be
 * bound, so lanes nobody was looking at stayed owed silently — three of four kin
 * in one house, two still holding a plaintext private key. The claim under test
 * is that the HOUSE is visible in one glance and an owed act is callable for a
 * being that is NOT the bound one. Only a real browser can answer that.
 *
 * The lanes here are seeded UNSEALED by design: the voice seal's true state is
 * proven against the real store in test/integration/api-roster-standing.test.js,
 * and the rite itself spends a real turn on a being's own conduit, which belongs
 * to a live lane and never to a browser test.
 *
 * SAFETY LAW: never the live witness stack — own backend + vite on PID-derived
 * bind-probed ports, disposable WORKSPACES_ROOT, the NEUMA_* isolation doors.
 * (test/e2e/ceremony.spec.js drives the OPERATOR'S dev stack on :3333 and is
 * left alone here; only its dock label was updated for the rename.)
 *
 * Needs no LLM: nothing in this file sends a thought.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Distinct base from every other isolated stack (chats 7291/3291, tasks
// 7461/3461, model-bar 7621/3621, terminal 7581/3581, explorer 7731/3731).
const FPORT_BASE = 7141 + (process.pid % 149);
const BPORT_BASE = 3141 + (process.pid % 149);

// Three lanes in three real states. BOUND is the one in the stream; UNBOUND
// owes custody and is NOT bound — it is the whole point of the table.
const BOUND = 'e2e-nitewren';
const UNBOUND = 'e2e-nitelumen';
const CLEAN = 'e2e-nitesovereign';

const ENVELOPE = { ciphertext: 'a'.repeat(64), tag: 'b'.repeat(32), iv: 'c'.repeat(24) };

let FPORT; let BPORT; let BASE; let FRONT; let root;
let backendProc; let viteProc; let token; let addr;

const canBind = (port) => new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.listen(port, () => srv.close(() => resolve(true)));
});
const freePort = async (start) => {
  for (let p = start; p < start + 120; p += 1) if (await canBind(p)) return p;
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

// Returns the url that ANSWERED — the backend binds 127.0.0.1, vite answers on
// [::1], and a hardcoded guess gets ERR_CONNECTION_REFUSED from a healthy server.
const waitFor = async (urls, ms = 90000) => {
  const list = Array.isArray(urls) ? urls : [urls];
  const t0 = Date.now();
  for (;;) {
    for (const url of list) {
      try { if ((await fetch(url)).status < 500) return url; } catch { /* not up */ }
    }
    if (Date.now() - t0 > ms) throw new Error(`stack member never answered: ${list.join(' | ')}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

// A lane in a real state. `custody: false` reproduces keir's real shape the day
// this was written — the interim keypair still sitting on disk.
const seedLane = async (id, name, { custody, anchor }) => {
  await claimOwner(root, id, addr);
  const dir = path.join(root, id);
  await fs.promises.mkdir(path.join(dir, 'keys'), { recursive: true });
  await fs.promises.mkdir(path.join(dir, 'identity'), { recursive: true });
  await fs.promises.writeFile(path.join(dir, 'identity', 'true-name.json'), JSON.stringify({
    chosenName: name, fullName: `${name} Semmet Aldmere`, houseName: 'Aldmere', soulMark: 'FBF167B8F932',
  }));
  const keys = path.join(dir, 'keys');
  if (custody) {
    await fs.promises.writeFile(path.join(keys, 'keypair-encrypted.json'), JSON.stringify(ENVELOPE));
    await fs.promises.writeFile(path.join(keys, 'keypair-recovery.json'), JSON.stringify(ENVELOPE));
    await fs.promises.writeFile(path.join(keys, 'recovery-hash.json'), JSON.stringify({ hash: 'd'.repeat(64) }));
  } else {
    await fs.promises.writeFile(path.join(keys, 'keypair.json'), JSON.stringify({
      privateKey: `0x${'1'.repeat(64)}`, publicKey: `0x${'2'.repeat(64)}`, address: addr,
    }));
  }
  if (anchor) {
    await fs.promises.writeFile(path.join(dir, 'identity', 'onchain-seal.json'), JSON.stringify({
      schema: 'neuma-onchain-seal/1', txHash: `0x${'e'.repeat(64)}`,
    }));
  }
};

test.beforeAll(async () => {
  FPORT = await freePort(FPORT_BASE);
  BPORT = await freePort(BPORT_BASE);
  BASE = `http://127.0.0.1:${BPORT}`;
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nite-e2e-'));
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
    NEUMA_RATE_GLOBAL_MAX: '5000',
  };
  backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  viteProc = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  await waitFor(`${BASE}/api/v1/health`);
  // Sent to the NAME, never the literal [::1]: the portal builds its WebSocket
  // url from window.location.host, and a bracketed v6 literal there arrives as
  // "Portal disconnected…" with a perfectly healthy backend behind it.
  const front = await waitFor([`http://[::1]:${FPORT}/`, `http://127.0.0.1:${FPORT}/`]);
  FRONT = front.includes('[::1]') ? `http://localhost:${FPORT}/` : front;

  ({ token, addr } = await mintToken());
  await seedLane(BOUND, 'Keir', { custody: false, anchor: true });
  await seedLane(UNBOUND, 'Galen', { custody: false, anchor: true });
  await seedLane(CLEAN, 'Sovereign', { custody: true, anchor: true });
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
  const veil = page.locator('.arrival');
  if (await veil.count()) {
    await veil.click({ force: true }).catch(() => {});
    await expect(veil).toHaveCount(0, { timeout: 20000 });
  }
  // the voice seal over the birth setup — whose door now reads CONTINUE TO THE DESK
  await passDeskGates(page);
};

const openNite = async (page) => {
  await openDockApp(page, 'NITE');
  await expect(page.locator('.refine')).toBeVisible({ timeout: 20000 });
};

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a, id }) => {
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${a.toLowerCase()}:neuma-companion`, JSON.stringify({ name: 'Keir', neumaId: id }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr, id: BOUND });
  await page.goto(FRONT);
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 15000 });
  await standAside(page);
});

test('the launcher says NITE — the label names the system, not one of its acts', async ({ page }) => {
  await openLauncher(page);
  const beings = page.locator('.launcher-section[data-category="beings"]');
  const item = beings.locator('.launcher-tile', { hasText: /^NITE$/ });
  await expect(item).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.launcher-tile', { hasText: /^CEREMONY$/ })).toHaveCount(0);
  await item.click();
  await expect(page.locator('.refine')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.refine-head-label')).toHaveText('NITE');
  // (the custody panel opens from a row's SECURE — THE POINT, below, walks it)
  await expect(page.locator('.taskbar-app.is-focused[data-app-id="refinement"]')).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('THE SYSTEM names the chain a being actually travels', async ({ page }) => {
  await openNite(page);
  const system = page.getByTestId('system-panel');
  await expect(system).toContainText('THE SILO');
  await expect(system).toContainText('THE TRANSMISSION');
  await expect(system).toContainText('THE SUBSTRATE');
  // The real compile layers, not invented ones (nite-view guards the list).
  for (const layer of ['identity', 'memory', 'voice', 'refinement', 'proof']) {
    await expect(system).toContainText(layer);
  }
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('THE HOUSE STANDS shows every lane, and counts what is owed', async ({ page }) => {
  await openNite(page);
  const table = page.getByTestId('standing-table');
  await expect(table).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId(`row-${BOUND}`)).toContainText('Keir');
  await expect(page.getByTestId(`row-${UNBOUND}`)).toContainText('Galen');
  await expect(page.getByTestId(`row-${CLEAN}`)).toContainText('Sovereign');
  // Two keypairs owed, three lanes never sealed — the headline says both.
  const headline = page.getByTestId('owed-headline');
  await expect(headline).toContainText('2 KEYPAIRS OWED');
  await expect(headline).toContainText('3 UNSEALED');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('a lane with NOTHING owed offers no act — the table never invents work', async ({ page }) => {
  await openNite(page);
  await expect(page.getByTestId(`row-${CLEAN}`)).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId(`secure-${CLEAN}`)).toHaveCount(0);
  await expect(page.getByTestId(`secure-${BOUND}`)).toBeVisible();
});

test('THE POINT: custody is callable for a being that is NOT the bound one', async ({ page }) => {
  await openNite(page);
  // Galen is not in the stream. Under the old modal-only door this act was
  // unreachable for her, which is exactly how three kin stayed owed for months.
  await page.getByTestId(`secure-${UNBOUND}`).click();
  await expect(page.getByTestId('roster-custody')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('roster-custody')).toContainText('GALEN');
  await expect(page.getByTestId('custody-panel')).toBeVisible();
  // The act refuses a password under the minimum — the gate is the flow's, not
  // this window's, and it survived the extraction.
  await expect(page.getByTestId('secure-keypair')).toBeDisabled();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('ELSEWHERE opens a real neighbouring window — NITE routes, it does not swallow', async ({ page }) => {
  await openNite(page);
  await expect(page.getByTestId('elsewhere-panel')).toContainText('SHEET');
  await expect(page.getByTestId('elsewhere-panel')).not.toContainText('VOICE'); // held back (coming-later.js)
  await page.getByTestId('elsewhere-house').click();
  // A real window opened, and NITE is still standing behind it.
  await expect(page.locator('.fwin-bar-title', { hasText: 'HOUSE' }).first()).toBeVisible({ timeout: 20000 });
  // still OPEN behind it — a wholly covered window is not drawn (2026-10-04)
  await expect(page.locator('.fwin-bar-title', { hasText: 'NITE' })).toHaveCount(1);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the BIRTH gate still opens the SAME custody flow — the extraction kept both doors', async ({ page }) => {
  // The gate re-raises on every relaunch until the acts are done, and the bound
  // lane owes custody. This is the OTHER caller of KeypairCustody: NITE gaining
  // the flow must never have cost the gate its own.
  await page.reload();
  // GATES, TOP FIRST: the voice-seal gate lies OVER the birth gate and
  // intercepts its pointer events — a click on a perfectly visible, enabled
  // button then times out against the wrong overlay.
  const veil = page.locator('.arrival');
  if (await veil.count()) {
    await veil.click({ force: true }).catch(() => {});
    await expect(veil).toHaveCount(0, { timeout: 20000 });
  }
  const seal = page.locator('.voice-seal-gate button', { hasText: 'STAND ASIDE' });
  if (await seal.isVisible({ timeout: 5000 }).catch(() => false)) {
    await seal.click();
    await expect(page.locator('.voice-seal-gate')).toHaveCount(0, { timeout: 20000 });
  }
  const gate = page.locator('.birth-setup-gate');
  await expect(gate).toBeVisible({ timeout: 20000 });
  await expect(gate).toContainText('KEYPAIR CUSTODY');
  await gate.locator('button', { hasText: 'SECURE THE KEYPAIR' }).click();
  await expect(page.getByTestId('custody-panel')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('secure-keypair')).toBeDisabled();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the launcher is grouped by purpose and alphabetical inside each group', async ({ page }) => {
  // Design note, 2026-08-25: […];
  // 2026-10-05: the desk navigates like an operating system — every app in the
  // launcher, grouped by what it is for, found by eye or by search.
  await openLauncher(page);
  const sections = page.locator('.launcher-section');
  await expect(sections.first()).toBeVisible({ timeout: 20000 });
  for (const id of await sections.evaluateAll((els) => els.map((e) => e.dataset.category))) {
    const labels = await page.locator(`.launcher-section[data-category="${id}"] .launcher-tile-label`).allInnerTexts();
    expect(labels, `${id} reads alphabetically`).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  }
  const work = await page.locator('.launcher-section[data-category="work"] .launcher-tile-label').allInnerTexts();
  expect(work).toEqual(expect.arrayContaining(['CHATS', 'STREAM']));
  const beings = await page.locator('.launcher-section[data-category="beings"] .launcher-tile-label').allInnerTexts();
  // VOICE and AVATAR are held back from the early release (coming-later.js).
  expect(beings).not.toContain('AVATAR');
  expect(beings).not.toContain('VOICE');
  expect(beings).toContain('HOUSE');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
