/* global sessionStorage, localStorage */
// WHOSE CHATS (deus-neuma #29), ALL (#30) and batch naming as a job (#28), in the real Chats window
// in Chromium against the real signed workspace and titling routes, real lanes, and a real loopback
// model server through the house's machine route. Picking another neuma lists its chats; ALL lists
// every neuma's, tagged; TITLE UNTITLED shows its progress and lands its titles. Opening a chat of
// another neuma brings it into the stream through the stream's own switch, which this window does
// not drive here (the provider stands in for the stream).
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { startLocalProvider } from '../helpers/local-provider.js';

test('the Chats window shows whose chats were picked, all of them, and names them with progress', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chats-whose-'));
  const oldRoot = getWorkspacesRoot();
  const saved = ['NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH'].map((k) => [k, process.env[k]]);
  let server; let browser; let provider; let previous;
  try {
    setWorkspacesRoot(path.join(root, 'lanes'));
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'creds.json');
    process.env.NEUMA_ROUTES_PATH = path.join(root, 'routes.json');
    const { setRealmRoot, getRealmRoot } = await import('../../backend/services/user-realm.js');
    const oldRealm = getRealmRoot();
    setRealmRoot(path.join(root, 'realm'));
    provider = await startLocalProvider({ script: [{ reply: 'A Named Chat', delayMs: 400 }] });
    const llm = await import('../../backend/services/llm-provider.js');
    previous = llm.getConfig();
    llm.setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '' });
    const auth = await fullAuth();
    const lanes = { 'whose-ash': ['session-1700000001000', 'session-1700000003000'], 'whose-birch': ['session-1700000002000'] };
    for (const [lane, ids] of Object.entries(lanes)) {
      await workspace.create(lane);
      await writeOwner(getWorkspacesRoot(), lane, auth.address);
      for (const id of ids) {
        await workspace.createSession(lane, id);
        await workspace.appendMessage(lane, id, { role: 'user', content: `what ${lane} said in ${id}` });
        await workspace.appendMessage(lane, id, { role: 'assistant', content: 'an answer' });
      }
    }
    const roster = { roster: [{ neumaId: 'whose-ash', name: 'Ash' }, { neumaId: 'whose-birch', name: 'Birch' }] };
    const entryId = 'virtual:chats-whose-proof';
    const source = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { chatsApp } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/ChatsApp.jsx'))};
      import { ConsciousnessProvider } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/consciousness-context.js'))};
      import { CouncilContext } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/council-context.js'))};
      import { WindowContext } from ${JSON.stringify(path.resolve('frontend/app/windowing/WindowManager.jsx'))};
      const council = { state: { past: [] }, listCouncils: () => {}, leaveRoom: () => {} };
      createRoot(document.getElementById('root')).render(
        React.createElement(WindowContext.Provider, { value: { dispatch: () => {} } },
          React.createElement(CouncilContext.Provider, { value: council },
            React.createElement(ConsciousnessProvider, { value: { activeCompanion: { neumaId: 'whose-ash', name: 'Ash' }, state: { messages: [] } } },
              React.createElement(chatsApp.Body)))));
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error', esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'whose-proof', resolveId: (id) => id === entryId ? id : null, load: (id) => id === entryId ? source : null }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express();
    app.use('/api/v1/workspace', (await import('../../backend/routes/workspace-routes.js')).default);
    app.use('/api/v1/titling', (await import('../../backend/routes/titling-routes.js')).default);
    app.use('/api/v1/user/realm', (await import('../../backend/routes/user-realm-routes.js')).default);
    for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) =>
      res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
    const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
    app.get('/', (_req, res) => res.send(`<div id="root"></div><script type="module" src="/${entry}"></script>`));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(([token, r]) => { sessionStorage.setItem('authToken', token); localStorage.setItem('neuma-roster', r); }, [auth.token, JSON.stringify(roster)]);
    await page.goto(`http://127.0.0.1:${server.address().port}`);

    // follows the stream's neuma: Ash's two chats
    await expect(page.locator('.chats-row')).toHaveCount(2);
    const whose = page.getByRole('button', { name: 'Whose chats' });
    await expect(whose).toContainText('ASH · IN THE STREAM');
    // pick Birch: Birch's one chat
    await whose.click();
    await page.getByRole('option', { name: 'BIRCH' }).click();
    await expect(page.locator('.chats-row')).toHaveCount(1);
    // ALL: three chats, newest first, each naming whose it is
    await whose.click();
    await page.getByRole('option', { name: 'ALL NEUMA' }).click();
    await expect(page.locator('.chats-row')).toHaveCount(3);
    await expect(page.locator('.chats-row-whose')).toHaveText(['ASH', 'BIRCH', 'ASH']);
    // name them all, as a job: its progress shows, then its end; the titles land in the list
    await page.getByRole('button', { name: 'TITLE', exact: true }).click();
    await page.getByRole('button', { name: 'TITLE UNTITLED', exact: true }).click();
    // the bar reads its own progress (this page carries no stylesheet, so it is checked, not looked at)
    await expect(page.getByRole('progressbar', { name: 'Naming chats' })).toHaveAttribute('aria-valuemax', '3');
    await expect(page.getByRole('status')).toContainText(/NAMING \d \/ 3/);
    await expect(page.getByRole('status')).toHaveText('NAMED 3 CHATS', { timeout: 20_000 });
    await expect(page.locator('.chats-row-label')).toHaveText(['A Named Chat', 'A Named Chat', 'A Named Chat']);
    expect(errors).toEqual([]);
    setRealmRoot(oldRealm);
  } finally {
    await browser?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await provider?.close();
    if (previous) (await import('../../backend/services/llm-provider.js')).setConfig(previous);
    for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    setWorkspacesRoot(oldRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);
