/* global window */
// Real React app bodies and browser roster storage; no birth, wallet or team run.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';

test('mounted Teams and Wallet receive roster completion updates without losing inputs', async () => {
  const entryId = 'virtual:reactive-roster-proof';
  const source = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { teamsApp } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/TeamsApp.jsx'))};
    import { walletApp } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/WalletApp.jsx'))};
    import { setRoster } from ${JSON.stringify(path.resolve('frontend/utils/companion-data.js'))};
    import { ConsciousnessProvider } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/consciousness-context.js'))};
    import { WindowContext } from ${JSON.stringify(path.resolve('frontend/app/windowing/WindowManager.jsx'))};
    const original = { neumaId: 'roster-fixture-a', name: 'Roster Fixture A' };
    setRoster([original], []);
    const root = createRoot(document.getElementById('root'));
    // Navigation requires the desk contexts; execution actions are never supplied or invoked.
    const mount = () => root.render(React.createElement(WindowContext.Provider, { value: {} },
      React.createElement(ConsciousnessProvider, { value: {} }, React.createElement(React.Fragment, null,
      React.createElement('section', { id: 'teams' }, React.createElement(teamsApp.Body)),
      React.createElement('section', { id: 'wallet' }, React.createElement(walletApp.Body))))));
    window.addRoster = () => {
      setRoster([original, { neumaId: 'roster-fixture-b', name: 'Roster Fixture B' }], []);
      window.dispatchEvent(new CustomEvent('birth:complete'));
    };
    window.clearView = () => root.render(null);
    window.mount = mount;
    mount();
  `;
  const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    plugins: [{ name: 'roster-proof', resolveId: (id) => id === entryId ? id : null,
      load: (id) => id === entryId ? source : null }],
    build: { write: false, rollupOptions: { input: entryId } } });
  const app = express();
  app.use((_req, res, next) => { res.set('Content-Security-Policy', "connect-src 'self'"); next(); });
  for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) =>
    res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
  const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
  app.get('/', (_req, res) => res.send(`<div id="root"></div><script type="module" src="/${entry}"></script>`));
  const server = http.createServer(app);
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const owner = page.getByRole('combobox', { name: 'Wallet owner' });
    await expect(owner).toBeVisible();
    await owner.selectOption('roster-fixture-a');
    const name = page.locator('#teams input[placeholder^="TEAM NAME"]');
    await name.fill('Keep this team');
    const teams = page.locator('#teams');
    const compose = teams.getByRole('tab', { name: 'FORM A TEAM' });
    const trial = teams.getByRole('tab', { name: 'TRIAL', exact: true });
    await expect(compose).toHaveAttribute('tabindex', '0');
    await compose.focus(); await page.keyboard.press('ArrowRight');
    await expect(trial).toBeFocused();
    await expect(teams.getByRole('tabpanel')).toHaveAccessibleName('TRIAL');
    await expect(teams.locator('.teams-head-cap')).toBeVisible();
    await page.keyboard.press('ArrowRight'); await expect(compose).toBeFocused();
    await expect(teams.getByRole('tabpanel')).toHaveAccessibleName('FORM A TEAM');
    await expect(name).toHaveValue('Keep this team');
    await page.keyboard.press('End'); await expect(trial).toBeFocused();
    await page.keyboard.press('Home'); await expect(compose).toBeFocused();
    await page.keyboard.press('Tab'); await expect(teams.getByRole('tabpanel')).toBeFocused();
    await page.evaluate(() => window.addRoster());
    await expect(owner.locator('option[value="roster-fixture-b"]')).toHaveCount(1);
    await expect(owner).toHaveValue('roster-fixture-a');
    await expect(name).toHaveValue('Keep this team');
    const member = page.getByRole('button', { name: 'Member', exact: true });
    await member.click();
    await expect(page.getByRole('option', { name: 'Roster Fixture B', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(member).toContainText('Roster Fixture A');
    await page.evaluate(() => window.clearView());
    await expect(owner).toHaveCount(0);
    await page.evaluate(() => { window.addRoster(); window.mount(); });
    await expect(page.locator('#wallet select option[value="roster-fixture-b"]')).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
}, 30_000);
