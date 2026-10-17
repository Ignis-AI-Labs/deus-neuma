/**
 * STT transcription integration — REAL Express route, REAL auth
 * (challenge-sign-verify), REAL whisper sidecar (engine-manager launches the
 * actual uv/FastAPI process on the actual weights), REAL speech (espeak-ng
 * renders an utterance to wav at test time). No mock anywhere on the claimed
 * path (RULE 0).
 *
 * Proves: the witness's recorded audio goes in, the spoken words come back.
 */

import express from 'express';
import { shouldRunGpuEngineTests, gpuSkipNote } from '../helpers/gpu-optin.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  generateChallenge, verifySignature, createSessionToken,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import sttRouter from '../../backend/routes/stt-routes.js';
import { launch, stop } from '../../backend/services/voice/engine-manager.js';

const run = promisify(execFile);

const SPOKEN = 'The portal is open and the house is listening.';

// Real session token via the full auth flow.
const makeAuthToken = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return createSessionToken(verifySignature(keypair.address, challenge, signature));
};

if (!shouldRunGpuEngineTests()) console.warn(gpuSkipNote('STT whisper sidecar'));
describe.skipIf(!shouldRunGpuEngineTests())('POST /api/v1/voice/transcribe (real route + real sidecar + real speech)', () => {
  let server, baseUrl, token, fixture;

  beforeAll(async () => {
    // Real speech, synthesized fresh — not a checked-in blob of unknown origin.
    const dir = await createTempDir('stt-fixture');
    fixture = path.join(dir, 'utterance.wav');
    await run('espeak-ng', ['-w', fixture, '-s', '150', SPOKEN]);

    token = await makeAuthToken();
    const app = express();
    app.use('/api/v1/voice', sttRouter);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    baseUrl = `http://localhost:${server.address().port}`;
  }, 30000);

  afterAll(async () => {
    stop('whisper'); // release the sidecar (and its VRAM) we launched
    await new Promise((resolve) => server.close(resolve));
  });

  test('rejects an unauthenticated caller', async () => {
    const res = await fetch(`${baseUrl}/api/v1/voice/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: await fs.readFile(fixture),
    });
    expect(res.status).toBe(401);
  });

  test('rejects an empty audio body', async () => {
    const res = await fetch(`${baseUrl}/api/v1/voice/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/wav' },
    });
    expect(res.status).toBe(400);
  });

  test('a transcribe racing an in-flight warmup waits for it — the composer pattern', async () => {
    // The composer fires a warmup launch at hold-start and the transcribe a
    // couple of seconds later, while the engine is still syncing/loading. The
    // route must wait for THAT launch, not race it and fail.
    const warmup = launch('whisper'); // not awaited — exactly like the warm route
    const res = await fetch(`${baseUrl}/api/v1/voice/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/wav' },
      body: await fs.readFile(fixture),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text.toLowerCase()).toContain('portal is open');
    await warmup; // settle — it must also have succeeded
  }, 240000);

  test('transcribes real speech on a ready engine — the spoken words come back', async () => {
    const res = await fetch(`${baseUrl}/api/v1/voice/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/wav' },
      body: await fs.readFile(fixture),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Whisper may vary punctuation/case; the words themselves must survive.
    expect(body.text.toLowerCase()).toContain('portal is open');
    expect(body.text.toLowerCase()).toContain('house is listening');
    expect(body.language).toBe('en');
    expect(body.durationSeconds).toBeGreaterThan(1);
  }, 240000);

  test('two concurrent transcribes on a cold engine share one launch — both succeed', async () => {
    stop('whisper');
    // Wait for the stopped sidecar to actually release the port — a relaunch
    // into a still-bound port would fail for the wrong reason.
    const gone = Date.now() + 15000;
    while (Date.now() < gone) {
      const alive = await fetch('http://127.0.0.1:7865/health', { signal: AbortSignal.timeout(500) })
        .then(() => true).catch(() => false);
      if (!alive) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    const audio = await fs.readFile(fixture);
    const post = () => fetch(`${baseUrl}/api/v1/voice/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/wav' },
      body: audio,
    });
    const [a, b] = await Promise.all([post(), post()]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const [bodyA, bodyB] = await Promise.all([a.json(), b.json()]);
    expect(bodyA.text.toLowerCase()).toContain('portal is open');
    expect(bodyB.text.toLowerCase()).toContain('portal is open');
  }, 240000);
});
