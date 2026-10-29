/* global window, document, sessionStorage, localStorage */
// The house calendar in a real browser (docs/work/house-calendar.md): the
// actual HouseCalendar over the real signed task routes on real disk. The
// week holds a row per person — the operator's daily on every day, a being's
// dated task in its own cell, the house's quiet hours on the house row; a
// operator reads by their own name; a click focuses on a person, more clicks
// add people, a click on a focused one releases them, CLEAR shows everyone
// (and the focus survives a reopen); an item opens its detail and its list;
// the keyboard steps and switches; a task added on a person's day lands in
// that person's real store and shows back; the month marks real items only;
// a day opens in time order. No mocks.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

const ENV = ['DNA_ENCRYPTION_KEY', 'NEUMA_REALM_ROOT', 'NEUMA_DATA_ROOT', 'NEUMA_SOCIAL_POST_QUEUE_PATH',
  'NEUMA_MEDITATION_SETTINGS_PATH', 'NEUMA_MEDITATION_STATE_PATH', 'NEUMA_BENCH_HARNESS_PATH', 'NEUMA_TEAM_RUN_PATH'];
const at = (file) => JSON.stringify(path.resolve(file));
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

test('the house calendar: everyone\'s week, hide and show, quick-add onto a person\'s day, the month, the day', async () => {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const root = await createTempDir('house-calendar-ui');
  let server; let browser;
  try {
    process.env.DNA_ENCRYPTION_KEY = 'house-calendar-ui-key';
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(root, 'queue.json');
    process.env.NEUMA_MEDITATION_SETTINGS_PATH = path.join(root, 'meditation.json');
    process.env.NEUMA_MEDITATION_STATE_PATH = path.join(root, 'meditation-state.json');
    process.env.NEUMA_BENCH_HARNESS_PATH = path.join(root, 'no-harness');
    process.env.NEUMA_TEAM_RUN_PATH = path.join(root, 'team-runs');
    const realmRoot = path.join(root, 'realm');
    process.env.NEUMA_REALM_ROOT = realmRoot;
    (await import('../../backend/services/user-realm.js')).setRealmRoot(realmRoot);
    const wsMod = await import('../../core/workspace/neuma-workspace.js');
    wsMod.setWorkspacesRoot(path.join(root, 'workspaces'));
    const workspace = wsMod.default;
    (await import('../../core/identity/ai-witness/ai-witness-service.js')).setAIWitnessesRoot(path.join(root, 'ai-witnesses'));
    await workspace.create('cal-being');
    const { witnessFor } = await import('../helpers/witness.js');
    const me = await witnessFor(path.join(root, 'workspaces'), 'cal-being');
    const { claimOwner } = await import('../helpers/claim-owner.js');
    await workspace.create('cal-other');
    await claimOwner(path.join(root, 'workspaces'), 'cal-other', me.address);
    const { default: taskRouter } = await import('../../backend/routes/task-routes.js');
    const { getUserTasks } = await import('../../backend/services/user-tasks.js');

    // what the house has scheduled
    const app = express();
    app.use(express.json());
    app.use('/api/v1/tasks', taskRouter);
    const seed = (url, body) => fetch(`http://127.0.0.1:${server.address().port}${url}`, { method: 'POST', headers: { ...me.header, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    const entryId = 'virtual:house-calendar-proof';
    const source = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import ${at('frontend/styles/tokens.css')};
      import ${at('frontend/styles/main.css')};
      import ${at('frontend/i18n/index.js')};
      import { HouseCalendar } from ${at('frontend/app/RelinkShell/house-calendar/HouseCalendar.jsx')};
      const root = createRoot(document.getElementById('root'));
      window.mount = () => root.render(React.createElement(HouseCalendar, { onOpenList: (id) => { window.__opened = id; } }));
      window.unmount = () => root.render(null);
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error', esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'house-calendar-proof', resolveId: (id) => (id === entryId ? id : null), load: (id) => (id === entryId ? source : null) }],
      build: { write: false, rollupOptions: { input: entryId } } });
    for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) => res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
    const entry = bundle.output.find((f) => f.type === 'chunk' && f.isEntry).fileName;
    const styles = bundle.output.filter((f) => f.fileName.endsWith('.css')).map((f) => `<link rel="stylesheet" href="/${f.fileName}">`).join('');
    app.get('/', (_req, res) => res.send(`<!doctype html><html><head>${styles}</head><body style="background:#000;margin:0;padding:16px"><div id="root" style="width:1380px"></div><script type="module" src="/${entry}"></script></body></html>`));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    await seed('/api/v1/tasks/mine', { title: 'Stretch qcal', cadence: 'daily', dueTime: '07:00' });
    await workspace.writeTaskLedger('cal-being', { tasks: [{ id: 'b1', title: 'Write the brief qcal', status: 'open', dueDate: dayKey(tomorrow), dueTime: '14:00', createdAt: today.toISOString(), updatedAt: today.toISOString() }] });
    await workspace.writeTaskLedger('cal-other', { tasks: [{ id: 'o1', title: 'Other lane qcal', status: 'open', dueDate: dayKey(tomorrow), createdAt: today.toISOString(), updatedAt: today.toISOString() }] });
    const wallet = path.join(realmRoot, me.address.toLowerCase());
    await fs.mkdir(wallet, { recursive: true });
    await fs.writeFile(path.join(wallet, 'house-charter.json'), JSON.stringify({ version: 1, approvedVersion: 1, approvedAt: today.toISOString(), quietHours: { start: '23:00', end: '06:00' }, seats: [{ laneId: 'cal-being', dailyCap: 3 }] }));

    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.mount);
    await page.evaluate(({ token, address }) => {
      sessionStorage.setItem('authToken', token);
      localStorage.setItem('walletAddress', address);
      localStorage.setItem(`${address.toLowerCase()}:witness-name`, 'Juniper');
      localStorage.removeItem('neuma.houseCalendar.focus');
      window.mount();
    }, { token: me.token, address: me.address });

    // THE WEEK: a row per person
    const grid = page.getByRole('grid', { name: "The house's week" });
    await grid.waitFor();
    const rows = grid.locator('.hcal-who-name');
    // only people with something this week take a row; the quiet fold beneath
    await expect(rows).toHaveText(['JUNIPER', 'CAL-BEIN', 'CAL-OTHE', 'HOUSE']);
    await expect(page.getByLabel('Quiet this week')).toContainText('MACHINE');
    // the daily: today and every day after it this week, never a day before it
    const daysLeft = 7 - ((today.getDay() + 6) % 7);
    await expect(grid.locator('.hcal-row.is-operator .hcal-item', { hasText: 'Stretch qcal' })).toHaveCount(daysLeft);
    if (daysLeft > 1) await expect(grid.locator('.hcal-row.is-operator .hcal-item.is-projected', { hasText: 'Stretch qcal' }).first()).toBeVisible();
    const beingRow = grid.locator('.hcal-row', { has: page.locator('.hcal-who-name', { hasText: 'CAL-BEIN' }) });
    await expect(beingRow.locator('.hcal-item', { hasText: 'Write the brief qcal' })).toContainText('14:00');
    await expect(grid.locator('.hcal-row.is-house .hcal-item', { hasText: 'Quiet hours' }).first()).toBeVisible();
    await expect(grid.locator('.hcal-dayhead.is-today')).toHaveCount(1);

    // FOCUS: one person, then two, then release one — kept across a reopen — then clear
    const chip = (name) => page.getByRole('navigation', { name: 'Focus on people' }).getByRole('button', { name: new RegExp(`^${name}`) });
    await chip('CAL-BEIN').click();
    await expect(page.locator('.hcal-who-name')).toHaveText(['CAL-BEIN']);
    await expect(chip('EVERYONE')).toContainText('FOCUS ON 1');
    await expect(chip('CAL-BEIN')).toHaveAttribute('aria-pressed', 'true');
    await chip('JUNIPER').click();
    await expect(page.locator('.hcal-who-name')).toHaveText(['JUNIPER', 'CAL-BEIN']);
    await page.evaluate(() => { window.unmount(); window.mount(); });
    await page.getByRole('grid', { name: "The house's week" }).waitFor();
    await expect(page.locator('.hcal-who-name')).toHaveText(['JUNIPER', 'CAL-BEIN']);
    await chip('CAL-BEIN').click();
    await expect(page.locator('.hcal-who-name')).toHaveText(['JUNIPER']);
    await chip('EVERYONE').click();
    await expect(page.locator('.hcal-who-name')).toHaveText(['JUNIPER', 'CAL-BEIN', 'CAL-OTHE', 'HOUSE']);
    await expect(chip('EVERYONE')).toHaveAttribute('aria-pressed', 'true');
    // a quiet person, focused, gets their row back (to plan their week)
    await page.getByLabel('Quiet this week').getByRole('button', { name: /MACHINE/ }).click();
    await expect(page.locator('.hcal-who-name')).toHaveText(['MACHINE']);
    await chip('EVERYONE').click();

    // AN ITEM opens its detail; a task's detail opens its person's list; Esc closes
    await beingRow.locator('.hcal-item', { hasText: 'Write the brief qcal' }).click();
    const detail = page.getByRole('complementary', { name: 'Scheduled item' });
    await expect(detail).toContainText('TASK · LANE');
    await expect(detail).toContainText('CAL-BEIN');
    await expect(detail).toContainText('14:00');
    await detail.getByRole('button', { name: "OPEN CAL-BEIN'S LIST" }).click();
    expect(await page.evaluate(() => window.__opened)).toBe('cal-being');
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);

    // THE KEYBOARD: M for the month, W back, → the next week
    const label = page.locator('.hcal-range-main');
    const thisWeek = await label.textContent();
    await page.keyboard.press('m');
    await expect(page.getByRole('button', { name: 'MONTH', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('w');
    await page.keyboard.press('ArrowRight');
    await expect(label).not.toHaveText(thisWeek);
    await page.keyboard.press('t');
    await expect(label).toHaveText(thisWeek);

    // QUICK-ADD onto the operator's day, and onto a member's
    const todayLong = today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    await page.getByRole('button', { name: `Add a task for JUNIPER on ${todayLong}` }).click();
    await page.getByRole('textbox', { name: `New task for JUNIPER on ${dayKey(today)}` }).fill('Call the notary qcal');
    await page.getByRole('textbox', { name: 'End or due time (optional)' }).fill('23:30');
    // the form says whether the task wakes anyone: the operator's own list never does
    await expect(page.locator('.hcal-quick-wakes')).toHaveText('ON YOUR OWN LIST — IT WAKES NO ONE');
    await page.getByRole('button', { name: 'ADD', exact: true }).click();
    await expect(page.locator('.hcal-row.is-operator .hcal-item', { hasText: 'Call the notary qcal' })).toContainText('23:30');
    expect((await getUserTasks(me.address)).tasks.find((t) => t.title === 'Call the notary qcal')).toMatchObject({ dueDate: dayKey(today), dueTime: '23:30', status: 'open' });
    await page.getByRole('button', { name: `Add a task for CAL-BEIN on ${todayLong}` }).click();
    await page.getByRole('textbox', { name: `New task for CAL-BEIN on ${dayKey(today)}` }).fill('Review the draft qcal');
    // a charter seat: no time wakes no one; a time wakes it then
    await expect(page.locator('.hcal-quick-wakes')).toHaveText('NO TIME — IT WAKES NO ONE; GIVE IT A TIME TO WAKE CAL-BEIN');
    // a start with no end is caught before anything is sent; with its end it is a block
    await page.getByRole('textbox', { name: /^Start time/ }).fill('22:00');
    await expect(page.locator('.hcal-quick-wakes')).toHaveText(/^AT 22:00 THIS WAKES CAL-BEIN — A CHARTER SEAT/);
    await page.getByRole('button', { name: 'ADD', exact: true }).click();
    await expect(page.getByText('A BLOCK NEEDS ITS END TIME')).toBeVisible();
    await page.getByRole('textbox', { name: 'End or due time (optional)' }).fill('23:15');
    await page.getByRole('button', { name: 'ADD', exact: true }).click();
    await expect(beingRow.locator('.hcal-item', { hasText: 'Review the draft qcal' })).toContainText('22:00–23:15');
    expect((await workspace.readAssignedPlan('cal-being')).tasks.find((t) => t.title === 'Review the draft qcal')).toMatchObject({ dueDate: dayKey(today), startTime: '22:00', dueTime: '23:15' });
    // the house and the machine take no tasks
    await expect(page.getByRole('button', { name: /Add a task for (HOUSE|MACHINE)/ })).toHaveCount(0);

    // THE MONTH: dots for real items; the projected daily does not flood it
    await page.getByRole('button', { name: 'MONTH', exact: true }).click();
    await expect(page.getByRole('button', { name: 'MONTH', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'WEEK', exact: true })).toHaveAttribute('aria-pressed', 'false');
    const cell = page.locator(`.qcal-cell[aria-label^="${tomorrow.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}"]`);
    await expect(cell.locator('.hcal-mini')).toHaveCount(2); // the being's and the other lane's — no projected daily
    await expect(cell).toContainText('Write the brief qcal');
    await expect(page.getByText(/EXPECTED RUNS .* SHOW IN WEEK AND DAY/)).toBeVisible();
    const probe = await page.evaluate(() => [...document.querySelectorAll('.hcal-view')].map((b) => `${b.textContent}|${b.className}|${getComputedStyle(b).color}|${getComputedStyle(b).backgroundColor}|${document.activeElement === b}|${b.matches(':hover')}`));

    // THE DAY, opened from the month: in time order, whose each item is
    await cell.click();
    const day = page.getByRole('list', { name: 'The day, in time order' });
    await expect(day.locator('.hcal-dayline').first()).toContainText('ALL DAY');
    await expect(day).toContainText('Write the brief qcal');
    await expect(day).toContainText('CAL-BEIN');
    await page.locator('.hcal-standing summary').click();

    await expect(page.locator('.hcal-standing summary')).toContainText('ALWAYS RUNNING');
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120_000);
