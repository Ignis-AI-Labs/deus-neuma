/* global process, window, sessionStorage */
// A hold on an installed app, end to end and for real: the desk's own stt-client in Chromium, the
// real signed /api/v1/voice/transcribe route on the processor engine (NEUMA_STT_ENGINE=managed), the
// real whisper.cpp server and pinned base model. The engine reads a hold once, on release, as ears
// does: its preview answer is 204 before any work, and the desk sends no preview after it. Skipped
// where the pinned files are not on this rig (/mnt/data/neuma/stt-pin/<build>). No mocks (RULE 0).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { STT_MODEL, WHISPER_CPP_BUILD, sttEngineFor } from '../../backend/services/managed-stt-plan.js';

const PINS = `/mnt/data/neuma/stt-pin/${WHISPER_CPP_BUILD}`;
const engine = sttEngineFor('linux', 'x64');
const have = process.platform === 'linux' && process.arch === 'x64'
  && fs.existsSync(path.join(PINS, engine.name)) && fs.existsSync(path.join(PINS, STT_MODEL.name));
const SPEECH = path.resolve('test/fixtures/speech-16k.wav');

describe.skipIf(!have)('a held key on the processor engine', () => {
  it('previews nothing, then reads the release back into words', async () => {
    const root = await createTempDir('managed-stt-hold');
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    process.env.NEUMA_STT_ENGINE = 'managed';
    const stt = await import('../../backend/services/managed-stt.js');
    const { installArchive } = await import('../../backend/services/managed-ollama-download.js');
    let vite; let server; let browser;
    try {
      const f = stt.sttFiles();
      // installArchive removes the archive it unpacks: it works on a copy, never the rig's pin
      const archive = path.join(root, engine.name);
      fs.copyFileSync(path.join(PINS, engine.name), archive);
      await installArchive(engine, archive, path.dirname(path.dirname(f.bin)));
      fs.mkdirSync(path.dirname(f.modelPath), { recursive: true });
      fs.copyFileSync(path.join(PINS, STT_MODEL.name), f.modelPath);
      expect(await stt.startSttAtBoot()).toBeGreaterThan(0); // the env door makes this checkout an installed app

      const auth = await fullAuth();
      const app = express();
      const asked = [];
      app.use('/api', (req, res, next) => { res.on('finish', () => asked.push(`${req.originalUrl} ${res.statusCode}`)); next(); });
      app.use('/api/v1/voice', (await import('../../backend/routes/stt-routes.js')).default);
      app.get('/speech.wav', (_req, res) => res.type('audio/wav').send(fs.readFileSync(SPEECH)));
      vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
        appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
      app.get('/', (_req, res) => res.type('html').send(
        '<script type="module">import * as stt from "/frontend/app/RelinkShell/stt-client.js"; window.stt = stt;</script>'));
      app.use(vite.middlewares);
      server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      browser = await chromium.launch({ args: ['--disable-gpu'] });
      const page = await browser.newPage();
      await page.addInitScript((token) => sessionStorage.setItem('authToken', token), auth.token);
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.stt, null, { timeout: 30_000 });

      const heard = await page.evaluate(async () => {
        const blob = await (await fetch('/speech.wav')).blob();
        const first = await window.stt.transcribe(blob, { preview: true });
        const second = await window.stt.transcribe(blob, { preview: true });
        const final = await window.stt.transcribe(blob);
        return { first, second, final };
      });
      expect(heard.first).toBeNull();
      expect(heard.second).toBeNull();
      expect(heard.final.toLowerCase()).toMatch(/speaks from the void/);
      expect(asked).toEqual(['/api/v1/voice/transcribe?preview=1 204', '/api/v1/voice/transcribe 200']);
    } finally {
      await browser?.close();
      await vite?.close();
      server?.closeAllConnections();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      stt.stopSttServer();
      delete process.env.NEUMA_STT_ENGINE;
    }
  }, 120_000);
});
