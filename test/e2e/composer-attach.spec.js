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
 * End-to-end composer "+" attach menu — the one place beside the field where a
 * witness brings things into the conversation: files (a REAL file chooser into
 * the same admission path as paste/drop), a folder focus (the REAL disk picker
 * through the shared open-folder flow), and the project (activate right there).
 * Auth is REAL (challenge-sign-verify with Claude's witness wallet); projects
 * are REAL wallet-scoped rows on the backend; the picked folder is REAL disk.
 * Nothing on any claimed path is mocked (AGENTS.md RULE 0).
 *
 * Needs no LLM — nothing here sends a thought.
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
// Distinct base from multi-terminal (7581/3581), context-map (7411/3511) and
// explorer-panel (7731/3731) so isolated stacks can never collide; clear of
// live-dev 3333/7777+3355/7755.
// PROCESS-SAFETY LAW: an occupied port means pick another port, NEVER touch
// the listener.
const FPORT_BASE = 7891 + (process.pid % 149);
const BPORT_BASE = 3891 + (process.pid % 149);
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

const api = (route, init = {}) => fetch(`${BASE}/api/v1/user/projects${route}`, {
  ...init,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
});

// The test wallet is used only by the e2e suites — clearing its projects is
// safe and makes every test's starting slate deterministic. Deletes run
// SEQUENTIALLY: a backend from before the store's mutation queue tears its
// projects.json under parallel read-modify-writes.
const clearProjects = async () => {
  const { projects } = await (await api('')).json();
  for (const p of projects || []) await api(`/${p.id}`, { method: 'DELETE' });
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
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attach-e2e-'));
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
  await clearProjects().catch(() => { /* stack already down — nothing to clear */ });
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
  await clearProjects();
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    // VOX is held back from the release (coming-later.js); preview it so its baseline stays measured.
    localStorage.setItem('neuma.preview', 'voice');
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: id }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto(`http://localhost:${FPORT}/`);
  // The "+" is live once the portal link is up (same gate as the field).
  await expect(page.locator('.relink-plus')).toBeEnabled({ timeout: 15000 });
});

test('"+" opens the attach menu with its honest rows, and Escape closes it', async ({ page }) => {
  await page.locator('.relink-plus').click();
  const menu = page.locator('.relink-attach-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.relink-attach-menu-name', { hasText: 'ADD FILES' })).toBeVisible();
  await expect(menu.locator('.relink-attach-menu-name', { hasText: 'OPEN FOLDER' })).toBeVisible();
  await expect(menu.locator('.relink-attach-menu-sect', { hasText: 'PROJECT' })).toBeVisible();
  // Clean slate — the project section says so instead of showing nothing.
  await expect(menu.locator('.relink-attach-menu-empty')).toBeVisible();
  await expect(menu.locator('.relink-attach-menu-name', { hasText: 'MANAGE PROJECTS' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('ADD FILES drives a real file chooser into a document chip', async ({ page }) => {
  // A REAL file on disk rides the chooser — same admission path as paste/drop.
  const doc = path.join(os.tmpdir(), `e2e-attach-${process.pid}.md`);
  fs.writeFileSync(doc, '# shared through the + menu\n');

  await page.locator('.relink-plus').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.relink-attach-menu-row', { hasText: 'ADD FILES' }).click();
  await (await chooser).setFiles(doc);

  // The document lands as a loaded chip, named honestly.
  const chip = page.locator('.relink-attach-chip.is-doc', { hasText: path.basename(doc) });
  await expect(chip).toBeVisible();
  await expect(chip).not.toHaveClass(/is-reading/);

  fs.rmSync(doc, { force: true });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('OPEN FOLDER lands the folder as this window\'s working focus — no project is created (D5)', async ({ page }) => {
  await page.locator('.relink-plus').click();
  await page.locator('.relink-attach-menu-row', { hasText: 'OPEN FOLDER' }).click();

  // The REAL disk picker: type the absolute path, GO into it, open it.
  const picker = page.locator('.picker');
  await expect(picker).toBeVisible();
  // Let the picker land in its initial folder first — its async first load
  // rewrites the path field, and a fill racing it gets overwritten.
  await expect(picker.locator('.picker-cwd')).toContainText('/');
  await picker.locator('.picker-pathinput').fill(path.join(REPO, 'core'));
  await picker.locator('.picker-go').click();
  await expect(picker.locator('.picker-cwd')).toContainText('core');
  await picker.locator('.picker-open').click();

  // Panel/focus era (D5): the open gesture is a LENS, not a mutation — the
  // strip reads the bare-folder focus and NO project is created.
  await expect(page.locator('.relink-status-folder')).toContainText('FOLDER — core', { timeout: 15000 });
  await expect(page.locator('.relink-status-project')).toHaveCount(0);
  const { projects } = await (await api('')).json();
  expect(projects || []).toEqual([]);

  // The menu still shows the clean project slate — nothing was activated.
  await page.locator('.relink-plus').click();
  await expect(page.locator('.relink-attach-menu-empty')).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the PROJECT rows switch the active project; MANAGE opens the Projects window', async ({ page }) => {
  // Two REAL projects on the backend before the desk loads.
  const a = (await (await api('', { method: 'POST', body: JSON.stringify({ name: 'e2e-attach-a', folder: path.join(REPO, 'backend') }) })).json()).project;
  const b = (await (await api('', { method: 'POST', body: JSON.stringify({ name: 'e2e-attach-b', folder: path.join(REPO, 'frontend') }) })).json()).project;
  if (!a?.id || !b?.id) throw new Error('project seed failed');
  await api(`/${a.id}/activate`, { method: 'POST', body: JSON.stringify({}) });
  await page.reload();
  await expect(page.locator('.relink-plus')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('.relink-status-project')).toContainText('e2e-attach-a');

  await page.locator('.relink-plus').click();
  await expect(page.locator('.relink-attach-menu-row.is-project', { hasText: 'e2e-attach-a' })).toHaveClass(/is-active/);
  await page.locator('.relink-attach-menu-row.is-project', { hasText: 'e2e-attach-b' }).click();
  await expect(page.locator('.relink-status-project')).toContainText('e2e-attach-b');

  await page.locator('.relink-plus').click();
  await page.locator('.relink-attach-menu-row', { hasText: 'MANAGE PROJECTS' }).click();
  await expect(page.locator('.proj')).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

/**
 * THE COMPOSER ROW SHARES ONE BASELINE.
 *
 * Design note, 2026-08-27, on a screenshot of `+ / DEFAULT / VOX OFF` sitting at three
 * different heights: […]
 *
 * CAUSE: the row is `align-items: flex-end`, and every control standing beside
 * the chamfered input box must be lifted by the same offset to share a bottom
 * edge with the send/mic controls INSIDE it. `.relink-attach-root` and
 * `.relink-mode-root` each hand-copied that offset; `.relink-vox-chip` is a bare
 * <button> with no root wrapper and copied nothing, so it sat a notch low.
 *
 * ⚠️ MEASURED IN REAL PAINT, not asserted from a class. A class assertion would
 * have passed the whole time this was broken — the classes were all correct;
 * only one of them lacked a rule. Bounding boxes are the only thing that can
 * tell a shared baseline from three that merely look related in the source.
 */
test('the +, MODE and VOX controls share one bottom edge with the input box', async ({ page }) => {
  await expect(page.locator('.relink-plus')).toBeEnabled({ timeout: 15000 });

  const boxes = {};
  for (const [name, selector] of Object.entries({
    plus: '.relink-plus',
    mode: '.relink-mode-chip',
    vox: '.relink-vox-chip',
    // The controls inside the box are what the outside ones are matching TO.
    // Without this the three could agree with each other and all be wrong.
    field: '.relink-input-in',
  })) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box, `${name} (${selector}) is not laid out`).toBeTruthy();
    boxes[name] = box;
  }

  const bottomOf = (b) => b.y + b.height;
  const bottoms = Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, bottomOf(b)]));
  const spread = Math.max(...Object.values(bottoms)) - Math.min(...Object.values(bottoms));

  // 1.5px of slack for sub-pixel layout and the box's 1px chamfered frame —
  // tight enough that the old ~5px drop fails, loose enough never to flake.
  expect(spread, `bottom edges drifted: ${JSON.stringify(bottoms)}`).toBeLessThanOrEqual(1.5);

  // And the three standing controls are the same height as each other: a
  // shared baseline with mismatched heights still reads as ragged.
  const heights = [boxes.plus.height, boxes.mode.height, boxes.vox.height];
  expect(Math.max(...heights) - Math.min(...heights),
    `control heights differ: ${JSON.stringify(heights)}`).toBeLessThanOrEqual(1.5);

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
