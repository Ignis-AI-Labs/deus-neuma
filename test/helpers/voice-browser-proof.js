/* global window, OfflineAudioContext, AudioContext, btoa, atob */
/** Actual Web Audio rendering and context lifecycle; no hardware/synthesis claim. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { beforeAll, afterAll, test, expect } from 'vitest';

/** Register real Web Audio tests for the frame sink or raw-chunk scheduler. */
export const voiceBrowserProof = (api) => {
let root; let browser; let server; let vite; let page;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-sink-browser-'));
  const app = express();
  app.get('/', (_req, res) => res.type('html').send(`
    <script type="module">
      import { ${api === 'sink' ? 'createVoiceSink' : 'createVoiceScheduler'} as createVoice } from '/frontend/app/RelinkShell/voice-${api}.js';
      window.createVoice = createVoice;
    </script>`));
  vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
    cacheDir: path.join(root, 'vite'), appType: 'custom',
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null }, optimizeDeps: { noDiscovery: true } });
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => Boolean(window.createVoice));
});
afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

// Test signals are actual PCM/WAV input to the production decoder, not a decoder replacement.
const render = (mode) => page.evaluate(async ({ mode, api }) => {
  const rate = 24000;
  const pcm = (marker) => {
    const bytes = new Uint8Array(480);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < 240; i++) view.setInt16(i * 2, marker, true);
    return bytes;
  };
  const frame = (marker) => ({ bytes: btoa(String.fromCharCode(...pcm(marker))),
    format: 'pcm_s16le', sampleRate: rate, channels: 1 });
  const wav = (marker) => {
    const data = pcm(marker);
    const bytes = new Uint8Array(44 + data.length);
    const view = new DataView(bytes.buffer);
    const text = (offset, value) => [...value].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0); });
    text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE');
    text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, data.length, true); bytes.set(data, 44);
    return { bytes: btoa(String.fromCharCode(...bytes)), format: 'audio/wav' };
  };
  const ctx = new OfflineAudioContext(1, 2400, rate);
  const sink = window.createVoice({ createContext: () => ctx });
  const push = (frame) => {
    if (api === 'sink') sink.pushAudio(frame);
    else sink.pushChunk(Uint8Array.from(atob(frame.bytes), (char) => char.charCodeAt(0)), frame);
  };
  if (mode === 'defaults') sink.pushChunk(pcm(8192));
  else if (mode === 'encoded') push(wav(8192));
  else if (mode === 'bad-codec') push({ bytes: btoa('junk'), format: 'audio/ogg' });
  else if (mode === 'muted') sink.setEnabled(false);
  else push(frame(8192));
  if (mode === 'interrupt' || mode === 'dispose') {
    await sink.idle();
    if (mode === 'interrupt') sink.interrupt(); else sink.dispose();
  }
  if (mode === 'gap') {
    await sink.idle();
    const suspended = ctx.suspend(0.04);
    const rendered = ctx.startRendering();
    await suspended;
    const resumedAt = ctx.currentTime;
    push(frame(16384));
    await sink.idle();
    await ctx.resume();
    const result = await rendered;
    return { samples: Array.from(result.getChannelData(0)), resumedAt };
  }
  push(frame(16384));
  await sink.idle();
  const result = await ctx.startRendering();
  return { samples: Array.from(result.getChannelData(0)), supported: sink.isSupported(), enabled: sink.isEnabled() };
}, { mode, api });

const expectSpan = (samples, start, end, value) => {
  expect(samples.slice(start, end).every((sample) => Math.abs(sample - value) < 0.00001)).toBe(true);
};

test('renders raw frames in order without gaps', async () => {
  const { samples, supported, enabled } = await render('raw');
  expect(supported).toBe(true); expect(enabled).toBe(true);
  expectSpan(samples, 0, 240, 0.25); expectSpan(samples, 240, 480, 0.5); expectSpan(samples, 480, 2400, 0);
});
test('real WAV decoding remains ahead of the following raw frame', async () => {
  const { samples } = await render('encoded');
  expectSpan(samples, 0, 240, 0.25); expectSpan(samples, 240, 480, 0.5);
});
test('real codec rejection does not wedge the next frame', async () => {
  const { samples } = await render('bad-codec');
  expectSpan(samples, 0, 240, 0.5); expectSpan(samples, 240, 2400, 0);
});
test('muting drops frames and renders silence', async () => {
  const { samples, enabled } = await render('muted');
  expect(enabled).toBe(false); expectSpan(samples, 0, 2400, 0);
});
test('interrupt stops queued audio and re-baselines the next frame', async () => {
  const { samples } = await render('interrupt');
  expectSpan(samples, 0, 240, 0.5); expectSpan(samples, 240, 2400, 0);
});
test('dispose stops queued audio and refuses subsequent frames', async () => {
  const { samples, enabled } = await render('dispose');
  expect(enabled).toBe(false); expectSpan(samples, 0, 2400, 0);
});
test('a real audio-clock gap starts the next frame at the current rendering time', async () => {
  const { samples, resumedAt } = await render('gap');
  const start = Math.round(resumedAt * 24000);
  expect(start).toBeGreaterThan(240);
  expectSpan(samples, 0, 240, 0.25); expectSpan(samples, 240, start, 0);
  expectSpan(samples, start, start + 240, 0.5); expectSpan(samples, start + 240, 2400, 0);
});
test('resumes and closes an actual AudioContext', async () => {
  const states = await page.evaluate(async () => {
    const ctx = new AudioContext();
    await ctx.suspend();
    const sink = window.createVoice({ createContext: () => ctx });
    const waitFor = (state) => new Promise((resolve) => {
      if (ctx.state === state) return resolve();
      const changed = () => {
        if (ctx.state === state) { ctx.removeEventListener('statechange', changed); resolve(); }
      };
      ctx.addEventListener('statechange', changed);
    });
    sink.resume(); await waitFor('running');
    const running = ctx.state;
    sink.dispose(); await waitFor('closed');
    return [running, ctx.state];
  });
  expect(states).toEqual(['running', 'closed']);
});

if (api === 'scheduler') test('sparse metadata uses mono signed PCM at 24000 Hz', async () => {
  const { samples } = await render('defaults');
  expectSpan(samples, 0, 240, 0.25);
  expectSpan(samples, 240, 480, 0.5);
  expectSpan(samples, 480, 2400, 0);
});
};
