/* global sessionStorage, document, window */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import { recoveryKit } from '../helpers/summoning-recovery-kit.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getRoots, setRoots } from '../../backend/services/user-files.js';

// Real app bodies, signed portal routes and a temporary repository in focus; no model or birth.
test('desk tabs navigate by keyboard with window-local panels and truthful map filters', async () => {
  const app = express(); const previous = getRealmRoot(); const previousRoots = getRoots();
  let kit; let vite; let browser;
  try {
    kit = await recoveryKit(app);
    setRealmRoot(path.join(kit.root, 'realm'));
    const folder = path.join(kit.root, 'repo'); await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'index.js'), 'export const answer = () => 42;\n');
    // The map follows the folder in focus, which must stand open in the Explorer.
    const focused = await fs.realpath(folder);
    setRoots([...previousRoots, focused]);
    app.use('/api/v1/map', (await import('../../backend/routes/map-routes.js')).default);
    app.use('/api/v1/user/realm', (await import('../../backend/routes/user-realm-routes.js')).default);
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(kit.root, 'vite'),
      appType: 'custom', esbuild: { jsx: 'automatic' }, optimizeDeps: { entries: ['test/fixtures/desk-tabs.jsx'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
    app.get('/', (_req, res) => res.type('html').send('<div id="root"></div><script type="module" src="/test/fixtures/desk-tabs.jsx"></script>'));
    app.use(vite.middlewares);
    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(([token, dir]) => {
      sessionStorage.setItem('authToken', token);
      window.__FOCUS_FOLDER = dir;
    }, [kit.token, focused]);
    await page.goto(kit.url);
    const first = page.locator('#chats-a'); const second = page.locator('#chats-b');
    const ones = first.getByRole('tab', { name: 'ONE-ON-ONES' });
    const councils = first.getByRole('tab', { name: 'COUNCILS' });
    await expect(ones).toHaveAttribute('tabindex', '0');
    await expect(councils).toHaveAttribute('tabindex', '-1');
    await ones.focus(); await page.keyboard.press('ArrowRight');
    await expect(councils).toBeFocused(); await expect(councils).toHaveAttribute('aria-selected', 'true');
    await expect(first.getByRole('tabpanel')).toHaveAccessibleName('COUNCILS');
    await expect(second.getByRole('tab', { name: 'ONE-ON-ONES' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight'); await expect(ones).toBeFocused();
    await page.keyboard.press('ArrowLeft'); await expect(councils).toBeFocused();
    await page.keyboard.press('Home'); await expect(ones).toBeFocused();
    await page.keyboard.press('End'); await expect(councils).toBeFocused();
    await page.keyboard.press('Tab'); await expect(first.getByRole('tabpanel')).toBeFocused();
    const context = page.locator('#context-map');
    await context.getByRole('tab', { name: 'COMPOSITION' }).focus();
    await page.keyboard.press('End');
    await expect(context.getByRole('tab', { name: 'FIELD' })).toBeFocused();
    await expect(context.getByRole('tabpanel')).toHaveAccessibleName('FIELD');
    await page.keyboard.press('Home');
    await expect(context.getByRole('tabpanel')).toHaveAccessibleName('COMPOSITION');
    const relations = await page.locator('[role="tab"]').evaluateAll(tabs => tabs.map(tab => {
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      return Boolean(panel && panel.getAttribute('aria-labelledby') === tab.id);
    }));
    expect(relations.every(Boolean)).toBe(true);
    const ids = await page.locator('[id]').evaluateAll(nodes => nodes.map(node => node.id));
    expect(new Set(ids).size).toBe(ids.length);
    const filters = page.getByRole('navigation', { name: 'Map filters' });
    await expect(filters).toBeVisible();
    await expect(filters.getByRole('tab')).toHaveCount(0);
    const buttons = filters.getByRole('button');
    await expect(filters.locator('[aria-pressed="true"]')).toHaveCount(1);
    await buttons.nth(1).focus(); await page.keyboard.press('Enter');
    await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'false');
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); await vite?.close();
    setRealmRoot(previous); setRoots(previousRoots); await kit?.close();
  }
}, 45_000);
