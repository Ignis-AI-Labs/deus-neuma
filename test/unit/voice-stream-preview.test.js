/**
 * Streaming forge preview — the PCM branch of readPreviewResponse must start
 * scheduling audio while the response body is still arriving, and the mp3
 * branch must honestly keep the whole-take blob path. Exercised against a
 * real HTTP server over real fetch (no stubs anywhere in the claimed path);
 * only the Web Audio boundary is injected (a fake AudioContext — the repo's
 * established pattern for scheduler tests, there is no audio device in node).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { readPreviewResponse, readPcmStream } from '../../frontend/app/RelinkShell/voice-client.js';
import { createVoiceScheduler } from '../../frontend/app/RelinkShell/voice-scheduler.js';

const makeFakeCtx = () => {
  const state = { now: 0, scheduled: [], sources: [] };
  const ctx = {
    state: 'running',
    get currentTime() { return state.now; },
    get destination() { return { __dest: true }; },
    createBuffer(channels, length, sampleRate) {
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        _data: Array.from({ length: channels }, () => new Float32Array(length)),
        copyToChannel(arr, ch) { this._data[ch] = arr; },
      };
    },
    createBufferSource() {
      const src = {
        buffer: null,
        onended: null,
        connect() {},
        start(when) { state.scheduled.push({ when, buffer: src.buffer }); },
        stop() {},
      };
      state.sources.push(src);
      return src;
    },
  };
  return { ctx, state };
};

// s16le little-endian marker samples as bytes: [100, 200] then [300] + a
// dangling tail byte (7 bytes total → 3 whole frames + 1 unplayable byte).
const CHUNK_A = new Uint8Array([100, 0, 200, 0]);
const CHUNK_B = new Uint8Array([44, 1, 9]); // 300 = 0x012C LE, then the tail byte
const FULL_TAKE = new Uint8Array([100, 0, 200, 0, 44, 1, 9]);
const MP3_BYTES = new Uint8Array([0xff, 0xfb, 1, 2, 3, 4, 5]);

const serverState = { ended: false };

let server, baseUrl;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    if (req.url === '/mp3') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
      res.end(Buffer.from(MP3_BYTES));
      return;
    }
    // /pcm — stream: first chunk now, the rest after a real delay, so the
    // client provably holds an unfinished body when first audio schedules.
    res.writeHead(200, {
      'Content-Type': 'audio/raw',
      'X-Audio-Format': 'pcm_s16le',
      'X-Audio-Sample-Rate': '8000',
      'X-Audio-Channels': '1',
      'Cache-Control': 'no-store',
    });
    res.write(Buffer.from(CHUNK_A));
    setTimeout(() => {
      serverState.ended = true;
      res.end(Buffer.from(CHUNK_B));
    }, 150);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const allSamples = (scheduled) =>
  scheduled.flatMap((s) => Array.from(s.buffer._data[0], (v) => Math.round(v * 32768)));

describe('readPreviewResponse — raw PCM streaming branch', () => {
  test('first audio schedules while the body is still arriving; take accumulates intact', async () => {
    const { ctx, state } = makeFakeCtx();
    const res = await fetch(`${baseUrl}/pcm`, { method: 'POST' });
    const pending = readPreviewResponse(res, { createContext: () => ctx });

    // Bounded real-time wait for the first scheduled buffer.
    for (let i = 0; i < 100 && state.scheduled.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(state.scheduled.length).toBeGreaterThan(0);
    expect(serverState.ended).toBe(false); // audio started before the body finished

    const result = await pending;
    expect(result.streamed).toBe(true);
    expect(result.scheduler).toBeTruthy();
    expect(result.format).toBe('pcm_s16le');
    expect(result.sampleRate).toBe(8000);
    expect(result.channels).toBe(1);
    expect(result.contentType).toBe('audio/raw');

    // Every whole frame scheduled, in order, gapless — however reads were split.
    expect(allSamples(state.scheduled)).toEqual([100, 200, 300]);
    for (let i = 1; i < state.scheduled.length; i++) {
      const prev = state.scheduled[i - 1];
      expect(state.scheduled[i].when).toBeCloseTo(prev.when + prev.buffer.duration, 6);
    }

    // The returned take is the byte-exact full body, trailing partial frame
    // included (kept for the WAV-wrap/<audio> path, never scheduled torn).
    const takeBytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(Array.from(takeBytes)).toEqual(Array.from(FULL_TAKE));

    result.scheduler.dispose();
  });
});

describe('readPreviewResponse — cloud mp3 blob branch', () => {
  test('mp3 keeps the whole-take blob path (never fake-streamed)', async () => {
    const { ctx, state } = makeFakeCtx();
    const res = await fetch(`${baseUrl}/mp3`, { method: 'POST' });
    const result = await readPreviewResponse(res, { createContext: () => ctx });

    expect(result.streamed).toBe(false);
    expect(result.scheduler).toBeNull();
    expect(result.contentType).toBe('audio/mpeg');
    expect(state.scheduled).toHaveLength(0); // no scheduler was created/used
    const takeBytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(Array.from(takeBytes)).toEqual(Array.from(MP3_BYTES));
  });
});

describe('readPreviewResponse — cancel mid-stream', () => {
  test('onScheduler publishes before the first chunk; the production cancel sequence (interrupt + dispose) silences the sounding take before the body finishes', async () => {
    const { ctx, state } = makeFakeCtx();
    serverState.ended = false;
    const res = await fetch(`${baseUrl}/pcm`, { method: 'POST' });
    let published = null;
    const pending = readPreviewResponse(res, {
      createContext: () => ctx,
      onScheduler: (s) => { published = s; },
    });

    // The interrupt target exists immediately — long before the body drains.
    expect(published).toBeTruthy();
    expect(serverState.ended).toBe(false);

    // Wait for the first buffer to be sounding, then run the exact cancel path
    // use-voice-preview's stopPreviewAudio runs (interrupt, then terminal dispose).
    for (let i = 0; i < 100 && state.scheduled.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(state.scheduled.length).toBeGreaterThan(0);
    expect(serverState.ended).toBe(false);
    published.interrupt();
    published.dispose();

    // The stream still drains (CHUNK_B lands ~150 ms in) and the take still
    // accumulates — but the late chunk is never scheduled for playback.
    const result = await pending;
    expect(result.streamed).toBe(true);
    expect(allSamples(state.scheduled)).toEqual([100, 200]); // CHUNK_A only; 300 never played
    const takeBytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(Array.from(takeBytes)).toEqual(Array.from(FULL_TAKE));
  });

  test('shouldAbort true at creation (cancel before the scheduler existed): nothing ever schedules, take still accumulates', async () => {
    const { ctx, state } = makeFakeCtx();
    serverState.ended = false;
    const res = await fetch(`${baseUrl}/pcm`, { method: 'POST' });
    let published = null;
    const result = await readPreviewResponse(res, {
      createContext: () => ctx,
      onScheduler: (s) => { published = s; },
      shouldAbort: () => true,
    });

    // Aborted pre-publish: never handed out, never resumed — and the terminal
    // dispose means both chunks' pushChunk calls were silent no-ops.
    expect(published).toBeNull();
    expect(state.scheduled).toHaveLength(0);
    const takeBytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(Array.from(takeBytes)).toEqual(Array.from(FULL_TAKE));
    result.scheduler.dispose();
  });
});

describe('readPcmStream — frame alignment across reads', () => {
  test('a sample split across stream chunks is carried, never played torn', async () => {
    const { ctx, state } = makeFakeCtx();
    const scheduler = createVoiceScheduler({ createContext: () => ctx });
    // Bytes [1,0, 2,0] = s16le samples 1, 2 — enqueued so every sample straddles
    // a chunk boundary.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.enqueue(new Uint8Array([0, 2]));
        controller.enqueue(new Uint8Array([0]));
        controller.close();
      },
    });

    const bytes = await readPcmStream(stream, {
      format: 'pcm_s16le', sampleRate: 8000, channels: 1, scheduler,
    });

    expect(state.scheduled).toHaveLength(2);
    expect(allSamples(state.scheduled)).toEqual([1, 2]);
    expect(state.scheduled[1].when).toBeCloseTo(
      state.scheduled[0].when + state.scheduled[0].buffer.duration, 6,
    );
    expect(Array.from(bytes)).toEqual([1, 0, 2, 0]);
    scheduler.dispose();
  });

  test('a null body fails explicitly, never silently', async () => {
    await expect(readPcmStream(null, {})).rejects.toThrow('preview stream unreadable');
  });
});
