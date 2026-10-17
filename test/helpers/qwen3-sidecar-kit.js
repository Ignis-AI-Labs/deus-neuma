/**
 * qwen3 sidecar kit — the impure helper block (real process / real GPU / real
 * HTTP) extracted VERBATIM from test/integration/qwen3-engine-live.test.js
 * under the size law (docs/work/size-law-breakdown.md Part 4). It serves that
 * live suite alone: every budget, assertion, describe/it, and the evidence
 * object stay in the test — the kit owns only the plumbing.
 */

import { execFile } from 'node:child_process';
import http from 'node:http';
import { createHash } from 'node:crypto';

const tts = await import('../../backend/services/tts-provider.js');

export const QWEN3_ENDPOINT = 'http://127.0.0.1:7867';

// --- helpers (all impure: real process / real GPU / real HTTP) ---

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const sh = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }));
      else resolve(stdout.trim());
    });
  });

export const gpuUsedMiB = async () =>
  Number(await sh('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits']));

// impure — PIDs (uv wrapper + python child) of every qwen3 sidecar, sorted
export const qwen3Pids = async () => {
  try {
    const out = await sh('pgrep', ['-f', 'voice-engines/qwen3/server\\.py']);
    return out.split('\n').map(Number).sort((a, b) => a - b);
  } catch {
    return []; // pgrep exits 1 on no match
  }
};

export const probeHealth = async () => {
  try {
    const r = await fetch(`${QWEN3_ENDPOINT}/health`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    return data?.ok === true ? data : null;
  } catch {
    return null;
  }
};

export const postShutdown = async () => {
  try {
    await fetch(`${QWEN3_ENDPOINT}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) });
  } catch { /* dropping the socket mid-exit IS the shutdown */ }
};

// impure — the sidecar's deferred exit re-checks lock+idle 0.3 s after the POST
// and legitimately ABORTS a reap that races recent activity (the S-6 contract),
// so the POST is retried until the port goes dark — exactly like the
// engine-manager's reaper.
export const shutdownUntilDark = async (timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  let posts = 0;
  while (Date.now() < deadline) {
    if (!(await probeHealth())) return { dark: true, posts };
    posts += 1;
    await postShutdown();
    await sleep(1200);
  }
  return { dark: !(await probeHealth()), posts };
};

export const waitHealthDown = async (timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await probeHealth())) return true;
    await sleep(500);
  }
  return false;
};

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// impure — raw http.request POST with NO client-side timeouts (undici's
// headersTimeout would kill the drain leg's ~100 s first-byte wait; Node's
// http.request has no inactivity timeout by default). Resolves on response
// headers; the caller drives the socket from there.
export const rawPostNoTimeout = (body) =>
  new Promise((resolve, reject) => {
    const url = new URL(`${QWEN3_ENDPOINT}/synthesize`);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (response) => resolve(response),
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });

// impure — one RAW POST /synthesize against the sidecar (contract truth,
// unadapted): status, the four audio headers, per-chunk arrival, total wall.
export const rawSynthesize = async (body, opts = {}) => {
  const t0 = performance.now();
  const response = await fetch(`${QWEN3_ENDPOINT}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const headers = {
    status: response.status,
    format: response.headers.get('x-audio-format'),
    sampleRate: Number(response.headers.get('x-audio-sample-rate')),
    channels: Number(response.headers.get('x-audio-channels')),
    cacheControl: response.headers.get('cache-control'),
  };
  if (!response.ok) {
    return { headers, errorBody: (await response.text().catch(() => '')).slice(0, 300), totalMs: Math.round(performance.now() - t0) };
  }
  const reader = response.body.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push({ bytes: value.length, atMs: Math.round((performance.now() - t0) * 10) / 10 });
    if (opts.maxChunks && chunks.length >= opts.maxChunks) break;
  }
  return { headers, chunks, totalMs: Math.round((performance.now() - t0) * 10) / 10 };
};

// impure — render through the REAL tts.synthesize adapter path; returns the
// concatenated PCM + stats. This is the shipping speak path (per-turn inline
// conditioning seam included when the DNA carries it).
export const renderThroughAdapter = async ({ text, voiceDNA, signal }) => {
  const parts = [];
  let finalSeen = false;
  let firstChunkMs = null;
  const t0 = performance.now();
  for await (const chunk of tts.synthesize({ text, voiceDNA, signal })) {
    if (firstChunkMs === null && chunk.bytes.length > 0) firstChunkMs = Math.round(performance.now() - t0);
    parts.push(Buffer.from(chunk.bytes));
    if (chunk.final) finalSeen = true;
  }
  const pcm = Buffer.concat(parts);
  return { pcm, finalSeen, firstChunkMs, wallMs: Math.round(performance.now() - t0), ...pcmStats(pcm) };
};

const pcmStats = (buf) => {
  const view = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < view.length; i++) {
    const a = Math.abs(view[i]) / 32768;
    if (a > peak) peak = a;
    sumSq += a * a;
  }
  return {
    bytes: buf.length,
    seconds: Math.round((view.length / 24000) * 100) / 100,
    peak: Math.round(peak * 100000) / 100000,
    rms: Math.round(Math.sqrt(sumSq / view.length) * 100000) / 100000,
  };
};

// pure — wrap raw pcm_s16le 24 kHz mono in a 44-byte WAV header
export const pcmToWav = (pcm) => {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};

// pure — a minimal mono WAV with the given rate/bits/duration (battery inputs)
export const makeWav = ({ seconds, sampleRate = 24000, bits = 16 }) => {
  const frames = Math.floor(seconds * sampleRate);
  const blockAlign = bits / 8;
  const data = Buffer.alloc(frames * blockAlign);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * blockAlign, 28);
  h.writeUInt16LE(blockAlign, 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
};
