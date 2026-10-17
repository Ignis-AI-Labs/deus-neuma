// stt-stream-client.js — impure: one hold's dictation over the live speech lane.
//
// The hold's own mic stream feeds an AudioWorklet (the voice sitting's pump,
// voice-mic-worklet.js) → 16 kHz s16le frames → /dictate-ws → the sidecar's
// live lane, which reads each frame once as it arrives. Words come back while
// the key is down (onPartial) and the final follows the release by ~0.2 s
// (docs/work/dictation-flow.md, 2026-10-07). Anything that keeps the lane from
// working resolves to null, and the hold falls back to /transcribe.

import { authTokenOrNull } from '../../utils/http.js';
import {
  createWorkletUrl, WORKLET_NAME, downsampleTo16k, floatToS16le, PCM_FRAME_SAMPLES,
} from './voice-mic-worklet.js';

// After the release the lane may still be catching up — on a busy machine it
// falls behind a long hold (measured 2026-10-09: 4.7 s behind after a 60 s hold
// under heavy CPU load). It is waited for as long as its words keep coming;
// a lane silent this long is stalled, and the hold goes to /transcribe whole.
// (A fixed 4 s wait kept the stale preview and lost the end of long holds.)
const STALL_MS = 6000;
// The mic keeps listening this long after the release: a key let go on the
// last syllable must not clip it.
const RELEASE_TAIL_MS = 150;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Open the live lane for one hold.
 * @param {MediaStream} stream - the hold's mic (the caller owns and stops it)
 * @param {{ onPartial?: (text: string) => void }} handlers
 * @returns {Promise<null | { readonly failed: boolean, finish: () => Promise<string|null>, abort: () => void }>}
 *   null when this browser cannot capture this way; finish() resolves the
 *   final text, or null when the lane failed and the caller should fall back.
 */
export const openDictationStream = async (stream, { onPartial } = {}) => {
  const token = authTokenOrNull();
  if (!token || typeof AudioWorkletNode === 'undefined') return null;
  let ctx;
  try {
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule(createWorkletUrl());
  } catch {
    ctx?.close().catch(() => {});
    return null;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${window.location.host}/dictate-ws?token=${encodeURIComponent(token)}`);
  let failed = false;
  let settled = false;
  let lastPartial = '';
  let lastHeardAt = 0;      // when the lane last said anything
  let resolveFinal;
  const finalText = new Promise((r) => { resolveFinal = r; });
  const settle = (text) => { if (!settled) { settled = true; resolveFinal(text); } };
  const fail = () => { if (!settled) { failed = true; settle(null); } };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    lastHeardAt = performance.now();
    if (msg.type === 'partial' && typeof msg.text === 'string') {
      lastPartial = msg.text;
      onPartial?.(msg.text);
    } else if (msg.type === 'final') {
      // An empty final with words on screen keeps the words (the lane heard them).
      settle(msg.text || lastPartial);
    } else if (msg.type === 'error') {
      fail();
    }
  };
  ws.onerror = fail;
  ws.onclose = fail;

  // Frames captured before the socket opens wait here (the backend also holds
  // early frames while a cold lane loads — this covers the handshake).
  const early = [];
  let pending = new Float32Array(0);
  const sendSamples = (samples) => {
    const bytes = floatToS16le(samples);
    if (ws.readyState === WebSocket.OPEN) ws.send(bytes);
    else if (ws.readyState === WebSocket.CONNECTING) early.push(bytes);
  };
  ws.onopen = () => { for (const bytes of early.splice(0)) ws.send(bytes); };

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, WORKLET_NAME);
  node.port.onmessage = (event) => {
    if (failed) return;
    const down = downsampleTo16k(event.data, ctx.sampleRate);
    const merged = new Float32Array(pending.length + down.length);
    merged.set(pending);
    merged.set(down, pending.length);
    let offset = 0;
    for (; merged.length - offset >= PCM_FRAME_SAMPLES; offset += PCM_FRAME_SAMPLES) {
      sendSamples(merged.subarray(offset, offset + PCM_FRAME_SAMPLES));
    }
    pending = merged.slice(offset);
  };
  source.connect(node);
  // The processor writes no output; an unconnected worklet node is never pulled.
  node.connect(ctx.destination);

  const stopCapture = () => {
    node.port.onmessage = null;
    try { source.disconnect(); node.disconnect(); } catch { /* already gone */ }
    ctx.close().catch(() => {});
  };

  return {
    get failed() { return failed; },
    finish: async () => {
      await sleep(RELEASE_TAIL_MS);
      stopCapture();
      if (failed) { ws.close(); return null; }
      // The held remainder is real audio, shorter than a frame — it goes too.
      if (pending.length > 0) sendSamples(pending);
      pending = new Float32Array(0);
      const flush = () => ws.send(JSON.stringify({ type: 'flush' }));
      if (ws.readyState === WebSocket.OPEN) flush();
      else ws.addEventListener('open', flush, { once: true });
      // Wait while the lane is still talking; a stall means fall back, never a cut.
      lastHeardAt = performance.now();
      const stalled = new Promise((resolve) => {
        const check = () => {
          if (settled) return;
          if (performance.now() - lastHeardAt > STALL_MS) resolve(undefined);
          else setTimeout(check, 250);
        };
        check();
      });
      const text = await Promise.race([finalText, stalled]);
      ws.onclose = null;
      ws.close();
      if (text === undefined) { failed = true; return null; }
      return text;
    },
    abort: () => {
      failed = true;
      stopCapture();
      ws.onclose = null;
      ws.close();
      settle(null);
    },
  };
};
