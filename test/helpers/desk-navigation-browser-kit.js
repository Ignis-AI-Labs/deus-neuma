// impure - disposable HTTP/WS/Chromium fixture. No model or private lane access.
/* global window, document, localStorage, sessionStorage */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import express from 'express';
import { createServer as createVite } from 'vite';
import { chromium } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { Wallet } from 'ethers';
import { generateChallenge, verifySignature, createSessionToken, verifySessionToken } from '../../backend/services/auth.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import workspaceRouter from '../../backend/routes/workspace-routes.js';
import { createPortalConnection } from '../../backend/services/portal-connection.js';
import { portalConnections } from '../../backend/routes/portal-connections.js';
import { handlePortalMessage } from '../../backend/routes/portal-message-handlers.js';
import { claimOwner } from './claim-owner.js';
import platform from '../../backend/services/platform-db.js';

export const A = 'hr-desk-a';
export const B = 'hr-desk-b';
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const until = async (predicate) => {
  const deadline = Date.now() + 10000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error('desk fixture condition did not arrive');
    await wait(25);
  }
};

/** Create a real browser desk over authenticated production navigation/storage. */
export const createDeskBrowserKit = async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hr-desk-browser-'));
  const oldRoot = getWorkspacesRoot();
  const oldPlatform = { driver: platform.driver, available: platform.available };
  const envKeys = ['PLATFORM_DB_PATH', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const pauses = [];
  const connections = new Set();
  let vite; let server; let wss; let browser;
  const close = async () => {
    pauses.forEach((p) => p.release());
    await browser?.close();
    if (wss) {
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
    }
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    for (const id of connections) portalConnections.delete(id);
    if (platform.driver !== oldPlatform.driver) platform.driver?.db?.close();
    Object.assign(platform, oldPlatform);
    for (const key of envKeys) {
      if (oldEnv[key] === undefined) delete process.env[key];
      else process.env[key] = oldEnv[key];
    }
    setWorkspacesRoot(oldRoot);
    await fs.rm(tmp, { recursive: true, force: true });
  };
  try {
  process.env.PLATFORM_DB_PATH = path.join(tmp, 'platform.db');
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  await platform.init();
  if (!platform.available || platform.driver?.constructor.name !== 'SqlitePlatform') {
    throw new Error('Desk browser fixture requires the real SQLite platform driver');
  }
  const house = path.join(tmp, 'sessions');
  const folderA = path.join(tmp, 'folder-a');
  const folderB = path.join(tmp, 'folder-b');
  await fs.mkdir(house);
  await fs.mkdir(folderA);
  await fs.mkdir(folderB);
  setWorkspacesRoot(house);
  const wallet = Wallet.createRandom();
  const challenge = generateChallenge(wallet.address);
  const signature = await wallet.signMessage(challenge);
  const token = createSessionToken(verifySignature(wallet.address, challenge, signature));
  for (const id of [A, B]) {
    // Storage-only fixtures, no DNA/genesis/true-name or born being.
    await claimOwner(house, id, wallet.address);
    await workspace.appendMessage(id, 'session-one', { role: 'user', content: `${id} original history` });
    await workspace.appendMessage(id, 'session-two', { role: 'user', content: `${id} second history` });
  }
  const app = express();
  const requests = [];
  const frames = [];
  const errors = [];
  const browserNotes = [];
  const completedSteps = [];
  const diagnose = async (page, label, error) => {
    const state = await Promise.race([
      page.evaluate(() => ({
        tabs: window.desk?.tabs?.state, anchor: window.desk?.tabs?.anchorTabId,
        binding: window.desk?.stream.wsService.getSessionState(),
        transcript: document.getElementById('transcript')?.textContent,
        windows: Object.fromEntries(Object.keys(localStorage).filter((k) => k.includes('desk:windows')).map((k) => [k, localStorage.getItem(k)])),
      })).catch((err) => ({ evaluationError: err.message })),
      wait(1000).then(() => ({ evaluationError: 'renderer did not answer within 1s' })),
    ]);
    return new Error(`${label}: ${error.message}\n${JSON.stringify({ completedSteps, state, errors, browserNotes, frames: frames.slice(-20) }, null, 2)}`);
  };
  app.use('/api/v1/workspace', async (req, res, next) => {
    requests.push(req.path);
    const pause = pauses.find((p) => !p.used && p.url === req.path);
    if (pause) { pause.used = true; await pause.promise; }
    next();
  }, workspaceRouter);
  vite = await createVite({
    configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
    cacheDir: path.join(tmp, 'vite-cache'), appType: 'custom',
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/desk-navigation-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  app.get('/', (req, res) => res.type('html').send(
    '<!doctype html><div id="root"></div><script type="module" src="/test/helpers/desk-navigation-page.jsx"></script>',
  ));
  app.use(vite.middlewares);
  server = http.createServer(app);
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const session = verifySessionToken(new URL(req.url, 'http://localhost').searchParams.get('token'));
    if (!session) { ws.close(4001, 'Unauthorized'); return; }
    const id = randomUUID();
    const connection = createPortalConnection({ ws, walletAddress: session.address });
    portalConnections.set(id, connection);
    connections.add(id);
    let navigation = Promise.resolve();
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      frames.push(frame);
      // The asserted boundary is outgoing WS delivery, not model execution.
      // Turns terminate in this collector; navigation uses the REAL dispatcher.
      if (['consciousness:stream', 'consciousness:retry'].includes(frame.type)) return;
      navigation = navigation.then(() => handlePortalMessage(id, frame, { birthHandler: null }))
        .catch((error) => errors.push(error.message));
    });
    ws.on('close', () => { portalConnections.delete(id); connections.delete(id); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  return {
    frames, errors, requests, folderA, folderB,
    disconnectClients() {
      for (const ws of wss.clients) ws.close(1012, 'browser reconnect regression');
    },
    async step(page, label, run) {
      try {
        const result = await run();
        completedSteps.push(label);
        return result;
      } catch (error) { throw await diagnose(page, label, error); }
    },
    pause(url) {
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      const pause = { url, promise, release, used: false };
      pauses.push(pause);
      return pause;
    },
    async corruptOwner(id) { await fs.writeFile(path.join(house, id, 'owner.json'), '{broken'); },
    async page(payload = null) {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      page.setDefaultNavigationTimeout(10000);
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (!['error', 'warning'].includes(message.type())) return;
        browserNotes.push(message.text());
        if (browserNotes.length > 20) browserNotes.shift();
      });
      await page.addInitScript(({ token, address, folderA, folderB, payload }) => {
        sessionStorage.setItem('authToken', token);
        localStorage.setItem('walletAddress', address);
        localStorage.setItem(`${address.toLowerCase()}:neuma-companion`, JSON.stringify({ neumaId: 'hr-desk-a', name: 'HR Desk A' }));
        window.deskFixture = { folderA, folderB, payload };
      }, { token, address: wallet.address, folderA, folderB, payload });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      try {
        await page.waitForFunction(() => window.desk?.stream.state.connected);
      } catch (error) { throw await diagnose(page, 'initial portal connection', error); }
      return page;
    },
    close,
  };
  } catch (error) {
    await close();
    throw error;
  }
};
