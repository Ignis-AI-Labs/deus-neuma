/* global process, fetch, setTimeout, clearTimeout */
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDockApp } from './helpers/dock.js';
import { passDeskGates } from './helpers/desk-gates.js';
import { claimOwner } from '../helpers/claim-owner.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let root;
let backend;
let frontend;
let base;
let frontendOrigin;
let token;
let addr;

const freePort = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

const waitFor = async (url, timeoutMs = 90000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* booting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`stack did not answer: ${url}`);
};

const mintToken = async () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  const wallet = new ethers.Wallet(pk);
  const { challenge } = await (await fetch(`${base}/api/v1/auth/challenge?address=${wallet.address}`)).json();
  const signature = await wallet.signMessage(challenge);
  const response = await fetch(`${base}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: wallet.address, signature, challenge }),
  });
  const session = await response.json();
  if (!session.token) throw new Error('auth/verify returned no token');
  return { token: session.token, addr: wallet.address };
};

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-terminal-link-'));
  const backendPort = await freePort();
  const frontendPort = await freePort();
  base = `http://127.0.0.1:${backendPort}`;
  const env = {
    ...process.env,
    PORT: String(backendPort),
    FRONTEND_PORT: String(frontendPort),
    WORKSPACES_ROOT: root,
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_SUBSTRATE_CLAIM_DIR: path.join(root, 'claims'),
    NEUMA_RATE_GLOBAL_MAX: '100000',
  };
  backend = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'inherit', detached: true });
  frontend = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'inherit', detached: true });
  await waitFor(`${base}/api/v1/health`);
  frontendOrigin = `http://localhost:${frontendPort}`;
  await waitFor(`http://[::1]:${frontendPort}/`);
  ({ token, addr } = await mintToken());
  await claimOwner(root, 'e2e-terminal-link', addr);
  const security = await (await fetch(`${base}/api/v1/security/status`, { headers: { Authorization: `Bearer ${token}` } })).json();
  if (security?.roots?.active && security.roots.active !== root) await claimOwner(security.roots.active, 'e2e-terminal-link', addr);
});

test.afterAll(async () => {
  for (const child of [frontend, backend]) {
    if (!child?.pid) continue;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
  }
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (error) => crashes.push(error.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a }) => {
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${a.toLowerCase()}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: 'e2e-terminal-link' }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr });
  await page.goto(frontendOrigin);
  await passDeskGates(page, 5000);
});

test('TERMINAL: right-clicking a printed dev-server URL offers both browser doors', async ({ page }) => {
  await openDockApp(page, 'TERMINAL');
  const screen = page.locator('.terminal-stage .xterm-screen');
  await expect(screen).toBeVisible();
  await screen.click();
  await page.keyboard.type('clear');
  await page.keyboard.press('Enter');
  await page.keyboard.type("printf 'Local:   http://localhost:5173/\\n'");
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  const point = await screen.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.font = '13px "JetBrains Mono", monospace';
    return {
      x: rect.left + ('Local:   '.length + 2.5) * canvas.measureText('M').width,
      y: rect.top + 2.5 * 17,
    };
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Open in integrated browser' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open in external browser' })).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  const requestPromise = page.context().waitForEvent('request', (request) => request.url() === 'http://localhost:5173/');
  await page.getByRole('menuitem', { name: 'Open in integrated browser' }).click();
  const popup = await popupPromise;
  expect(await requestPromise).toBeTruthy();
  await popup.close();

  const leftPopupPromise = page.waitForEvent('popup');
  const leftRequestPromise = page.context().waitForEvent('request', (request) => request.url() === 'http://localhost:5173/');
  await page.mouse.click(point.x, point.y);
  const leftPopup = await leftPopupPromise;
  expect(await leftRequestPromise).toBeTruthy();
  await leftPopup.close();

  await page.mouse.click(point.x, point.y + 3 * 17, { button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Open in integrated browser' })).toHaveCount(0);

  fs.writeFileSync(path.join(root, 'absolute.md'), '# absolute terminal link\n');
  await screen.click();
  await page.keyboard.type('clear');
  await page.keyboard.press('Enter');
  await page.keyboard.type(`printf 'read ${root}/absolute.md\\n'`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const pathPoint = await screen.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.font = '13px "JetBrains Mono", monospace';
    return { x: rect.left + ('read '.length + 0.5) * canvas.measureText('M').width, y: rect.top + 2.5 * 17 };
  });
  await page.mouse.click(pathPoint.x, pathPoint.y);
  const editor = page.locator('.fwin', { has: page.locator('.fwin-bar-title', { hasText: 'ABSOLUTE.MD' }) });
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(editor).toContainText('terminal link');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('TERMINAL: a cwd-relative filename opens the actual file on plain click', async ({ page }) => {
  await openDockApp(page, 'TERMINAL');
  const screen = page.locator('.terminal-stage .xterm-screen');
  await expect(screen).toBeVisible();
  await screen.click();
  await page.keyboard.type('clear');
  await page.keyboard.press('Enter');
  await page.keyboard.type("printf 'read package.json\\n'");
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const point = await screen.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.font = '13px "JetBrains Mono", monospace';
    return { x: rect.left + ('read '.length + 0.5) * canvas.measureText('M').width, y: rect.top + 2.5 * 17 };
  });
  await page.mouse.click(point.x, point.y);
  const editor = page.locator('.fwin', { has: page.locator('.fwin-bar-title', { hasText: 'PACKAGE.JSON' }) });
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(editor).toContainText('neuma');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
