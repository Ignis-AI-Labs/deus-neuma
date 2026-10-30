/**
 * Whisper sidecar /stream — the REAL sidecar (uv/FastAPI process on the real
 * weights, launched through the real engine-manager), REAL speech (espeak-ng
 * rendered at test time, ffmpeg-resampled to 16 kHz s16le PCM), a REAL
 * WebSocket client. CPU-only by construction: WHISPER_FORCE_CPU=1 keeps the
 * dictation model off the GPU and the streaming lane is CPU by design —
 * the suite lane never touches the GPU (rig law). No mock anywhere on the
 * claimed path (RULE 0).
 *
 * Proves (threat-model controls #2 and #3):
 *   1. PCM in → speech_started / partial / utterance out through the real
 *      Silero VAD + the live lane's streaming model (Nemotron since
 *      2026-10-07; the spoken words come back).
 *   2. ONE /stream client at a time — a second concurrent client is rejected.
 *   3. A hostile WHISPER_HOST (non-loopback) is refused at boot, exit 2.
 */

import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { renderSpeechPcm, makeDiskWorkDir } from '../helpers/speech-fixture.js';
import { launch, stop } from '../../backend/services/voice/engine-manager.js';
import { shutdownSidecar } from '../../backend/services/voice/engine-process.js';
import { SIDECAR_CALLER_HEADER, callerToken, sidecarKey } from '../../backend/services/voice/sidecar-trust.js';

const WHISPER_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../voice-engines/whisper',
);
// This file's OWN port — never the registry's 7865, where a live desk's sidecar
// may be serving (engine-manager reads WHISPER_PORT lazily, fork-local env).
const WHISPER_TEST_PORT = 7875;
const STREAM_URL = `ws://127.0.0.1:${WHISPER_TEST_PORT}/stream`;
const SPOKEN = 'The portal is open and the house is listening.';

// 100 ms of 16 kHz s16le mono "room tone" — very low amplitude noise, never
// pure zeros: byte-identical silence frames are replay-deduped upstream and
// the VAD needs real trailing non-speech to endpoint the utterance.
const noiseChunk = () => {
  const b = Buffer.alloc(3200);
  for (let i = 0; i < b.length; i += 2) {
    b.writeInt16LE(Math.floor((Math.random() - 0.5) * 128), i);
  }
  return b;
};

// the backend's own token (sidecar-trust.js): the sidecar the backend launched holds the install key
const openStream = (headers = { [SIDECAR_CALLER_HEADER]: callerToken(sidecarKey()) }) => new Promise((resolve, reject) => {
  const ws = new WebSocket(STREAM_URL, { headers });
  const events = [];
  const closed = { code: null };
  ws.on('message', (d) => { try { events.push(JSON.parse(d.toString())); } catch { /* noise */ } });
  ws.on('close', (code) => { closed.code = code; });
  ws.once('open', () => resolve({ ws, events, closed }));
  ws.once('error', reject);
});

const untilEvent = (events, pred, ms = 60_000) => new Promise((resolve, reject) => {
  const started = Date.now();
  const tick = () => {
    const hit = events.find(pred);
    if (hit) return resolve(hit);
    if (Date.now() - started > ms) return reject(new Error('expected sidecar event never arrived'));
    setTimeout(tick, 25);
  };
  tick();
});

// Real pacing-ish: 100 ms chunks every ~25 ms (4× realtime — inside the
// sidecar's queue bound), then room tone so the VAD finalizes.
const streamUtterance = async (ws, pcm) => {
  for (let off = 0; off < pcm.length; off += 3200) {
    ws.send(pcm.subarray(off, off + 3200));
    await new Promise((r) => setTimeout(r, 25));
  }
  for (let i = 0; i < 20; i++) {
    ws.send(noiseChunk());
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('whisper sidecar /stream (real sidecar, real speech, CPU-only)', () => {
  let pcm, fixtureDir;

  beforeAll(async () => {
    // The suite lane must never touch the GPU — boot the dictation model on
    // CPU int8 (the streaming lane is CPU int8 by construction).
    process.env.WHISPER_FORCE_CPU = '1';
    process.env.WHISPER_HOST = '127.0.0.1';
    process.env.WHISPER_PORT = String(WHISPER_TEST_PORT);

    // Real speech, synthesized fresh — not a checked-in blob of unknown origin.
    // On disk, never /tmp (tmpfs = RAM here); removed in afterAll.
    fixtureDir = await makeDiskWorkDir('stt-stream-fixture');
    pcm = await renderSpeechPcm(SPOKEN, fixtureDir, 'utterance');

    await launch('whisper', { timeoutMs: 300_000 });
  }, 420_000);

  afterAll(async () => {
    // Release the sidecar we launched, even after a failure: SIGTERM, then its own
    // /shutdown until the port is silent.
    stop('whisper');
    await shutdownSidecar('127.0.0.1', WHISPER_TEST_PORT, 15_000);
    if (fixtureDir) await fs.rm(fixtureDir, { recursive: true, force: true });
    delete process.env.WHISPER_FORCE_CPU;
    delete process.env.WHISPER_HOST;
    delete process.env.WHISPER_PORT;
    vi.restoreAllMocks();
  }, 30_000);

  test('PCM in → speech_started, partials, and a VAD-finalized utterance with the spoken words', async () => {
    const { ws, events } = await openStream();
    await untilEvent(events, (e) => e.type === 'ready', 120_000); // first connect builds the streaming model

    await streamUtterance(ws, pcm);

    const utterance = await untilEvent(events, (e) => e.type === 'utterance', 90_000);
    expect(events.some((e) => e.type === 'speech_started')).toBe(true);
    expect(events.some((e) => e.type === 'speech_stopped')).toBe(true);
    expect(events.some((e) => e.type === 'partial')).toBe(true);
    expect(utterance.text.toLowerCase()).toContain('portal is open');
    ws.close();
  }, 240_000);

  // PUSH TO TALK — the key owns the endpoint (Design note, 2026-08-01: […]). Measured before the fix, against this same sidecar: holding
  // the key ≥500 ms past the last word emitted the sentence TWICE — the VAD
  // finalized it, and the release's flush re-emitted the identical text
  // because finish() never clears `commited`. One hold became two turns, and
  // the being answered the same sentence twice, over itself.
  test('hold mode: one hold is ONE utterance, however long the key is held after', async () => {
    // The one decode lane may still be releasing from the previous test —
    // same patience the concurrency test uses.
    let sitting;
    const deadline = Date.now() + 120_000;
    for (;;) {
      sitting = await openStream();
      const got = await untilEvent(sitting.events, (e) => e.type === 'ready', 10_000)
        .then(() => true).catch(() => false);
      if (got) break;
      sitting.ws.close();
      if (Date.now() > deadline) throw new Error('slot never released for the hold-mode client');
      await new Promise((r) => setTimeout(r, 500));
    }
    const { ws, events } = sitting;
    ws.send(JSON.stringify({ type: 'hold_on' }));

    // The witness speaks, then keeps holding for a beat — the ordinary way a
    // person releases a key, and the timing that used to double the turn.
    for (let off = 0; off < pcm.length; off += 3200) {
      ws.send(pcm.subarray(off, off + 3200));
      await new Promise((r) => setTimeout(r, 25));
    }
    for (let i = 0; i < 20; i++) {           // ~2 s of held, speechless key
      ws.send(noiseChunk());
      await new Promise((r) => setTimeout(r, 25));
    }
    ws.send(JSON.stringify({ type: 'flush' }));

    const utterance = await untilEvent(events, (e) => e.type === 'utterance', 90_000);
    expect(utterance.text.toLowerCase()).toContain('portal is open');
    // Give any second utterance every chance to show up before claiming there
    // is none — the duplicate arrived on the release, i.e. right about now.
    await new Promise((r) => setTimeout(r, 3000));
    const utterances = events.filter((e) => e.type === 'utterance');
    expect(utterances).toHaveLength(1);
    ws.send(JSON.stringify({ type: 'hold_off' }));
    ws.close();
  }, 240_000);

  // re-audit 2026-10-29, M-06: the transcription lane answers the backend holding the key, no one else
  test('a socket without the backend\'s token is refused before any audio is taken', async () => {
    const refused = await new Promise((resolve) => {
      const ws = new WebSocket(STREAM_URL);
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.on('close', (code) => resolve(code));
      ws.on('error', () => {});
    });
    expect([403, 1008]).toContain(refused);
  });

  test('a second concurrent /stream client is rejected (one decode lane, ever)', async () => {
    // The slot may still be releasing from the previous sitting — open the
    // first client with patience, THEN prove a concurrent second is refused.
    let first;
    const deadline = Date.now() + 60_000;
    for (;;) {
      first = await openStream();
      const got = await untilEvent(first.events, (e) => e.type === 'ready', 5_000)
        .then(() => true).catch(() => false);
      if (got) break;
      first.ws.close();
      if (Date.now() > deadline) throw new Error('slot never released for the first client');
      await new Promise((r) => setTimeout(r, 500));
    }

    const second = await openStream();
    await expect.poll(() => second.closed.code, { timeout: 10_000 }).toBe(1013);

    first.ws.close();
    // The slot must free for the next sitting — a fresh client gets in.
    await new Promise((r) => setTimeout(r, 500));
    const third = await openStream();
    await untilEvent(third.events, (e) => e.type === 'ready', 30_000);
    third.ws.close();
  }, 180_000);

  test('hostile WHISPER_HOST (non-loopback) is refused at boot — exit 2', async () => {
    const stderr = await new Promise((resolve, reject) => {
      const proc = spawn(
        path.join(WHISPER_DIR, '.venv/bin/python'), ['server.py'],
        { cwd: WHISPER_DIR, env: { ...process.env, WHISPER_HOST: '0.0.0.0', WHISPER_PORT: '7899' } },
      );
      let err = '';
      proc.stderr.on('data', (d) => { err += d.toString(); });
      proc.on('error', reject);
      proc.on('exit', (code) => (code === 2 ? resolve(err) : reject(new Error(`expected exit 2, got ${code}: ${err}`))));
    });
    expect(stderr).toContain('refusing non-loopback bind');
  }, 30_000);
});
