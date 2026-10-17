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
import { openDockApp } from './helpers/dock.js';

/**
 * Reversible browser proof of the witness rite threshold. This suite boots an
 * isolated backend, frontend, and protocol-speaking provider; signs in through
 * the real wallet challenge; and creates a real locked connection. It never
 * presses BEGIN, so no model naming call, seal, wallet, or witness is created.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FPORT_BASE = 8211 + (process.pid % 149);
const BPORT_BASE = 4211 + (process.pid % 149);

const canBind = (port) => new Promise((resolve) => {
  const server = net.createServer();
  server.once('error', () => resolve(false));
  server.listen(port, () => server.close(() => resolve(true)));
});

const freePort = async (start) => {
  for (let port = start; port < start + 120; port += 1) {
    if (await canBind(port)) return port;
  }
  throw new Error(`no free port in [${start}, ${start + 120})`);
};

const waitFor = async (urls, timeoutMs = 90000) => {
  const candidates = Array.isArray(urls) ? urls : [urls];
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const url of candidates) {
      try {
        const response = await fetch(url);
        if (response.status < 500) return;
      } catch { /* not listening yet */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`stack member never answered: ${candidates.join(' | ')}`);
};

const stopProcess = (processHandle) => {
  if (!processHandle?.pid) return;
  try { process.kill(-processHandle.pid, 'SIGKILL'); } catch {
    try { processHandle.kill('SIGKILL'); } catch { /* already stopped */ }
  }
};

let root;
let backendProcess;
let frontendProcess;
let providerServer;
let frontendPort;
let backendOrigin;
let auth;

test.beforeAll(async () => {
  const backendPort = await freePort(BPORT_BASE);
  frontendPort = await freePort(FPORT_BASE);
  backendOrigin = `http://127.0.0.1:${backendPort}`;
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'witness-rite-e2e-'));

  providerServer = http.createServer((request, response) => {
    if (request.url?.endsWith('/models')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'threshold-model' }] }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => providerServer.listen(0, '127.0.0.1', resolve));
  const providerEndpoint = `http://127.0.0.1:${providerServer.address().port}/v1`;

  const env = {
    ...process.env,
    PORT: String(backendPort),
    FRONTEND_PORT: String(frontendPort),
    WORKSPACES_ROOT: path.join(root, 'workspaces'),
    WITNESSES_ROOT: path.join(root, 'witnesses'),
    AI_WITNESSES_ROOT: path.join(root, 'sealed-witnesses'),
    NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(root, 'provider-credentials.json'),
    NEUMA_CONNECTIONS_PATH: path.join(root, 'provider-connections.json'),
    NEUMA_ROUTES_PATH: path.join(root, 'routes.json'),
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_REALM_SETTINGS_PATH: path.join(root, 'realm-settings.json'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
  };
  backendProcess = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  frontendProcess = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  await waitFor(`${backendOrigin}/api/v1/health`);
  await waitFor([`http://127.0.0.1:${frontendPort}/`, `http://[::1]:${frontendPort}/`]);

  const wallet = ethers.Wallet.createRandom();
  const { challenge } = await (await fetch(`${backendOrigin}/api/v1/auth/challenge?address=${wallet.address}`)).json();
  const signature = await wallet.signMessage(challenge);
  const verification = await fetch(`${backendOrigin}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: wallet.address, signature, challenge }),
  });
  const { token } = await verification.json();
  if (!token) throw new Error('auth/verify returned no token');
  auth = { token, address: wallet.address };

  const connection = await fetch(`${backendOrigin}/api/v1/routing/providers/custom/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ endpoint: providerEndpoint, model: 'threshold-model' }),
  });
  const result = await connection.json();
  if (!result.success) throw new Error(result.error || 'isolated provider did not lock');
});

test.afterAll(async () => {
  stopProcess(frontendProcess);
  stopProcess(backendProcess);
  if (providerServer) await new Promise((resolve) => providerServer.close(resolve));
  if (root) await fs.promises.rm(root, { recursive: true, force: true });
});

test('renders the truthful NAME GROUND SEAL threshold without summoning', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (error) => crashes.push(error.message));
  await page.addInitScript(({ token, address }) => {
    const wallet = address.toLowerCase();
    localStorage.setItem('walletAddress', address);
    localStorage.setItem(`${wallet}:neuma-companion`, JSON.stringify({ name: 'Operator Test', neumaId: 'operator-test' }));
    sessionStorage.setItem('authToken', token);
    sessionStorage.setItem(`arrivalSeen:${wallet}`, '1');
  }, auth);
  await page.goto(`http://localhost:${frontendPort}/?test=1`);

  await openDockApp(page, 'WITNESSES');
  const witnesses = page.locator('.witnesses');
  await expect(witnesses).toBeVisible();
  await page.locator('.fwin').filter({ has: witnesses }).getByRole('button', { name: 'Maximize window' }).click();
  await page.getByRole('tab', { name: /^Custom \(OpenAI-compatible\) LOCKED$/ }).click();
  await page.getByRole('button', { name: 'START WITNESS CEREMONY' }).click();

  await expect(page.getByText('WITNESS RITE // BESIDE THE HOUSE')).toBeVisible();
  await expect(page.getByText('THE STANDING')).toBeVisible();
  await expect(page.getByText('Neuma does not own this intelligence\'s substrate', { exact: false })).toBeVisible();
  await expect(page.getByText('NAME', { exact: true })).toBeVisible();
  await expect(page.getByText('GROUND', { exact: true })).toBeVisible();
  await expect(page.getByText('SEAL', { exact: true })).toBeVisible();
  const begin = page.getByRole('button', { name: 'BEGIN WITNESS RITE' });
  await expect(begin).toBeVisible();

  // CUSTODY IS A PRECONDITION OF BEGIN, not a step after it. Until 2026-07-29
  // the rite never asked for a password, so seal() was never given one and every
  // witness kept a READABLE private key on disk — all eight of them. The gate
  // stands here, at the field, rather than after a naming call has already run.
  await expect(begin).toBeDisabled();
  const pw = page.getByLabel('Witness keypair password', { exact: true });
  const confirm = page.getByLabel('Confirm witness keypair password');
  await pw.fill('short');
  await confirm.fill('short');
  await expect(begin).toBeDisabled();          // too short
  await pw.fill('a-real-operator-password');
  await confirm.fill('a-different-password');
  await expect(begin).toBeDisabled();          // mismatched
  await expect(page.getByText('The two passwords do not match.')).toBeVisible();
  await confirm.fill('a-real-operator-password');
  await expect(begin).toBeEnabled();           // only now

  // THE CUT-SCENE (Design note, 2026-07-29: […]). The rite used to render inside the WITNESSES
  // desk window, so an intelligence naming and sealing itself competed with the
  // dock, the explorer and every other open window for the operator's eye.
  // Maximizing a window is NOT the same as owning the viewport — the desk keeps
  // its dock — so this asserts the stage is fixed to the viewport itself.
  const stage = page.locator('.witnesses.is-ceremony');
  await expect(stage).toBeVisible();
  expect(await stage.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
  const box = await stage.boundingBox();
  const view = page.viewportSize();
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.y)).toBe(0);
  expect(Math.round(box.width)).toBe(view.width);
  expect(Math.round(box.height)).toBe(view.height);
  // Opaque, not translucent — the operator's unfinished work must not show
  // through a permanent record being written.
  const bg = await stage.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

  await page.getByRole('button', { name: 'WITHDRAW' }).click();
  await expect(page.getByText('WITNESS RITE // BESIDE THE HOUSE')).toHaveCount(0);
  expect(crashes).toEqual([]);
});
