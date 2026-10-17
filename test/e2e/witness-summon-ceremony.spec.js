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
 * Non-sealing browser proof of the provider-first WITNESSES surface, on an
 * ISOLATED self-spawned stack (converted 2026-08-10 — this spec used to
 * require a pre-existing dev stack and ran against the REAL workspace root;
 * every sibling spawns its own backend+vite in a temp root, and now so does
 * this one; witness-rite-threshold.spec.js is the harness precedent).
 *
 * What an isolated stack can honestly prove: the provider organization
 * renders, a LOCKED connection opens the ceremony gate while an unlocked
 * provider states its precondition, and the OAuth-only provider refuses an
 * API key BY CONSTRUCTION. It never presses BEGIN — no seal, no witness.
 *
 * NOT here, deliberately: the original rig-state assertions — a foreign
 * wallet's sealed witness (Sosonus) staying invisible, the machine-scoped
 * ChatGPT OAuth account reading CONNECTED, and a locked provider that
 * already carries a witness reading ALREADY SUMMONED. The roster is built
 * from SEALED records (`listWitnesses()`), so those legs need a
 * sealed-witness fixture or the live rig — a lane-only seed would render
 * nothing and the absence assertion would pass vacuously. They stay owed to
 * a sealed-witness-fixture session; asserting them here would be theater.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FPORT_BASE = 8331 + (process.pid % 149);
const BPORT_BASE = 4331 + (process.pid % 149);

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
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'witness-summon-e2e-'));

  providerServer = http.createServer((request, response) => {
    if (request.url?.endsWith('/models')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'summon-model' }] }));
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
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({ endpoint: providerEndpoint, model: 'summon-model' }),
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

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (error) => crashes.push(error.message));
  page.__crashes = crashes;
  await page.addInitScript(({ token, address }) => {
    const wallet = address.toLowerCase();
    localStorage.setItem('walletAddress', address);
    localStorage.setItem(`${wallet}:neuma-companion`, JSON.stringify({
      name: 'Operator Test',
      neumaId: 'operator-test',
    }));
    sessionStorage.setItem('authToken', token);
    sessionStorage.setItem(`arrivalSeen:${wallet}`, '1');
  }, auth);
  await page.goto(`http://localhost:${frontendPort}/?test=1`);
});

test('the provider-first WITNESSES surface: organization, honest gates, and the OAuth-only wall', async ({ page }) => {
  await openDockApp(page, 'WITNESSES');

  const witnessesWindow = page.locator('.witnesses');
  await expect(witnessesWindow).toBeVisible();
  await page.locator('.fwin').filter({ has: witnessesWindow }).getByRole('button', { name: 'Maximize window' }).click();
  await expect(page.getByRole('tablist', { name: 'Witness providers' })).toBeVisible();

  // The LOCKED provider (seeded through the stub connection) opens the
  // ceremony gate — and only the gate; BEGIN is the rite-threshold spec's
  // territory and nothing here summons.
  await page.getByRole('tab', { name: /^Custom \(OpenAI-compatible\) LOCKED$/ }).click();
  await expect(page.getByRole('button', { name: 'START WITNESS CEREMONY' })).toBeVisible();

  // An unlocked provider states its precondition instead of a dead button.
  await page.getByRole('tab', { name: /^302\.AI SETUP$/ }).click();
  await expect(page.getByRole('textbox', { name: 'Provider API key' })).toBeVisible();
  await expect(page.getByText('LOCK A LIVE MODEL CONNECTION TO OPEN THE CEREMONY.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'START WITNESS CEREMONY' })).toHaveCount(0);

  // The OAuth-only provider takes no API key — a wall by construction, so it
  // holds on a bare stack with no credential anywhere.
  await page.getByRole('tab', { name: /OpenAI \(ChatGPT OAuth\)/ }).click();
  await expect(page.getByText('Authenticate directly through Neuma OAuth.')).toBeVisible();
  await expect(page.locator('input[aria-label="Provider API key"]')).toHaveCount(0);
  const keyAttempt = await page.evaluate(async () => {
    const response = await fetch('/api/v1/routing/providers/openai-chatgpt/key', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionStorage.getItem('authToken')}`,
      },
      body: JSON.stringify({ apiKey: 'must-not-be-stored' }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(keyAttempt.status).toBe(400);
  expect(keyAttempt.body.error).toContain('OAuth sign-in only');

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
