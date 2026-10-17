/* global window, sessionStorage, requestAnimationFrame */
// Real Chats body, signed workspace route and filesystem failure; no chat generation.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

test('Chats distinguishes failure from empty history and rejects late previous-lane results', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chats-history-'));
  const oldRoot = getWorkspacesRoot();
  let server; let browser; let release;
  try {
  setWorkspacesRoot(path.join(root, 'lanes'));
  const auth = await fullAuth();
  const first = 'history-fixture-a'; const second = 'history-fixture-b';
  for (const id of [first, second]) { await workspace.create(id); await writeOwner(getWorkspacesRoot(), id, auth.address); }
  const sessionsDir = path.join(workspace.pathFor(first), 'sessions');
  await fs.rmdir(sessionsDir);
  await fs.writeFile(sessionsDir, 'directory-damage-proof');
  const entryId = 'virtual:chats-history-proof';
  const source = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { chatsApp } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/ChatsApp.jsx'))};
    import { ConsciousnessProvider } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/consciousness-context.js'))};
    import { WindowContext } from ${JSON.stringify(path.resolve('frontend/app/windowing/WindowManager.jsx'))};
    const root = createRoot(document.getElementById('root'));
    const View = () => {
      const [lane, setLane] = React.useState('history-fixture-a');
      window.changeLane = setLane;
      return React.createElement(WindowContext.Provider, { value: {} },
        React.createElement(ConsciousnessProvider, { value: { activeCompanion: { neumaId: lane, name: lane }, state: { messages: [] } } },
          React.createElement(chatsApp.Body)));
    };
    root.render(React.createElement(View));
  `;
  const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    plugins: [{ name: 'roster-proof', resolveId: (id) => id === entryId ? id : null,
      load: (id) => id === entryId ? source : null }],
    build: { write: false, rollupOptions: { input: entryId } } });
  const app = express();
  app.use((_req, res, next) => { res.set('Content-Security-Policy', "connect-src 'self'"); next(); });
  let hold = false; let observed;
  app.use('/api/v1/workspace/:id/sessions', async (req, _res, next) => {
    if (hold && req.params.id === first) {
      hold = false;
      const barrier = new Promise((resolve) => { release = resolve; });
      observed();
      await barrier;
    }
    next();
  });
  app.use('/api/v1/workspace', (await import('../../backend/routes/workspace-routes.js')).default);
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
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(page.getByText('CHATS UNREACHABLE', { exact: true })).toBeVisible();
    await expect(page.getByText('NO CHATS YET', { exact: true })).toHaveCount(0);
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    await page.getByRole('button', { name: 'RETRY', exact: true }).click();
    await expect(page.getByText('sessions list failed: HTTP 500', { exact: true })).toBeVisible();
    expect(await fs.readFile(sessionsDir, 'utf8')).toBe('directory-damage-proof');
    await fs.rename(sessionsDir, `${sessionsDir}.damaged`);
    await fs.mkdir(sessionsDir);
    await page.getByRole('button', { name: 'RETRY', exact: true }).click();
    await expect(page.getByText('NO CHATS YET', { exact: true })).toBeVisible();
    await fs.writeFile(path.join(sessionsDir, 'session-proof.jsonl'), '');
    await page.getByRole('button', { name: 'Refresh chats' }).click();
    await expect(page.locator('.chats-row')).toHaveCount(1);
    hold = true;
    const seen = new Promise((resolve) => { observed = resolve; });
    const oldResponse = page.waitForResponse((res) => res.url().endsWith(`/${first}/sessions`));
    await page.getByRole('button', { name: 'Refresh chats' }).click();
    await seen;
    await expect(page.getByText('LOADING…', { exact: true })).toBeVisible();
    await page.evaluate((id) => window.changeLane(id), second);
    await expect(page.getByText('NO CHATS YET', { exact: true })).toBeVisible();
    release();
    await (await oldResponse).finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('.chats-row')).toHaveCount(0);
    await expect(page.getByText('NO CHATS YET', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    release?.();
    await browser?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    setWorkspacesRoot(oldRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
