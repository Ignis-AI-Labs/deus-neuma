/* global window, sessionStorage */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { test, expect } from 'vitest';
import folderRouter from '../../backend/routes/model-folder-routes.js';
import { fullAuth } from '../helpers/audit-auth.js';

test('folder and skill reads keep real data, cache semantics and expired-auth fallbacks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'library-read-'));
  const keys = ['NEUMA_SKILLS_ROOT', 'NEUMA_MODEL_FOLDERS_PATH', 'NEUMA_MODELS_DIRS', 'LLAMA_SERVER_MODEL'];
  const saved = keys.map(key => process.env[key]); let vite; let server; let browser;
  try {
    process.env.NEUMA_SKILLS_ROOT = path.join(root, 'skills');
    process.env.NEUMA_MODEL_FOLDERS_PATH = path.join(root, 'folders.json');
    process.env.NEUMA_MODELS_DIRS = path.join(root, 'models'); process.env.LLAMA_SERVER_MODEL = '';
    const skillFile = path.join(process.env.NEUMA_SKILLS_ROOT, 'read-proof', 'SKILL.md');
    await fs.mkdir(path.dirname(skillFile), { recursive: true });
    const skillText = '---\nname: read-proof\ndescription: Read-only library integration fixture\n---\nFixture documentation; no executable code.\n';
    await fs.writeFile(skillFile, skillText);
    const { skillService } = await import('../../backend/services/skill-service.js');
    expect(skillService.root).toBe(process.env.NEUMA_SKILLS_ROOT);
    const { default: skillRouter } = await import('../../backend/routes/skill-routes.js');
    const auth = await fullAuth();
    const app = express(); app.use(express.json());
    let skillReads = 0;
    app.use('/api/v1/skills', (req, _res, next) => { if (req.method === 'GET') skillReads++; next(); });
    app.use('/api/v1/llm/model-folders', folderRouter); app.use('/api/v1', skillRouter);
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import {getModelFolders,setModelFoldersClient} from "/frontend/services/inference.js"; import {listSkillsResult,listSkills} from "/frontend/services/skills-client.js"; window.clients={getModelFolders,setModelFoldersClient,listSkillsResult,listSkills}; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
    app.use(vite.middlewares);
    server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.clients);
    const call = (name, ...args) => page.evaluate(({ name, args }) => window.clients[name](...args), { name, args });
    expect(await call('getModelFolders')).toBeNull();
    expect(await call('listSkillsResult')).toEqual({ ok: false, skills: [] });
    expect(skillReads).toBe(0);
    expect(await page.evaluate(() => window.expired)).toBe(0);
    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    expect((await call('getModelFolders')).folders.map(folder => folder.path)).toEqual([process.env.NEUMA_MODELS_DIRS]);
    const chosen = [{ path: path.join(root, 'chosen'), servers: ['llama-server'] }];
    expect((await call('setModelFoldersClient', chosen)).folders).toEqual(chosen);
    expect((await call('getModelFolders')).folders).toEqual(chosen);
    const folderBefore = await fs.readFile(process.env.NEUMA_MODEL_FOLDERS_PATH, 'utf8');
    const library = await call('listSkillsResult');
    expect(library).toMatchObject({ ok: true, skills: [{ name: 'read-proof', description: 'Read-only library integration fixture' }] });
    expect(await call('listSkills')).toEqual(library.skills); expect(skillReads).toBe(1);
    await page.evaluate(() => sessionStorage.setItem('authToken', 'expired-invalid-token'));
    await page.reload(); await page.waitForFunction(() => window.clients);
    expect(await call('getModelFolders')).toBeNull();
    expect(await call('listSkillsResult')).toEqual({ ok: false, skills: [] });
    expect(await page.evaluate(() => window.expired)).toBe(2);
    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    expect(await call('listSkillsResult')).toEqual(library);
    expect(skillReads).toBe(3); // failed reads never poison the successful cache
    expect(await fs.readFile(process.env.NEUMA_MODEL_FOLDERS_PATH, 'utf8')).toBe(folderBefore);
    expect(await fs.readFile(skillFile, 'utf8')).toBe(skillText);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await vite?.close(); keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
