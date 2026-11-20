/* global process, sessionStorage */
// DICTATE IN EVERY APP in Settings, in Chromium against the real route (system-dictation-routes.js)
// on this real machine: off until turned on; the install owner turns it on (LISTENING on the real
// keyboards) and off again; a guest's press is answered with the server's refusal. Each turn-on
// listens for about a second. Skipped off Linux and where the pinned engine files are not on this
// rig. No mocks (RULE 0).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer } from 'vite';
import { chromium, expect as pw } from '@playwright/test';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { STT_MODEL, WHISPER_CPP_BUILD, sttEngineFor } from '../../backend/services/managed-stt-plan.js';

const PINS = `/mnt/data/neuma/stt-pin/${WHISPER_CPP_BUILD}`;
const engine = sttEngineFor('linux', 'x64');
const have = process.platform === 'linux' && process.arch === 'x64'
  && fs.existsSync(path.join(PINS, engine.name)) && fs.existsSync(path.join(PINS, STT_MODEL.name));

describe.skipIf(!have)('DICTATE IN EVERY APP in Settings', () => {
  let dir, vite, server, browser, owner, guest, url, sd, stt;
  beforeAll(async () => {
    dir = await createTempDir('system-dictation-browser');
    process.env.NEUMA_DATA_ROOT = path.join(dir, 'data');
    process.env.NEUMA_STT_ENGINE = 'managed';
    vi.resetModules();
    stt = await import('../../backend/services/managed-stt.js');
    const { installArchive } = await import('../../backend/services/managed-ollama-download.js');
    const f = stt.sttFiles();
    const archive = path.join(dir, engine.name); // installArchive removes what it unpacks: a copy
    fs.copyFileSync(path.join(PINS, engine.name), archive);
    await installArchive(engine, archive, path.dirname(path.dirname(f.bin)));
    fs.mkdirSync(path.dirname(f.modelPath), { recursive: true });
    fs.copyFileSync(path.join(PINS, STT_MODEL.name), f.modelPath);
    const { fullAuth } = await import('../helpers/audit-auth.js');
    owner = await fullAuth();
    guest = await fullAuth();
    await (await import('../../backend/services/install-owner.js')).recordFirstLocalOwner(owner.address);
    sd = await import('../../backend/services/system-dictation/system-dictation.js');
    const { default: router } = await import('../../backend/routes/system-dictation-routes.js');
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(dir, 'cache'), appType: 'custom',
      esbuild: { jsx: 'automatic' }, optimizeDeps: { entries: ['test/fixtures/system-dictation-section.jsx'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
    const app = express();
    app.use('/api/v1/system-dictation', router);
    app.get('/', (_q, res) => res.type('html').send('<!doctype html><body><script type="module" src="/test/fixtures/system-dictation-section.jsx"></script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/`;
    browser = await chromium.launch({ args: ['--disable-gpu'] });
  }, 120_000);
  afterAll(async () => {
    sd?.stopSystemDictation();
    stt?.stopSttServer();
    delete process.env.NEUMA_STT_ENGINE;
    await browser?.close();
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    await vite?.close();
  });
  const open = async (who) => {
    const page = await browser.newPage();
    await page.addInitScript((t) => sessionStorage.setItem('authToken', t), who.token);
    await page.goto(url);
    await page.getByTestId('system-dictation').getByText('Dictation in every app').waitFor({ timeout: 60_000 });
    return page;
  };

  it('off until turned on; the install owner turns it on and it listens, then off', async () => {
    const page = await open(owner);
    const section = page.getByTestId('system-dictation');
    await pw(section).toContainText('Hold RIGHT CTRL, speak, and let go');
    await pw(section.locator('.conn-state')).toHaveText('OFF');
    await pw(section).not.toContainText('THIS COMPUTER STILL NEEDS');
    await section.getByRole('button', { name: 'TURN ON' }).click();
    await pw(section.locator('.conn-state')).toHaveText('LISTENING');
    await pw(section.getByRole('button', { name: 'TURN OFF' })).toHaveAttribute('aria-pressed', 'true');
    await section.getByRole('button', { name: 'TURN OFF' }).click();
    await pw(section.locator('.conn-state')).toHaveText('OFF');
    await page.close();
  }, 60_000);

  it('a guest\'s press is answered with the refusal, and nothing turns on', async () => {
    const page = await open(guest);
    const section = page.getByTestId('system-dictation');
    await section.getByRole('button', { name: 'TURN ON' }).click();
    await pw(section.getByRole('alert')).toBeVisible();
    await pw(section.locator('.conn-state')).toHaveText('OFF');
    await page.close();
  }, 60_000);
});
