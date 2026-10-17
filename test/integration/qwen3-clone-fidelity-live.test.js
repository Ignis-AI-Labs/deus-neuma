/**
 * qwen3-engine-q3gh Wave-3 — clone-fidelity ECAPA re-gate through the SHIPPING
 * path (substrate-live lane, REAL stack, no mock anywhere).
 *
 * THE GATE IS PRE-REGISTERED HERE, BEFORE ANY MEASUREMENT (the S-6 gate,
 * verbatim): a qwen3 clone voice passes fidelity iff BOTH
 *     cos(seed, clone render)  ≥ 0.5
 *     cos(seed, clone render) − cos(seed, different-voice control)  ≥ 0.15
 * hold on speechbrain/spkrec-ecapa-voxceleb (CPU). Rationale, carried from
 * S-6: same-speaker pairs through a resynthesis path measure ≈0.73 (the S-6
 * run's own anchor), different-speaker pairs ≈0.02–0.12 — a 0.5 floor with a
 * 0.15 discrimination margin over a real control is conservative, not fitted.
 *
 * OUTCOME (measured 2026-07-20, qwen3-fidelity-evidence.json): the gate PASSED
 * on the first shipping-path run — cos_self 1, cos_anchor 0.7344,
 * cos_minted 0.8032, cos_control 0.3156, margin 0.4876. FIDELITY UNVERIFIED
 * RETIRES for qwen3. The gate began life under test.fails (the S-6 pattern:
 * green-as-expected-fail while unmet); the pass flipped it red as designed,
 * and it now rides as a HARD gate — any future fidelity regression fails here.
 *
 * The shipping path under test (every step real):
 *   1. real engine-manager ensureReady('qwen3') — the production launch
 *   2. a REAL express app on an ephemeral loopback port mounting the REAL
 *      routers: /api/auth (challenge → verify) and /api/v1/voice/forge
 *   3. REAL wallet auth: a fresh ethers wallet signs the real SIWE challenge;
 *      the server verifies and issues the session token (no auth stub)
 *   4. consent-gated offering: POST /start (clone) → POST /offering with the
 *      real bench WAV — preceded by a consent-negative probe that must 400
 *   5. POST /preview (the route's own ensureReady + adapter render) — saved
 *   6. POST /seal — the real DNA + seed.wav custody write to a temp
 *      workspaces root (real AES-GCM envelope via the machine config)
 *   7. the SEALED voice speaks: getVoiceDNA() from the workspace →
 *      tts.synthesize — the needsInlineRef seam attaches the sealed seed.wav,
 *      the real qwen3 adapter renders (this render is the ECAPA subject)
 *   8. a different-voice CONTROL render through the same engine (real bench
 *      ref of a different speaker), so the margin is measured, not assumed
 *   9. ECAPA-TDNN cosines via the S-6 harness (bench venv, CPU; the GPU is
 *      released first) — cos_self ≈ 1 and cos_anchor > 0.5 validate the
 *      metric itself on every run, so a gate failure is never metric breakage
 *
 * Evidence lands in .waves/runs/qwen3-engine-q3gh/wave-3/
 * qwen3-fidelity-evidence.json — the deliverable quotes that file, not memory.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import express from 'express';
import { ethers } from 'ethers';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';

const em = await import('../../backend/services/voice/engine-manager.js');
const tts = await import('../../backend/services/tts-provider.js');
const core = await import('../../core/index.js');
const dnaSvc = await import('../../core/voice/voice-dna-service.js');
const { createAuthRouter } = await import('../../backend/services/auth.js');
const { default: forgeRouter } = await import('../../backend/routes/voice-forge-routes.js');

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const WAVE3_DIR = path.join(REPO_ROOT, '.waves', 'runs', 'qwen3-engine-q3gh', 'wave-3');
const EVIDENCE_PATH = path.join(WAVE3_DIR, 'qwen3-fidelity-evidence.json');
const QWEN3_ENDPOINT = 'http://127.0.0.1:7867';
const BENCH_PYTHON = path.join(
  REPO_ROOT, '.waves', 'runs', 'sesame-class-voice-0y39', 'wave-2', 'bench-env', 'bin', 'python',
);
const S6_ECAPA_SCRIPT = path.join(REPO_ROOT, '.waves', 'runs', 'kyutai-engine-phase1-srex', 'wave-3', 'ecapa_cosine.py');
const ECAPA_SCRIPT = path.join(WAVE3_DIR, 'ecapa_cosine.py');
const SEED_WAV = path.join(
  REPO_ROOT, '.waves', 'runs', 'kyutai-engine-phase1-srex', 'wave-1', 'spike-out', 's2_smoke_b2.wav',
);
const ANCHOR_WAV = path.join(
  REPO_ROOT, '.waves', 'runs', 'kyutai-engine-phase1-srex', 'wave-1', 'spike-out', 's2_smoke_a.wav',
);
const CONTROL_REF_WAV = path.join(REPO_ROOT, 'voice-engines', '_samples', 'parler-deep-male-seed1337.wav');
const RENDER_WAV = path.join(WAVE3_DIR, 'fidelity-render-sealed.wav');
const CONTROL_WAV = path.join(WAVE3_DIR, 'fidelity-render-control.wav');
const PREVIEW_WAV = path.join(WAVE3_DIR, 'fidelity-render-preview.wav');
const NEUMA_ID = 'q3gh-fidelity-neuma';
const RENDER_TEXT = 'The voice you hear was sealed by consent, and it still sounds like me.';

// THE PRE-REGISTERED GATE (see header) — fixed before the first measurement.
const FIDELITY_THRESHOLD = 0.5;
const DISCRIMINATION_MARGIN = 0.15;

const evidence = { startedAt: new Date().toISOString(), steps: {} };
const state = {};

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
    const r = await fetch(`${QWEN3_ENDPOINT}/health`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    return data?.ok === true ? data : null;
  } catch {
    return null;
  }
};

const postShutdown = async () => {
  try {
    await fetch(`${QWEN3_ENDPOINT}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) });
  } catch { /* dropping the socket mid-exit IS the shutdown */ }
};

const waitHealthDown = async (timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await probeHealth())) return true;
    await sleep(500);
  }
  return false;
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
const pcmToWav = (pcm) => {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
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
    evidence.steps.preclean = 'leftover qwen3 sidecar shut down for a clean boot';
    await postShutdown();
    await waitHealthDown();
  }
  evidence.steps.baseline = { gpuUsedMiB: await gpuUsedMiB() };
  tts.setConfig({ provider: 'qwen3', endpoint: QWEN3_ENDPOINT, apiKey: '' });

  // 1. the production launch path
  await em.ensureReady('qwen3', 600_000);
  const health = await probeHealth();
  evidence.steps.boot = { device: health?.device, sampleRate: health?.sample_rate, gpuUsedMiB: await gpuUsedMiB() };

  // 2. REAL app, REAL routers, ephemeral loopback port
  const app = express();
  app.use('/api/auth', express.json(), createAuthRouter(express));
  app.use('/api/v1/voice/forge', forgeRouter);
  state.server = app.listen(0, '127.0.0.1');
  await new Promise((r) => state.server.once('listening', r));
  const base = `http://127.0.0.1:${state.server.address().port}`;
  state.base = base;

  // 3. REAL wallet auth: fresh key, real SIWE challenge, real verify
  const tmpRoot = await createTempDir('q3gh-fidelity-ws');
  core.setWorkspacesRoot(tmpRoot);
  state.wallet = ethers.Wallet.createRandom();
  await claimOwner(tmpRoot, NEUMA_ID, state.wallet.address);
  const challengeRes = await fetch(`${base}/api/auth/challenge?address=${state.wallet.address}`);
  const { challenge } = await challengeRes.json();
  const signature = await state.wallet.signMessage(challenge);
  const verifyRes = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: state.wallet.address, signature, challenge }),
  });
  const { token } = await verifyRes.json();
  state.token = token;
  // negative probe: a wrong signature must NOT authenticate
  const badVerify = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: state.wallet.address, signature: await state.wallet.signMessage('wrong'), challenge }),
  });
  evidence.steps.auth = { challengeStatus: challengeRes.status, verifyStatus: verifyRes.status, badVerifyStatus: badVerify.status };

  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const seedBytes = await fsp.readFile(SEED_WAV);
  const seedB64 = seedBytes.toString('base64');

  // 4. consent-gated offering: the consent-negative probe must 400 first
  const startRes = await fetch(`${base}/api/v1/voice/forge/start`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ neumaId: NEUMA_ID, engine: 'qwen3', mode: 'clone' }),
  });
  const startBody = await startRes.json();
  state.sessionId = startBody.sessionId;

  const noConsent = await fetch(`${base}/api/v1/voice/forge/${state.sessionId}/offering`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ refAudioB64: seedB64 }),
  });
  const offeringRes = await fetch(`${base}/api/v1/voice/forge/${state.sessionId}/offering`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ refAudioB64: seedB64, consent: true, refText: 'real bench recording, witness-consented' }),
  });
  const offeringBody = await offeringRes.json();
  evidence.steps.forge = {
    startStatus: startRes.status, stage: startBody.stage,
    noConsentStatus: noConsent.status,
    offeringStatus: offeringRes.status, offeringStage: offeringBody.stage,
  };

  // 5. preview through the REAL route (route-level ensureReady + adapter)
  const previewRes = await fetch(`${base}/api/v1/voice/forge/${state.sessionId}/preview`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ text: RENDER_TEXT }),
  });
  const previewBuf = Buffer.from(await previewRes.arrayBuffer());
  await fsp.writeFile(PREVIEW_WAV, pcmToWav(previewBuf));
  evidence.steps.preview = {
    status: previewRes.status,
    format: previewRes.headers.get('x-audio-format'),
    sampleRate: Number(previewRes.headers.get('x-audio-sample-rate')),
    ...pcmStats(previewBuf),
  };

  // 6. seal — the real custody write (DNA + encrypted seed.wav)
  const sealRes = await fetch(`${base}/api/v1/voice/forge/${state.sessionId}/seal`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({}),
  });
  const sealBody = await sealRes.json();
  evidence.steps.seal = {
    status: sealRes.status, stage: sealBody.stage,
    provider: sealBody.sealedDNA?.engine?.provider,
    seedSource: sealBody.sealedDNA?.seed?.source,
    hasRefHash: Boolean(sealBody.sealedDNA?.seed?.refHash),
  };

  // 7. the SEALED voice speaks — needsInlineRef attaches seed.wav from custody
  const sealedDNA = await dnaSvc.getVoiceDNA(NEUMA_ID);
  state.sealedSummary = {
    provider: sealedDNA?.engine?.provider,
    seedConsent: sealedDNA?.seed?.consent,
    hasRefHash: Boolean(sealedDNA?.seed?.refHash),
  };
  state.renderSealed = await renderThroughAdapter(RENDER_TEXT, sealedDNA, RENDER_WAV);
  evidence.steps.renderSealed = state.renderSealed;

  // 8. different-voice CONTROL through the same engine
  const controlB64 = (await fsp.readFile(CONTROL_REF_WAV)).toString('base64');
  state.renderControl = await renderThroughAdapter(
    RENDER_TEXT,
    { neumaId: 'q3gh-fidelity-control', engine: { provider: 'qwen3' }, _inlineRefAudio: controlB64 },
    CONTROL_WAV,
  );
  evidence.steps.renderControl = { ref: 'voice-engines/_samples/parler-deep-male-seed1337.wav (different voice)', ...state.renderControl };

  // GPU released BEFORE the CPU metric runs
  await postShutdown();
  await waitHealthDown();
  em.shutdownAll();
  await sleep(2500);
  evidence.steps.gpuBeforeMetric = { gpuUsedMiB: await gpuUsedMiB(), portDark: !(await probeHealth()) };

  // 9. ECAPA-TDNN (S-6 harness, copied into this run's evidence dir; CPU)
  await fsp.copyFile(S6_ECAPA_SCRIPT, ECAPA_SCRIPT);
  const cosineJson = await sh(
    BENCH_PYTHON,
    [ECAPA_SCRIPT, SEED_WAV, RENDER_WAV, CONTROL_WAV, ANCHOR_WAV, path.join(WAVE3_DIR, 'ecapa-model')],
    { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
  );
  state.cosine = JSON.parse(cosineJson.trim().split('\n').at(-1));

  const pass = state.cosine.cos_minted >= FIDELITY_THRESHOLD
    && (state.cosine.cos_minted - state.cosine.cos_control) >= DISCRIMINATION_MARGIN;
  evidence.steps.ecapa = {
    ...state.cosine,
    preRegistered: { threshold: FIDELITY_THRESHOLD, discriminationMargin: DISCRIMINATION_MARGIN },
    margin: Math.round((state.cosine.cos_minted - state.cosine.cos_control) * 10000) / 10000,
    pass,
    fidelityUnverifiedLifts: pass,
    subject: 'seed=s2_smoke_b2.wav (consent-gated offering) · render=sealed-voice adapter render · control=different-voice qwen3 clone · anchor=s2_smoke_a.wav (same voice, different render)',
  };
}, 900_000);

afterAll(async () => {
  if (await probeHealth()) await postShutdown();
  try { state.server?.close(); } catch { /* already closed */ }
  em.shutdownAll();
  await waitHealthDown();
  await sleep(2000);
  evidence.steps.finalRelease = { gpuUsedMiB: await gpuUsedMiB(), portDark: !(await probeHealth()) };
  evidence.finishedAt = new Date().toISOString();
  await fsp.writeFile(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
}, 90_000);

describe('qwen3 Wave-3 — clone-fidelity ECAPA re-gate (real forge route, real seal, real adapter, real ECAPA)', () => {
  test('shipping path: real auth, consent gate, forge stages, sealed voice speaks through the real adapter', () => {
    expect(evidence.steps.auth.challengeStatus).toBe(200);
    expect(evidence.steps.auth.verifyStatus).toBe(200);
    expect(evidence.steps.auth.badVerifyStatus).toBe(401); // a wrong signature never authenticates

    expect(evidence.steps.forge.startStatus).toBe(200);
    expect(evidence.steps.forge.noConsentStatus).toBe(400); // the consent gate holds at offering time
    expect(evidence.steps.forge.offeringStatus).toBe(200);
    expect(evidence.steps.forge.offeringStage).toBe(2); // ITERATING

    expect(evidence.steps.preview.status).toBe(200);
    expect(evidence.steps.preview.format).toBe('pcm_s16le');
    expect(evidence.steps.preview.sampleRate).toBe(24000);
    expect(evidence.steps.preview.rms).toBeGreaterThan(0.01); // real speech, not silence

    expect(evidence.steps.seal.status).toBe(200);
    expect(evidence.steps.seal.stage).toBe(3); // SEALED
    expect(evidence.steps.seal.provider).toBe('qwen3');
    expect(evidence.steps.seal.hasRefHash).toBe(true); // the offering's seed.wav entered custody

    expect(state.sealedSummary.provider).toBe('qwen3');
    expect(state.sealedSummary.seedConsent).toBe(true);
    // The render succeeding at all PROVES the needsInlineRef seam attached the
    // sealed seed.wav — the qwen3 adapter throws on a ref-less clone turn.
    expect(state.renderSealed.finalSeen).toBe(true);
    expect(state.renderSealed.rms).toBeGreaterThan(0.01);
    expect(state.renderControl.finalSeen).toBe(true);
    expect(state.renderControl.rms).toBeGreaterThan(0.01);

    // Metric validation anchors — the SV metric itself is proven on this run.
    expect(state.cosine.cos_self).toBeGreaterThan(0.99);
    expect(state.cosine.cos_anchor).toBeGreaterThan(0.5); // same voice, different render
  });

  // THE FIDELITY GATE — pre-registered above, BEFORE any measurement. PASSED
  // on the first shipping-path run (2026-07-20: cos_minted 0.8032 ≥ 0.5,
  // margin 0.4876 ≥ 0.15); FIDELITY UNVERIFIED retired for qwen3. It began as
  // test.fails (the S-6 pattern); the pass flipped it red as designed, and it
  // is now a hard regression gate.
  test('FIDELITY GATE: qwen3 clone preserves the seed speaker through the shipping path (FIDELITY UNVERIFIED retired 2026-07-20)', () => {
    expect(state.cosine.cos_minted).toBeGreaterThanOrEqual(FIDELITY_THRESHOLD);
    expect(state.cosine.cos_minted - state.cosine.cos_control).toBeGreaterThanOrEqual(DISCRIMINATION_MARGIN);
  });
});
