/* global window, sessionStorage, localStorage */
// Actual Dock/WindowManager and WalletService storage teardown/reload.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import { fullAuth } from '../helpers/audit-auth.js';

for (const reducedMotion of ['reduce', 'no-preference']) {
  test(`Dock requires confirmation before native disconnect (${reducedMotion})`, async () => {
    const auth = await fullAuth();
    const entryId = 'virtual:dock-disconnect-proof';
    const source = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { Dock } from ${JSON.stringify(path.resolve('frontend/app/windowing/Dock.jsx'))};
      import { WindowManager } from ${JSON.stringify(path.resolve('frontend/app/windowing/WindowManager.jsx'))};
      import { getWalletService } from ${JSON.stringify(path.resolve('frontend/services/WalletGate.js'))};
      import { setWindowCompanion } from ${JSON.stringify(path.resolve('frontend/utils/companion-data.js'))};
      import ${JSON.stringify(path.resolve('frontend/styles/tokens.css'))};
      import ${JSON.stringify(path.resolve('frontend/i18n/index.js'))}; // the words, as the desk boots them
      const root = createRoot(document.getElementById('root'));
      window.setWindowCompanion = setWindowCompanion;
      window.wallet = getWalletService;
      window.mountDock = () => root.render(React.createElement(WindowManager, { registry: {} }, React.createElement(Dock)));
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'dock-proof', resolveId: (id) => id === entryId ? id : null,
        load: (id) => id === entryId ? source : null }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express();
    app.use((_req, res, next) => { res.set('Content-Security-Policy', "connect-src 'self'"); next(); });
    for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) =>
      res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
    const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
    const styles = bundle.output.filter((file) => file.fileName.endsWith('.css')).map((file) => `<link rel="stylesheet" href="/${file.fileName}">`).join('');
    app.get('/', (_req, res) => res.send(`${styles}<p id="outside">Outside dock</p><div id="root"></div><script type="module" src="/${entry}"></script>`));
    const server = http.createServer(app);
    let browser;
    try {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      browser = await chromium.launch({ args: ['--disable-gpu'] });
      const page = await browser.newPage({ reducedMotion });
      const errors = []; page.on('pageerror', (error) => errors.push(error.message));
      let navigations = 0;
      page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++; });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.mountDock);
      const keys = await page.evaluate(({ token, address }) => {
        sessionStorage.setItem('authToken', token);
        sessionStorage.setItem('llm-apikey', 'non-secret-storage-marker');
        localStorage.setItem('walletAddress', address);
        localStorage.setItem('walletConnected', 'true');
        localStorage.setItem('unrelated-document', 'preserved');
        const arrival = `arrivalSeen:${address.toLowerCase()}`;
        sessionStorage.setItem(arrival, '1');
        window.setWindowCompanion({ neumaId: 'binding-metadata-fixture', name: 'Metadata fixture' });
        const binding = Object.keys(sessionStorage).find((key) => key.includes('neuma-window-companion'));
        window.mountDock();
        return { arrival, binding };
      }, { token: auth.token, address: auth.address });
      expect(keys.binding).toBeTruthy();
      const start = page.getByRole('button', { name: /launcher/i }); // the taskbar's launcher (2026-10-05) — its foot holds disconnect
      const trigger = page.getByRole('menuitem', { name: 'DISCONNECT WALLET', exact: true });
      const group = page.getByRole('group', { name: 'Confirm wallet disconnect' });
      await start.click(); await trigger.click();
      await expect(group.getByRole('menuitem', { name: 'CANCEL' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(group).toHaveCount(0);
      await trigger.click(); await page.keyboard.press('Escape');
      await expect(group).toHaveCount(0);
      await trigger.click(); await page.locator('#outside').click();
      await expect(page.getByRole('menu')).toHaveCount(0);
      await start.click();
      await expect(trigger).toBeVisible();
      await expect(group).toHaveCount(0);
      expect(navigations).toBe(1);
      expect(await page.evaluate(() => ({ token: sessionStorage.getItem('authToken'), address: localStorage.getItem('walletAddress') })))
        .toEqual({ token: auth.token, address: auth.address });
      await trigger.click();
      const reloaded = page.waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame() });
      await group.getByRole('menuitem', { name: 'DISCONNECT', exact: true }).click();
      if (reducedMotion === 'no-preference') {
        await expect(page.getByRole('status', { name: 'The portal rests' })).toBeVisible();
      }
      await reloaded;
      await page.waitForFunction(() => window.mountDock);
      expect(navigations).toBe(2);
      expect(await page.evaluate(({ arrival, binding }) => ({
        token: sessionStorage.getItem('authToken'), key: sessionStorage.getItem('llm-apikey'),
        address: localStorage.getItem('walletAddress'), connected: localStorage.getItem('walletConnected'),
        arrival: sessionStorage.getItem(arrival), binding: sessionStorage.getItem(binding),
        preserved: localStorage.getItem('unrelated-document'), serviceConnected: window.wallet().isConnected(),
      }), keys)).toEqual({ token: null, key: null, address: null, connected: null, arrival: null, binding: null,
        preserved: 'preserved', serviceConnected: false });
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      server.closeAllConnections();
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    }
  }, 30_000);
}
