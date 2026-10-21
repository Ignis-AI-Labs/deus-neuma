/* global window, document, sessionStorage, localStorage */
// The house calendar fits its window (docs/work/house-calendar.md): mounted
// the way the TASKS window mounts it — the CALENDAR register inside a
// bounded window body — at a small laptop, a desk monitor, a full HD screen
// and a narrow window. At every size: the month is seven equal columns that
// never push past the window however long a day's words run, the calendar
// stays inside the window, the subscribe link sits under the rail and never
// over it, and a taller window shows more of each day. The real register
// over the real signed task routes on real disk; no mocks.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { test, expect } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

const ENV = ['DNA_ENCRYPTION_KEY', 'NEUMA_REALM_ROOT', 'NEUMA_DATA_ROOT', 'NEUMA_SOCIAL_POST_QUEUE_PATH',
  'NEUMA_MEDITATION_SETTINGS_PATH', 'NEUMA_MEDITATION_STATE_PATH', 'NEUMA_BENCH_HARNESS_PATH', 'NEUMA_TEAM_RUN_PATH'];
const at = (file) => JSON.stringify(path.resolve(file));
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const LONG = 'Why do aggregators route to the deepest pools? Because the depth is there, and every page runs its safety checks first';
const SIZES = [[1100, 700], [1540, 880], [1900, 1060], [720, 820]];
const SHOTS = process.env.HCAL_SHOTS || null; // a folder to keep each size's picture in, for a human look

test('the house calendar fits its window at every size: seven equal columns, nothing over the rail, more of a day in a taller window', async () => {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const root = await createTempDir('house-calendar-fit');
  let server; let browser;
  try {
    process.env.DNA_ENCRYPTION_KEY = 'house-calendar-fit-key';
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
    await workspace.create('fit-being');
    const { witnessFor } = await import('../helpers/witness.js');
    const me = await witnessFor(path.join(root, 'workspaces'), 'fit-being');
    const { default: taskRouter } = await import('../../backend/routes/task-routes.js');

    // a busy month: one day with eight long entries, a few days with one or two
    const today = new Date();
    const stamp = today.toISOString();
    const busy = dayKey(today);
    const tasks = Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, title: `${LONG} (${i + 1})`, status: 'open', dueDate: busy, dueTime: `${pad(9 + i)}:00`, createdAt: stamp, updatedAt: stamp }));
    for (const shift of [1, 2, 4]) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + shift);
      if (d.getMonth() === today.getMonth()) tasks.push({ id: `d${shift}`, title: `${LONG} — later`, status: 'open', dueDate: dayKey(d), dueTime: '21:00', createdAt: stamp, updatedAt: stamp });
    }
    await workspace.writeTaskLedger('fit-being', { tasks });

    const app = express();
    app.use(express.json());
    app.use('/api/v1/tasks', taskRouter);
    const entryId = 'virtual:house-calendar-fit';
    const source = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import ${at('frontend/styles/tokens.css')};
      import ${at('frontend/styles/main.css')};
      import ${at('frontend/app/RelinkShell/TodoApp.css')};
      import ${at('frontend/i18n/index.js')};
      import { TodoCalendarRegister } from ${at('frontend/app/RelinkShell/TodoCalendarRegister.jsx')};
      const root = createRoot(document.getElementById('win'));
      window.mount = () => root.render(React.createElement('div', { className: 'todo is-calendar' }, React.createElement(TodoCalendarRegister)));
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error', esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'house-calendar-fit', resolveId: (id) => (id === entryId ? id : null), load: (id) => (id === entryId ? source : null) }],
      build: { write: false, rollupOptions: { input: entryId } } });
    for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) => res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
    const entry = bundle.output.find((f) => f.type === 'chunk' && f.isEntry).fileName;
    const styles = bundle.output.filter((f) => f.fileName.endsWith('.css')).map((f) => `<link rel="stylesheet" href="/${f.fileName}">`).join('');
    // the window body: a bounded flex column, as a desk window gives its app
    app.get('/', (_req, res) => res.send(`<!doctype html><html><head>${styles}</head><body style="background:#000;margin:0"><div id="win" style="display:flex;flex-direction:column;width:1100px;height:700px;overflow:hidden"></div><script type="module" src="/${entry}"></script></body></html>`));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.mount);
    await page.evaluate(({ token, address }) => {
      sessionStorage.setItem('authToken', token);
      localStorage.setItem('walletAddress', address);
      localStorage.removeItem('neuma.houseCalendar.focus');
      window.mount();
    }, { token: me.token, address: me.address });
    await page.getByRole('grid', { name: "The house's week" }).waitFor();
    await page.getByRole('button', { name: 'MONTH', exact: true }).click();
    await page.locator('.qcal-grid').waitFor();

    const shown = {};
    for (const [w, h] of SIZES) {
      await page.evaluate(([width, height]) => { Object.assign(document.getElementById('win').style, { width: `${width}px`, height: `${height}px` }); }, [w, h]);
      await page.waitForTimeout(150); // a frame for the resize to be measured and the month to refit
      const m = await page.evaluate((busyDay) => {
        const box = (sel) => document.querySelector(sel)?.getBoundingClientRect();
        const win = box('#win');
        const todo = document.querySelector('.todo');
        const body = document.querySelector('.hcal-body');
        const heads = [...document.querySelectorAll('.qcal-weekday')].map((e) => e.getBoundingClientRect().width);
        const cell = [...document.querySelectorAll('button.qcal-cell')].find((c) => c.querySelector('.qcal-day')?.textContent === String(Number(busyDay.slice(8))));
        const cellBox = cell.getBoundingClientRect();
        const minis = [...cell.querySelectorAll('.hcal-mini')];
        return {
          win, hcal: box('.hcal'), rail: box('.hcal-rail'), foot: box('.hcal-sidefoot'), grid: box('.qcal-grid'),
          todoSpill: todo.scrollWidth - todo.clientWidth, bodySpill: body.scrollWidth - body.clientWidth,
          heads, minis: minis.length, more: cell.querySelector('.hcal-mini-more')?.textContent || '',
          clipped: minis.filter((e) => e.getBoundingClientRect().bottom > cellBox.bottom + 1).length,
          wide: minis.filter((e) => e.getBoundingClientRect().right > cellBox.right + 1).length,
          rows: document.querySelectorAll('.qcal-cell').length / 7,
        };
      }, busy);
      if (SHOTS) await page.locator('#win').screenshot({ path: path.join(SHOTS, `hcal-month-${w}x${h}.png`) });
      const at = `${w}×${h}`;
      // nothing pushes sideways: not the window, not the month
      expect(m.todoSpill, at).toBeLessThanOrEqual(1);
      expect(m.bodySpill, at).toBeLessThanOrEqual(1);
      expect(m.grid.right, at).toBeLessThanOrEqual(m.win.right + 1);
      // seven equal columns
      expect(m.heads).toHaveLength(7);
      expect(Math.max(...m.heads) - Math.min(...m.heads), at).toBeLessThanOrEqual(1);
      // the calendar keeps inside the window, the link under the rail, never over it
      expect(m.hcal.bottom, at).toBeLessThanOrEqual(m.win.bottom + 1);
      expect(m.foot.top, at).toBeGreaterThanOrEqual(m.rail.bottom - 1);
      expect(m.foot.bottom, at).toBeLessThanOrEqual(m.hcal.bottom + 1);
      // what a day shows, it shows whole; the rest is counted, not lost
      expect(m.clipped, at).toBe(0);
      expect(m.wide, at).toBe(0); // the words end in their day, never past its edge
      expect(m.rows, at).toBe(Math.ceil((((new Date(today.getFullYear(), today.getMonth(), 1).getDay() + 6) % 7) + new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()) / 7));
      expect(m.minis + Number(m.more.replace('+', '') || 0), at).toBe(8);
      shown[at] = m.minis;
    }
    // a taller window shows more of the busy day
    expect(shown['1900×1060']).toBeGreaterThan(shown['1100×700']);

    // the week fits the same window: no sideways spill outside its own scroller
    await page.evaluate(() => { Object.assign(document.getElementById('win').style, { width: '1100px', height: '700px' }); });
    await page.getByRole('button', { name: 'WEEK', exact: true }).click();
    await page.getByRole('grid', { name: "The house's week" }).waitFor();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250); // the view switch's hover and press settle before the picture
    const week = await page.evaluate(() => {
      const todo = document.querySelector('.todo');
      const grid = document.querySelector('.hcal-week');
      return { weekSpill: grid.scrollWidth - grid.clientWidth, todoSpill: todo.scrollWidth - todo.clientWidth, hcal: document.querySelector('.hcal').getBoundingClientRect().bottom, win: document.getElementById('win').getBoundingClientRect().bottom };
    });
    if (SHOTS) await page.locator('#win').screenshot({ path: path.join(SHOTS, 'hcal-week-1100x700.png') });
    expect(week.todoSpill).toBeLessThanOrEqual(1);
    expect(week.weekSpill).toBeLessThanOrEqual(1); // all seven days in view at a small laptop's window
    expect(week.hcal).toBeLessThanOrEqual(week.win + 1);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120_000);
