// A forge VIDEO plays where the being made it: real Chromium, the PRODUCTION ToolChip and
// AuthImage, the real authenticated lane-scoped /images route, a real mp4 on real disk.
// No provider, mock, spy or fake transport. A <video> that cannot decode its bytes fails
// silently, so the proof is the media element's own metadata (duration, size).
/* global window, document */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer as createVite } from 'vite';
import { chromium } from '@playwright/test';
import { Wallet } from 'ethers';
import { generateChallenge, verifySignature, createSessionToken } from '../../backend/services/auth.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import imageForgeRouter from '../../backend/routes/image-forge-routes.js';
import { collectOutputs } from '../../backend/services/image-forge/image-store.js';
import { claimOwner } from '../helpers/claim-owner.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
// A 1.6 MB, 4.84 s, 1280x704 LTX-2.3 clip with sound and a 2x2 PNG, both checked in as fixtures.
const CLIP = path.join(REPO, 'test', 'fixtures', 'forge', 'ltx-clip.mp4');
const PNG_2X2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z4AATAxIHAgLADS3AR6O5ZFyAAAAAElFTkSuQmCC', 'base64');
const LANE = 'e2e-forge-video';

let tmp; let oldRoot; let vite; let server; let browser; let fixture;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-video-chip-'));
  oldRoot = getWorkspacesRoot();
  const house = path.join(tmp, 'house');
  const out = path.join(tmp, 'engine-out');
  await fs.mkdir(out, { recursive: true });
  setWorkspacesRoot(house);
  const wallet = Wallet.createRandom();
  const challenge = generateChallenge(wallet.address);
  const token = createSessionToken(verifySignature(wallet.address, challenge, await wallet.signMessage(challenge)));
  await claimOwner(house, LANE, wallet.address);
  await fs.copyFile(CLIP, path.join(out, 'job-v_00001_.mp4'));
  await fs.writeFile(path.join(out, 'job-s_00001_.png'), PNG_2X2);
  const store = (jobId, filename) => collectOutputs({ outputDir: out, outputs: { 9: { images: [{ filename, subfolder: '', type: 'output' }] } }, laneId: LANE, jobId })[0];
  const video = store('job-v', 'job-v_00001_.mp4');
  const still = store('job-s', 'job-s_00001_.png');
  fixture = { token, laneId: LANE, video: video.imageId, still: still.imageId, videoMime: video.mime };
  const app = express();
  app.use('/api/v1/image-forge', imageForgeRouter);
  vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(tmp, 'vite-cache'), appType: 'custom',
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/forge-video-chip-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (req, res) => res.type('html').send(
    `<!doctype html><script>window.chipFixture=${JSON.stringify(fixture)}</script><div id="root"></div><script type="module" src="/test/helpers/forge-video-chip-page.jsx"></script>`,
  ));
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
}, 90000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  setWorkspacesRoot(oldRoot);
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}, 30000);

describe('the forge chip shows what the being made', () => {
  it('stores the clip as video/mp4 in the lane', () => {
    expect(fixture.videoMime).toBe('video/mp4');
  });

  it('a clip plays in a real player — its true length and size reach the element; a still stays a picture', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('video.tool-chip-made-img', { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('video.tool-chip-made-img').readyState >= 1, null, { timeout: 30000 });
    const v = await page.evaluate(() => {
      const el = document.querySelector('video.tool-chip-made-img');
      return { duration: el.duration, width: el.videoWidth, height: el.videoHeight, controls: el.controls, src: el.src.slice(0, 5) };
    });
    expect(v).toMatchObject({ width: 1280, height: 704, controls: true, src: 'blob:' });
    expect(v.duration).toBeCloseTo(4.84, 1);
    await page.waitForFunction(() => document.querySelector('img.tool-chip-made-img')?.naturalWidth > 0, null, { timeout: 30000 });
    expect(await page.evaluate(() => document.querySelectorAll('video').length)).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, 90000);
});
