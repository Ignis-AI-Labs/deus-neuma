/**
 * The whisper sidecar never reaches for the network — the REAL sidecar (uv +
 * FastAPI on the pinned weights, launched through the real engine-manager),
 * REAL speech (espeak-ng → ffmpeg PCM), a REAL WebSocket client. No mock on
 * the claimed path (RULE 0).
 *
 * Why this exists (WP6, 2026-10-01): the live /stream lane used to load its
 * model BY NAME and its VAD through torch.hub at the first connect — both go
 * to the internet, and on this rig Python HTTP to the Hub hangs, so a sitting
 * opened, no speech frame ever came back, and shutdown stuck. The sidecar now
 * loads everything from disk at startup with HF_HUB_OFFLINE forced.
 *
 * Proves, with every proxy pointed at a dead port (so any outbound call
 * fails instead of quietly succeeding):
 *   1. the sidecar becomes ready with ONE model — Nemotron streaming serves
 *      /stream AND /transcribe; large-v3 is never loaded (Design note, 2026-10-09:
 *      […]) — and both
 *      lanes transcribe real speech; WHISPER_TRANSCRIBE=whisper brings
 *      large-v3 back for /transcribe (other languages);
 *   2. a missing pinned file is a plain, fast failure naming the file — the
 *      manager stops waiting instead of a sitting that never answers (the
 *      Nemotron lane, and the base whisper lane it can fall back to).
 *
 * Own ports (7872, 7874): never the registry's 7865, never another file's 7871.
 * CPU only (WHISPER_FORCE_CPU=1) — the suite lane never touches the GPU.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import WebSocket from 'ws';
import { launch, stop } from '../../backend/services/voice/engine-manager.js';
import { shutdownSidecar } from '../../backend/services/voice/engine-process.js';
import { renderSpeechPcm, makeDiskWorkDir } from '../helpers/speech-fixture.js';

const PORT = 7872;
const MISSING_PORT = 7874;
const LIVE_MODEL = 'nemotron-speech-streaming-en-0.6b';
const SPOKEN = 'The portal is open and the house is listening.';
const DEAD = 'http://127.0.0.1:9';
const NETWORK_ENV = {
  HTTP_PROXY: DEAD, HTTPS_PROXY: DEAD, ALL_PROXY: DEAD,
  http_proxy: DEAD, https_proxy: DEAD, all_proxy: DEAD,
  HF_ENDPOINT: DEAD,
  // The test's own loopback traffic (health probes, the socket) stays direct.
  NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
  WHISPER_FORCE_CPU: '1', WHISPER_HOST: '127.0.0.1', WHISPER_PORT: String(PORT),
};

const noiseChunk = () => {
  const b = Buffer.alloc(3200);
  for (let i = 0; i < b.length; i += 2) b.writeInt16LE(Math.floor((Math.random() - 0.5) * 128), i);
  return b;
};

const until = (events, pred, ms) => new Promise((resolve, reject) => {
  const started = Date.now();
  const tick = () => {
    const hit = events.find(pred);
    if (hit) return resolve(hit);
    if (Date.now() - started > ms) return reject(new Error('expected sidecar event never arrived'));
    setTimeout(tick, 25);
  };
  tick();
});

describe('whisper sidecar is offline by construction (real sidecar, dead proxies, CPU-only)', () => {
  const saved = {};
  let workDir, emptyModelDir, pcm;

  beforeAll(async () => {
    for (const key of [...Object.keys(NETWORK_ENV), 'WHISPER_STREAM_MODEL_DIR', 'NEMOTRON_MODEL_DIR', 'WHISPER_STREAM_ENGINE', 'WHISPER_TRANSCRIBE']) saved[key] = process.env[key];
    Object.assign(process.env, NETWORK_ENV);
    workDir = await makeDiskWorkDir('stt-offline');
    emptyModelDir = path.join(workDir, 'no-model');
    await fs.mkdir(emptyModelDir);
    pcm = await renderSpeechPcm(SPOKEN, workDir, 'utterance');
  }, 60_000);

  afterAll(async () => {
    // Whatever happened above, both sidecars this file may have started are gone.
    stop('whisper');
    await shutdownSidecar('127.0.0.1', PORT, 15_000);
    await shutdownSidecar('127.0.0.1', MISSING_PORT, 15_000);
    if (workDir) await fs.rm(workDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, 60_000);

  test('ready with one model from disk, and both lanes transcribe real speech', async () => {
    const status = await launch('whisper', { timeoutMs: 180_000 });
    expect(status.state).toBe('ready');
    const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
    expect(health).toMatchObject({ ok: true, phase: 'ready', model: LIVE_MODEL, streamModel: LIVE_MODEL, device: 'cpu' });

    // /stream: the lane is already built — `ready` arrives at once, not after a load.
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/stream`);
    const events = [];
    ws.on('message', (d) => { try { events.push(JSON.parse(d.toString())); } catch { /* noise */ } });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    try {
      const ready = await until(events, (e) => e.type === 'ready' || e.type === 'error', 5_000);
      expect(ready).toMatchObject({ type: 'ready', model: LIVE_MODEL });
      for (let off = 0; off < pcm.length; off += 3200) {
        ws.send(pcm.subarray(off, off + 3200));
        await new Promise((r) => setTimeout(r, 50));
      }
      for (let i = 0; i < 20; i++) {
        ws.send(noiseChunk());
        await new Promise((r) => setTimeout(r, 50));
      }
      const utterance = await until(events, (e) => e.type === 'utterance', 30_000);
      expect(utterance.text.toLowerCase()).toContain('portal is open');
      expect(events.some((e) => e.type === 'speech_started')).toBe(true);
    } finally {
      ws.close();
    }

    // /transcribe: the same live model reads the whole recording.
    const wav = await fs.readFile(path.join(workDir, 'utterance.wav'));
    const res = await fetch(`http://127.0.0.1:${PORT}/transcribe`, {
      method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav, signal: AbortSignal.timeout(120_000),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).text.toLowerCase()).toContain('portal is open');
  }, 300_000);

  test('WHISPER_TRANSCRIBE=whisper loads large-v3 for /transcribe (other languages)', async () => {
    stop('whisper');
    await shutdownSidecar('127.0.0.1', PORT, 15_000);
    process.env.WHISPER_TRANSCRIBE = 'whisper';
    try {
      const status = await launch('whisper', { timeoutMs: 180_000 });
      expect(status.state).toBe('ready');
      const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
      expect(health).toMatchObject({ ok: true, model: 'large-v3', streamModel: LIVE_MODEL });
      const wav = await fs.readFile(path.join(workDir, 'utterance.wav'));
      const res = await fetch(`http://127.0.0.1:${PORT}/transcribe`, {
        method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav, signal: AbortSignal.timeout(120_000),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).text.toLowerCase()).toContain('portal is open');
    } finally {
      delete process.env.WHISPER_TRANSCRIBE;
    }
  }, 300_000);

  test.each([
    ['the Nemotron lane', { NEMOTRON_MODEL_DIR: 'dir' }, 'whisper live model incomplete', 'model.safetensors'],
    ['the base whisper lane', { WHISPER_STREAM_ENGINE: 'base', WHISPER_STREAM_MODEL_DIR: 'dir' }, 'whisper stream model incomplete', 'model.bin'],
  ])('a missing model file fails fast and names the file — never a hang (%s)', async (_lane, env, message, weights) => {
    stop('whisper');
    await shutdownSidecar('127.0.0.1', PORT, 15_000);
    await shutdownSidecar('127.0.0.1', MISSING_PORT, 15_000);
    process.env.WHISPER_PORT = String(MISSING_PORT);
    for (const key of ['NEMOTRON_MODEL_DIR', 'WHISPER_STREAM_ENGINE', 'WHISPER_STREAM_MODEL_DIR']) delete process.env[key];
    for (const [key, value] of Object.entries(env)) process.env[key] = value === 'dir' ? emptyModelDir : value;
    const started = Date.now();
    const err = await launch('whisper', { timeoutMs: 180_000 }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain(message);
    expect(err.message).toContain(path.join(emptyModelDir, weights));
    expect(Date.now() - started).toBeLessThan(90_000);
  }, 200_000);
});
