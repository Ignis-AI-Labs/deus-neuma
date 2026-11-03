// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { claimOwner } from '../helpers/claim-owner.js';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';
import { openDockApp } from './helpers/dock.js';
import { settleDesk } from './helpers/explorer-panel-harness.js';
import { ownerClaimHeaders } from './helpers/owner-claim.js';

/**
 * THE MANDATE, GRANTED AND WITHDRAWN IN A REAL BROWSER — Design note, 2026-10-24: […].
 *
 * The house seats its CMO and holds one X account; the operator opens
 * MARKETING, reads what a grant means in plain words before the yes, grants
 * it, sees it stand in the notification tray and in the House Clock, and withdraws it
 * with ONE press there. Every read and act goes through the real
 * routes of a real backend.
 *
 * SAFETY LAW: never a live stack — its own backend + vite on bind-probed
 * ports, a disposable root holding the whole data root, realm and
 * workspaces, NO social keys (the account is a record with no keys, so
 * nothing can be posted), and the serving is a local stub. Only the recorded
 * PIDs are killed.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const FPORT_BASE = 6711 + (process.pid % 149);
const BPORT_BASE = 5711 + (process.pid % 149);
const NEUMA_ID = 'e2e-mandatecmo';
const MODEL = 'stub-speaker';
const SHOTS = process.env.MANDATE_SHOTS_DIR || path.join(os.tmpdir(), 'mandate-e2e-shots');

let FPORT; let BPORT; let BASE;
let stub; let root; let backendProc; let viteProc; let token; let addr;

const canBind = (port) => new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.listen(port, () => srv.close(() => resolve(true)));
});
const freePort = async (start) => {
  for (let p = start; p < start + 120; p += 1) if (await canBind(p)) return p;
  throw new Error(`no free port in [${start}, ${start + 120})`);
};
const waitFor = async (urls, ms = 90000) => {
  const list = Array.isArray(urls) ? urls : [urls];
  const t0 = Date.now();
  for (;;) {
    for (const url of list) {
      try { if ((await fetch(url)).status < 500) return; } catch { /* not up */ }
    }
    if (Date.now() - t0 > ms) throw new Error(`stack member never answered: ${list.join(' | ')}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

/** A local OpenAI-wire serving that only ever says one line. */
const startStub = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: MODEL }] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw); } catch { /* answer anyway */ }
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Here.' } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
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
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ownerClaimHeaders(path.join(root, 'data')) },
    body: JSON.stringify({ address: w.address, signature, challenge }),
  });
  const { token: t } = await res.json();
  if (!t) throw new Error('auth/verify returned no token');
  return { token: t, addr: w.address };
};

const api = async (method, url, body) => {
  const res = await fetch(`${BASE}${url}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
};

test.describe.configure({ mode: 'serial' });
// The new headless Chromium: the old headless shell reports every notification permission
// `denied` whatever is granted (probed 2026-10-24), so it cannot stand for a browser that allowed them.
test.use({ channel: 'chromium' });

test.beforeAll(async () => {
  FPORT = await freePort(FPORT_BASE);
  BPORT = await freePort(BPORT_BASE);
  BASE = `http://localhost:${BPORT}`;
  stub = await startStub();
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mandate-e2e-'));
  await fs.promises.mkdir(SHOTS, { recursive: true });
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
    NEUMA_EFFORT_PATH: path.join(root, 'neuma-effort.json'),
    NEUMA_ROUTES_PATH: path.join(root, 'neuma-routes.json'),
    NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(root, 'creds.json'),
    NEUMA_SKILLS_ROOT: path.join(root, 'skills'),
    NEUMA_SOCIAL_POST_QUEUE_PATH: path.join(root, 'social', 'social-post-queue.json'),
    NEUMA_REPLY_CANDIDATES_PATH: path.join(root, 'social', 'reply-candidates.json'),
    // NO social keys reach this stack: nothing it holds can post.
    X_API_KEY: '', X_API_SECRET: '', X_ACCESS_TOKEN: '', X_ACCESS_SECRET: '',
    LLM_PROVIDER: 'lm-studio',
    LM_STUDIO_URL: stub.url,
    SUBSTRATE_IDLE_MINUTES: '0',
    NEUMA_RATE_GLOBAL_MAX: '5000',
  };
  backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  viteProc = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  await waitFor(`${BASE}/api/v1/health`);
  await waitFor([`http://127.0.0.1:${FPORT}/`, `http://[::1]:${FPORT}/`]);
  ({ token, addr } = await mintToken());
  await claimOwner(root, NEUMA_ID, addr);
  // The house's own records, through their own writers, in this stack's realm.
  process.env.NEUMA_REALM_ROOT = path.join(root, 'realm');
  const { setRealmRoot } = await import('../../backend/services/user-realm.js');
  setRealmRoot(process.env.NEUMA_REALM_ROOT);
  const { default: workspace, setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
  setWorkspacesRoot(root);
  await workspace.writeDNA(NEUMA_ID, { version: '1.0.0', identity: { name: 'Mandatecmo' }, genesis: '# Essence\nI am Mandatecmo.' });
  const { cmoDesignation } = await import('../../backend/services/marketing/cmo-designation.js');
  await cmoDesignation.designate(addr, NEUMA_ID);
  const { addAccount } = await import('../../backend/services/social/account-store.js');
  await addAccount(addr, 'x', { label: 'launch' });
  await fetch(`${BASE}/api/v1/routing/providers/lm-studio/key`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: stub.url }),
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
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${a.toLowerCase()}:neuma-companion`, JSON.stringify({ name: 'Mandatecmo', neumaId: id }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto(`http://localhost:${FPORT}/`);
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 15000 });
  await settleDesk(page);
});

const windowOf = (page, title) => page.locator('.fwin', { has: page.locator('.fwin-bar-title', { hasText: title }) }).first();

test('GRANT reads in plain words before the yes; WITHDRAW in the notification tray ends it in one press', async ({ page }) => {
  // The MANDATE lives in the notification tray now (bottom-right), never at the top of the desk.
  const openTray = async () => {
    if (!(await page.locator('.ntray-panel').count())) await page.locator('.ntray-bell').click();
    await expect(page.locator('.ntray-panel')).toBeVisible();
  };
  const trayChip = page.locator('.ntray-panel .ntray-mandate .mandate-chip');
  // The bell's own quiet mark while a mandate is ACTIVE (Design note, 2026-10-24: none before the grant.
  const bellMark = page.locator('.ntray-bell .ntray-mandate-mark');
  const MARK_WORDS = /^Mandate on — the CMO acts for you · ends [A-Z][a-z]{2} \d{1,2} · WITHDRAW in the tray$/;
  await expect(bellMark).toHaveCount(0);
  await openTray();
  await expect(trayChip).toHaveCount(0);
  await page.locator('.ntray-bell').click();
  await expect(page.locator('.relink-status .mandate-chip')).toHaveCount(0);

  await openDockApp(page, 'MARKETING');
  const win = windowOf(page, 'MARKETING');
  const panel = win.locator('section.mandate');
  await expect(panel.locator('.mandate-head')).toContainText('NO MANDATE — EVERY ACT ASKS YOU', { timeout: 20000 });
  await panel.getByRole('button', { name: 'GRANT A MANDATE…' }).click();

  const form = panel.locator('.mandate-grant');
  await expect(form.getByRole('button', { name: 'GRANT MANDATE' })).toBeDisabled();
  await form.getByRole('button', { name: /^x-1/ }).click();
  await expect(form.locator('.mandate-words')).toContainText('Mandatecmo will post on x-1 (2 a day), make images and videos without asking you, for 7 days.');
  await expect(form.locator('.mandate-words')).toContainText('This is total capacity inside that scope');
  await expect(form.locator('.mandate-never')).toContainText('Money never leaves the house');
  await form.getByRole('button', { name: 'GRANT MANDATE' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(600); // the window's rise settles (no-flash law) before the picture
  await page.screenshot({ path: path.join(SHOTS, 'mandate-1-grant-preview.png') });

  await form.getByRole('button', { name: 'GRANT MANDATE' }).click();
  await expect(panel.locator('.mandate-head')).toContainText('MANDATE · CMO ACTS FOR YOU');
  await expect(panel.locator('.mandate-words')).toContainText('Mandatecmo may post on x-1 (2 a day) and make images and videos without asking you');
  await expect(panel.locator('.mandate-feed')).toContainText('You granted the mandate');
  expect((await api('GET', '/api/v1/mandate')).standing).toBe('active');

  // The bell carries the mandate's quiet mark: its words on hover and in the bell's label, its
  // own square (not the ◆ of a decision owed — nothing waits), never animated.
  await expect(bellMark).toHaveCount(1, { timeout: 15000 });
  await expect(bellMark).toHaveAttribute('title', MARK_WORDS);
  await expect(page.locator('.ntray-bell')).toHaveAttribute('aria-label', /Mandate on — the CMO acts for you · ends .+ · WITHDRAW in the tray · Notifications/);
  await expect(page.locator('.ntray-bell .ntray-wait')).toHaveCount(0);
  const still = await bellMark.locator('.ntray-mandate-sq').evaluate((el) => {
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    return { animation: cs.animationName, transition: cs.transitionDuration, border: cs.borderTopStyle };
  });
  expect(still).toEqual({ animation: 'none', transition: '0s', border: 'solid' });
  await page.locator('.ntray-bell').screenshot({ path: path.join(SHOTS, 'mandate-2b-bell-mark.png') });

  // The tray holds it beside WAITING ON YOU, WITHDRAW one press away; the top of the desk stays clear.
  await expect(page.locator('.relink-status .mandate-chip')).toHaveCount(0);
  await openTray();
  await expect(trayChip).toHaveAttribute('data-tone', 'live', { timeout: 15000 });
  await expect(trayChip).toContainText('MANDATE ON');
  await expect(trayChip.getByRole('button', { name: 'WITHDRAW' })).toBeVisible();
  // …and in the window the head with its WITHDRAW is back in view after the grant.
  await expect(panel.locator('.mandate-head').getByRole('button', { name: 'WITHDRAW' })).toBeInViewport();
  await page.waitForTimeout(600); // the window's rise settles (no-flash law) before the picture
  await page.screenshot({ path: path.join(SHOTS, 'mandate-2-granted-desk.png') });

  // The House Clock shows it too.
  await openDockApp(page, 'HOUSE CLOCK');
  await expect(windowOf(page, 'HOUSE CLOCK').locator('.hclock-head .mandate-chip')).toContainText('MANDATE ON', { timeout: 15000 });

  // ONE press in the tray: no confirm, and every surface reads it ended.
  await openTray();
  await trayChip.getByRole('button', { name: 'WITHDRAW' }).click();
  await expect(trayChip).toHaveCount(0, { timeout: 15000 });
  await expect(windowOf(page, 'HOUSE CLOCK').locator('.hclock-head .mandate-chip')).toHaveCount(0);
  // …and the bell's mark is gone once the pointer leaves the tray (the calm rule holds it until then).
  await page.mouse.move(5, 5);
  await expect(bellMark).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator('.ntray-bell')).toHaveAttribute('aria-label', /^(?!.*Mandate on)/);
  const after = await api('GET', '/api/v1/mandate');
  expect(after.standing).toBe('none');
  expect(after.feed[0].what).toBe('You withdrew the mandate');
  await openDockApp(page, 'MARKETING');
  await expect(panel.locator('.mandate-head')).toContainText('NO MANDATE — EVERY ACT ASKS YOU', { timeout: 15000 });
  await expect(panel.locator('.mandate-feed')).toContainText('You withdrew the mandate');
  await page.screenshot({ path: path.join(SHOTS, 'mandate-3-withdrawn-desk.png') });

  expect(page.__crashes, page.__crashes.join(' | ')).toEqual([]);
});

test('DESKTOP ALERTS: no switch (and no permission prompt) where the desk cannot reach the OS; ON by default where it can, and it stays as set', async ({ page, context }) => {
  // This browser was never granted notifications: the tray offers no switch that would do nothing, and asks nothing.
  await page.locator('.ntray-bell').click();
  await expect(page.locator('.ntray-panel')).toBeVisible();
  await expect(page.locator('.ntray-os-toggle')).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.Notification.permission)).not.toBe('granted');

  // Granted already (by the operator, here by the test's browser): the switch stands, ON.
  await context.grantPermissions(['notifications'], { origin: `http://localhost:${FPORT}` });
  await page.reload();
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 15000 });
  await settleDesk(page);
  await page.locator('.ntray-bell').click();
  const toggle = page.locator('.ntray-panel .ntray-os-toggle');
  await expect(toggle).toHaveText('DESKTOP ALERTS ON');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveText('DESKTOP ALERTS OFF');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.ntray-panel').screenshot({ path: path.join(SHOTS, 'mandate-4-desktop-alerts-off.png') });

  // It stays as set across a reload.
  await page.reload();
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 15000 });
  await settleDesk(page);
  await page.locator('.ntray-bell').click();
  await expect(page.locator('.ntray-panel .ntray-os-toggle')).toHaveText('DESKTOP ALERTS OFF');
  await page.locator('.ntray-panel .ntray-os-toggle').click();
  await expect(page.locator('.ntray-panel .ntray-os-toggle')).toHaveText('DESKTOP ALERTS ON');

  expect(page.__crashes, page.__crashes.join(' | ')).toEqual([]);
});
