/**
 * Live voice sitting through the REAL portal — no mock anywhere on the
 * claimed path (RULE 0): the REAL portal route (setupPortalRoutes) on a real
 * HTTP server, REAL session tokens from the real auth service, a REAL
 * WebSocket client, the REAL stream-session bridge, and the REAL whisper
 * sidecar /stream lane decoding REAL speech (espeak-ng → ffmpeg PCM),
 * CPU-only (WHISPER_FORCE_CPU=1 — the suite lane never touches the GPU).
 *
 * Proves (threat-model controls #1, #6, #7 + the B-03 frame law):
 *   1. voice:mic_open without purpose='conversation' is REFUSED (fail-closed).
 *   2. voice:mic_pcm with no open session is dropped, not an error.
 *   3. Full loop: purpose → mic_open → real PCM → gen-stamped
 *      voice:partial / voice:utterance frames carrying the spoken words.
 *   4. Generation-tagged cancel: after voice:cancel(gen), no stale-gen frame
 *      is emitted — the next utterance rides the new generation. (The second
 *      utterance is a DIFFERENT sentence on purpose: the portal's replay
 *      defence dedupes byte-identical frames, so re-sending the same audio
 *      would prove nothing.)
 *   5. The PCM flood bound holds per connection.
 *   6. Sidecar wedge → honest voice:error with degrade:'text' (NEVER cloud).
 *
 * The sitting lives and dies with its socket (token-expiry law,
 * stream-session.js): proven by construction — closing the client closes
 * the session; there is no mid-sitting re-auth path to test.
 *
 * PARALLEL-SUITE ISOLATION (Wave-3): this file shares the machine with
 * stt-stream-sidecar.test.js in the parallel suite lane, and the sidecar's
 * /stream lane is single-client by law — a shared registry port means a
 * launch race (double spawn → EADDRINUSE), a slot race (1013), and a kill
 * race (one fork's stop()/shutdown reaping the engine out from under the
 * other — the ECONNREFUSED the full-suite run showed). This file therefore
 * runs its OWN sidecar on its OWN port (WHISPER_TEST_PORT below, read
 * lazily through engine-manager's resolveServe seam, fork-local env).
 */

import { describe, test, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createServer } from 'http';
import fs from 'fs/promises';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { renderSpeechPcm, makeDiskWorkDir } from '../helpers/speech-fixture.js';
import { setupPortalRoutes } from '../../backend/routes/portal-routes.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { stop } from '../../backend/services/voice/engine-manager.js';
import { shutdownSidecar } from '../../backend/services/voice/engine-process.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { findAudioArtifacts, findLogLeaks } from '../helpers/voice-retention-sweep.js';

const WALLET = '0x00B0110a0000000000000000000000000000b01a';
// This fork's own sidecar port (parallel-suite isolation — see header).
const WHISPER_TEST_PORT = 7871;
const SPOKEN_A = 'The portal is open and the house is listening.';
const SPOKEN_B = 'The house answers in its own voice.';

// 100 ms of 16 kHz s16le "room tone" — low-amplitude noise, never pure zeros
// (the portal's replay defence dedupes byte-identical frames; real mic
// silence has a noise floor, so the fixture must too).
const noiseChunk = () => {
  const b = Buffer.alloc(3200);
  for (let i = 0; i < b.length; i += 2) {
    b.writeInt16LE(Math.floor((Math.random() - 0.5) * 128), i);
  }
  return b;
};

describe('portal voice frames + stream-session bridge (real portal, real sidecar)', () => {
  let httpServer, wss, port, origRoot, tempRoot, pcmA, pcmB, fixtureDir;
  const clients = [];

  const connectClient = () => new Promise((resolve, reject) => {
    const token = createSessionToken(WALLET);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
    const log = [];
    ws.on('message', (raw) => { try { log.push(JSON.parse(raw.toString())); } catch { /* frame noise */ } });
    ws.on('open', () => { clients.push(ws); resolve({ ws, log }); });
    ws.on('error', reject);
  });

  const until = (log, pred, ms = 30_000, from = 0) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = log.slice(from).find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error('expected frame never arrived'));
      setTimeout(tick, 25);
    };
    tick();
  });

  // mic_open lazy-launches the sidecar (minutes on a cold boot) and the
  // sidecar's single /stream slot may still be releasing from a previous
  // sitting — retry honestly instead of asserting on a race.
  const openMic = async (client) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const mark = client.log.length;
      // A unique messageId per attempt, as the desk's WebSocketService stamps
      // every frame — an identical retry is (rightly) dropped as a replay.
      client.ws.send(JSON.stringify({ type: 'voice:mic_open', messageId: `mic-open-${Date.now()}-${attempt}` }));
      const res = await until(
        client.log,
        (m) => m.type === 'voice:mic_open' || m.type === 'voice:error',
        300_000, mark,
      );
      if (res.type === 'voice:mic_open') return res;
      if (res.code === 'purpose_not_conversation') throw new Error('purpose gate refused a conversation sitting');
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error('voice session never opened');
  };

  // paceMs ~90 = realtime (the production shape — partials flow at the 300 ms
  // decode cadence); faster pacing is legal (the sidecar's finalize covers
  // the tail) but partials are best-effort by design.
  const streamUtterance = async (ws, pcm, paceMs = 90) => {
    for (let off = 0; off < pcm.length; off += 3200) {
      ws.send(JSON.stringify({ type: 'voice:mic_pcm', pcm: pcm.subarray(off, off + 3200).toString('base64') }));
      await new Promise((r) => setTimeout(r, paceMs));
    }
    for (let i = 0; i < 20; i++) {
      ws.send(JSON.stringify({ type: 'voice:mic_pcm', pcm: noiseChunk().toString('base64') }));
      await new Promise((r) => setTimeout(r, paceMs));
    }
  };

  beforeAll(async () => {
    process.env.WHISPER_FORCE_CPU = '1';
    // Parallel-suite isolation: this fork's sidecar binds its own port (read
    // lazily by engine-manager's resolveServe — fork-local env).
    process.env.WHISPER_HOST = '127.0.0.1';
    process.env.WHISPER_PORT = String(WHISPER_TEST_PORT);
    origRoot = getWorkspacesRoot();
    tempRoot = await createTempDir('portal-voice-stream');
    setWorkspacesRoot(tempRoot);

    // Audio fixtures on DISK, never /tmp (tmpfs = RAM on the rig); removed in afterAll.
    fixtureDir = await makeDiskWorkDir('portal-voice-fixture');
    pcmA = await renderSpeechPcm(SPOKEN_A, fixtureDir, 'a');
    pcmB = await renderSpeechPcm(SPOKEN_B, fixtureDir, 'b');

    httpServer = createServer();
    wss = new WebSocketServer({ noServer: true });
    setupPortalRoutes(wss, { birthHandler: null });
    httpServer.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    port = httpServer.address().port;
  }, 60_000);

  afterEach(() => {
    // A failed test must never leak its sitting — the sidecar's single
    // /stream slot is held until the socket dies.
    while (clients.length) {
      try { clients.pop().close(); } catch { /* already gone */ }
    }
  });

  afterAll(async () => {
    // The sidecar this file launched must be gone even after a failure: the
    // manager's SIGTERM, then the sidecar's own /shutdown until the port is silent.
    stop('whisper');
    await shutdownSidecar('127.0.0.1', WHISPER_TEST_PORT, 15_000);
    if (fixtureDir) await fs.rm(fixtureDir, { recursive: true, force: true });
    delete process.env.WHISPER_FORCE_CPU;
    delete process.env.WHISPER_HOST;
    delete process.env.WHISPER_PORT;
    setWorkspacesRoot(origRoot);
    wss?.close();
    httpServer?.close();
    vi.restoreAllMocks();
  }, 30_000);

  test('voice:mic_open without purpose=conversation is refused — fail-closed', async () => {
    const c = await connectClient();
    await until(c.log, (m) => m.type === 'portal:established');
    c.ws.send(JSON.stringify({ type: 'voice:mic_open' }));
    const err = await until(c.log, (m) => m.type === 'voice:error');
    expect(err.code).toBe('purpose_not_conversation');
    expect(err.degrade).toBe('text');
  });

  test('voice:mic_pcm with no open session is dropped — the portal stays well', async () => {
    const c = await connectClient();
    await until(c.log, (m) => m.type === 'portal:established');
    c.ws.send(JSON.stringify({ type: 'voice:mic_pcm', pcm: noiseChunk().toString('base64') }));
    // A frame the portal MUST answer proves the drop was silent and clean.
    c.ws.send(JSON.stringify({ type: 'voice:pref', enabled: true }));
    const ack = await until(c.log, (m) => m.type === 'voice:pref');
    expect(ack.enabled).toBe(true);
    expect(c.log.some((m) => m.type === 'voice:error')).toBe(false);
  });

  test('full loop: conversation purpose → mic_open → real PCM → gen-stamped partials and the utterance', async () => {
    const c = await connectClient();
    await until(c.log, (m) => m.type === 'portal:established');
    c.ws.send(JSON.stringify({ type: 'session:purpose', purpose: 'conversation' }));
    await until(c.log, (m) => m.type === 'session:purpose' && m.purpose === 'conversation');

    const opened = await openMic(c);
    expect(opened.gen).toBe(0);

    // Partials are best-effort by design (they ride the 300 ms decode
    // cadence): under FULL-SUITE CPU load a sitting can finalize on the VAD
    // tail before a partial confirms, so partials are proven across up to
    // three real sittings instead of asserted on one load-sensitive sitting.
    // Each attempt speaks a DIFFERENT sentence — the portal's replay defence
    // dedupes byte-identical frames, so re-speaking the same audio proves
    // nothing.
    let utterance = null;
    let sawPartial = false;
    for (let attempt = 0; attempt < 3 && !(utterance && sawPartial); attempt++) {
      const mark = c.log.length;
      await streamUtterance(c.ws, attempt % 2 === 0 ? pcmA : pcmB);
      utterance = await until(c.log, (m) => m.type === 'voice:utterance', 120_000, mark).catch(() => null);
      sawPartial = c.log.slice(mark).some((m) => m.type === 'voice:partial' && m.gen === 0);
    }
    expect(c.log.some((m) => m.type === 'voice:speech_started' && m.gen === 0)).toBe(true);
    expect(sawPartial).toBe(true);
    expect(utterance).not.toBeNull();
    expect(utterance.gen).toBe(0);
    const said = utterance.text.toLowerCase();
    expect(said.includes('portal is open') || said.includes('house')).toBe(true);
  }, 600_000);
  test('generation-tagged cancel: no stale-gen output after voice:cancel', async () => {
    const c = await connectClient();
    await until(c.log, (m) => m.type === 'portal:established');
    c.ws.send(JSON.stringify({ type: 'session:purpose', purpose: 'conversation' }));
    await until(c.log, (m) => m.type === 'session:purpose' && m.purpose === 'conversation');
    await openMic(c);

    // One full utterance on generation 0, then cancel forward to gen 5.
    await streamUtterance(c.ws, pcmA);
    await until(c.log, (m) => m.type === 'voice:utterance', 120_000);
    const mark = c.log.length;
    c.ws.send(JSON.stringify({ type: 'voice:cancel', gen: 5 }));

    // A second, DIFFERENT utterance (replay defence dedupes identical
    // frames) must ride the NEW generation — nothing stale may cross.
    await streamUtterance(c.ws, pcmB);
    const utterance = await until(c.log, (m) => m.type === 'voice:utterance', 120_000, mark);
    const postCancel = c.log.slice(mark).filter(
      (m) => m.type === 'voice:partial' || m.type === 'voice:utterance' || m.type === 'voice:speech_started',
    );
    expect(postCancel.length).toBeGreaterThan(0);
    expect(postCancel.every((m) => m.gen === 5)).toBe(true);
    expect(utterance.text.toLowerCase()).toContain('house');
  }, 420_000);

  test('PCM flood bound holds per connection — over-bound audio drops with an honest error', async () => {
    const c = await connectClient();
    await until(c.log, (m) => m.type === 'portal:established');
    c.ws.send(JSON.stringify({ type: 'session:purpose', purpose: 'conversation' }));
    await until(c.log, (m) => m.type === 'session:purpose' && m.purpose === 'conversation');
    await openMic(c);

    // 15 × 16 KB in one burst = 240 KB inside the 3 s window (bound: 192 KB).
    // Each frame must be byte-distinct — the portal's replay defence dedupes
    // identical frames before the bridge ever sees them.
    const burst = Buffer.alloc(16384);
    for (let i = 2; i < burst.length; i += 2) burst.writeInt16LE(i % 600 - 300, i);
    for (let i = 0; i < 15; i++) {
      burst.writeInt16LE(i + 1, 0);
      c.ws.send(JSON.stringify({ type: 'voice:mic_pcm', pcm: burst.toString('base64') }));
    }

    const err = await until(c.log, (m) => m.type === 'voice:error' && m.code === 'pcm_flood', 30_000);
    expect(err.degrade).toBe('text');
  }, 300_000);

  test('sidecar wedge mid-sitting → honest voice:error, degrade to text (NEVER cloud)', async () => {
    const c = await connectClient();
    await until(c.log, (m) => m.type === 'portal:established');
    c.ws.send(JSON.stringify({ type: 'session:purpose', purpose: 'conversation' }));
    await until(c.log, (m) => m.type === 'session:purpose' && m.purpose === 'conversation');
    await openMic(c);

    // The real reap path: the sidecar kills itself (its shutdown is honest
    // only once idle — let the sitting settle past its 0.5 s guard first).
    await new Promise((r) => setTimeout(r, 1_000));
    await fetch(`http://127.0.0.1:${WHISPER_TEST_PORT}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(5_000) }).catch(() => {});
    stop('whisper'); // tidy the manager's view whichever way the process went

    const err = await until(c.log, (m) => m.type === 'voice:error' && m.code === 'stt_unavailable', 30_000);
    expect(err.degrade).toBe('text');
    // Leave no DYING sidecar behind: one still answering /health while it exits
    // gets adopted by the next sitting, acks its mic_open, then drops the link —
    // and that test streams into a session that is already gone.
    expect(await shutdownSidecar('127.0.0.1', WHISPER_TEST_PORT, 15_000)).toBe(true);
  }, 300_000);

  test('S-20: STT finalize latency is logged — timings and counts only, never content', async () => {
    const c = await connectClient();
    await until(c.log, (m) => m.type === 'portal:established');
    c.ws.send(JSON.stringify({ type: 'session:purpose', purpose: 'conversation' }));
    await until(c.log, (m) => m.type === 'session:purpose' && m.purpose === 'conversation');
    await openMic(c);

    // The structured logger writes to process.stdout (never console) —
    // capture the REAL backend log output for the sitting's duration.
    const lines = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      await streamUtterance(c.ws, pcmA);
      // The timing line is emitted bridge-side BEFORE the utterance frame is
      // sent, so the frame's arrival proves the line already landed.
      await until(c.log, (m) => m.type === 'voice:utterance', 120_000);
    } finally {
      spy.mockRestore();
    }

    const timing = lines.filter((l) => l.includes('voice turn STT finalize'));
    expect(timing.length).toBeGreaterThan(0);
    const data = JSON.parse(timing[0].match(/\{.*\}/)[0]);
    expect(typeof data.sttFinalizeMs).toBe('number');
    expect(data.sttFinalizeMs).toBeGreaterThanOrEqual(0);
    expect(data.utterances).toBeGreaterThanOrEqual(1);
    // Threat control #5: the timing line carries NO transcript content.
    expect(timing[0].toLowerCase()).not.toContain('portal is open');
  }, 420_000);

  test('audio-retention sweep (control #5): no PCM on disk, no audio or transcript in the logs', async () => {
    const c = await connectClient();
    await until(c.log, (m) => m.type === 'portal:established');
    c.ws.send(JSON.stringify({ type: 'session:purpose', purpose: 'conversation' }));
    await until(c.log, (m) => m.type === 'session:purpose' && m.purpose === 'conversation');
    await openMic(c);

    const lines = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      await streamUtterance(c.ws, pcmB);
      // The sitting REALLY happened — the sweep below is not vacuous.
      const utterance = await until(c.log, (m) => m.type === 'voice:utterance', 120_000);
      expect(utterance.text.toLowerCase()).toContain('house');
    } finally {
      spy.mockRestore();
    }

    // (a) No audio artifacts under the workspace root the sitting touched.
    expect(await findAudioArtifacts(tempRoot)).toEqual([]);
    // (b) Captured backend logs: no base64 PCM blobs, no spoken content.
    expect(findLogLeaks(lines.join('').toLowerCase(), ['house answers', 'portal is open'])).toEqual([]);
    // The sidecar's own log file rides the same law — retention is everywhere.
    const sidecarLog = await fs
      .readFile(path.resolve('voice-engines/_logs/whisper.log'), 'utf8')
      .catch(() => '');
    expect(sidecarLog.toLowerCase()).not.toContain('house answers');
  }, 420_000);
});
