// @ts-check
// THE DREAM JOURNAL, ON A PHONE — the DREAMS pane at Pixel size in real
// Chromium, against the real dream routes and real auth on an isolated temp
// realm (never the desk's). Proves: a dream recorded on the phone lands on the
// desk's disk as a playable recording; a desk that is DOWN when the dream ends
// leaves it on the phone, and it goes when the desk is back; playback; the
// deliberate two-tap delete.
//
// THE MICROPHONE IS NEVER REAL. getUserMedia is answered by a Web Audio stream
// of an espeak-ng voice (the dictation spec's law: --use-file-for-fake-audio-
// capture once fell through to the operator's desk mic), and Chromium runs with
// the fake capture device so even a fall-through is synthetic. Everything from
// the MediaStream on — MediaRecorder, IndexedDB, upload, disk — is the real path.
//
// The words: this stack's desk has no speech engine (HOME is a temp dir, so the
// engine's uv is absent) — the real […] path. The
// words themselves are proven live on the real whisper sidecar, separately.
import { test, expect, devices } from '@playwright/test';
import { ethers } from 'ethers';
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setupSpecimenServer, REPO } from './helpers/vite-specimen.js';

const { defaultBrowserType: _ignored, ...PIXEL } = devices['Pixel 7'];
test.use({
  ...PIXEL,
  channel: 'chromium',
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
  permissions: ['microphone'],
});

let root;
let stack;
let BPORT;
let witness;
const voiceWav = () => path.join(root, 'voice.wav');
const dreamsDir = () => path.join(root, 'realm', witness.addr.toLowerCase(), 'dreams');

const startStack = async (port = 0) => {
  const env = {
    PATH: '/usr/bin:/bin',
    HOME: path.join(root, 'home'),
    NODE_ENV: 'test',
    AUTH_SECRET: 'pocket-dreams-e2e-secret-only',
    NEUMA_DATA_ROOT: path.join(root, 'data'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
    NEUMA_REALM_SETTINGS_PATH: path.join(root, 'realm-settings.json'),
    NEUMA_SUBSTRATE_CLAIM_DIR: process.env.NEUMA_SUBSTRATE_CLAIM_DIR,
    NEUMA_ROOT_LOCK_PATH: process.env.NEUMA_ROOT_LOCK_PATH,
    WHISPER_PORT: '9', // were a launch ever reached, it binds nowhere real
    DREAMS_PORT: String(port),
  };
  stack = spawn(process.execPath, ['test/e2e/helpers/dreams-stack.mjs'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let log = '';
  stack.stdout.on('data', (c) => { log += c; });
  stack.stderr.on('data', (c) => { log += c; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`dream stack did not start: ${log}`)), 30_000);
    stack.once('message', ({ port: p }) => { clearTimeout(timer); resolve(p); });
    stack.once('exit', (code) => { clearTimeout(timer); reject(new Error(`dream stack exited ${code}: ${log}`)); });
  });
};

const stopStack = () => new Promise((resolve) => {
  if (!stack || stack.exitCode !== null) { resolve(); return; }
  const timer = setTimeout(() => stack.kill('SIGKILL'), 5000);
  stack.once('exit', () => { clearTimeout(timer); resolve(); });
  stack.kill('SIGTERM');
});

const mintWitness = async () => {
  const w = ethers.Wallet.createRandom();
  const base = `http://127.0.0.1:${BPORT}`;
  const { challenge } = await (await fetch(`${base}/api/v1/auth/challenge?address=${w.address}`)).json();
  const res = await fetch(`${base}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: w.address, signature: await w.signMessage(challenge), challenge }),
  });
  const { token } = await res.json();
  if (!token) throw new Error('auth/verify returned no token');
  return { token, addr: w.address };
};

// Registered BEFORE the specimen server: vite reads PORT (its /api proxy target) when it spawns.
test.beforeAll(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pocket-dreams-e2e-'));
  await fs.promises.mkdir(path.join(root, 'home'));
  execFileSync('espeak-ng', ['-s', '140', '-w', voiceWav(), 'I was walking through a house made of glass and the stairs went down into the sea']);
  BPORT = await startStack();
  process.env.PORT = String(BPORT);
  witness = await mintWitness();
});
const base = setupSpecimenServer('dreams.html');
test.afterAll(async () => { await stopStack(); });

test.beforeEach(async ({ page }) => {
  await page.route('**/__voice.wav', (route) => route.fulfill({ body: fs.readFileSync(voiceWav()), contentType: 'audio/wav' }));
  await page.addInitScript(({ token, addr }) => {
    sessionStorage.setItem('authToken', token);
    localStorage.setItem('walletAddress', addr);
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const buffer = await ctx.decodeAudioData(await (await fetch('/__voice.wav')).arrayBuffer());
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const out = ctx.createMediaStreamDestination();
      source.connect(out);
      source.start();
      return out.stream;
    };
  }, witness);
});

const record = async (page, ms) => {
  await page.getByRole('button', { name: 'Record a dream' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording the dream' })).toContainText('STOP');
  await page.waitForTimeout(ms);
  await page.getByRole('button', { name: 'Stop recording the dream' }).click();
};

test('a dream recorded on the phone lands on the desk, playable, and says when its words fail', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base()}/dreams.html`);
  await record(page, 3500);

  const item = page.locator('.dream-item').first();
  await expect(item.locator('.dream-meta')).toContainText(/0:0[3-4]/);
  const files = await fs.promises.readdir(dreamsDir());
  const webm = files.find((f) => f.endsWith('.webm'));
  expect(webm).toBeTruthy();
  const bytes = await fs.promises.readFile(path.join(dreamsDir(), webm));
  expect(bytes.subarray(0, 4).toString('hex')).toBe('1a45dfa3'); // a real WebM (EBML) recording
  expect(bytes.length).toBeGreaterThan(5000);

  // No speech engine on this desk: the words fail honestly and offer a retry.
  await expect(item).toContainText('The words did not come through.', { timeout: 20_000 });
  await expect(item.getByRole('button', { name: 'WRITE THE WORDS' })).toBeVisible();
  // Nothing left waiting on the phone.
  expect(await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('neuma-dream-outbox-v1', 1);
    req.onsuccess = () => {
      const all = req.result.transaction('takes').objectStore('takes').getAll();
      all.onsuccess = () => resolve(all.result.length);
    };
  }))).toBe(0);

  await item.getByRole('button', { name: 'PLAY' }).click();
  await expect(item.getByRole('button', { name: 'STOP' })).toBeVisible();
  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/pocket-dreams.png') });
  expect(errors).toEqual([]);
});

test('a dream finished while the desk is down stays on the phone, and goes when the desk is back', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`${base()}/dreams.html`);
  const before = (await fs.promises.readdir(dreamsDir())).filter((f) => f.endsWith('.json')).length;
  await stopStack();
  await record(page, 2500);
  await expect(page.locator('.dream-item[data-waiting="true"]')).toContainText('On this phone');
  await expect(page.locator('.dream-note[role="status"]')).toContainText('Kept on this phone');

  await startStack(BPORT);
  await page.reload(); // a phone that comes back opens the pane again; the outbox sends on open
  await expect.poll(async () => (await fs.promises.readdir(dreamsDir())).filter((f) => f.endsWith('.json')).length,
    { timeout: 20_000 }).toBe(before + 1);
  await expect(page.locator('.dream-item:not([data-waiting])')).toHaveCount(before + 1);
  await expect(page.locator('.dream-item[data-waiting="true"]')).toHaveCount(0);
});

test('delete is deliberate: the first tap asks, the second removes the dream from the desk', async ({ page }) => {
  await page.goto(`${base()}/dreams.html`);
  const kept = async () => (await fs.promises.readdir(dreamsDir()).catch(() => [])).filter((f) => f.endsWith('.json')).length;
  const before = await kept();
  await record(page, 1500); // its own dream: a failed test before this one restarts the worker on a fresh realm
  await expect.poll(kept).toBe(before + 1);
  const count = before + 1;
  const items = page.locator('.dream-item');
  await expect(items).toHaveCount(count); // the new dream is in the list before any tap
  const first = items.first();
  await first.getByRole('button', { name: 'DELETE' }).click();
  await expect(first.getByRole('button', { name: 'DELETE?' })).toBeVisible();
  await first.getByRole('button', { name: 'DELETE?' }).click();
  await expect(items).toHaveCount(count - 1);
  expect((await fs.promises.readdir(dreamsDir())).filter((f) => f.endsWith('.json'))).toHaveLength(count - 1);
});
