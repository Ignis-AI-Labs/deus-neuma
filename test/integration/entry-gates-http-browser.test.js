/* global window */
// The first-run door — its capacity probe and its model bar — driven from a REAL
// Chromium page against the REAL preflight router on a real HTTP socket. The door
// opens after the gateway's sign-in (app-state.js phaseAfterGateway), so the page
// holds a real session token: /preflight and /mind answer only a signed-in caller
// (audit 2026-10-28 M-03); /setup stays open.
// Nothing is mocked: the verdicts are the backend's own, the refusals are its
// own status codes, and a dropped socket is a real dropped socket. (The
// licence gate it once stood beside was removed 2026-10-03: a download opens
// to sign-in.)
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import { fullAuth } from '../helpers/audit-auth.js';

// The real preflight route's dynamic port sweep must stay pinned to a dead
// port — unpinned it GETs /api/tags and /v1/models on EVERY loopback listener
// on the box, including sibling test files' ephemeral servers. Set BEFORE the
// backend modules load (preflight-panel-http-browser.test.js precedent).
const PREVIOUS_DISCOVERY = process.env.NEUMA_DISCOVERY_PORTS;
process.env.NEUMA_DISCOVERY_PORTS = '1';

const { default: preflightRouter } = await import('../../backend/routes/preflight-routes.js');

test('the first-run door reads the real backend for a signed-in caller: capacity, mind and flight agree', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entry-gates-http-'));
  const saved = ['NEUMA_DATA_ROOT']
    .map((key) => [key, process.env[key]]);
  let server; let browser;
  try {
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    await fs.mkdir(path.join(process.env.NEUMA_DATA_ROOT, 'settings'), { recursive: true });

    const entryId = 'virtual:entry-gates-proof';
    const source = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { FirstRunChoice } from ${JSON.stringify(path.resolve('frontend/app/FirstRunChoice/FirstRunChoice.jsx'))};
      import { PreflightCheck } from ${JSON.stringify(path.resolve('frontend/components/BirthCeremony/PreflightCheck.js'))};
      window.expired = 0;
      window.chosen = null;
      window.addEventListener('neuma:auth_expired', () => window.expired++);
      const root = createRoot(document.getElementById('root'));
      window.showDoor = () => root.render(React.createElement(FirstRunChoice, { onChoose: (p) => { window.chosen = p; } }));
      // the flight check torn down while its run still awaits the machine (a step back to the door)
      window.tearDownMidRun = () => { const check = new PreflightCheck(() => {}, () => {}); check.show(); check.hide(); };
      window.hideDoor = () => root.render(null);
      window.ready = true;
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'entry-gates-proof', resolveId: (id) => id === entryId ? id : null,
        load: (id) => id === entryId ? source : null }],
      build: { write: false, rollupOptions: { input: entryId } } });

    const app = express();
    app.use(express.json());
    // A real failure dial in front of the REAL preflight router: an HTTP 500
    // from the stack, or a dropped socket — both genuine wire behaviors.
    let preflightFailure = null;
    app.use('/api/v1/preflight', (req, res, next) => {
      if (preflightFailure === '500') return res.status(500).json({ error: 'probe down' });
      if (preflightFailure === 'drop') return req.socket.destroy();
      next();
    });
    app.use('/api/v1/preflight', preflightRouter);
    for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) =>
      res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
    const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
    app.get('/', (_req, res) => res.send(`<div id="root"></div><script type="module" src="/${entry}"></script>`));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const auth = await fullAuth();
    const page = await browser.newPage();
    // signed in at the gateway, as the real app is before the door opens
    await page.addInitScript((token) => sessionStorage.setItem('authToken', token), auth.token);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready);

    // The first-run probe: the REAL setup status becomes a rendered verdict, behind the model bar's details.
    await page.evaluate(() => window.showDoor());
    const details = page.getByRole('button', { name: 'details' });
    await details.click();
    const capacity = page.locator('.firstrun-capacity');
    await expect(capacity).toBeVisible({ timeout: 20_000 });
    expect(await capacity.getAttribute('class')).toMatch(/is-(ok|cpu|insufficient|unknown)/);
    // ONE TRUTH: the door's "ready" IS the flight check's substrate row, asked of the same backend.
    const base = `http://127.0.0.1:${server.address().port}/api/v1/preflight`;
    expect((await page.request.get(`${base}/mind`)).status(), 'no token, no mind check').toBe(401);
    const signed = { headers: { Authorization: `Bearer ${auth.token}` } };
    const mind = await (await page.request.get(`${base}/mind`, signed)).json();
    const flight = await (await page.request.get(`${base}/`, signed)).json();
    expect(mind.ready).toBe(flight.checks.find((c) => c.id === 'substrate').status === 'pass');
    // No model answers here (the sweep is pinned to a dead port): the model bar says so, first,
    expect(mind.ready).toBe(false);
    await expect(page.getByTestId('door-bar')).toContainText('No model is running on this computer', { timeout: 20_000 });
    // and SUMMON does not enter the ceremony: it is held, and the bar says it starts by itself.
    await page.locator('[data-door="neuma"] .firstrun-path').click();
    await expect(page.getByText('The summoning starts by itself once the model runs.')).toBeVisible();
    await expect(page.getByTestId('door-bar')).toHaveClass(/is-holding/);
    expect(await page.evaluate(() => window.chosen)).toBeNull();
    // the doors that need no local model still open at once
    await page.locator('[data-door="witness"] .firstrun-path').click();
    expect(await page.evaluate(() => window.chosen)).toBe('witness');
    await page.evaluate(() => window.hideDoor());

    // A flight check torn down mid-run stops after its awaits — no step touches the gone panel.
    await page.evaluate(() => window.tearDownMidRun());
    await page.waitForResponse((r) => r.url().endsWith('/api/v1/preflight') || r.url().endsWith('/api/v1/preflight/'), { timeout: 60_000 });
    await page.waitForTimeout(2500);
    expect(errors).toEqual([]);

    // Any probe failure — an HTTP refusal or a dropped connection — resolves to
    // capacityVerdict(null): CAPACITY UNREAD, both doors open, never a throw.
    preflightFailure = '500';
    await page.evaluate(() => window.showDoor());
    await details.click();
    await expect(page.getByText('CAPACITY UNREAD', { exact: true })).toBeVisible();
    await expect(page.getByText('Every door stays open')).toBeVisible();
    // A machine that could not be read still says no model runs, and offers a way on.
    await expect(page.getByTestId('door-bar')).toContainText('No model is running on this computer');
    await page.evaluate(() => window.hideDoor());
    preflightFailure = 'drop';
    await page.evaluate(() => window.showDoor());
    await details.click();
    await expect(page.getByText('CAPACITY UNREAD', { exact: true })).toBeVisible();
    await page.evaluate(() => window.hideDoor());

    // A signed-in door never sounds the auth-rot alarm, and the page ran clean throughout.
    expect(await page.evaluate(() => window.expired)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (PREVIOUS_DISCOVERY === undefined) delete process.env.NEUMA_DISCOVERY_PORTS;
    else process.env.NEUMA_DISCOVERY_PORTS = PREVIOUS_DISCOVERY;
    await fs.rm(root, { recursive: true, force: true });
  }
}, 180_000);
