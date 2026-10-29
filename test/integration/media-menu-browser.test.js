// THE MEDIA MENU, in a real browser (Design note, 2026-10-23: right-click a forge clip and […]).
//
// Real Chromium, the PRODUCTION ToolChip/AuthImage, MediaMenuHost, CtxMenu, gallery body and Files
// tree, over the real authenticated routes (image-forge, gallery, user files) on an ISOLATED stack:
// an ephemeral port, a temp data root, temp workspaces, temp gallery + files settings. A real mp4 and
// a real PNG stored by the real forge store. No provider, mock, spy or fake transport.
/* global document, window, navigator, process, fetch, sessionStorage, Buffer */
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

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const CLIP = path.join(REPO, 'test', 'fixtures', 'forge', 'ltx-clip.mp4');
const PNG_2X2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z4AATAxIHAgLADS3AR6O5ZFyAAAAAElFTkSuQmCC', 'base64');
const LANE = 'e2e-media-menu';
const ENV_KEYS = ['NEUMA_DATA_ROOT', 'NEUMA_GALLERY_ROOTS_PATH', 'NEUMA_FILES_SETTINGS_PATH', 'COMFYUI_DATA_DIR', 'NEUMA_REALM_ROOT', 'NEUMA_REALM_SETTINGS_PATH'];

let tmp; let oldRoot; let oldEnv; let setWorkspacesRoot; let vite; let server; let browser; let fixture; let base;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'media-menu-'));
  oldEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  // Every store this stack touches lives in the temp tree — never the real data root.
  process.env.NEUMA_DATA_ROOT = path.join(tmp, 'data');
  process.env.NEUMA_GALLERY_ROOTS_PATH = path.join(tmp, 'data', 'settings', 'gallery-roots.json');
  process.env.NEUMA_FILES_SETTINGS_PATH = path.join(tmp, 'data', 'settings', 'user-files.json');
  process.env.COMFYUI_DATA_DIR = path.join(tmp, 'comfy');
  process.env.NEUMA_REALM_ROOT = path.join(tmp, 'realm');
  process.env.NEUMA_REALM_SETTINGS_PATH = path.join(tmp, 'data', 'settings', 'user-realm.json');
  await fs.mkdir(path.join(tmp, 'data', 'settings'), { recursive: true });

  const ws = await import('../../core/workspace/neuma-workspace.js');
  setWorkspacesRoot = ws.setWorkspacesRoot;
  oldRoot = ws.getWorkspacesRoot();
  const house = path.join(tmp, 'house');
  setWorkspacesRoot(house);
  const { generateChallenge, verifySignature, createSessionToken } = await import('../../backend/services/auth.js');
  const { claimOwner } = await import('../helpers/claim-owner.js');
  const { collectOutputs } = await import('../../backend/services/image-forge/image-store.js');
  const wallet = Wallet.createRandom();
  const challenge = generateChallenge(wallet.address);
  const token = createSessionToken(verifySignature(wallet.address, challenge, await wallet.signMessage(challenge)));
  await claimOwner(house, LANE, wallet.address);
  // This wallet owns this (temp) install, at its own desk: the explorer reaches the whole machine.
  await fs.writeFile(path.join(tmp, 'data', 'settings', 'install-owner.json'),
    JSON.stringify({ owner: wallet.address.toLowerCase(), coOwners: [], recordedAt: new Date().toISOString(), source: 'test' }));

  const out = path.join(tmp, 'engine-out');
  await fs.mkdir(out, { recursive: true });
  await fs.copyFile(CLIP, path.join(out, 'job-v_00001_.mp4'));
  await fs.writeFile(path.join(out, 'job-s_00001_.png'), PNG_2X2);
  const store = (jobId, filename) => collectOutputs({ outputDir: out, outputs: { 9: { images: [{ filename, subfolder: '', type: 'output' }] } }, laneId: LANE, jobId })[0];
  const v = store('job-v', 'job-v_00001_.mp4');
  const s = store('job-s', 'job-s_00001_.png');
  fixture = {
    token, laneId: LANE, video: v.imageId, still: s.imageId,
    videoPath: path.join(v.dir, v.file), stillPath: path.join(s.dir, s.file),
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1/image-forge', (await import('../../backend/routes/image-forge-routes.js')).default);
  app.use('/api/v1/gallery', (await import('../../backend/routes/gallery-routes.js')).default);
  app.use('/api/v1/user/files', (await import('../../backend/routes/user-files-routes.js')).default);
  app.use('/api/v1/user/projects', (await import('../../backend/routes/user-projects-routes.js')).default);
  vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(tmp, 'vite-cache'), appType: 'custom',
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/media-menu-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (req, res) => res.type('html').send(
    `<!doctype html><script>window.menuFixture=${JSON.stringify(fixture)}</script><div id="root"></div><script type="module" src="/test/helpers/media-menu-page.jsx"></script>`,
  ));
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
}, 120000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  if (setWorkspacesRoot && oldRoot) setWorkspacesRoot(oldRoot);
  for (const [k, v] of Object.entries(oldEnv || {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}, 30000);

// The open menu's row labels, top to bottom.
const menuLabels = (page) => page.evaluate(() => [...document.querySelectorAll('.cmenu .cmenu-item')].map((b) => b.textContent));
const choose = async (page, label) => {
  await page.locator('.cmenu .cmenu-item', { hasText: label }).first().click();
};

const openPage = async () => {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/`);
  await page.waitForSelector('video.tool-chip-made-img', { timeout: 30000 }).catch(async (err) => {
    throw new Error(`the page did not draw the chip (${err.message}); page errors: ${JSON.stringify(errors)}`);
  });
  await page.waitForFunction(() => document.querySelector('video.tool-chip-made-img').readyState >= 1, null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('img.tool-chip-made-img')?.naturalWidth > 0, null, { timeout: 30000 });
  return { context, page, errors };
};

describe('one media menu on every image and clip', () => {
  it('right-clicking a forge clip opens the desk\'s menu (not the browser\'s), with every option it held plus the way to the gallery and the folder', async () => {
    const { context, page, errors } = await openPage();
    await page.evaluate(() => {
      window.lastMenuEvent = null;
      window.addEventListener('contextmenu', (e) => { window.lastMenuEvent = e; }, true);
    });
    await page.click('video.tool-chip-made-img', { button: 'right' });
    await page.waitForSelector('.cmenu');
    // The browser's own menu was refused: the page took the gesture.
    expect(await page.evaluate(() => window.lastMenuEvent.defaultPrevented)).toBe(true);
    const labels = await menuLabels(page);
    const env = await page.evaluate(() => ({ fs: document.fullscreenEnabled, pip: document.pictureInPictureEnabled }));
    expect(labels).toEqual([
      ...(env.fs ? ['View full screen'] : []), ...(env.pip ? ['Picture in picture'] : []),
      'Play', 'Mute', 'Loop', 'Show controls', 'Playback speed: Normal  ›', // the clip has not been started
      'Open in gallery', 'Show in files',
      'Download', 'Copy path',
    ]);
    expect(await page.evaluate(() => [...document.querySelectorAll('.cmenu [role="menuitemcheckbox"]')].map((b) => `${b.textContent}:${b.getAttribute('aria-checked')}`)))
      .toEqual(['Loop:false', 'Show controls:true']);

    // The player's own options act on THIS player.
    await choose(page, 'Playback speed');
    await page.waitForFunction(() => document.querySelector('.cmenu .cmenu-item')?.textContent.includes('‹'));
    expect(await menuLabels(page)).toEqual(['‹  Playback speed', '0.25×', '0.5×', '0.75×', 'Normal', '1.25×', '1.5×', '1.75×', '2×']);
    await choose(page, '2×');
    expect(await page.$('.cmenu')).toBeNull();
    expect(await page.evaluate(() => document.querySelector('video.tool-chip-made-img').playbackRate)).toBe(2);

    await page.click('video.tool-chip-made-img', { button: 'right' });
    expect((await menuLabels(page)).find((l) => l.startsWith('Playback speed'))).toBe('Playback speed: 2×  ›');
    await choose(page, 'Loop');
    await page.click('video.tool-chip-made-img', { button: 'right' });
    await choose(page, 'Mute');
    await page.click('video.tool-chip-made-img', { button: 'right' });
    await choose(page, 'Show controls');
    expect(await page.evaluate(() => {
      const v = document.querySelector('video.tool-chip-made-img');
      return { loop: v.loop, muted: v.muted, controls: v.controls };
    })).toEqual({ loop: true, muted: true, controls: false });

    // Full screen and picture in picture go to THIS player, inside the menu's own click.
    await page.click('video.tool-chip-made-img', { button: 'right' });
    await choose(page, 'View full screen');
    await page.waitForFunction(() => document.fullscreenElement === document.querySelector('video.tool-chip-made-img'));
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.click('video.tool-chip-made-img', { button: 'right' });
    await choose(page, 'Picture in picture');
    await page.waitForFunction(() => document.pictureInPictureElement === document.querySelector('video.tool-chip-made-img'));
    await page.click('video.tool-chip-made-img', { button: 'right' });
    await choose(page, 'Leave picture in picture');
    await page.waitForFunction(() => !document.pictureInPictureElement);

    // Copy path puts the file's real place on disk on the clipboard.
    await page.click('video.tool-chip-made-img', { button: 'right' });
    await choose(page, 'Copy path');
    await page.waitForFunction((p) => navigator.clipboard.readText().then((t) => t === p), fixture.videoPath, { timeout: 5000 });

    // Download hands over the clip's own bytes under its own name.
    await page.click('video.tool-chip-made-img', { button: 'right' });
    const [download] = await Promise.all([page.waitForEvent('download'), choose(page, 'Download')]);
    expect(download.suggestedFilename()).toBe(path.basename(fixture.videoPath));
    const saved = await fs.readFile(await download.path());
    // The stored render's own bytes (the store stamps its disclosure into the file), not the engine's.
    expect(saved.equals(await fs.readFile(fixture.videoPath))).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  }, 120000);

  it('the keyboard menu key opens a still\'s menu; it holds the loupe, the clipboard and the way home', async () => {
    const { context, page, errors } = await openPage();
    await page.focus('img.tool-chip-made-img');
    await page.keyboard.press('Shift+F10');
    await page.waitForSelector('.cmenu');
    const labels = await menuLabels(page);
    const canCopy = await page.evaluate(() => typeof window.ClipboardItem === 'function' && typeof navigator.clipboard?.write === 'function');
    expect(canCopy).toBe(true); // this Chromium's clipboard takes pictures, so the item must be offered
    expect(labels).toEqual(['View full screen', 'Open in gallery', 'Show in files', 'Download', 'Copy image', 'Copy path']);
    // Opened under the picture, not at the window's corner.
    const where = await page.evaluate(() => {
      const m = document.querySelector('.cmenu').getBoundingClientRect();
      const i = document.querySelector('img.tool-chip-made-img').getBoundingClientRect();
      return { menuTop: m.top, imgBottom: i.bottom, menuLeft: m.left, imgLeft: i.left };
    });
    expect(Math.abs(where.menuTop - where.imgBottom)).toBeLessThan(2);
    expect(Math.abs(where.menuLeft - where.imgLeft)).toBeLessThan(2);
    await page.keyboard.press('Escape');
    expect(await page.$('.cmenu')).toBeNull();

    await page.click('img.tool-chip-made-img', { button: 'right' });
    await choose(page, 'Copy image');
    await page.waitForFunction(() => navigator.clipboard.read().then((items) => items.some((it) => it.types.includes('image/png'))), null, { timeout: 5000 });

    await page.click('img.tool-chip-made-img', { button: 'right' });
    await choose(page, 'View full screen');
    await page.waitForSelector('.lightbox[role="dialog"]');
    await page.waitForFunction(() => document.querySelector('.lightbox img')?.naturalWidth === 2);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.lightbox'));
    expect(errors).toEqual([]);
    await context.close();
  }, 120000);

  it('Open in gallery opens the gallery ON the clip, in the being\'s own folder; there its menu offers the folder, never the gallery', async () => {
    const { context, page, errors } = await openPage();
    await page.click('video.tool-chip-made-img', { button: 'right' });
    await choose(page, 'Open in gallery');
    await page.waitForSelector('#gallery-window .gallery-viewer video.gallery-viewer-media', { timeout: 30000 });
    const viewed = await page.evaluate(() => ({
      src: document.querySelector('.gallery-viewer video').getAttribute('src'),
      accession: document.querySelector('.gallery-plaque-accession')?.getAttribute('title'),
      folder: document.querySelector('.gallery-root.is-on .gallery-root-label')?.textContent,
    }));
    expect(path.basename(viewed.accession)).toBe(path.basename(fixture.videoPath));
    expect(viewed.src).toContain(encodeURIComponent(viewed.accession));
    expect(viewed.folder).toBe(LANE); // the being's own folder, not the unfiltered gallery

    await page.click('.gallery-viewer video.gallery-viewer-media', { button: 'right' });
    const inside = await menuLabels(page);
    expect(inside).not.toContain('Open in gallery');
    expect(inside).toContain('Show in files');
    expect(inside).toContain('Download');
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
    await context.close();
  }, 120000);

  it('Show in files opens the Explorer tree down to the still\'s own folder, its file in view', async () => {
    const { context, page, errors } = await openPage();
    const dir = path.dirname(fixture.stillPath);
    await page.click('img.tool-chip-made-img', { button: 'right' });
    await choose(page, 'Show in files');
    await page.waitForSelector(`#explorer .files-row[title="${fixture.stillPath}"]`, { timeout: 30000 });
    expect(await page.$(`#explorer .files-row[title="${dir}"]`)).not.toBeNull();
    // The folder joined the Explorer's open roots through the real route.
    const roots = await page.evaluate(() => fetch('/api/v1/user/files/roots', { headers: { Authorization: `Bearer ${sessionStorage.getItem('authToken')}` } }).then((r) => r.json()));
    expect(roots.roots).toContain(dir);
    expect(errors).toEqual([]);
    await context.close();
  }, 120000);
});
