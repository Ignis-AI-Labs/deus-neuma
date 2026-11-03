/* global sessionStorage */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import { fullAuth } from '../helpers/audit-auth.js';

test('skill selection, allocation controls and composer retain keyboard operation with clear semantics', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'desk-accessibility-'));
  const previous = process.env.NEUMA_SKILLS_ROOT; let server; let browser;
  try {
    process.env.NEUMA_SKILLS_ROOT = path.join(root, 'skills');
    for (const name of ['alpha', 'beta']) {
      const dir = path.join(process.env.NEUMA_SKILLS_ROOT, name); await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} navigation proof\n---\n# ${name}\nRead-only fixture, never executed.\n`);
    }
    const auth = await fullAuth();
    const entryId = 'virtual:accessible-controls.jsx';
    const modulePath = file => JSON.stringify(path.resolve(file));
    const source = `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {skillsApp} from ${modulePath('frontend/app/RelinkShell/SkillsApp.jsx')};
      import {SendLayer} from ${modulePath('frontend/app/RelinkShell/WalletAppSend.jsx')};
      import {StreamInput} from ${modulePath('frontend/app/RelinkShell/StreamInput.jsx')};
      import { ConsciousnessProvider } from ${modulePath('frontend/app/RelinkShell/consciousness-context.js')};
      import {ProjectContext} from ${modulePath('frontend/app/RelinkShell/projects/project-context.js')};
      import {WindowManager} from ${modulePath('frontend/app/windowing/WindowManager.jsx')};
      import ${modulePath('frontend/styles/tokens.css')};
      const Page = () => { const [sent,setSent]=useState(''); return <ConsciousnessProvider value={{}}>
        <ProjectContext.Provider value={{projects:[]}}><WindowManager registry={{}}>
          <section id="skills"><skillsApp.Body /></section>
          <section id="allocation"><SendLayer wallet={{balance:'1'}} identities={[]} /></section>
          <section id="composer"><StreamInput connected onSend={setSent} /><output>{sent}</output></section>
        </WindowManager></ProjectContext.Provider></ConsciousnessProvider>; };
      createRoot(document.getElementById('root')).render(<Page />);`;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
      esbuild: { jsx: 'automatic', loader: 'jsx' },
      plugins: [{ name: 'accessible-controls', resolveId: id => id === entryId ? id : null,
        load: id => id === entryId ? source : null }], build: { write: false, rollupOptions: { input: entryId } } });
    const app = express();
    app.use('/api/v1', (await import('../../backend/routes/skill-routes.js')).default);
    for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) =>
      res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
    const entry = bundle.output.find(file => file.type === 'chunk' && file.isEntry).fileName;
    const styles = bundle.output.filter(file => file.fileName.endsWith('.css')).map(file => `<link rel="stylesheet" href="/${file.fileName}">`).join('');
    app.get('/', (_req, res) => res.type('html').send(`${styles}<div id="root"></div><script type="module" src="/${entry}"></script>`));
    server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(token => sessionStorage.setItem('authToken', token), auth.token);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const graph = page.getByRole('group', { name: 'skill tree', exact: true });
    await expect(graph.getByRole('button')).toHaveCount(2);
    await graph.getByRole('button', { name: 'alpha — not yet summoned', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.craft-detail')).toContainText('alpha navigation proof');
    await graph.getByRole('button', { name: 'beta — not yet summoned', exact: true }).focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.craft-detail')).toContainText('beta navigation proof');
    const presets = page.getByRole('group', { name: 'Balance allocation presets' });
    const slider = page.getByRole('slider', { name: 'Balance allocation slider' });
    await presets.getByRole('button', { name: '50%', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(slider).toHaveValue('500');
    await slider.focus(); await page.keyboard.press('ArrowRight'); await expect(slider).toHaveValue('501');
    const composer = page.locator('#composer');
    const sandboxOff = composer.getByRole('button', { name: 'SANDBOX OFF', exact: true });
    await expect(sandboxOff).toHaveAttribute('aria-pressed', 'false');
    await sandboxOff.focus(); await page.keyboard.press('Enter');
    const sandboxOn = composer.getByRole('button', { name: 'SANDBOX ON', exact: true });
    await expect(sandboxOn).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('neuma.sandbox.enabled'))).toBe('1');
    await sandboxOn.focus(); await page.keyboard.press('Enter');
    await expect(composer.getByRole('button', { name: 'SANDBOX OFF', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => localStorage.getItem('neuma.sandbox.enabled'))).toBe('0');
    const send = composer.getByRole('button', { name: 'Send thought', exact: true });
    await expect(send.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    await composer.locator('textarea').fill('Keyboard composer proof');
    await send.focus(); await page.keyboard.press('Enter');
    await expect(composer.locator('output')).toHaveText('Keyboard composer proof');
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.NEUMA_SKILLS_ROOT; else process.env.NEUMA_SKILLS_ROOT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
