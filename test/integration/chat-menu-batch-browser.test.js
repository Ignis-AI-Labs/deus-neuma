/* global sessionStorage */
// A chat's right-click menu offers the batch naming too (deus-neuma #27): the
// real Chats body, the real signed workspace route, a real lane with one chat.
// The batch starts a titling job (titling-routes.js) with the force each item names; no chat has
// words, so nothing is generated.
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

test('right-clicking a chat offers OPEN, RENAME, AUTO-TITLE, then TITLE UNTITLED and RETITLE ALL', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-menu-batch-'));
  const oldRoot = getWorkspacesRoot();
  let server; let browser;
  try {
    setWorkspacesRoot(path.join(root, 'lanes'));
    const auth = await fullAuth();
    const lane = 'menu-batch-fixture';
    await workspace.create(lane);
    await writeOwner(getWorkspacesRoot(), lane, auth.address);
    await fs.writeFile(path.join(workspace.pathFor(lane), 'sessions', 'session-menu-proof.jsonl'), '');
    const entryId = 'virtual:chat-menu-batch-proof';
    const source = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { chatsApp } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/ChatsApp.jsx'))};
      import { ConsciousnessProvider } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/consciousness-context.js'))};
      import { WindowContext } from ${JSON.stringify(path.resolve('frontend/app/windowing/WindowManager.jsx'))};
      createRoot(document.getElementById('root')).render(
        React.createElement(WindowContext.Provider, { value: {} },
          React.createElement(ConsciousnessProvider, { value: { activeCompanion: { neumaId: ${JSON.stringify(lane)}, name: 'fixture' }, state: { messages: [] } } },
            React.createElement(chatsApp.Body))));
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'menu-proof', resolveId: (id) => id === entryId ? id : null,
        load: (id) => id === entryId ? source : null }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express();
    app.use('/api/v1/workspace', (await import('../../backend/routes/workspace-routes.js')).default);
    app.use('/api/v1/titling', (await import('../../backend/routes/titling-routes.js')).default);
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
    await page.addInitScript((token) => sessionStorage.setItem('authToken', token), auth.token);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(page.locator('.chats-row')).toHaveCount(1);

    const batchRuns = [];
    page.on('request', (req) => { if (req.url().endsWith('/api/v1/titling/jobs') && req.method() === 'POST') batchRuns.push(req.postDataJSON()); });
    const menuItems = () => page.locator('.chats-ctx').locator('button, [role="separator"]');

    await page.locator('.chats-row').first().click({ button: 'right' });
    await expect(menuItems()).toHaveCount(6);
    expect(await menuItems().evaluateAll((els) => els.map((el) => el.textContent || el.getAttribute('role'))))
      .toEqual(['OPEN', 'RENAME', 'AUTO-TITLE', 'separator', 'TITLE UNTITLED', 'RETITLE ALL']);
    const settled = page.waitForResponse((res) => res.url().endsWith('/api/v1/titling/jobs'));
    await page.getByRole('button', { name: 'TITLE UNTITLED', exact: true }).click();
    await (await settled).finished();
    await expect(page.locator('.chats-ctx')).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'TITLE', exact: true })).toBeEnabled();
    await page.locator('.chats-row').first().click({ button: 'right' });
    // the job ends: the chat has no words (or this machine no model to name with)
    await expect(page.getByRole('status')).toHaveText(/NOTHING TO NAME|NO MODEL TO NAME WITH/, { timeout: 15_000 });
    const again = page.waitForResponse((res) => res.url().endsWith('/api/v1/titling/jobs'));
    await page.getByRole('button', { name: 'RETITLE ALL', exact: true }).click();
    await (await again).finished();
    expect(batchRuns).toEqual([{ kind: 'chats', neumaIds: [lane], force: false }, { kind: 'chats', neumaIds: [lane], force: true }]);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    setWorkspacesRoot(oldRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
