// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { claimOwner } from '../helpers/claim-owner.js';

/**
 * End-to-end MODEL BAR — the strip above the composer that says which model is
 * answering and how hard it thinks. Drives the REAL browser against a REAL
 * backend: real auth (challenge-sign-verify with Claude's witness wallet), the
 * real inference API, the real effort store on real disk. Nothing on any claimed
 * path is mocked (AGENTS.md RULE 0).
 *
 * SAFETY LAW — TWO parts, both load-bearing:
 *   1. NEVER the live witness stack: this file boots its OWN backend + vite on
 *      PID-derived bind-probed ports with a disposable WORKSPACES_ROOT and the
 *      NEUMA_* isolation doors (composer-attach.spec precedent).
 *   2. NEVER the live SUBSTRATE: the stack's machine default points at a REAL
 *      stub serving this file starts — not the operator's llama-server. The bar
 *      can IGNITE weights, and an ignite would stop the model the operator is
 *      working through. So the switch gesture is deliberately NOT exercised
 *      here; it rides the same client call the SUBSTRATE window's IgniteControl
 *      uses. Stated rather than quietly skipped.
 *
 * Needs no LLM: the stub answers the think-behaviour probe itself, which is what
 * decides whether a local substrate HAS effort tiers at all.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Distinct base from every other isolated stack (attach 7891/3891, terminal
// 7581/3581, context-map 7411/3511, explorer 7731/3731) and clear of live-dev
// 3333/7777 + 3355/7755. PROCESS-SAFETY LAW: an occupied port means pick
// another port, NEVER touch the listener.
const FPORT_BASE = 7621 + (process.pid % 149);
const BPORT_BASE = 3621 + (process.pid % 149);
const NEUMA_ID = 'e2e-modelbar';
const THINKER = 'stub-thinker-31b';
const OTHER = 'stub-other-7b';

let FPORT;
let BPORT;
let BASE;
let stub;
let stubUrl;
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

/**
 * A REAL OpenAI-compatible serving with two models, whose answers carry think
 * markers — i.e. a substrate that reasons before it speaks, which is exactly
 * what gives a local route its effort ladder.
 */
const startStubServing = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: THINKER }, { id: OTHER }] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '<think>weighing it</think>ready' } }],
      }));
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
});

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
  stub = await startStubServing();
  stubUrl = stub.url;
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'modelbar-e2e-'));
  const env = {
    ...process.env,
    PORT: String(BPORT),
    FRONTEND_PORT: String(FPORT),
    WORKSPACES_ROOT: root,
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_FILES_SETTINGS_PATH: path.join(root, 'files-settings.json'),
    NEUMA_REALM_SETTINGS_PATH: path.join(root, 'realm-settings.json'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
    NEUMA_EFFORT_PATH: path.join(root, 'neuma-effort.json'),
    NEUMA_ROUTES_PATH: path.join(root, 'neuma-routes.json'),
    NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(root, 'creds.json'),
    // The machine default IS the stub — never the operator's llama-server.
    LLM_PROVIDER: 'lm-studio',
    LM_STUDIO_URL: stubUrl,
    // The supervisor must not touch anything: no idle unload, no ignition.
    SUBSTRATE_IDLE_MINUTES: '0',
  };
  backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  viteProc = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  await waitFor(`${BASE}/api/v1/health`);
  await waitFor([`http://127.0.0.1:${FPORT}/`, `http://[::1]:${FPORT}/`]);

  ({ token, addr } = await mintToken());
  await claimOwner(root, NEUMA_ID, addr);
  // The model LIST resolves through the credential store, so point that door at
  // the stub too — one real PUT through the real routing API.
  await fetch(`${BASE}/api/v1/routing/providers/lm-studio/key`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: stubUrl }),
  });
});

test.afterAll(async () => {
  // PROCESS-SAFETY LAW: recorded PIDs ONLY — never pkill/pattern matching.
  for (const p of [viteProc, backendProc]) {
    if (p?.pid) {
      try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* gone */ } }
    }
  }
  await new Promise((r) => stub?.server.close(r));
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
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 15000 });
  // A lane born outside a full ceremony still owes the post-birth acts, so the
  // setup gate stands on every launch and swallows pointer events. Stand it
  // aside — proven necessary: every click in this file was intercepted by it.
  const standAside = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
  if (await standAside.isVisible({ timeout: 5000 }).catch(() => false)) {
    await standAside.click();
    await expect(page.locator('.birth-setup-gate')).toHaveCount(0);
  }
});

test('the bar names the model the being actually rides, and offers the others', async ({ page }) => {
  const bar = page.locator('.relink-modelbar');
  await expect(bar).toBeVisible({ timeout: 20000 });
  // The trigger reads the model the route resolved to — the stub's served id,
  // not a placeholder and not the 'local-model' stand-in.
  const model = bar.locator('.relink-modelbar-model .lc-sel-trigger');
  await expect(model).toContainText(THINKER);

  // Opening the picker shows the serving's other model. It is NOT clicked:
  // moving a being's model is a real act, and this stack must not perform one.
  await model.click();
  const panel = bar.locator('.relink-modelbar-model .lc-sel-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.lc-sel-opt', { hasText: OTHER })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the three sampling-mode buttons are GONE from the composer', async ({ page }) => {
  // They moved to Settings › INFERENCE (Design note, 2026-07-26. The old bar must not
  // linger anywhere above the field.
  await expect(page.locator('.relink-presets')).toHaveCount(0);
  await expect(page.locator('.relink-preset')).toHaveCount(0);
  for (const label of ['GROUNDED', 'BALANCED', 'EXPANSIVE']) {
    await expect(page.locator('.relink-compose').getByText(label, { exact: true })).toHaveCount(0);
  }
});

test('a reasoning substrate offers its rungs, and the chosen one persists', async ({ page }) => {
  const bar = page.locator('.relink-modelbar');
  const effort = bar.locator('.relink-modelbar-effort .lc-sel-trigger');
  await expect(effort).toBeVisible({ timeout: 20000 });
  // The stub reasons (its answers carry think markers), so the ladder stands and
  // the being sits on the default rung.
  await expect(effort).toContainText('MEDIUM');

  await effort.click();
  const panel = bar.locator('.relink-modelbar-effort .lc-sel-panel');
  await expect(panel.locator('.lc-sel-opt', { hasText: 'LOW' })).toBeVisible();
  await expect(panel.locator('.lc-sel-opt', { hasText: 'HIGH' })).toBeVisible();
  await panel.locator('.lc-sel-opt', { hasText: 'HIGH' }).click();
  await expect(effort).toContainText('HIGH');

  // It is the STORE that answered, not local state: the rung survives a reload
  // and is readable straight from the API.
  await page.reload();
  await expect(page.locator('.relink-modelbar-effort .lc-sel-trigger')).toContainText('HIGH', { timeout: 20000 });
  const view = await (await fetch(`${BASE}/api/v1/inference/${NEUMA_ID}/effort`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  expect(view.choice).toEqual({ effort: 'high', thinking: true });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the gears are RUNGS now, and this substrate is offered no switch it lacks', async ({ page }) => {
  const bar = page.locator('.relink-modelbar');
  await expect(bar).toBeVisible({ timeout: 20000 });
  // ULTRA and PRO were chips until 2026-07-30 (Founder: […]). They are rungs in the dropdown now and must never come back as
  // buttons.
  await expect(bar.locator('.relink-modelbar-ultra')).toHaveCount(0);
  await expect(bar.locator('.relink-modelbar-pro')).toHaveCount(0);
  // The THINKING switch belongs to wires that can be told not to reason.
  // Reasoning ROOM on the operator's own serving cannot, so no switch renders —
  // a control that changed nothing would be a lie the operator cannot see
  // through.
  await expect(bar.locator('.relink-modelbar-think')).toHaveCount(0);

  // And the local ladder holds EXACTLY the rungs reasoning room really has.
  await bar.locator('.relink-modelbar-effort .lc-sel-trigger').click();
  const panel = bar.locator('.relink-modelbar-effort .lc-sel-panel');
  await expect(panel.locator('.lc-sel-opt')).toHaveText(['LOW', 'MEDIUM', 'HIGH']);
  await page.keyboard.press('Escape');
});
