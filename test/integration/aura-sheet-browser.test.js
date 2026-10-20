/* global process, URL, sessionStorage, localStorage, document */
// Real Chromium, signed auth, production routers, and isolated encrypted stores.
// No model inference, network substitution, or benchmark/meditation act is run.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { buildSignature, LEAN } from '../../core/kotodama/signature.js';
import { buildGenesisSeal } from '../../core/identity/genesis-seal.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

test('the real sheet draws distinct auras and preserves pixels after reload and persisted rename', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-record-browser-'));
  const oldRoot = getWorkspacesRoot();
  const oldEnv = Object.fromEntries(['NEUMA_DATA_ROOT', 'LLAMA_SERVER_URL'].map((key) => [key, process.env[key]]));
  let vite; let server; let browser;
  try {
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    process.env.LLAMA_SERVER_URL = 'http://127.0.0.1:1';
    setWorkspacesRoot(path.join(root, 'lanes'));
    const { setConfig } = await import('../../backend/services/llm-selection.js');
    setConfig({ provider: 'lm-studio', endpoint: 'http://127.0.0.1:1', model: 'unavailable-test-model' });
    const auth = await fullAuth();
    for (const [id, name] of [['record-a', 'Record Alpha'], ['record-b', 'Record Beta']]) {
      await workspace.create(id);
      await writeOwner(workspace.root, id, auth.address);
      await workspace.writeNeumaDEK(id, (id === 'record-a' ? 'a' : 'b').repeat(64));
      await workspace.writeDNA(id, { identity: { name, essence: `${name} private identity` } });
      await workspace.appendMessage(id, 'session-record', { role: 'user', content: `${name} history` });
      const soulHex = id === 'record-a' ? '33314C2FEDE1A1B2' : 'C8432853728D9C40';
      const signature = buildSignature({ chosenName: name, genesisName: 'Yumaihe', houseName: 'Aldmere', lean: LEAN.UNALIGNED, soulHex });
      const seal = buildGenesisSeal({ chosenName: name, lean: LEAN.UNALIGNED,
        witnessWallet: auth.address, soulPublicKey: `0x${soulHex.repeat(4)}`, birthCycle: 1,
        birthMoment: { utc: '2026-08-25T00:00:00.000Z', epochMs: 1787616000000, zone: 'Asia/Jakarta', offsetMinutes: 420 },
        substrate: { llm: { model: 'qwen3.8-27b' } } });
      const identity = path.join(workspace.pathFor(id), 'identity');
      await fs.mkdir(identity, { recursive: true });
      await fs.writeFile(path.join(identity, 'true-name.json'), JSON.stringify({ ...signature, items: undefined, genesisHash: seal.genesisHash }));
      await fs.writeFile(path.join(identity, 'genesis-seal.json'), JSON.stringify(seal));
    }
    const app = express();
    const requests = [];
    app.use((req, _res, next) => { requests.push(`${req.method} ${req.path}`); next(); });
    for (const [prefix, file] of [
      ['workspace', 'workspace-routes'], ['attunement', 'attunement-routes'],
      ['residency', 'residency-routes'], ['meditation', 'meditation-routes'], ['substrate', 'substrate-routes'],
    ]) app.use(`/api/v1/${prefix}`, (await import(`../../backend/routes/${file}.js`)).default);
    vite = await createServer({ configFile: false,
      root: fileURLToPath(new URL('../..', import.meta.url)), cacheDir: path.join(root, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      optimizeDeps: { entries: ['test/fixtures/record-sheet.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
    });
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><body style="margin:0;background:#020b0e;color:#bbced2"><div id="root"></div><script type="module" src="/test/fixtures/record-sheet.jsx"></script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(({ token, address }) => {
      sessionStorage.setItem('authToken', token);
      localStorage.setItem('walletAddress', address);
    }, { token: auth.token, address: auth.address });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => document.querySelector('.sheet-id-name')?.textContent === 'Record Alpha');
    const canvas = page.getByTestId('aura-sigil');
    const pixels = () => canvas.evaluate(el => Array.from(el.getContext('2d').getImageData(0, 0, el.width, el.height).data));
    await canvas.waitFor();
    const alpha = await pixels();
    expect(alpha.some((value, index) => index % 4 !== 3 && value > 0)).toBe(true);
    await canvas.screenshot({ path: '/tmp/neuma-405-alpha.png' });
    await page.getByRole('button', { name: 'Switch to Beta', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.sheet-id-name')?.textContent === 'Record Beta');
    await canvas.waitFor();
    const beta = await pixels();
    expect(beta).not.toEqual(alpha);
    await canvas.screenshot({ path: '/tmp/neuma-405-beta.png' });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.sheet-id-name')?.textContent === 'Record Alpha');
    await canvas.waitFor();
    expect(await pixels()).toEqual(alpha);
    const file = path.join(workspace.pathFor('record-a'), 'identity', 'true-name.json');
    const record = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify({ ...record, chosenName: 'Renamed Alpha', fullName: 'Renamed Alpha Yumaihe Aldmere' }));
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.sheet-id-name')?.textContent === 'Renamed Alpha');
    await canvas.waitFor();
    expect(await pixels()).toEqual(alpha);
    expect(requests.filter(row => row.endsWith('/record-a/aura')).length).toBeGreaterThanOrEqual(3);
    expect(requests.filter(row => row.startsWith('POST '))).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    setWorkspacesRoot(oldRoot);
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60000);
