/**
 * qwen3-engine-q3gh Wave-3 — the shipping-path live suite for the Qwen3-TTS
 * engine (substrate-live lane), plus the formal VoiceDesign determinism proof.
 *
 * Everything here runs the REAL stack: the real engine-manager
 * (backend/services/voice/engine-manager.js) spawning through the committed
 * registry (uv sync from the committed uv.lock — the production path; the
 * numpy<2.5 pin in pyproject.toml was proven to make BOTH a fresh resolve
 * (no lock) and sync-from-lock resolve cleanly, 2026-07-20), the
 * real tts-provider + qwen3 adapter, the
 * real Python sidecar on port 7867 on the real GPU (llama-server co-resident,
 * ~49 GiB baseline). No mock, stub, fake, or spy anywhere on any claimed path.
 * The operator's backend (3355) and any other sidecar are never touched — the
 * sidecar under test is spawned and released by this file alone.
 *
 * PRE-REGISTERED budgets and thresholds (written BEFORE the first run; fitted
 * afterwards would be worthless):
 *   - VRAM co-residency budget: qwen3 footprint (loaded − baseline) ≤ 16384 MiB
 *     (the 16 GB budget; B-20 measured 8610 MiB for both checkpoints)
 *   - Batch TTFB budgets (B-20 measured with llama co-resident): clone
 *     0.0341 s/char + ~0.8 s fixed, design 0.0485 s/char — asserted at 3× margin
 *     (budget assertions are BATCH budgets, never streaming, per the registry)
 *   - VoiceDesign determinism proof (formal): the SAME (text, description,
 *     seed) rendered TWICE through the real adapter. PRIMARY assertion:
 *     bitwise-identical PCM bytes (sha256 equal) — B-20's spot-check says the
 *     runtime is deterministic. FALLBACK (only if bytes differ): ECAPA-TDNN
 *     cosine(renderA, renderB) ≥ 0.90. The outcome is recorded verbatim; the
 *     UI copy strengthens or stays hedged on it.
 *   - Drain-inactivity semantics: the DRAIN-phase watchdog trips at 120 s of
 *     no-chunk-progress (sidecar contract, B-20), never a total-turn cap —
 *     asserted as: trip lands in [110 s, 200 s] after the stall begins, then a
 *     fresh request succeeds.
 *
 * Proofs, in order:
 *   1. non-loopback refusal — a throwaway 0.0.0.0 registry entry makes the
 *      REAL launch() throw BEFORE any process/GPU spend
 *   2. real ensureReady('qwen3') through the engine-manager — state
 *      transitions sampled and recorded; /health shape; VRAM co-residency
 *      measured against the budget above
 *   3. clone render — RAW sidecar contract (200, X-Audio-* headers, uniform
 *      3840 B / 80 ms frames) AND the real adapter path (tts.synthesize)
 *   4. design render through the real adapter (description + seed)
 *   5. FORMAL VoiceDesign determinism proof (see thresholds above)
 *   6. disconnect-cut mid-generation → the next request succeeds (rc 200)
 *   7. watchdog GENERATION trip on a tuned short deadline (env-tuned sidecar
 *      boot through the manager) → 500 with the watchdog body → recovery 200;
 *      then a clean default re-boot for the remaining legs
 *   8. DRAIN-phase inactivity trip per the sidecar's semantics (see above)
 *   9. bounded-input rejection battery (15 cases, expect == got)
 *  10. clean /shutdown with the VRAM release measured in nvidia-smi
 *
 * Measured numbers accumulate into `evidence` and are written to
 * .waves/runs/qwen3-engine-q3gh/wave-3/qwen3-live-evidence.json by afterAll —
 * the deliverable quotes that file, not memory.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { shouldRunGpuEngineTests, gpuSkipNote } from '../helpers/gpu-optin.js';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  QWEN3_ENDPOINT, sleep, sh, gpuUsedMiB, qwen3Pids, probeHealth, postShutdown,
  shutdownUntilDark, waitHealthDown, sha256, rawPostNoTimeout, rawSynthesize,
  renderThroughAdapter, pcmToWav, makeWav,
} from '../helpers/qwen3-sidecar-kit.js';

const em = await import('../../backend/services/voice/engine-manager.js');
const registry = await import('../../backend/services/voice/engine-registry.js');
const tts = await import('../../backend/services/tts-provider.js');

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const WAVE3_DIR = path.join(REPO_ROOT, '.waves', 'runs', 'qwen3-engine-q3gh', 'wave-3');
const EVIDENCE_PATH = path.join(WAVE3_DIR, 'qwen3-live-evidence.json');
const SIDECAR_LOG = path.join(REPO_ROOT, 'voice-engines', '_logs', 'qwen3.log');
const BENCH_PYTHON = path.join(
  REPO_ROOT, '.waves', 'runs', 'sesame-class-voice-0y39', 'wave-2', 'bench-env', 'bin', 'python',
);
const CLONE_REF_WAV = path.join(
  REPO_ROOT, '.waves', 'runs', 'kyutai-engine-phase1-srex', 'wave-1', 'spike-out', 's2_smoke_a.wav',
);
const CONTROL_REF_WAV = path.join(REPO_ROOT, 'voice-engines', '_samples', 'parler-deep-male-seed1337.wav');
const ECAPA_SCRIPT = path.join(REPO_ROOT, '.waves', 'runs', 'kyutai-engine-phase1-srex', 'wave-3', 'ecapa_cosine.py');

// Pre-registered (see header): budgets and thresholds, fixed before any run.
const VRAM_BUDGET_MIB = 16384;
const CLONE_S_PER_CHAR = 0.0341;
const CLONE_FIXED_S = 0.8;
const DESIGN_S_PER_CHAR = 0.0485;
const BUDGET_MARGIN = 3;
const DETERMINISM_ECAPA_FLOOR = 0.9;
const DRAIN_TRIP_MIN_MS = 110_000;
const DRAIN_TRIP_MAX_MS = 200_000;

const DESIGN_TEXT = 'The gateway opens, and the void answers with a voice that was designed, not found.';
const DESIGN_DESCRIPTION = 'A warm, measured female voice with a slight metallic edge and unhurried pacing.';
const DESIGN_SEED = 42;

const evidence = { startedAt: new Date().toISOString(), steps: {} };
const state = {}; // cross-test artifacts (determinism compares against the t4 render)

// --- helpers live in test/helpers/qwen3-sidecar-kit.js (size-law extraction) ---

const cloneDNA = (refB64) => ({
  neumaId: 'q3gh-live', engine: { provider: 'qwen3' }, _inlineRefAudio: refB64,
});
const designDNA = () => ({
  neumaId: 'q3gh-live',
  engine: { provider: 'qwen3', description: DESIGN_DESCRIPTION, voiceSeed: DESIGN_SEED },
});

beforeAll(async () => {
  await fsp.mkdir(WAVE3_DIR, { recursive: true });
  // Clean slate on 7867. Anything answering here is a leftover from this
  // program's own earlier runs (the operator's backend on 3355 and other
  // engines' sidecars are different processes and are never touched).
  if (await probeHealth()) {
    evidence.steps.preclean = 'leftover qwen3 sidecar shut down for a clean from-scratch spawn';
    await postShutdown();
    await waitHealthDown();
  }
  state.cloneRefB64 = (await fsp.readFile(CLONE_REF_WAV)).toString('base64');
  state.controlRefB64 = (await fsp.readFile(CONTROL_REF_WAV)).toString('base64');
  evidence.steps.baseline = { gpuUsedMiB: await gpuUsedMiB(), qwen3Pids: await qwen3Pids() };
  tts.setConfig({ provider: 'qwen3', endpoint: QWEN3_ENDPOINT, apiKey: '' });
}, 60_000);

afterAll(async () => {
  // Release discipline: nothing this file spawned may hold VRAM afterwards.
  if (await probeHealth()) await postShutdown();
  em.shutdownAll();
  await waitHealthDown();
  await sleep(2500); // cuda teardown settle
  evidence.steps.finalRelease = { gpuUsedMiB: await gpuUsedMiB(), qwen3Pids: await qwen3Pids() };
  evidence.finishedAt = new Date().toISOString();
  await fsp.writeFile(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
}, 90_000);

if (!shouldRunGpuEngineTests()) console.warn(gpuSkipNote('qwen3 engine live suite'));
describe.skipIf(!shouldRunGpuEngineTests())('qwen3 Wave-3 live suite (real engine-manager, real sidecar, real GPU)', () => {
  test('1. non-loopback registry entry is refused by the REAL launch() before any process/GPU spend', async () => {
    const qwen3 = registry.getEngine('qwen3');
    const originalHost = qwen3.serve.host;
    const pidsBefore = await qwen3Pids();
    const vramBefore = await gpuUsedMiB();

    qwen3.serve.host = '0.0.0.0'; // throwaway registry entry, in-process only, restored below
    let thrown = null;
    try {
      await em.launch('qwen3', { skipSync: true });
    } catch (err) {
      thrown = err.message;
    } finally {
      qwen3.serve.host = originalHost;
    }

    const pidsAfter = await qwen3Pids();
    const vramAfter = await gpuUsedMiB();
    evidence.steps.nonLoopbackRefusal = {
      thrown, pidsBefore, pidsAfter, vramBefore, vramAfter, restoredHost: qwen3.serve.host,
    };

    expect(thrown).toMatch(/non-loopback/);
    expect(qwen3.serve.host).toBe('127.0.0.1');
    expect(pidsAfter).toEqual(pidsBefore); // zero process spend
    expect(Math.abs(vramAfter - vramBefore)).toBeLessThanOrEqual(64); // zero GPU spend (baseline jitter only)
  }, 60_000);

  test('2. real ensureReady through the engine-manager — transitions recorded; health shape; VRAM co-residency within budget', async () => {
    const seen = [];
    let last = null;
    const t0 = Date.now();
    const sampler = setInterval(() => {
      const s = em.getStatus('qwen3')?.state;
      if (s && s !== last) { seen.push({ state: s, atMs: Date.now() - t0 }); last = s; }
    }, 100);

    const vramBaseline = evidence.steps.baseline.gpuUsedMiB;
    await em.ensureReady('qwen3', 600_000); // boot syncs from the committed uv.lock — the production path
    clearInterval(sampler);
    const st = em.getStatus('qwen3');
    if (st.state && st.state !== last) seen.push({ state: st.state, atMs: Date.now() - t0 });

    const health = await probeHealth();
    const vramLoaded = await gpuUsedMiB();
    const footprintMiB = vramLoaded - vramBaseline;
    evidence.steps.ensureReady = {
      bootWallMs: Date.now() - t0,
      transitions: seen,
      status: { state: st.state, pid: st.pid, port: st.port, host: st.host, downloaded: st.downloaded },
      health,
      vramBaseline, vramLoaded, footprintMiB, budgetMiB: VRAM_BUDGET_MIB,
    };

    expect(st.state).toBe('ready');
    expect(st.downloaded).toBe(true);
    const states = seen.map((t) => t.state);
    expect(states).toContain('ready');
    expect(states.some((s) => s === 'syncing' || s === 'launching')).toBe(true); // a real launch, not an instant adopt

    expect(health?.ok).toBe(true);
    expect(health.device).toBe('cuda');
    expect(health.sample_rate).toBe(24000);
    expect(typeof health.idle_seconds).toBe('number');
    expect(typeof health.busy).toBe('boolean');

    // VRAM co-residency: the two-checkpoint footprint fits the 16 GB budget
    // alongside the co-resident llama-server (pre-registered bound).
    expect(footprintMiB).toBeLessThanOrEqual(VRAM_BUDGET_MIB);
    expect(footprintMiB).toBeGreaterThan(1000); // a real model actually loaded
  }, 660_000);

  test('3. clone render — RAW sidecar contract AND the real adapter path', async () => {
    const text = 'The gateway opens, and the void answers in a human voice.';
    const budgetMs = BUDGET_MARGIN * (CLONE_FIXED_S + CLONE_S_PER_CHAR * text.length) * 1000;

    // RAW contract leg: exact sidecar wire shape, unadapted.
    const raw = await rawSynthesize({ text, ref_audio_b64: state.cloneRefB64 });
    const rawBytes = raw.chunks.reduce((n, c) => n + c.bytes, 0);
    evidence.steps.cloneRaw = {
      headers: raw.headers,
      chunkCount: raw.chunks.length,
      chunkSizes: [...new Set(raw.chunks.map((c) => c.bytes))],
      note: 'the sidecar emits uniform 80 ms (3840 B) frames; loopback TCP legitimately COALESCES them in the client reader (observed multiples of 3840) — the transport-truthful invariant is overall frame alignment',
      totalBytes: rawBytes,
      firstChunkMs: raw.chunks[0]?.atMs,
      totalMs: raw.totalMs,
      budgetMs: Math.round(budgetMs),
    };
    expect(raw.headers.status).toBe(200);
    expect(raw.headers.format).toBe('pcm_s16le');
    expect(raw.headers.sampleRate).toBe(24000);
    expect(raw.headers.channels).toBe(1);
    expect(raw.headers.cacheControl).toBe('no-store');
    expect(raw.chunks.length).toBeGreaterThan(3);
    expect(rawBytes).toBeGreaterThan(0);
    expect(rawBytes % 3840).toBe(0); // whole 80 ms frames, nothing partial
    expect(raw.chunks[0].atMs).toBeLessThan(budgetMs); // batch TTFB budget (never streaming)

    // Shipping leg: the real adapter path with the inline-ref seam.
    const viaAdapter = await renderThroughAdapter({ text, voiceDNA: cloneDNA(state.cloneRefB64) });
    evidence.steps.cloneAdapter = { ...viaAdapter, pcm: undefined, budgetMs: Math.round(budgetMs) };
    expect(viaAdapter.finalSeen).toBe(true);
    expect(viaAdapter.bytes).toBeGreaterThan(0);
    expect(viaAdapter.bytes % 2).toBe(0);
    expect(viaAdapter.rms).toBeGreaterThan(0.01); // real speech, not silence
    expect(viaAdapter.firstChunkMs).toBeLessThan(budgetMs);
  }, 180_000);

  test('4. design render through the real adapter (description + seed)', async () => {
    const budgetMs = BUDGET_MARGIN * (DESIGN_S_PER_CHAR * DESIGN_TEXT.length) * 1000;
    const viaAdapter = await renderThroughAdapter({ text: DESIGN_TEXT, voiceDNA: designDNA() });
    state.designRenderT4 = viaAdapter.pcm; // third determinism sample (cross-interleaving)
    evidence.steps.designAdapter = {
      ...viaAdapter, pcm: undefined, budgetMs: Math.round(budgetMs),
      text: DESIGN_TEXT, description: DESIGN_DESCRIPTION, seed: DESIGN_SEED,
    };
    expect(viaAdapter.finalSeen).toBe(true);
    expect(viaAdapter.bytes).toBeGreaterThan(0);
    expect(viaAdapter.rms).toBeGreaterThan(0.01);
    expect(viaAdapter.firstChunkMs).toBeLessThan(budgetMs);
  }, 180_000);

  test('5. FORMAL VoiceDesign determinism proof — same (text, description, seed) twice through the real adapter', async () => {
    const renderA = await renderThroughAdapter({ text: DESIGN_TEXT, voiceDNA: designDNA() });
    const renderB = await renderThroughAdapter({ text: DESIGN_TEXT, voiceDNA: designDNA() });
    const wavA = path.join(WAVE3_DIR, 'determinism-render-a.wav');
    const wavB = path.join(WAVE3_DIR, 'determinism-render-b.wav');
    await fsp.writeFile(wavA, pcmToWav(renderA.pcm));
    await fsp.writeFile(wavB, pcmToWav(renderB.pcm));

    const proof = {
      path: 'real tts.synthesize adapter (the shipping speak path)',
      text: DESIGN_TEXT, description: DESIGN_DESCRIPTION, seed: DESIGN_SEED,
      bytesA: renderA.bytes, bytesB: renderB.bytes,
      sha256A: sha256(renderA.pcm), sha256B: sha256(renderB.pcm),
      sha256T4: sha256(state.designRenderT4),
      preRegistered: { primary: 'bitwise-identical PCM bytes', fallbackEcapaFloor: DETERMINISM_ECAPA_FLOOR },
    };
    proof.bitwiseIdentical = proof.sha256A === proof.sha256B;
    proof.crossInterleavingIdentical = proof.sha256A === proof.sha256T4; // t4's render sat behind two clone turns

    if (proof.bitwiseIdentical) {
      proof.outcome = 'BITWISE IDENTICAL — the VoiceDesign runtime is deterministic; the UI copy may strengthen';
    } else {
      // Pre-registered fallback: equivalence by speaker-embedding cosine.
      const cosineJson = await sh(
        BENCH_PYTHON,
        [ECAPA_SCRIPT, wavA, wavB, CONTROL_REF_WAV, wavA, path.join(WAVE3_DIR, 'ecapa-model-determinism')],
        { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
      );
      const cosine = JSON.parse(cosineJson.trim().split('\n').at(-1));
      proof.ecapaFallback = { ...cosine, floor: DETERMINISM_ECAPA_FLOOR, pass: cosine.cos_minted >= DETERMINISM_ECAPA_FLOOR };
      proof.outcome = proof.ecapaFallback.pass
        ? `NOT bitwise — equivalent by ECAPA cos ${cosine.cos_minted} ≥ ${DETERMINISM_ECAPA_FLOOR}; the UI copy stays hedged`
        : `NOT bitwise and ECAPA cos ${cosine.cos_minted} < ${DETERMINISM_ECAPA_FLOOR} — determinism claim FAILS`;
    }
    evidence.steps.determinism = proof;

    expect(renderA.finalSeen && renderB.finalSeen).toBe(true);
    expect(renderA.rms).toBeGreaterThan(0.01);
    expect(renderA.bytes).toBe(renderB.bytes);
    if (proof.bitwiseIdentical) {
      expect(proof.sha256A).toBe(proof.sha256B);
      expect(proof.crossInterleavingIdentical).toBe(true);
    } else {
      expect(proof.ecapaFallback.pass).toBe(true);
    }
  }, 420_000);

  test('6. disconnect-cut mid-generation — the next request succeeds', async () => {
    // 952-char clone ≈ 33 s of generation (B-20 measured rate): long enough to
    // cut during the first-frame wait, batch-bounded afterwards.
    const longText = 'Sentence one of a deliberately long turn for the cut. '.repeat(17);
    const ac = new AbortController();
    const cut = (async () => {
      let err = null;
      try {
        for await (const chunk of tts.synthesize({ text: longText, voiceDNA: cloneDNA(state.cloneRefB64), signal: ac.signal })) {
          void chunk; // the cut lands during generation — no chunk should ever arrive
        }
      } catch (e) { err = e.message; }
      return err;
    })();
    await sleep(3000); // mid-generation (TTFB ≈ 33 s — no frame has arrived)
    ac.abort();
    const abortError = await cut;

    // The zombie turn completes server-side (a batch generation cannot notice
    // a cut until frames exist); the next request queues behind it and lands.
    const next = await rawSynthesize({ text: 'The voice returns after the cut.', ref_audio_b64: state.cloneRefB64 });
    const pcmBytes = next.chunks.reduce((n, c) => n + c.bytes, 0);
    evidence.steps.disconnectRecovery = {
      abortError,
      nextStatus: next.headers.status,
      nextTotalMs: next.totalMs,
      nextBytes: pcmBytes,
    };

    expect(String(abortError)).toMatch(/abort/i);
    expect(next.headers.status).toBe(200); // rc=0 on the very next request
    expect(pcmBytes).toBeGreaterThan(0);
  }, 240_000);

  test('7. watchdog GENERATION trip on a tuned short deadline → 500 with the watchdog body → recovery 200', async () => {
    // Reboot the sidecar through the manager with the watchdog curve tuned to
    // a 1 s base + 1 ms/char (env rides the manager's spawn): a healthy 476-char
    // generation (~23 s) then provably exceeds its ~1.5 s deadline. The first
    // shutdown races test 6's recent activity — retry per the reap contract.
    const down1 = await shutdownUntilDark();
    expect(down1.dark).toBe(true);
    process.env.QWEN3_GEN_BASE_S = '1';
    process.env.QWEN3_GEN_PER_CHAR_S = '0.001';
    try {
      await em.ensureReady('qwen3', 300_000);
    } finally {
      delete process.env.QWEN3_GEN_BASE_S;
      delete process.env.QWEN3_GEN_PER_CHAR_S;
    }

    const text476 = 'The void keeps listening while the voice keeps speaking. '.repeat(8).slice(0, 476);
    const tripped = await rawSynthesize({ text: text476, description: DESIGN_DESCRIPTION, seed: DESIGN_SEED });

    // Recovery: the lock is released after the bounded join; a fresh request lands.
    const recovery = await rawSynthesize({ text: 'Recovery after the watchdog.', ref_audio_b64: state.cloneRefB64 });
    const logTail = await fsp.readFile(SIDECAR_LOG, 'utf8').then((s) => s.split('\n').filter((l) => l.includes('watchdog') || l.includes('deadline') || l.includes('abandon')).slice(-4)).catch(() => []);
    evidence.steps.watchdogTrip = {
      tunedEnv: { QWEN3_GEN_BASE_S: '1', QWEN3_GEN_PER_CHAR_S: '0.001' },
      shutdownPosts: down1.posts,
      chars: text476.length,
      tripStatus: tripped.headers.status,
      tripBody: tripped.errorBody,
      tripWallMs: tripped.totalMs,
      recoveryStatus: recovery.headers.status,
      recoveryWallMs: recovery.totalMs,
      logTail,
    };

    expect(tripped.headers.status).toBe(500);
    expect(tripped.errorBody).toMatch(/batch watchdog/);
    expect(recovery.headers.status).toBe(200);

    // Restore the default-curve sidecar for the remaining legs.
    const down2 = await shutdownUntilDark();
    expect(down2.dark).toBe(true);
    await em.ensureReady('qwen3', 300_000);
    expect((await probeHealth())?.ok).toBe(true);
  }, 420_000);

  test('8. DRAIN-phase inactivity trip per the sidecar semantics — 120 s no-progress stall, then recovery', async () => {
    // 3185-char clone ≈ 8.1 MB of audio > the 4 MB kernel tcp_wmem: reading ONE
    // chunk then holding stalls the drain for real (B-20's proven recipe). The
    // raw http.request carries NO client-side timeout — an undici headers
    // timeout here once orphaned a server-side turn into a real (recovered)
    // default-curve watchdog trip, v3 evidence.
    const text3240 = 'The void listens while the voice keeps speaking. '.repeat(65).slice(0, 3240);
    const t0 = performance.now();
    const response = await rawPostNoTimeout({ text: text3240, ref_audio_b64: state.cloneRefB64 });
    const genMs = Math.round(performance.now() - t0); // batch: headers land when generation completes
    expect(response.statusCode).toBe(200);
    const firstChunk = await new Promise((resolve) => response.once('data', resolve));
    expect(firstChunk.length).toBeGreaterThan(0);
    response.pause(); // read ONE chunk, then hold — the drain stalls here
    const stallStart = performance.now();

    // /health polls do NOT touch the drain-progress stamps (server.py: the
    // drain watchdog reads only per-chunk last_progress) — busy stays true
    // until the watchdog forces the release at 120 s of no progress.
    let tripMs = null;
    while (performance.now() - stallStart < DRAIN_TRIP_MAX_MS + 30_000) {
      const h = await probeHealth();
      if (h && h.busy === false) { tripMs = Math.round(performance.now() - stallStart); break; }
      await sleep(5000);
    }
    response.destroy(); // client-side cleanup of the dead stream

    const recovery = await rawSynthesize({ text: 'The voice returns after the stalled drain.', ref_audio_b64: state.cloneRefB64 });
    evidence.steps.drainInactivity = {
      chars: text3240.length,
      generationMs: genMs,
      stallTripMs: tripMs,
      semantics: `DRAIN-phase inactivity trip, expected in [${DRAIN_TRIP_MIN_MS}, ${DRAIN_TRIP_MAX_MS}] ms of no chunk progress — never a total-turn cap`,
      recoveryStatus: recovery.headers.status,
      recoveryTotalMs: recovery.totalMs,
    };

    expect(tripMs).not.toBeNull();
    expect(tripMs).toBeGreaterThanOrEqual(DRAIN_TRIP_MIN_MS);
    expect(tripMs).toBeLessThanOrEqual(DRAIN_TRIP_MAX_MS);
    expect(recovery.headers.status).toBe(200);
  }, 900_000);

  test('9. bounded-input rejection battery (expect == got)', async () => {
    const cases = [
      ['text 4001 chars → 422', { text: 'x'.repeat(4001), ref_audio_b64: state.cloneRefB64 }, 422],
      ['empty text → 422', { text: '', ref_audio_b64: state.cloneRefB64 }, 422],
      ['description 2001 chars → 422', { text: 'hello there', description: 'x'.repeat(2001), seed: 1 }, 422],
      ['seed −1 → 422', { text: 'hello there', description: DESIGN_DESCRIPTION, seed: -1 }, 422],
      ['seed 2^31 → 422', { text: 'hello there', description: DESIGN_DESCRIPTION, seed: 2 ** 31 }, 422],
      ['seed "abc" → 422', { text: 'hello there', description: DESIGN_DESCRIPTION, seed: 'abc' }, 422],
      ['clone without ref → 400', { text: 'hello there' }, 400],
      ['design + ref → 400', { text: 'hello there', description: DESIGN_DESCRIPTION, seed: 1, ref_audio_b64: state.cloneRefB64 }, 400],
      ['design without seed → 400', { text: 'hello there', description: DESIGN_DESCRIPTION }, 400],
      ['preset voice id → 400 (no preset voices)', { text: 'hello there', ref_audio_b64: state.cloneRefB64, voice: 'af_heart' }, 400],
      ['bad base64 → 400', { text: 'hello there', ref_audio_b64: '!!!not-base64!!!' }, 400],
      ['ref WAV 0.5 s → 400', { text: 'hello there', ref_audio_b64: makeWav({ seconds: 0.5 }).toString('base64') }, 400],
      ['ref WAV 8-bit → 400', { text: 'hello there', ref_audio_b64: makeWav({ seconds: 3, bits: 8 }).toString('base64') }, 400],
      ['ref_path traversal → 400', { text: 'hello there', ref_path: '../../../etc/passwd' }, 400],
      ['ref_path not-installed → 400', { text: 'hello there', ref_path: 'no-such-voice.wav' }, 400],
    ];
    const results = [];
    for (const [name, body, want] of cases) {
      const r = await rawSynthesize(body);
      const got = r.headers.status;
      results.push({ name, want, got, detailLen: r.errorBody?.length ?? 0, pass: got === want });
    }
    evidence.steps.boundedBattery = results;
    for (const r of results) {
      expect(r.got, `${r.name} — want ${r.want}, got ${r.got}`).toBe(r.want);
      expect(r.detailLen).toBeLessThanOrEqual(300); // bounded error bodies, never the payload
    }
  }, 120_000);

  test('10. clean /shutdown — port dark, process gone, VRAM release measured', async () => {
    const vramLoaded = await gpuUsedMiB();
    const pidsLoaded = await qwen3Pids();
    expect(pidsLoaded.length).toBeGreaterThan(0);

    const res = await fetch(`${QWEN3_ENDPOINT}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(3000) })
      .then((r) => r.json().catch(() => null)).catch(() => null);
    // The deferred-exit guard aborts a reap racing the battery's recent
    // activity — retry per the reap contract until the port is dark.
    const down = await shutdownUntilDark();
    const portDark = down.dark;
    await sleep(3000); // cuda teardown settle
    const vramAfter = await gpuUsedMiB();
    const pidsAfter = await qwen3Pids();

    evidence.steps.cleanShutdown = {
      shutdownResponse: res,
      portDark,
      shutdownPosts: down.posts,
      pidsLoaded, pidsAfter,
      vramLoaded, vramAfter,
      releasedMiB: vramLoaded - vramAfter,
      vramBaseline: evidence.steps.baseline.gpuUsedMiB,
      driftFromBaselineMiB: vramAfter - evidence.steps.baseline.gpuUsedMiB,
    };

    expect(res?.shutting_down ?? res?.ok).toBeTruthy();
    expect(portDark).toBe(true);
    expect(pidsAfter).toEqual([]);
    expect(vramLoaded - vramAfter).toBeGreaterThan(4000); // the model's GiBs actually left the GPU
    expect(Math.abs(vramAfter - evidence.steps.baseline.gpuUsedMiB)).toBeLessThanOrEqual(1024); // back to the llama-only baseline
  }, 120_000);
});
