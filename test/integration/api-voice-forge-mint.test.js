import express from 'express';
import request from 'supertest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { claimOwner } from '../helpers/claim-owner.js';

/**
 * Integration tests for the B-9 mint path (FR-15/FR-19): a clone-mode seal on
 * an embedding-voice engine (kyutai) mints the session's consent-gated
 * offering through the REAL sidecar /mint, re-parses the safetensors before
 * custody (guard 5), and stores it via the REAL saveEmbedding — encrypted at
 * rest, content-addressed, engine.embeddingRef advanced automatically.
 *
 * Real router, real orchestrator, real encrypted workspace on real tmp disk
 * (root repointed via the REAL setWorkspacesRoot — no workspace mock), real
 * kyutai sidecar over real loopback HTTP, and REAL auth (#390 tranche 4): a
 * witness with a real HMAC session token through the real requireAuth.
 * Nothing on the mint path is mocked.
 *
 * Gating: the positive proofs run only when the kyutai sidecar answers its
 * registry /health (boot it from the bench venv); the sidecar-DOWN proof runs
 * only when it does not. The no-op proof (non-embedding engine) runs always.
 *
 * Run:
 *   npx vitest run test/integration/api-voice-forge-mint.test.js
 */

// The mint endpoint comes from the frozen registry serve block — the same
// host:port engine-manager launches and the route posts to. Never hardcoded.
const { getEngine } = await import('../../backend/services/voice/engine-registry.js');
const KYUTAI_SERVE = getEngine('kyutai').serve;
const HEALTH_URL = `http://${KYUTAI_SERVE.host}:${KYUTAI_SERVE.port}${KYUTAI_SERVE.healthPath || '/health'}`;

const sidecarUp = () => {
  try {
    const out = execSync(`curl -sS --max-time 2 ${HEALTH_URL}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return JSON.parse(out).ok === true;
  } catch {
    return false;
  }
};

const UP = sidecarUp();
if (!UP) {
  console.warn(`[forge-mint] no kyutai sidecar at ${HEALTH_URL} — positive proofs skip, sidecar-down proof runs. Boot: KYUTAI_VOICE=<dev fixture> bench-env/bin/python voice-engines/kyutai/server.py`);
} else {
  console.warn(`[forge-mint] kyutai sidecar up at ${HEALTH_URL} — positive proofs run, sidecar-down proof skips.`);
}
const describeUp = UP ? describe : describe.skip;
const describeDown = UP ? describe.skip : describe;

// --- A real seed WAV, built in-test: 24 kHz mono s16 RIFF/PCM, speech-like ---
// harmonic stack (f0 + formants, vibrato, attack/release envelope) so the
// mimi encoder sees a non-degenerate signal. Two variants (A/B) with distinct
// f0 — an offering-dependent mint must yield DIFFERENT content addresses.
const buildSeedWav = ({ seconds = 4, f0 = 140, rate = 24000 }) => {
  const n = seconds * rate;
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const vibrato = 1 + 0.01 * Math.sin(2 * Math.PI * 5 * t);
    let s = 0;
    for (let h = 1; h <= 6; h++) s += (1 / h) * Math.sin(2 * Math.PI * f0 * vibrato * h * t);
    s *= 0.22 * Math.min(1, t / 0.02, (seconds - t) / 0.05); // envelope + level
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), i * 2);
  }
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
};

const SEED_A = buildSeedWav({ f0: 140 });
const SEED_B = buildSeedWav({ f0: 196 });

const buildApp = async () => {
  const { default: router } = await import('../../backend/routes/voice-forge-routes.js');
  const app = express();
  app.use('/api/v1/voice/forge', router);
  return app;
};

// Drive a real kyutai clone session start → offering to ITERATING over HTTP.
const driveKyutaiClone = async (app, witness, neumaId, seedWav) => {
  let r = await request(app)
    .post('/api/v1/voice/forge/start').set(witness.header)
    .send({ neumaId, engine: 'kyutai', mode: 'clone' });
  expect(r.status).toBe(200);
  const sessionId = r.body.sessionId;
  r = await request(app)
    .post(`/api/v1/voice/forge/${sessionId}/offering`).set(witness.header)
    .send({ refAudioB64: seedWav.toString('base64'), consent: true, refText: 'the witness seed clip' });
  expect(r.status).toBe(200);
  expect(r.body.stage).toBe(2); // ITERATING
  return sessionId;
};

// --- The mint gate as a pure predicate: the "no wasted mint" invariant is
// machine-locked HERE, across every stage/mode/engine combination — not by
// the route tests' status assertions, which cannot observe a discarded mint.
describe('shouldMintForSeal — the pure mint gate (machine-locks the no-wasted-mint invariant)', () => {
  let shouldMintForSeal, FORGE_MODES, FORGE_STAGES;
  beforeAll(async () => {
    ({ shouldMintForSeal } = await import('../../backend/routes/voice-forge-routes.js'));
    ({ FORGE_MODES, FORGE_STAGES } = await import('../../core/voice/voice-forge.js'));
  });

  const session = (stage, mode, offering) => ({ mode, stage, data: { offering } });
  const caps = { embeddingVoices: true };

  test('fires only for an ITERATING clone session with a validated offering', () => {
    expect(shouldMintForSeal(session(FORGE_STAGES.ITERATING, FORGE_MODES.CLONE, { refAudioB64: 'x' }), caps)).toBe(true);
  });

  test('never fires pre-offering, on a re-seal, for non-clone modes, for non-embedding engines, or without bytes', () => {
    expect(shouldMintForSeal(session(FORGE_STAGES.INIT ?? 0, FORGE_MODES.CLONE, null), caps)).toBe(false);
    expect(shouldMintForSeal(session(FORGE_STAGES.SEALED, FORGE_MODES.CLONE, { refAudioB64: 'x' }), caps)).toBe(false);
    expect(shouldMintForSeal(session(FORGE_STAGES.COMPLETE, FORGE_MODES.CLONE, { refAudioB64: 'x' }), caps)).toBe(false);
    expect(shouldMintForSeal(session(FORGE_STAGES.ITERATING, FORGE_MODES.PRESET, { voiceId: 'af_heart' }), caps)).toBe(false);
    expect(shouldMintForSeal(session(FORGE_STAGES.ITERATING, FORGE_MODES.DESIGN, { description: 'd' }), caps)).toBe(false);
    expect(shouldMintForSeal(session(FORGE_STAGES.ITERATING, FORGE_MODES.CLONE, { refAudioB64: 'x' }), { embeddingVoices: false })).toBe(false);
    expect(shouldMintForSeal(session(FORGE_STAGES.ITERATING, FORGE_MODES.CLONE, { refAudioB64: 'x' }), undefined)).toBe(false);
    expect(shouldMintForSeal(session(FORGE_STAGES.ITERATING, FORGE_MODES.CLONE, { refAudioB64: '' }), caps)).toBe(false);
  });
});

describe('B-9 mint path — POST /api/v1/voice/forge/:sessionId/seal on kyutai', () => {
  let app;
  let tmpRoot;
  let witness;

  beforeEach(async () => {
    vi.resetModules();
    // Imported AFTER resetModules so the witness mints its token from the
    // same auth.js instance the router will verify against — the token
    // secret is memoized per module instance, so a stale import would 401.
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    // Real workspace module, repointed at a real tmp root — no mock.
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'forge-mint-'));
    const { setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
    setWorkspacesRoot(tmpRoot);
    app = await buildApp();
  });

  afterEach(async () => {
    const { setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
    setWorkspacesRoot(null);
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
    vi.restoreAllMocks();
  });

  // Stage-contract proof (runs always — the mint gate must never fire before
  // the offering exists, and the stage 400 belongs to seal(), not to a null
  // dereference leaking as a 503).
  test('INIT-stage clone seal on kyutai gets the clean stage 400, never a mint TypeError/503', async () => {
    const neumaId = 'mint-neuma-init';
    await claimOwner(tmpRoot, neumaId, witness.address);
    mkdirSync(path.join(tmpRoot, neumaId, 'journal'), { recursive: true });
    // Start only — no offering, so the session sits at INIT (stage 0).
    const r0 = await request(app)
      .post('/api/v1/voice/forge/start').set(witness.header)
      .send({ neumaId, engine: 'kyutai', mode: 'clone' });
    expect(r0.status).toBe(200);
    const sessionId = r0.body.sessionId;

    const r = await request(app)
      .post(`/api/v1/voice/forge/${sessionId}/seal`).set(witness.header)
      .send({});

    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/ITERATING/i);
    expect(r.body.error).not.toMatch(/Cannot read properties/);
  });

  describeUp('real sidecar booted (positive)', () => {
    test('offering → seal → encrypted content-addressed embedding, embeddingRef advanced', async () => {
      const neumaId = 'mint-neuma-a';
      await claimOwner(tmpRoot, neumaId, witness.address);
      // The birth ceremony normally creates the journal dir; mirror that here.
      mkdirSync(path.join(tmpRoot, neumaId, 'journal'), { recursive: true });
      const sessionId = await driveKyutaiClone(app, witness, neumaId, SEED_A);

      const r = await request(app)
        .post(`/api/v1/voice/forge/${sessionId}/seal`).set(witness.header)
        .send({ firstUtterance: 'I speak with a minted voice.' });

      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.stage).toBe(4); // COMPLETE
      const ref = r.body.sealedDNA.engine.embeddingRef;
      expect(ref).toMatch(/^sha256:[0-9a-f]{64}$/);

      // The DNA persisted with the advanced ref (B-7 contract: saveEmbedding
      // advances engine.embeddingRef automatically after the DNA exists).
      const svc = await import('../../core/voice/voice-dna-service.js');
      const persisted = await svc.getVoiceDNA(neumaId);
      expect(persisted).not.toBeNull();
      expect(persisted.engine.provider).toBe('kyutai');
      expect(persisted.engine.embeddingRef).toBe(ref);
      expect(persisted.seed.consent).toBe(true);

      // Content-addressed custody: the file is named from the bytes' sha256…
      const embeddingPath = svc.voiceEmbeddingPath(neumaId, ref);
      expect(existsSync(embeddingPath)).toBe(true);
      expect(path.basename(embeddingPath)).toBe(`embedding-${ref.slice(7)}.safetensors`);

      // …encrypted at rest (the plaintext safetensors header never hits disk;
      // the file is a sealed envelope that only readEmbedding opens)…
      const rawOnDisk = readFileSync(embeddingPath);
      expect(rawOnDisk.toString('utf8')).not.toContain('speaker_wavs');
      // …and the round-tripped bytes are REAL minted safetensors whose sha256
      // IS the content address (guard-5 re-parse passes on the real output).
      const roundTrip = await svc.readEmbedding(neumaId, ref);
      const { validateMintedEmbedding } = await import('../../core/voice/voice-forge.js');
      expect(validateMintedEmbedding(roundTrip)).toEqual([]);
      expect('sha256:' + createHash('sha256').update(roundTrip).digest('hex')).toBe(ref);

      // The seal persisted the consent-gated offering audio itself (B-8 lane
      // preserved): seed.wav round-trips to EXACTLY the offered WAV.
      const seedRoundTrip = await svc.readSeedAudio(neumaId);
      expect(Buffer.from(seedRoundTrip).equals(SEED_A)).toBe(true);
    }, 90000); // first mint on a fresh sidecar can run long; warm mints are ~80 ms

    test('the mint consumes the session offering — two different offerings mint different voices', async () => {
      const neumaB = 'mint-neuma-b';
      await claimOwner(tmpRoot, neumaB, witness.address);
      const svc = await import('../../core/voice/voice-dna-service.js');

      const mintRefFor = async (neumaId, seedWav) => {
        const sessionId = await driveKyutaiClone(app, witness, neumaId, seedWav);
        const r = await request(app).post(`/api/v1/voice/forge/${sessionId}/seal`).set(witness.header).send({});
        expect(r.status).toBe(200);
        return (await svc.getVoiceDNA(neumaId)).engine.embeddingRef;
      };

      const refB = await mintRefFor(neumaB, SEED_B);
      // SEED_B's ref must differ from a re-mint of SEED_A — the minted voice
      // is a function of the consent-gated offering, not a default/constant.
      const neumaA2 = 'mint-neuma-a2';
      await claimOwner(tmpRoot, neumaA2, witness.address);
      const refA = await mintRefFor(neumaA2, SEED_A);
      expect(refB).toMatch(/^sha256:/);
      expect(refA).toMatch(/^sha256:/);
      expect(refA).not.toBe(refB);
    }, 90000);

    test('a re-seal of a sealed session gets the stage 400', async () => {
      const neumaId = 'mint-neuma-reseal';
      await claimOwner(tmpRoot, neumaId, witness.address);
      mkdirSync(path.join(tmpRoot, neumaId, 'journal'), { recursive: true });
      const sessionId = await driveKyutaiClone(app, witness, neumaId, SEED_A);

      const first = await request(app).post(`/api/v1/voice/forge/${sessionId}/seal`).set(witness.header).send({});
      expect(first.status).toBe(200);

      // Session is now SEALED (stage 3 — no firstUtterance passed) but retains
      // the offering. The "no second mint" invariant is machine-locked by the
      // pure shouldMintForSeal tests above (every stage/mode/engine
      // combination) and was watched live (sidecar /mint count: first-seals
      // only); this test pins the route's stage-400 contract on re-seal.
      const second = await request(app).post(`/api/v1/voice/forge/${sessionId}/seal`).set(witness.header).send({});
      expect(second.status).toBe(400);
      expect(second.body.error).toMatch(/ITERATING/i);
    }, 90000);
  });

  describeDown('sidecar down (negative)', () => {
    test('unreachable engine → bounded 503, no partial DNA write, session stays ITERATING', async () => {
      const neumaId = 'mint-neuma-down';
      await claimOwner(tmpRoot, neumaId, witness.address);
      const sessionId = await driveKyutaiClone(app, witness, neumaId, SEED_A);

      const r = await request(app)
        .post(`/api/v1/voice/forge/${sessionId}/seal`).set(witness.header)
        .send({ firstUtterance: 'never spoken' });

      expect(r.status).toBe(503);
      expect(r.body.error).toMatch(/unreachable|sidecar/i);

      // Forge semantics preserved: the mint failed BEFORE seal() ran — no
      // DNA, no seed, no embedding, nothing under the voice dir at all.
      const svc = await import('../../core/voice/voice-dna-service.js');
      expect(await svc.getVoiceDNA(neumaId)).toBeNull();
      expect(existsSync(svc.voiceSeedPath(neumaId))).toBe(false);
      const voiceDir = path.join(tmpRoot, neumaId, 'voice');
      expect(existsSync(voiceDir) ? readdirSync(voiceDir) : []).toEqual([]);

      // The session is untouched — still ITERATING, a retry is simply a re-seal.
      const state = await request(app).get(`/api/v1/voice/forge/${sessionId}`).set(witness.header);
      expect(state.status).toBe(200);
      expect(state.body.stage).toBe(2);
      expect(state.body.data.sealedDNA).toBeNull();
    }, 30000);
  });

  describe('guard 5 — re-parse before custody (runs always)', () => {
    test('a blob that fails the safetensors re-parse fails the seal with nothing on disk', async () => {
      const neumaId = 'mint-neuma-guard5';
      await claimOwner(tmpRoot, neumaId, witness.address);
      const sessionId = await driveKyutaiClone(app, witness, neumaId, SEED_A);

      // A "mint" that is not safetensors at all — the orchestrator's seal()
      // re-parses BEFORE any custody write (guard 5), so this must throw and
      // leave the world exactly as it was. Real orchestrator, real tmp disk.
      const { seal, getSession } = await import('../../core/voice/voice-forge.js');
      await expect(seal(sessionId, { embeddingBytes: Buffer.from('not safetensors at all') }))
        .rejects.toThrow(/invalid minted embedding/);

      expect(getSession(sessionId).stage).toBe(2); // still ITERATING — retry is a re-mint
      const svc = await import('../../core/voice/voice-dna-service.js');
      expect(await svc.getVoiceDNA(neumaId)).toBeNull();
      const voiceDir = path.join(tmpRoot, neumaId, 'voice');
      expect(existsSync(voiceDir) ? readdirSync(voiceDir) : []).toEqual([]);
    }, 30000);
  });

  describe('non-embedding engine (no-op, runs always)', () => {
    test('a zonos clone seal never touches the mint path — existing behavior preserved', async () => {
      const neumaId = 'mint-neuma-zonos';
      await claimOwner(tmpRoot, neumaId, witness.address);
      // Clone offering on an engine WITHOUT embeddingVoices. If the route
      // wrongly attempted a mint it would hit zonos's serve port (nothing
      // there in this test world) and 503 — a 200 here proves the no-op.
      let r = await request(app)
        .post('/api/v1/voice/forge/start').set(witness.header)
        .send({ neumaId, engine: 'zonos', mode: 'clone' });
      expect(r.status).toBe(200);
      const sessionId = r.body.sessionId;
      r = await request(app)
        .post(`/api/v1/voice/forge/${sessionId}/offering`).set(witness.header)
        .send({ refAudioB64: SEED_A.toString('base64'), consent: true });
      expect(r.status).toBe(200);

      r = await request(app).post(`/api/v1/voice/forge/${sessionId}/seal`).set(witness.header).send({});
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.sealedDNA.engine.embeddingRef ?? null).toBeNull();

      const svc = await import('../../core/voice/voice-dna-service.js');
      const persisted = await svc.getVoiceDNA(neumaId);
      expect(persisted.engine.provider).toBe('zonos');
      expect(persisted.engine.embeddingRef ?? null).toBeNull();
      // The seed still persists — clone seal behavior unchanged, mint or not.
      const seedRoundTrip = await svc.readSeedAudio(neumaId);
      expect(Buffer.from(seedRoundTrip).equals(SEED_A)).toBe(true);
    }, 30000);
  });
});
