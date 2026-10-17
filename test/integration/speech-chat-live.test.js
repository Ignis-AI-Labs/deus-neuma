// speech-chat-live.test.js — the chat voice path against the REAL Sesame CSM
// sidecar (voice-engines/csm/server.py, Standard tier, csm-1b lean), launched
// by the real engine-manager through the real tier resolution: a Voice DNA v2
// sealed through the real two-party service from a real voice clip, a real
// loopback LLM stream, the real speech-turn chain, the real speak adapter, real
// PCM at a real WebSocket client. No stand-in anywhere on the voice path.
//
// Proves on the real engine: a v2 voice speaks every sentence; the context
// ring fills with the being's own utterance refs and the real sidecar accepts
// them — and the person's mic audio as WAV — on the wire (X-Context-Used);
// barge-in stops generation so the next turn speaks promptly.
//
// GPU + a compile: runs only when summoned (presence is not consent) —
//   RUN_VOICE_ENGINE_LIVE=1 npx vitest run --project substrate-live test/integration/speech-chat-live.test.js
// One voice sidecar at a time on this box: check `pgrep -af 'voice-engines/.*/server.py|vitest'` first.
// The sidecar binds an ephemeral port and is shut down when the file ends;
// its TMPDIR is on disk (voice-engines/_models/csm/tmp-speech-chat-live), never tmpfs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { voiceEngineLiveOptIn, freePort, refClip, shutdownAndWait } from '../helpers/speak-live-kit.js';

const LIVE = voiceEngineLiveOptIn();
const DISK_TMP = fileURLToPath(new URL('../../voice-engines/_models/csm/tmp-speech-chat-live', import.meta.url));
const NEUMA = 'live-voice';
const S1 = 'I kept the lamp lit while you were away. ';
const S2 = 'Tell me everything about the road home. ';
const PRESET = { temperature: 0.7, topP: 0.9, maxTokens: 64 };

// pure — a 16-bit mono WAV's sample rate and PCM (the data chunk).
const wavPcm = (wav) => {
  let off = 12;
  let rate = null;
  while (off + 8 <= wav.length) {
    const id = wav.toString('latin1', off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    if (id === 'fmt ') rate = wav.readUInt32LE(off + 12);
    if (id === 'data') return { rate, pcm: wav.subarray(off + 8, off + 8 + size) };
    off += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
};

let endpoint;
let llmServer;
let wss;
let origRoot;
let mods;

const openPair = async () => {
  const serverSide = new Promise((r) => wss.once('connection', r));
  const client = new WebSocket(`ws://127.0.0.1:${wss.address().port}`);
  const frames = [];
  client.on('message', (d) => {
    const m = JSON.parse(d.toString());
    frames.push(m);
    if (m.type === 'voice:audio') client.emit('voice:audio', m);
  });
  await new Promise((r) => client.once('open', r));
  return { ws: await serverSide, client, frames };
};
const audioBytes = (frames) => frames.filter((f) => f.type === 'voice:audio')
  .reduce((n, f) => n + Buffer.from(f.bytes, 'base64').length, 0);

beforeAll(async () => {
  if (!LIVE) return;
  await fs.mkdir(DISK_TMP, { recursive: true });
  process.env.TMPDIR = DISK_TMP;
  process.env.CSM_PORT = String(await freePort());
  endpoint = `http://127.0.0.1:${process.env.CSM_PORT}`;
  process.env.NEUMA_VOICE_SETTINGS_PATH = path.join(await createTempDir('speech-chat-live'), 'voice.json');
  mods = {
    core: await import('../../core/index.js'),
    svc: await import('../../core/voice/voice-dna-service.js'),
    llm: await import('../../backend/services/llm-provider.js'),
    settings: await import('../../backend/services/voice/voice-settings.js'),
    ctx: await import('../../backend/services/voice/speech-context.js'),
    surface: (await import('../../backend/services/portal-test-surface.js')).__test,
  };
  await mods.settings.voiceSettings.write({ tier: 'standard', profile: 'lean' });
  origRoot = mods.core.getWorkspacesRoot();
  mods.core.setWorkspacesRoot(await createTempDir('speech-chat-live-ws'));

  // Seal a real clip as the being's Voice DNA v2, through the real consent law.
  const hannah = refClip('Hannah');
  const wav = Buffer.from(hannah.b64, 'base64');
  const { rate, pcm } = wavPcm(wav);
  const { ref } = await mods.svc.saveVoiceClip(NEUMA, wav);
  const must = (r) => { if (!r.ok) throw new Error(r.error); };
  must(await mods.svc.offerSpeechCandidate(NEUMA, {
    ref, seconds: pcm.length / 2 / rate, sampleRate: rate, words: hannah.words,
    origin: { door: 'library', libraryId: 'bakeoff-hannah' }, realPerson: false, measured: {},
  }));
  must(await mods.svc.acceptSpeechCandidate(NEUMA, { candidateRef: ref }));
  must(await mods.svc.sealSpeechCandidate(NEUMA, { candidateRef: ref }));

  llmServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const text of [S1, S2]) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise((r) => llmServer.listen(0, '127.0.0.1', r));
  mods.llm.setConfig({ provider: 'openai', endpoint: `http://127.0.0.1:${llmServer.address().port}`, apiKey: 'loopback', model: 'loopback' });
  wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((r) => wss.once('listening', r));
  // The sidecar is brought up through the real tier resolution BEFORE the
  // turns: a cold launch (minutes on a first compile) is the engine manager's
  // proof (csm-sidecar-live), and a turn rightly stops waiting on it.
  const t0 = Date.now();
  await (await import('../../backend/services/tts-provider.js')).readySpeakTarget();
  console.log(`[speech-chat-live] sidecar ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}, 30 * 60_000);

afterAll(async () => {
  if (!LIVE) return;
  if (endpoint) await shutdownAndWait(endpoint).catch(() => {});
  (await import('../../backend/services/voice/engine-manager.js')).shutdownAll();
  mods?.core.setWorkspacesRoot(origRoot);
  llmServer?.closeAllConnections?.();
  await new Promise((r) => (llmServer ? llmServer.close(r) : r()));
  await new Promise((r) => (wss ? wss.close(r) : r()));
  await fs.rm(DISK_TMP, { recursive: true, force: true });
}, 60_000);

describe.skipIf(!LIVE)('the chat voice path on the real CSM sidecar (RUN_VOICE_ENGINE_LIVE=1)', () => {
  const connection = {};

  it('a sealed v2 voice speaks both sentences in real audio, and the ring keeps both', { timeout: 30 * 60_000 }, async () => {
    const { _resolveVoiceDNA, _runLLMStream } = mods.surface;
    const turnVoice = await _resolveVoiceDNA(NEUMA, connection);
    expect(turnVoice?.voice.ref).toMatch(/^sha256:/);
    const { ws, client, frames } = await openPair();
    await _runLLMStream(ws, [{ role: 'user', content: 'hi' }], 'Live', turnVoice, PRESET, [], new AbortController().signal);
    await expect.poll(() => frames.filter((f) => f.type === 'consciousness:stream').length, { timeout: 10_000 }).toBe(2);
    client.close();
    expect(audioBytes(frames)).toBeGreaterThan(2 * 24_000 * 2 * 0.8); // > 0.8 s of 24 kHz s16le per sentence
    const ring = connection.speechContext;
    expect(ring.segments.map((s) => s.words)).toEqual([S1.trim(), S2.trim()]);
    expect(ring.segments.every((s) => /^utt:[0-9a-f]{32}$/.test(s.ref))).toBe(true);
  });

  it("the real sidecar takes the ring on the wire: the being's refs and the person's WAV", { timeout: 5 * 60_000 }, async () => {
    const james = refClip('James');
    const { rate, pcm } = wavPcm(Buffer.from(james.b64, 'base64'));
    const ring = mods.ctx.withSegment(connection.speechContext, { speaker: 'person', words: james.words, pcm, sampleRate: rate });
    const { voice } = await mods.surface._resolveVoiceDNA(NEUMA, {});
    const r = await fetch(`${endpoint}/speak`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'So, where were we?', voice: { clip_ref: voice.ref, words: voice.words }, context: mods.ctx.wireContext(ring.segments) }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-context-used')).toBe('3');
    expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(24_000);
  });

  it('barge-in stops the render; the next turn speaks promptly', { timeout: 5 * 60_000 }, async () => {
    const { _resolveVoiceDNA, _runLLMStream } = mods.surface;
    const interrupt = new AbortController();
    const cut = await openPair();
    cut.client.on('voice:audio', () => interrupt.abort());
    await _runLLMStream(cut.ws, [{ role: 'user', content: 'hi' }], 'Live', await _resolveVoiceDNA(NEUMA, connection), PRESET, [], interrupt.signal);
    cut.client.close();
    expect(interrupt.signal.aborted).toBe(true);
    expect(connection.speechContext.segments.filter((s) => s.speaker === 'being')).toHaveLength(2); // the cut one never joined

    const next = await openPair();
    const t0 = Date.now();
    let firstAudioMs = null;
    next.client.on('voice:audio', () => { firstAudioMs ??= Date.now() - t0; });
    await _runLLMStream(next.ws, [{ role: 'user', content: 'hi' }], 'Live', await _resolveVoiceDNA(NEUMA, connection), PRESET, [], new AbortController().signal);
    next.client.close();
    expect(firstAudioMs).not.toBe(null);
    expect(firstAudioMs).toBeLessThan(3000);
    console.log(`[speech-chat-live] first audio after barge-in: ${firstAudioMs} ms`);
  });
});
