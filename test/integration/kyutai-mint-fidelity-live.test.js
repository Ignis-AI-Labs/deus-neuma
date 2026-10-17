/**
 * S-6 — real-mint fidelity retiring test (substrate-live lane, REAL stack).
 *
 * The FIDELITY UNVERIFIED honesty label retires or stays based on what is
 * measured here — recorded, never asserted unrun.
 *
 * Flow (every step real: real sidecar processes booted from the bench venv,
 * real /mint, real tts.synthesize adapter path, real ECAPA-TDNN):
 *   1. boot sidecar #1 (KYUTAI_VOICE=expresso/… dev fixture per the Mint
 *      Engineer's note) from the bench venv
 *   2. mint the spike's real speech WAV (s2_smoke_b2.wav, 24 kHz mono s16,
 *      4.32 s — the same seed B-2 minted) TWICE → decoded bytes sha256-equal
 *      (determinism); safetensors header parsed in JS AND validated by the
 *      production guard-5 validator (core/voice/voice-forge.js
 *      validateMintedEmbedding)
 *   3. write the minted embedding into the gitignored managed dir under a
 *      minted/ slug and boot sidecar #2 with KYUTAI_VOICE=minted/… — the
 *      minted voice becomes the baked conditioning
 *   4. render a sentence through the REAL tts.synthesize adapter path with
 *      voiceDNA._inlineEmbedding (the production conditioning seam); no-clip
 *      analysis on the render (rail-hit fraction + longest rail run, RMS)
 *   5. boot sidecar #3 with the CC0 voice-donations/James.wav baked: render
 *      the SAME sentence as a different-speaker control; re-mint the same
 *      seed on this third process → cross-process sha256 determinism
 *   6. ECAPA-TDNN (speechbrain/spkrec-ecapa-voxceleb, CPU, bench venv):
 *      cos(seed, minted render) vs cos(seed, control render), PLUS two
 *      metric-validation anchors on every run — cos(seed, seed) ≈ 1 and
 *      cos(seed, same-voice anchor render) > 0.5 — so a gate failure can
 *      never be dismissed as metric breakage
 *   7. the fidelity gate rides test.fails: while cos_minted is below the
 *      pre-chosen threshold the suite stays green-as-expected-fail and
 *      FIDELITY UNVERIFIED STAYS; the day a future engine/mint change meets
 *      the gate, this test flips RED and forces the label decision
 *
 * GPU discipline: each sidecar is /shutdown before the next boots; afterAll
 * verifies the port is dark and records the released VRAM. The operator's
 * backend (3355) and llama-server are never touched.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { shouldRunGpuEngineTests, gpuSkipNote } from '../helpers/gpu-optin.js';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const tts = await import('../../backend/services/tts-provider.js');
const { validateMintedEmbedding } = await import('../../core/voice/voice-forge.js');

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const WAVE3_DIR = path.join(REPO_ROOT, '.waves', 'runs', 'kyutai-engine-phase1-srex', 'wave-3');
const EVIDENCE_PATH = path.join(WAVE3_DIR, 's6-live-evidence.json');
const BENCH_PYTHON = path.join(
  REPO_ROOT, '.waves', 'runs', 'sesame-class-voice-0y39', 'wave-2', 'bench-env', 'bin', 'python',
);
const SERVER_PY = path.join(REPO_ROOT, 'voice-engines', 'kyutai', 'server.py');
const MODELS_DIR = path.join(REPO_ROOT, 'voice-engines', '_models', 'kyutai');
const ENDPOINT = 'http://127.0.0.1:7866';
const SEED_WAV = path.join(
  REPO_ROOT, '.waves', 'runs', 'kyutai-engine-phase1-srex', 'wave-1', 'spike-out', 's2_smoke_b2.wav',
);
const ANCHOR_WAV = path.join(
  REPO_ROOT, '.waves', 'runs', 'kyutai-engine-phase1-srex', 'wave-1', 'spike-out', 's2_smoke_a.wav',
);
const RENDER_WAV = path.join(WAVE3_DIR, 's6-render-minted.wav');
const CONTROL_WAV = path.join(WAVE3_DIR, 's6-render-control-james.wav');
const MINTED_SLUG = 'minted/s6-live-smoke.wav';
const MINTED_PATH = path.join(MODELS_DIR, 'minted', 's6-live-smoke.wav.1e68beda@240.safetensors');
const RENDER_TEXT = 'The voice you hear was minted from a real recording, and it still sounds like me.';

// Fidelity gate (chosen BEFORE the first measurement, rationale in the
// deliverable): spkrec-ecapa-voxceleb same-speaker pairs through this exact
// resynthesis path measure ≈0.73 (the run's own anchor), different-speaker
// pairs ≈0.02-0.12. A gate at 0.5 with a discrimination margin over a real
// control is conservative: pass requires BOTH.
const FIDELITY_THRESHOLD = 0.5;
const DISCRIMINATION_MARGIN = 0.15;

const evidence = { startedAt: new Date().toISOString(), steps: {} };
const state = {}; // beforeAll fills; the tests assert from recorded measurements

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sh = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }));
      else resolve(stdout.trim());
    });
  });

const gpuUsedMiB = async () =>
  Number(await sh('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits']));

const probeHealth = async () => {
  try {
    const r = await fetch(`${ENDPOINT}/health`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    return data?.ok === true ? data : null;
  } catch {
    return null;
  }
};

// impure — boot the real sidecar from the bench venv with a given baked voice
const bootSidecar = async (voiceSlug, logName) => {
  const logPath = path.join(WAVE3_DIR, logName);
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(BENCH_PYTHON, [SERVER_PY], {
    env: {
      ...process.env,
      KYUTAI_HOST: '127.0.0.1',
      KYUTAI_PORT: '7866',
      KYUTAI_VOICE: voiceSlug,
    },
    stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`sidecar exited during boot (${child.exitCode}) — see ${logPath}`);
    const health = await probeHealth();
    if (health) return { child, health, logPath };
    await sleep(1000);
  }
  throw new Error(`sidecar did not become ready in 180s — see ${logPath}`);
};

// impure — /shutdown then wait for the port to go dark and the process to exit.
// The sidecar's deferred still-idle guard legitimately ABORTS an exit that
// races recent activity (a mint <0.5 s before counts) — so the POST is retried
// until the exit lands, exactly like the engine-manager's reaper contract.
const shutdownSidecar = async (child) => {
  let posts = 0;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null && !(await probeHealth())) return { exited: true, posts };
    try {
      posts += 1;
      await fetch(`${ENDPOINT}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) });
    } catch { /* socket drop on exit IS the shutdown */ }
    await sleep(1200);
  }
  return { exited: child.exitCode !== null && !(await probeHealth()), posts };
};

const postMint = async (refAudioB64) => {
  const r = await fetch(`${ENDPOINT}/mint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref_audio_b64: refAudioB64 }),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// pure — minimal safetensors header parse (mirrors guard 5's expectations)
const parseSafetensorsHeader = (buf) => {
  const headerLen = Number(buf.readBigUInt64LE(0));
  const header = JSON.parse(buf.subarray(8, 8 + headerLen).toString('utf8'));
  return { headerLen, tensors: Object.keys(header).filter((k) => k !== '__metadata__'), header };
};

// pure — wrap raw pcm_s16le 24 kHz mono in a 44-byte WAV header
const pcmToWav = (pcm) => {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};

const pcmStats = (buf) => {
  const view = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
  let peak = 0;
  let sumSq = 0;
  let railHits = 0;
  let longestRailRun = 0;
  let run = 0;
  for (let i = 0; i < view.length; i++) {
    const a = Math.abs(view[i]) / 32768;
    if (a > peak) peak = a;
    sumSq += a * a;
    if (Math.abs(view[i]) >= 32767) { railHits += 1; run += 1; if (run > longestRailRun) longestRailRun = run; }
    else run = 0;
  }
  return {
    bytes: buf.length,
    seconds: Math.round((view.length / 24000) * 100) / 100,
    peak: Math.round(peak * 100000) / 100000,
    rms: Math.round(Math.sqrt(sumSq / view.length) * 100000) / 100000,
    railHits,
    railHitFraction: Math.round((railHits / view.length) * 1000000) / 1000000,
    longestRailRun,
  };
};

// impure — render through the REAL tts.synthesize adapter path into a WAV file
const renderThroughAdapter = async (text, voiceDNA, outWav) => {
  const parts = [];
  let finalSeen = false;
  for await (const chunk of tts.synthesize({ text, voiceDNA })) {
    parts.push(Buffer.from(chunk.bytes));
    if (chunk.final) finalSeen = true;
  }
  const pcm = Buffer.concat(parts);
  await fsp.writeFile(outWav, pcmToWav(pcm));
  return { finalSeen, ...pcmStats(pcm) };
};

beforeAll(async () => {
  await fsp.mkdir(WAVE3_DIR, { recursive: true });
  if (await probeHealth()) {
    evidence.steps.preclean = 'leftover kyutai sidecar shut down for a clean boot';
    try { await fetch(`${ENDPOINT}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) }); } catch { /* exit */ }
    await sleep(3000);
  }
  evidence.steps.baseline = { gpuUsedMiB: await gpuUsedMiB() };
  tts.setConfig({ provider: 'kyutai', endpoint: ENDPOINT, apiKey: '' });

  // --- 1+2: boot #1 (expresso dev fixture) and mint the real seed twice ---
  const seedBytes = await fsp.readFile(SEED_WAV);
  const boot1 = await bootSidecar('expresso/ex01-ex02_default_001_channel1_168s.wav', 's6-boot1-expresso.log');
  evidence.steps.boot1 = { voice: 'expresso dev fixture', device: boot1.health.device, gpuUsedMiB: await gpuUsedMiB() };

  const mintA = await postMint(seedBytes.toString('base64'));
  const mintB = await postMint(seedBytes.toString('base64'));
  state.mint = { statusA: mintA.status, statusB: mintB.status };
  if (mintA.status === 200 && mintB.status === 200) {
    const embA = Buffer.from(mintA.body.embedding_b64, 'base64');
    const embB = Buffer.from(mintB.body.embedding_b64, 'base64');
    const parsed = parseSafetensorsHeader(embA);
    state.mint = {
      ...state.mint,
      bytes: embA.length,
      sha256: sha256(embA),
      sameInProcess: sha256(embA) === sha256(embB),
      tensors: parsed.tensors,
      shape: parsed.header.speaker_wavs?.shape,
      dtype: parsed.header.speaker_wavs?.dtype,
      guard5Errors: validateMintedEmbedding(embA),
      embeddingB64: mintA.body.embedding_b64,
      embeddingBytes: embA,
    };
    evidence.steps.mint = { ...state.mint, embeddingB64: undefined, embeddingBytes: undefined };
  }
  state.down1 = await shutdownSidecar(boot1.child);
  evidence.steps.boot1Shutdown = { exited: state.down1.exited, posts: state.down1.posts };

  // --- 3+4: bake the minted voice and render through the real adapter ---
  await fsp.mkdir(path.dirname(MINTED_PATH), { recursive: true });
  await fsp.writeFile(MINTED_PATH, state.mint.embeddingBytes);
  const boot2 = await bootSidecar(MINTED_SLUG, 's6-boot2-minted.log');
  const boot2Log = await fsp.readFile(boot2.logPath, 'utf8');
  const bakedLine = (boot2Log.split('\n').find((l) => l.includes('ready in')) || '').trim();

  const mintedDNA = {
    neumaId: 's6-live',
    engine: { provider: 'kyutai' },
    _inlineEmbedding: state.mint.embeddingB64, // production seam: tts-provider attaches this from the sealed workspace
  };
  state.renderMinted = await renderThroughAdapter(RENDER_TEXT, mintedDNA, RENDER_WAV);
  evidence.steps.renderMinted = {
    bakedLine,
    ...state.renderMinted,
    noSustainedClip: state.renderMinted.railHitFraction < 0.001 && state.renderMinted.longestRailRun <= 3,
    aboveSilence: state.renderMinted.rms > 0.01,
  };
  state.down2 = await shutdownSidecar(boot2.child);
  evidence.steps.boot2Shutdown = { exited: state.down2.exited, posts: state.down2.posts };

  // --- 5: control render (different speaker, CC0 James) + cross-process re-mint ---
  const boot3 = await bootSidecar('voice-donations/James.wav', 's6-boot3-james.log');
  state.renderControl = await renderThroughAdapter(RENDER_TEXT, { neumaId: 's6-live-control', engine: { provider: 'kyutai' } }, CONTROL_WAV);
  evidence.steps.renderControl = { voice: 'voice-donations/James.wav (CC0)', ...state.renderControl };

  const mintC = await postMint(seedBytes.toString('base64'));
  state.crossProcess = mintC.status === 200
    && sha256(Buffer.from(mintC.body.embedding_b64, 'base64')) === state.mint.sha256;
  evidence.steps.mint.crossProcessSha256Equal = state.crossProcess;
  state.down3 = await shutdownSidecar(boot3.child);
  evidence.steps.boot3Shutdown = { exited: state.down3.exited, posts: state.down3.posts };
  await sleep(2000);
  evidence.steps.gpuBetweenSynthAndMetric = { gpuUsedMiB: await gpuUsedMiB() };

  // --- 6: ECAPA-TDNN cosine (CPU; the GPU is released before the metric runs) ---
  const cosineJson = await sh(
    BENCH_PYTHON,
    [path.join(WAVE3_DIR, 'ecapa_cosine.py'), SEED_WAV, RENDER_WAV, CONTROL_WAV, ANCHOR_WAV,
      path.join(WAVE3_DIR, 'ecapa-model')],
    { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
  );
  state.cosine = JSON.parse(cosineJson.trim().split('\n').at(-1));

  // --- 7: verdict vs the pre-chosen threshold (test.fails carries the gate) ---
  const pass = state.cosine.cos_minted >= FIDELITY_THRESHOLD
    && (state.cosine.cos_minted - state.cosine.cos_control) >= DISCRIMINATION_MARGIN;
  evidence.steps.ecapa = {
    ...state.cosine,
    threshold: FIDELITY_THRESHOLD,
    discriminationMargin: DISCRIMINATION_MARGIN,
    gap: Math.round((state.cosine.cos_minted - state.cosine.cos_control) * 10000) / 10000,
    pass,
    fidelityUnverifiedLifts: pass,
  };
}, 600_000);

afterAll(async () => {
  if (await probeHealth()) {
    try { await fetch(`${ENDPOINT}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) }); } catch { /* exit */ }
  }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && (await probeHealth())) await sleep(500);
  await sleep(2000);
  evidence.steps.finalRelease = { gpuUsedMiB: await gpuUsedMiB(), portDark: !(await probeHealth()) };
  evidence.finishedAt = new Date().toISOString();
  await fsp.writeFile(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
}, 60_000);

if (!shouldRunGpuEngineTests()) console.warn(gpuSkipNote('kyutai mint fidelity'));
describe.skipIf(!shouldRunGpuEngineTests())('S-6 — real-mint fidelity retiring test (real sidecar, real mint, real ECAPA)', () => {
  test('mint mechanics: deterministic across processes, guard-5 clean, bakes, renders, no sustained clip, metric anchors valid', () => {
    expect(state.mint.statusA).toBe(200);
    expect(state.mint.statusB).toBe(200);
    expect(state.mint.sameInProcess).toBe(true);
    expect(state.crossProcess).toBe(true); // same WAV → same sha256 across processes
    expect(state.mint.guard5Errors).toEqual([]);
    expect(state.mint.tensors).toEqual(['speaker_wavs']);
    expect(state.mint.dtype).toBe('F32');
    expect(state.mint.shape[0]).toBe(1);
    expect(state.mint.shape[1]).toBe(512);

    for (const down of [state.down1, state.down2, state.down3]) expect(down.exited).toBe(true);

    expect(state.renderMinted.finalSeen).toBe(true);
    expect(state.renderMinted.bytes).toBeGreaterThan(0);
    // No-clip = no SUSTAINED rail contact (waveform flattening). Isolated
    // full-scale transient touches are recorded, not failed: the measured
    // criterion is rail-hit fraction < 0.1% AND longest rail run ≤ 3 samples.
    expect(state.renderMinted.railHitFraction).toBeLessThan(0.001);
    expect(state.renderMinted.longestRailRun).toBeLessThanOrEqual(3);
    expect(state.renderMinted.rms).toBeGreaterThan(0.01); // real speech, not silence
    expect(state.renderControl.finalSeen).toBe(true);
    expect(state.renderControl.rms).toBeGreaterThan(0.01);

    // Metric validation anchors — the SV metric itself is proven on every run.
    expect(state.cosine.cos_self).toBeGreaterThan(0.99);
    expect(state.cosine.cos_anchor).toBeGreaterThan(0.5); // same voice, different mimi render
  });

  // THE FIDELITY GATE — FIDELITY UNVERIFIED retires the day this passes.
  // test.fails: expected-red while the measured cosine is below threshold; a
  // future engine/mint change that achieves fidelity flips this test RED and
  // forces the label decision instead of letting it drift.
  test.fails('FIDELITY GATE: minted voice preserves the seed speaker (retires FIDELITY UNVERIFIED when met)', () => {
    expect(state.cosine.cos_minted).toBeGreaterThanOrEqual(FIDELITY_THRESHOLD);
    expect(state.cosine.cos_minted - state.cosine.cos_control).toBeGreaterThanOrEqual(DISCRIMINATION_MARGIN);
  });
});
