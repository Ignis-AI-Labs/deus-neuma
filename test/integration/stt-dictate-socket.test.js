/**
 * Hold-to-talk dictation over the live lane (/dictate-ws) — the REAL sidecar
 * (launched through the real engine-manager, Nemotron streaming on CPU), the
 * REAL dictate route behind the REAL upgrade router, a real session token,
 * REAL speech (espeak-ng → 16 kHz PCM). No mock on the claimed path (RULE 0).
 *
 * Proves (Design note, 2026-10-07: […]):
 *   1. no token, no socket (4001);
 *   2. words come back WHILE the key is down, and the final lands fast after
 *      the release — the lane read the hold as it arrived, not after;
 *   3. a hold with nothing said answers an empty final (never a hang);
 *   4. when a voice sitting holds the lane, dictation is refused plainly —
 *      the desk's cue to fall back to /transcribe for that hold.
 *
 * Own port 7873 — never the registry's 7865. CPU only (WHISPER_FORCE_CPU=1).
 */

import { createServer } from 'http';
import fs from 'fs/promises';
import WebSocket, { WebSocketServer } from 'ws';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { generateChallenge, verifySignature, createSessionToken } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setupDictateRoutes } from '../../backend/routes/dictate-routes.js';
import { attachUpgradeRouter } from '../../backend/services/ws-upgrade-router.js';
import { launch, stop } from '../../backend/services/voice/engine-manager.js';
import { shutdownSidecar } from '../../backend/services/voice/engine-process.js';
import { renderSpeechPcm, makeDiskWorkDir } from '../helpers/speech-fixture.js';
import { SIDECAR_CALLER_HEADER, callerToken, sidecarKey } from '../../backend/services/voice/sidecar-trust.js';

const SIDECAR_PORT = 7873;
const SPOKEN = 'The portal is open and the house is listening.';
const FRAME = 3200; // 100 ms of 16 kHz s16le

const makeAuthToken = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return createSessionToken(verifySignature(keypair.address, challenge, signature));
};

const until = (frames, pred, ms) => new Promise((resolve, reject) => {
  const started = Date.now();
  const tick = () => {
    const hit = frames.find(pred);
    if (hit) return resolve(hit);
    if (Date.now() - started > ms) return reject(new Error('expected dictation frame never arrived'));
    setTimeout(tick, 20);
  };
  tick();
});

describe('dictation streams through the live lane (real sidecar, real route)', () => {
  let server, url, token, workDir, pcm;
  const saved = {};

  const openDictation = (withToken = true) => {
    const ws = new WebSocket(`${url}${withToken ? `?token=${encodeURIComponent(token)}` : ''}`);
    const frames = [];
    const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
    ws.on('message', (d) => frames.push({ at: Date.now(), ...JSON.parse(d.toString()) }));
    return { ws, frames, closed, opened: new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); }) };
  };

  beforeAll(async () => {
    for (const key of ['WHISPER_FORCE_CPU', 'WHISPER_HOST', 'WHISPER_PORT']) saved[key] = process.env[key];
    Object.assign(process.env, { WHISPER_FORCE_CPU: '1', WHISPER_HOST: '127.0.0.1', WHISPER_PORT: String(SIDECAR_PORT) });
    workDir = await makeDiskWorkDir('stt-dictate');
    pcm = await renderSpeechPcm(SPOKEN, workDir, 'utterance');
    token = await makeAuthToken();
    await launch('whisper', { timeoutMs: 180_000 });
    server = createServer();
    const dictateWss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
    setupDictateRoutes(dictateWss);
    attachUpgradeRouter(server, {
      wss: new WebSocketServer({ noServer: true }),
      terminalWss: new WebSocketServer({ noServer: true }),
      dictateWss,
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `ws://127.0.0.1:${server.address().port}/dictate-ws`;
  }, 300_000);

  afterAll(async () => {
    server?.close();
    stop('whisper');
    await shutdownSidecar('127.0.0.1', SIDECAR_PORT, 15_000);
    if (workDir) await fs.rm(workDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, 60_000);

  test('no token, no socket', async () => {
    const { closed } = openDictation(false);
    expect(await closed).toBe(4001);
  });

  test('words arrive while the key is down; the final follows the release fast', async () => {
    const { ws, frames, closed, opened } = openDictation();
    await opened;
    await until(frames, (f) => f.type === 'ready', 60_000);
    // A live mic: 100 ms frames at real-time pace.
    for (let off = 0; off < pcm.length; off += FRAME) {
      ws.send(pcm.subarray(off, off + FRAME));
      await new Promise((r) => setTimeout(r, 100));
    }
    const releasedAt = Date.now();
    const heardBeforeRelease = frames.filter((f) => f.type === 'partial' && f.at < releasedAt);
    ws.send(JSON.stringify({ type: 'flush' }));
    const final = await until(frames, (f) => f.type === 'final', 10_000);
    expect(heardBeforeRelease.length).toBeGreaterThan(0);
    expect(final.text.toLowerCase()).toContain('portal is open');
    // Measured ~0.3 s on CPU (docs/work/dictation-flow.md); bounded loosely for a loaded box.
    expect(final.at - releasedAt).toBeLessThan(2500);
    ws.close();
    await closed;
  }, 120_000);

  test('a hold with nothing said answers an empty final — never a hang', async () => {
    const { ws, frames, closed, opened } = openDictation();
    await opened;
    await until(frames, (f) => f.type === 'ready', 60_000);
    ws.send(JSON.stringify({ type: 'flush' }));
    const final = await until(frames, (f) => f.type === 'final', 5_000);
    expect(final.text).toBe('');
    ws.close();
    await closed;
  }, 90_000);

  test('a lane held by a voice sitting refuses dictation plainly (the desk falls back)', async () => {
    // The one decode lane may still be releasing from the previous hold — patience.
    let sitting;
    const deadline = Date.now() + 60_000;
    for (;;) {
      // the sitting is the backend's own socket: it carries the install key's token (sidecar-trust.js)
      sitting = new WebSocket(`ws://127.0.0.1:${SIDECAR_PORT}/stream`, { headers: { [SIDECAR_CALLER_HEADER]: callerToken(sidecarKey()) } });
      const got = await new Promise((resolve) => {
        sitting.on('message', (d) => resolve(JSON.parse(d.toString()).type === 'ready'));
        sitting.on('close', () => resolve(false));
      });
      if (got) break;
      sitting.close();
      if (Date.now() > deadline) throw new Error('the lane never freed for the sitting');
      await new Promise((r) => setTimeout(r, 500));
    }
    try {
      const { frames, closed, opened } = openDictation();
      await opened;
      const code = await closed;
      expect(frames.some((f) => f.type === 'error' && f.code === 'stt_unavailable')).toBe(true);
      expect(code).toBe(1011);
    } finally {
      sitting.close();
    }
  }, 90_000);
});
