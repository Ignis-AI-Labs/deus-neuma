/**
 * The live dictation preview rests on one assumption that is easy to get wrong
 * and impossible to notice: while the key is held we transcribe the audio SO
 * FAR, which means handing a PARTIAL MediaRecorder blob to the decoder. If a
 * prefix of a webm/opus stream does not decode, the preview silently never
 * appears and the witness simply sees nothing — the failure mode this whole
 * round of voice work has been full of.
 *
 * Real Chromium, real MediaRecorder, real fake mic fed with REAL speech
 * (espeak-ng at test time, not a checked-in blob), decoded by the real ffmpeg.
 * No mock anywhere on the claimed path (RULE 0).
 *
 * Design note, 2026-08-01: […]
 */

import { test, expect, chromium } from '@playwright/test';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import http from 'http';
import os from 'os';

const run = promisify(execFile);
const SPOKEN = 'This is a long flowing thought that keeps going for a while '
  + 'so that the recorder produces several separate chunks in sequence.';
// The composer's recorder slice (use-push-to-talk.js SLICE_MS).
const SLICE_MS = 250;

let dir; let wav; let server; let origin;

test.beforeAll(async () => {
  // createTempDir() is a vitest helper (it reads a global the vitest setup
  // installs); this lane is Playwright, so it makes its own.
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dictation-live-preview-'));
  wav = path.join(dir, 'speech.wav');
  await run('espeak-ng', ['-w', wav, '-s', '150', SPOKEN]);
  // getUserMedia needs a secure context; http://127.0.0.1 is one.
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><meta charset="utf-8"><title>dictation probe</title>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}/`;
});

test.afterAll(async () => {
  server?.close();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

test.describe('live dictation preview — a partial recording is decodable', () => {
  // The fake-audio file path is only known once the fixture is rendered, so
  // the browser is launched here rather than through test.use's static args.
  test('the audio SO FAR decodes while the key is still held', async () => {
    const browser = await chromium.launch({
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        // %noloop: the file plays once, so the tail is real silence rather
        // than the sentence starting over mid-hold.
        `--use-file-for-fake-audio-capture=${wav}%noloop`,
      ],
    });
    const page = await browser.newPage();
    await page.goto(origin);

    const shot = await page.evaluate(async (sliceMs) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : undefined;
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      const partials = [];
      rec.ondataavailable = (e) => {
        if (!e.data.size) return;
        chunks.push(e.data);
        // Exactly the hook's shape: accumulate from the FIRST chunk, so the
        // blob always carries the container header. A tail slice alone would
        // not decode, and that is the trap this test exists for.
        partials.push(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.start(sliceMs);
      await new Promise((r) => setTimeout(r, sliceMs * 3 + 600));
      const stillRecording = rec.state === 'recording';
      rec.stop();
      await new Promise((r) => setTimeout(r, 200));
      stream.getTracks().forEach((t) => t.stop());
      // The third partial: three slices (~0.75 s) accumulated from the first.
      const early = partials[2];
      const buf = new Uint8Array(await early.arrayBuffer());
      let s = '';
      for (const b of buf) s += String.fromCharCode(b);
      return { stillRecording, count: partials.length, b64: btoa(s) };
    }, SLICE_MS);
    await browser.close();

    // The preview must fire WHILE the hold is live, not only at the end.
    expect(shot.stillRecording).toBe(true);
    expect(shot.count).toBeGreaterThanOrEqual(3);

    // THE CRUX: an early partial decodes on its own.
    const webm = path.join(dir, 'partial.webm');
    const pcm = `${webm}.pcm`;
    await fs.writeFile(webm, Buffer.from(shot.b64, 'base64'));
    await run('ffmpeg', ['-y', '-i', webm, '-f', 's16le', '-ar', '16000', '-ac', '1', pcm]);
    const { size } = await fs.stat(pcm);
    const seconds = size / 2 / 16000;
    expect(seconds).toBeGreaterThan(0.5);
  });
});
