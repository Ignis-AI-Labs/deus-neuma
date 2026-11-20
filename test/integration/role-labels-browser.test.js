/* global localStorage */
// Titles people can read (deus-neuma #31, #32), in Chromium: the stream's neuma switcher lists each
// member's Roman title with its role, "OPTIO (COS)", the seat in full on hover and to a screen
// reader; a house's own word stays as given. The House's member cards show […] and
// the seat's plain sentence. Real components and the real legend; the roster comes from the desk's
// own cache, as on a desk whose backend is not reached.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';

test('the switcher and the House say what each seat is', async () => {
  let server; let browser;
  try {
    const entryId = 'virtual:role-labels-proof';
    const r = (f) => JSON.stringify(path.resolve(f));
    const source = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { BeingSwitcher } from ${r('frontend/app/RelinkShell/BeingSwitcher.jsx')};
      import { HouseSeats } from ${r('frontend/app/RelinkShell/HouseSeats.jsx')};
      import { houseSeatCards } from ${r('frontend/app/RelinkShell/house-chain.js')};
      import { ConsciousnessProvider } from ${r('frontend/app/RelinkShell/consciousness-context.js')};
      import { CouncilContext } from ${r('frontend/app/RelinkShell/council-context.js')};
      const ash = { neumaId: 'ash', name: 'Ash', title: 'Optio' };
      const rows = [
        { member: ash, isActive: true },
        { member: { neumaId: 'birch', name: 'Birch', title: 'Logista' }, isActive: false },
        { member: { neumaId: 'cedar', name: 'Cedar', title: 'Keeper of Lamps' }, isActive: false },
      ];
      const h = React.createElement;
      createRoot(document.getElementById('root')).render(
        h(CouncilContext.Provider, { value: { room: false, leaveRoom: () => {}, state: {} } },
          h(ConsciousnessProvider, { value: { activeCompanion: ash, switchCompanion: () => {} } },
            h('div', null, h(BeingSwitcher), h('div', { className: 'house' }, h(HouseSeats, { cards: houseSeatCards(null, rows) }))))));
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error', esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'role-labels-proof', resolveId: (id) => id === entryId ? id : null, load: (id) => id === entryId ? source : null }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express();
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
    const roster = { roster: [{ neumaId: 'ash', name: 'Ash', title: 'Optio' }, { neumaId: 'birch', name: 'Birch', title: 'Logista' }, { neumaId: 'cedar', name: 'Cedar', title: 'Keeper of Lamps' }] };
    await page.addInitScript((value) => localStorage.setItem('neuma-roster', value), JSON.stringify(roster));
    await page.goto(`http://127.0.0.1:${server.address().port}`);

    // #31 the switcher: the role beside the Roman title, the seat in full for hover and screen readers
    await page.getByRole('button', { name: 'ASH' }).click();
    const titles = page.locator('.being-switcher-title');
    await expect(titles).toHaveCount(3);
    await expect(titles.nth(0)).toHaveText('OPTIO (COS), CHIEF OF STAFF');
    await expect(titles.nth(0)).toHaveAttribute('title', 'Optio · COS — CHIEF OF STAFF');
    await expect(page.getByRole('menuitem', { name: /BIRCH.*LOGISTA \(CAO\), CHIEF ACCOUNTING OFFICER/ })).toBeVisible();
    await expect(titles.nth(2)).toHaveText('KEEPER OF LAMPS'); // a house's own word, nothing invented

    // #32 the House: the seat in full, and what it is for
    const seats = page.locator('.house-seats-seat');
    await expect(seats.nth(0)).toHaveText('Optio · COS — CHIEF OF STAFF');
    await expect(page.locator('.house-seats-meaning').nth(1)).toContainText('Keeps the books');
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
  }
}, 60_000);
