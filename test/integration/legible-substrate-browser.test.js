// The SUBSTRATE console in real Chromium, drawn from this rig's recorded read
// (test/fixtures/substrate/rig-snapshot.json — scripts/record-substrate-snapshot.mjs,
// read-only: nvidia-smi, `sensors -j`, /sys, /proc; the model server never
// probed). Proves what the owner reads: the health strip leads and matches
// the pure health read, every label meets the 13px floor, sensors carry plain
// names, the floating board input is set apart (never drawn as heat), and the
// window reflows narrow without spilling. Shots: test/e2e/shots/substrate-legible-*.png.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import { machineHealth } from '../../frontend/app/RelinkShell/machine-health.js';
import { NO_SENSE, doubtIn, trackSense } from '../../frontend/app/RelinkShell/machine-sense.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = path.join(REPO, 'test/e2e/shots');
const snapshot = JSON.parse(await fs.readFile(path.join(REPO, 'test/fixtures/substrate/rig-snapshot.json'), 'utf8'));

/** In the page: every element carrying its own visible text, with its computed font size. */
const textSizes = () => [...document.querySelectorAll('.sub-body *')]
  .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && el.getClientRects().length)
  .map((el) => ({ text: el.textContent.trim().slice(0, 40), size: parseFloat(getComputedStyle(el).fontSize) }));

test('SUBSTRATE console: one health read first, legible labels, plain sensor names, the floating input set apart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-substrate-console-'));
  let vite; let server; let browser;
  try {
    const app = express();
    vite = await createServer({
      configFile: false, root: REPO, cacheDir: path.join(root, 'cache'), appType: 'custom', esbuild: { jsx: 'automatic' },
      optimizeDeps: { entries: ['test/fixtures/substrate-console.jsx'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
    });
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><div id="root"></div><script type="module" src="/test/fixtures/substrate-console.jsx"></script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1500, height: 780 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const body = page.locator('.sub-body');
    await body.locator('.hlth-cell').first().waitFor();

    // The strip says exactly what the pure health read says, part by part.
    const sense = snapshot.machine.reduce((m, poll) => trackSense(m, poll.readings), NO_SENSE);
    const machine = snapshot.machine.at(-1);
    const cells = machineHealth(machine, snapshot.telemetry.gpu, (r) => !doubtIn(sense, r));
    await expect.poll(() => body.locator('.hlth-cell').count()).toBe(6);
    for (const [i, c] of cells.entries()) {
      const cell = body.locator('.hlth-cell').nth(i);
      expect(await cell.getAttribute('class')).toContain(`is-${c.level}`);
      expect(await cell.locator('.hlth-part').textContent()).toBe(c.label);
      expect(await cell.locator('.hlth-num').textContent()).toBe(`${c.value ?? '—'}${c.value === null ? '' : c.unit}`);
    }
    // It stands above every panel.
    const stripBottom = (await body.locator('.hlth').boundingBox()).y + (await body.locator('.hlth').boundingBox()).height;
    expect((await body.locator('.sub-panel').first().boundingBox()).y).toBeGreaterThan(stripBottom - 1);

    // The legibility floor: no visible text in the window under 13px.
    const small = (await page.evaluate(textSizes)).filter((t) => t.size < 13);
    expect(small).toEqual([]);

    // Plain names on screen; the chip codes only ever in a hover title.
    const visible = await body.innerText();
    for (const name of ['Motherboard', 'CPU socket', 'Chipset', 'Wi-Fi card', 'Network card', 'Samsung SSD 990 PRO 4TB', 'KINGSTON SFYR2S4T0 ×5', 'nvme3']) expect(visible).toContain(name);
    for (const code of ['SYSTIN', 'CPUTIN', 'AUXTIN', 'PCH_CHIP', 'iwlwifi', 'r8169', 'acpitz', 'nvme-pci']) expect(visible).not.toContain(code);

    // The floating input and the 0° register are named apart, never a bar of heat.
    const board = body.locator('[data-part="board"]');
    const doubted = machine.readings.filter((r) => doubtIn(sense, r));
    expect(doubted.map((r) => r.label).sort()).toEqual(['AUXTIN3', 'PCH_CHIP_CPU_MAX_TEMP']);
    await expect.poll(() => board.locator('.hud-doubt summary').innerText()).toMatch(/input 3/i);
    expect(await board.locator('.hud-bar-name', { hasText: /^Input 3$/ }).count()).toBe(0);
    expect(await board.locator('.hud-input i').allTextContents()).not.toContain('3');
    await board.locator('.hud-doubt summary').click();
    expect(await board.locator('.hud-doubt-list').innerText()).toMatch(/jumped \d+° between reads — input floating/);
    // Every board temperature is on screen once: a named bar, an input cell, or a doubted row.
    const boardTemps = machine.readings.filter((r) => r.type === 'temp' && (r.kind === 'board' || r.kind === 'network'));
    const drawn = await board.locator('.hud-bar').count() + await board.locator('.hud-input').count() + await board.locator('.hud-doubt-list li').count();
    expect(drawn).toBe(boardTemps.length);
    await board.locator('.hud-doubt summary').click();

    await body.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(400);
    await fs.mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'substrate-legible.png') });
    await body.evaluate((el) => { el.scrollTop = 520; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, 'substrate-legible-middle.png') });
    await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, 'substrate-legible-lower.png') });

    // POWER is a door to the rails, which live in the board's panel: a press brings its top into the window.
    await body.evaluate((el) => { el.scrollTop = 0; });
    const boardTop = async () => { const [b, p] = await Promise.all([body.boundingBox(), board.boundingBox()]); return p.y - b.y; };
    expect(await boardTop()).toBeGreaterThan(780);
    await body.locator('.hlth-cell', { hasText: 'POWER' }).click();
    await expect.poll(async () => { const top = await boardTop(); return top >= -1 && top < 390; }).toBe(true);

    // Narrow: the console reflows to one column and nothing spills sideways.
    await page.setViewportSize({ width: 720, height: 900 });
    await body.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(300);
    expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect((await page.evaluate(textSizes)).filter((t) => t.size < 13)).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, 'substrate-legible-narrow.png') });
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 90000);
