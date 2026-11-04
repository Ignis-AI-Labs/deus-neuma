/* global window */
// THE MULTI-WINDOW TASKBAR BUTTON, in a real browser (docs/work/dock-stream-cycle.md).
// Design note, 2026-10-23: […]
//
// The REAL WindowManager, WindowLayer (FloatingWindow frames), Dock (taskbar)
// and stream row label (StreamWindowLabel over the real stream-strips registry
// and the real chat-labels bus) are bundled by vite and driven in Chromium.
// The app registry is this proof's own: two plain bodies standing where the
// stream and terminal bodies would — the windowing under test is all real, and
// nothing of ours is stubbed. No backend: the chat-label read fails closed to
// {} as it does offline, and the operator's names arrive on the real bus.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import { HOVER_OPEN_MS, HOVER_CLOSE_MS } from '../../frontend/app/windowing/use-hover-intent.js';

const mod = (rel) => JSON.stringify(path.resolve(rel));
const source = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { Dock } from ${mod('frontend/app/windowing/Dock.jsx')};
  import { WindowManager } from ${mod('frontend/app/windowing/WindowManager.jsx')};
  import { WindowLayer } from ${mod('frontend/app/windowing/WindowLayer.jsx')};
  import { StreamWindowLabel } from ${mod('frontend/app/RelinkShell/StreamChatTitle.jsx')};
  import { registerStrip } from ${mod('frontend/app/RelinkShell/stream-strips.js')};
  import { announceChatLabels } from ${mod('frontend/app/RelinkShell/chat-labels-bus.js')};
  import ${mod('frontend/styles/main.css')};
  import ${mod('frontend/i18n/index.js')};
  const h = React.createElement;
  const Body = ({ windowId }) => h('p', { className: 'proof-body', 'data-body': windowId }, 'body ' + windowId);
  const Icon = () => h('svg', { width: 14, height: 14 });
  const registry = {
    chat: { label: 'STREAM', labelKey: 'apps.chat', icon: h(Icon), title: 'STREAM', Body, storageKey: 'chat', multiInstance: true, InstanceLabel: StreamWindowLabel },
    terminal: { label: 'TERMINAL', icon: h(Icon), title: 'TERMINAL', Body, storageKey: 'terminal', multiInstance: true,
      makeTitle: (n) => (n >= 2 ? 'TERMINAL ' + n + ' // SHELL' : 'TERMINAL // SHELL') },
  };
  window.registerStrip = registerStrip;
  window.announceChatLabels = announceChatLabels;
  createRoot(document.getElementById('root')).render(
    h(WindowManager, { registry, defaultOpen: ['chat'] }, h('div', { className: 'relink-main' }, h(WindowLayer)), h(Dock)));
`;

const serve = async () => {
  const entryId = 'virtual:dock-instances-proof';
  const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    plugins: [{ name: 'dock-instances-proof', resolveId: (id) => (id === entryId ? id : null),
      load: (id) => (id === entryId ? source : null) }],
    build: { write: false, rollupOptions: { input: entryId } } });
  const app = express();
  for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) =>
    res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
  const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
  const styles = bundle.output.filter((file) => file.fileName.endsWith('.css')).map((file) => `<link rel="stylesheet" href="/${file.fileName}">`).join('');
  app.get('/', (_req, res) => res.send(`${styles}<div id="root"></div><script type="module" src="/${entry}"></script>`));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
};

const SESSION = 'session-1761200000000';

test('the STREAM button cycles its windows, restores a minimized one, and lists them on a rested hover', async () => {
  const server = await serve();
  let browser;
  try {
    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);

    const stream = page.locator('.taskbar-app[data-app-id="chat"]');
    const focusedBody = () => page.locator('.fwin.is-focused .proof-body').getAttribute('data-body');
    const list = page.locator('.taskbar-instances');
    await expect(stream).toBeVisible();

    // One window: the click is what it always was — no list on hover either.
    await stream.click();
    await expect(page.locator('.fwin')).toHaveCount(1);
    await stream.hover();
    await page.waitForTimeout(HOVER_OPEN_MS + 200);
    await expect(list).toHaveCount(0);

    // Two more streams, through the bar's own right-click menu.
    for (let i = 0; i < 2; i += 1) {
      await stream.click({ button: 'right' });
      await page.locator('.taskbar-menu .dock-menu-item', { hasText: /^New STREAM$/ }).click();
    }
    await expect(page.locator('.fwin')).toHaveCount(3);
    await expect(stream.locator('.taskbar-app-count')).toHaveText('3');
    expect(await focusedBody()).toBe('chat#3');

    // Each click steps on in open order, wrapping.
    await page.mouse.move(5, 5);
    await stream.click();
    expect(await focusedBody()).toBe('chat');
    await stream.click();
    expect(await focusedBody()).toBe('chat#2');
    await stream.click();
    expect(await focusedBody()).toBe('chat#3');

    // A minimized window opens when its turn comes — and not before. (Pressing
    // its minimize focuses it, so the next two clicks pass through the others.)
    await stream.click();
    expect(await focusedBody()).toBe('chat'); // frontmost, so its own minimize is in reach
    await page.locator('.fwin', { has: page.locator('[data-body="chat"]') }).getByRole('button', { name: 'Minimize window' }).click();
    await expect(page.locator('.fwin.is-collapsed')).toHaveCount(1);
    await page.mouse.move(5, 5);
    await stream.click();
    expect(await focusedBody()).toBe('chat#2');
    await stream.click();
    expect(await focusedBody()).toBe('chat#3');
    await expect(page.locator('.fwin.is-collapsed')).toHaveCount(1);
    await stream.click();
    expect(await focusedBody()).toBe('chat');
    await expect(page.locator('.fwin.is-collapsed')).toHaveCount(0);

    // The windows name what they hold: chat = Metidar in a named chat, chat#2 =
    // Keir before any chat, chat#3 = no strip published yet (its fallback).
    await page.evaluate(({ session }) => {
      const strip = (tab) => ({ focusedId: tab.id, ground: null, setGround: () => {}, tabs: [tab] });
      window.registerStrip('chat', strip({ id: 't1', kind: 'local', neumaId: 'metidar', name: 'Metidar', sessionId: session }));
      window.registerStrip('chat#2', strip({ id: 't2', kind: 'local', neumaId: 'keir', name: 'Keir' }));
    }, { session: SESSION });

    // A sweep across the button never opens the list — the pointer must rest.
    const box = await stream.boundingBox();
    await page.mouse.move(box.x - 40, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width + 40, box.y + box.height / 2, { steps: 6 });
    await page.waitForTimeout(HOVER_OPEN_MS + 200);
    await expect(list).toHaveCount(0);

    // A rested pointer opens it: three rows, in click order, the focused one marked.
    await stream.hover();
    await expect(list).toBeVisible();
    const rows = list.getByRole('menuitem');
    await expect(rows).toHaveCount(3);
    await expect(list.locator('.dock-menu-item.is-focused')).toHaveAttribute('data-window-id', 'chat');
    await expect(rows.nth(1)).toHaveText(/KEIR\s*·\s*NEW CHAT/);
    await expect(rows.nth(2)).toHaveText('STREAM 3');
    await page.waitForTimeout(300); // the offline label read settles to {} first
    await page.evaluate(({ session }) => window.announceChatLabels({ [`metidar:${session}`]: 'TikTok test' }), { session: SESSION });
    await expect(rows.nth(0)).toHaveText(/METIDAR\s*·\s*TikTok test/);
    // the list stands above the bar, clear of the button it belongs to
    const listBox = await list.boundingBox();
    expect(listBox.y + listBox.height).toBeLessThan(box.y);
    await page.screenshot({ path: 'test/e2e/shots/dock-stream-instances.png' });

    // A click on the button while it is open steps on, and the mark follows.
    await stream.click();
    expect(await focusedBody()).toBe('chat#2');
    await expect(list.locator('.dock-menu-item.is-focused')).toHaveAttribute('data-window-id', 'chat#2');

    // Crossing the gap to the list keeps it; a row click raises that window and closes the list.
    await rows.nth(2).click();
    expect(await focusedBody()).toBe('chat#3');
    await expect(list).toHaveCount(0);

    // Leaving closes it after the grace.
    await stream.hover();
    await expect(list).toBeVisible();
    await page.mouse.move(800, 300);
    await page.waitForTimeout(HOVER_CLOSE_MS + 200);
    await expect(list).toHaveCount(0);

    // Keyboard: focus opens it at once, the arrow walks in, Enter picks, Escape hands back.
    await page.locator('.taskbar-launcher').focus();
    await page.keyboard.press('Tab');
    await expect(stream).toBeFocused();
    await expect(list).toBeVisible();
    await page.keyboard.press('ArrowUp');
    await expect(list.locator('.dock-menu-item.is-focused')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(0)).toBeFocused(); // wraps from the last row to the first
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(stream).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await page.locator('.taskbar-launcher').focus();
    await page.keyboard.press('Tab');
    await expect(list).toBeVisible();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await focusedBody()).toBe('chat');
    await expect(list).toHaveCount(0);

    // TERMINAL rides the same path: two windows cycle and list by their titles.
    await page.locator('.taskbar-launcher').click();
    await page.locator('.launcher-search').fill('terminal');
    await page.keyboard.press('Enter');
    const term = page.locator('.taskbar-app[data-app-id="terminal"]');
    await term.click({ button: 'right' });
    await page.locator('.taskbar-menu .dock-menu-item', { hasText: /^New TERMINAL$/ }).click();
    expect(await focusedBody()).toBe('terminal#2');
    await page.mouse.move(5, 5);
    await term.click();
    expect(await focusedBody()).toBe('terminal');
    await term.hover();
    await expect(list).toBeVisible();
    await expect(list.getByRole('menuitem')).toHaveText(['TERMINAL // SHELL', 'TERMINAL 2 // SHELL']);

    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
}, 60_000);
