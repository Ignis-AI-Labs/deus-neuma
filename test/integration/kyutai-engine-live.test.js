/**
 * S-5 — Phase-1 Rule-0 live suite for the Kyutai engine (substrate-live lane).
 *
 * Everything here runs the REAL stack: the real engine-manager
 * (backend/services/voice/engine-manager.js), the real tts-provider + kyutai
 * adapter, the real Python sidecar process on the real GPU. No mock, stub,
 * fake, or spy anywhere on any claimed path. The operator's backend (3355)
 * and llama-server are never touched — the sidecar under test is spawned and
 * released by this file alone.
 *
 * Proofs, in order:
 *   1. non-loopback refusal — a throwaway registry entry at 0.0.0.0 makes the
 *      REAL launch() throw BEFORE any process/GPU spend (B-6 guard)
 *   2. real ensureReady('kyutai') spawn in a child "backend A" — state
 *      transitions (syncing/launching/ready) sampled and recorded; then the
 *      child is SIGKILLed — a real backend kill
 *   3. orphan adoption — this process ("backend B") ensureReady() ADOPTS the
 *      still-running sidecar (adopted:true, pid:null), same sidecar PID set,
 *      no double-spawn
 *   4. /synthesize incremental arrival — real fetch reader, per-chunk
 *      timestamps; cold + warm first-chunk ms measured and recorded
 *   5. abort mid-stream through the REAL tts.synthesize adapter path — the
 *      stream terminates, the sidecar survives, a second turn succeeds
 *      (supervisor-teardown regression proof)
 *   6. idle-reap — reapIdleEngines(short TTL) shuts the sidecar down and the
 *      VRAM drop is watched in nvidia-smi (MiB before/after recorded)
 *   7. no-migration Zonos-DNA parity — a pre-program Zonos Voice DNA (seed
 *      metadata only, zero kyutai fields) synthesizes through the SAME
 *      provider path against the REAL zonos sidecar; then all five legacy
 *      adapters answer honest testConnection checks (unrunnable legs are
 *      recorded, never faked green)
 *
 * Measured numbers are accumulated into `evidence` and written to
 * .waves/runs/kyutai-engine-phase1-srex/wave-3/s5-live-evidence.json by
 * afterAll — the deliverable quotes that file, not memory.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';

const em = await import('../../backend/services/voice/engine-manager.js');
const registry = await import('../../backend/services/voice/engine-registry.js');
const tts = await import('../../backend/services/tts-provider.js');
const { adapters } = await import('../../backend/services/voice/providers/index.js');
const core = await import('../../core/index.js');
const dnaSvc = await import('../../core/voice/voice-dna-service.js');

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const WAVE3_DIR = path.join(REPO_ROOT, '.waves', 'runs', 'kyutai-engine-phase1-srex', 'wave-3');
const EVIDENCE_PATH = path.join(WAVE3_DIR, 's5-live-evidence.json');
const KYUTAI_ENDPOINT = 'http://127.0.0.1:7866';
const ZONOS_ENDPOINT = 'http://127.0.0.1:7860';
const SEED_WAV = path.join(
  REPO_ROOT, '.waves', 'runs', 'kyutai-engine-phase1-srex', 'wave-1', 'spike-out', 's2_smoke_b2.wav',
);

const evidence = { startedAt: new Date().toISOString(), steps: {} };

// --- helpers (all impure: real process / real GPU / real HTTP) ---

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sh = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }));
      else resolve(stdout.trim());
    });
  });

const gpuUsedMiB = async () =>
  Number(await sh('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits']));

// impure — PIDs (uv wrapper + python child) of every kyutai sidecar, sorted
const kyutaiPids = async () => {
  try {
    const out = await sh('pgrep', ['-f', 'voice-engines/kyutai/server\\.py']);
    return out.split('\n').map(Number).sort((a, b) => a - b);
  } catch {
    return []; // pgrep exits 1 on no match
  }
};

const probeHealth = async (endpoint) => {
  try {
    const r = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    return data?.ok === true ? data : null;
  } catch {
    return null;
  }
};

const postShutdown = async (endpoint) => {
  try {
    await fetch(`${endpoint}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) });
  } catch { /* dropping the socket mid-exit IS the shutdown */ }
};

const waitHealthDown = async (endpoint, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await probeHealth(endpoint))) return true;
    await sleep(500);
  }
  return false;
};

// impure — one real POST /synthesize against the running sidecar, per-chunk timestamps
const timedSynthesize = async (text) => {
  const t0 = performance.now();
  const response = await fetch(`${KYUTAI_ENDPOINT}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const headers = {
    status: response.status,
    format: response.headers.get('x-audio-format'),
    sampleRate: Number(response.headers.get('x-audio-sample-rate')),
    channels: Number(response.headers.get('x-audio-channels')),
    cacheControl: response.headers.get('cache-control'),
  };
  const reader = response.body.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push({ bytes: value.length, atMs: Math.round((performance.now() - t0) * 10) / 10 });
  }
  return { headers, chunks, totalMs: Math.round((performance.now() - t0) * 10) / 10 };
};

const pcmStats = (chunks, sampleRate = 24000) => {
  // chunks are adapter AudioChunks — concat bytes and measure as s16le
  const total = chunks.reduce((n, c) => n + c.bytes.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c.bytes, off); off += c.bytes.length; }
  const view = new Int16Array(buf.buffer, 0, Math.floor(total / 2));
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < view.length; i++) {
    const a = Math.abs(view[i]) / 32768;
    if (a > peak) peak = a;
    sumSq += a * a;
  }
  return {
    bytes: total,
    samples: view.length,
    seconds: Math.round((view.length / sampleRate) * 100) / 100,
    peak: Math.round(peak * 100000) / 100000,
    rms: Math.round(Math.sqrt(sumSq / view.length) * 100000) / 100000,
  };
};

// impure — run "backend A": a real node process that ensureReady()s kyutai,
// prints every observed manager state transition as NDJSON, then SIGKILLs
// itself WITHOUT shutdownAll — a real backend kill that orphans the sidecar.
const CHILD_SCRIPT = `
const em = await import(${JSON.stringify(path.join(REPO_ROOT, 'backend/services/voice/engine-manager.js'))});
const seen = [];
let last = null;
const t0 = Date.now();
const timer = setInterval(() => {
  const s = em.getStatus('kyutai')?.state;
  if (s && s !== last) { seen.push({ state: s, atMs: Date.now() - t0 }); last = s; }
}, 100);
try {
  await em.ensureReady('kyutai');
  clearInterval(timer);
  const st = em.getStatus('kyutai');
  // The 100 ms sampler can miss the terminal transition in the gap between the
  // state flip and clearInterval — record the guaranteed-ready state explicitly.
  if (st.state && st.state !== last) seen.push({ state: st.state, atMs: Date.now() - t0 });
  console.log(JSON.stringify({ ready: true, transitions: seen, status: { state: st.state, pid: st.pid, port: st.port, host: st.host } }));
} catch (err) {
  clearInterval(timer);
  console.log(JSON.stringify({ ready: false, transitions: seen, error: err.message }));
  process.exit(3);
}
setTimeout(() => process.kill(process.pid, 'SIGKILL'), 250);
`;

const runBackendA = () =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', CHILD_SCRIPT], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });

beforeAll(async () => {
  await fsp.mkdir(WAVE3_DIR, { recursive: true });
  // Clean slate on both engine ports. Anything answering here is a leftover
  // dev sidecar from this program (the operator's backend on 3355 and
  // llama-server are different processes and are never touched).
  for (const ep of [KYUTAI_ENDPOINT, ZONOS_ENDPOINT]) {
    if (await probeHealth(ep)) {
      evidence.steps.preclean = evidence.steps.preclean || [];
      evidence.steps.preclean.push({ endpoint: ep, note: 'leftover sidecar shut down for a clean from-scratch spawn' });
      await postShutdown(ep);
      await waitHealthDown(ep);
    }
  }
  evidence.steps.baseline = {
    gpuUsedMiB: await gpuUsedMiB(),
    kyutaiPids: await kyutaiPids(),
  };
}, 60_000);

afterAll(async () => {
  // Release discipline: nothing this file spawned may hold VRAM afterwards.
  for (const ep of [KYUTAI_ENDPOINT, ZONOS_ENDPOINT]) {
    if (await probeHealth(ep)) await postShutdown(ep);
  }
  em.shutdownAll();
  await waitHealthDown(KYUTAI_ENDPOINT);
  await waitHealthDown(ZONOS_ENDPOINT);
  await sleep(2000); // cuda teardown settle
  evidence.steps.finalRelease = { gpuUsedMiB: await gpuUsedMiB() };
  evidence.finishedAt = new Date().toISOString();
  await fsp.writeFile(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
}, 60_000);

describe('S-5 — Phase-1 Rule-0 live suite (real engine-manager, real sidecar, real GPU)', () => {
  test('1. non-loopback registry entry is refused by the REAL launch() before any process/GPU spend', async () => {
    const kyutai = registry.getEngine('kyutai');
    const originalHost = kyutai.serve.host;
    const pidsBefore = await kyutaiPids();
    const vramBefore = await gpuUsedMiB();

    kyutai.serve.host = '0.0.0.0'; // throwaway registry entry, in-process only, restored below
    let thrown = null;
    try {
      await em.launch('kyutai', { skipSync: true });
    } catch (err) {
      thrown = err.message;
    } finally {
      kyutai.serve.host = originalHost;
    }

    const pidsAfter = await kyutaiPids();
    const vramAfter = await gpuUsedMiB();
    evidence.steps.nonLoopbackRefusal = {
      thrown, pidsBefore, pidsAfter, vramBefore, vramAfter,
      restoredHost: kyutai.serve.host,
    };

    expect(thrown).toMatch(/non-loopback/);
    expect(kyutai.serve.host).toBe('127.0.0.1');
    expect(pidsAfter).toEqual(pidsBefore); // zero process spend
    expect(Math.abs(vramAfter - vramBefore)).toBeLessThanOrEqual(64); // zero GPU spend (baseline jitter only)
  }, 60_000);

  test('2. backend A spawns the sidecar through the real engine-manager; transitions observed; then SIGKILL', async () => {
    const result = await runBackendA();
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    const report = JSON.parse(lines.at(-1));
    evidence.steps.backendA = {
      exitCode: result.code,
      exitSignal: result.signal,
      transitions: report.transitions,
      status: report.status,
      stderrTail: result.stderr.slice(-400),
      gpuUsedMiBAfterReady: await gpuUsedMiB(),
    };

    expect(report.ready).toBe(true);
    const states = report.transitions.map((t) => t.state);
    expect(states).toContain('ready');
    expect(states.some((s) => s === 'syncing' || s === 'launching')).toBe(true); // a real launch sequence, not an instant adopt
    expect(result.signal).toBe('SIGKILL'); // the backend was KILLED, not shut down politely

    // The orphaned sidecar survives its dead backend and still serves /health.
    const health = await probeHealth(KYUTAI_ENDPOINT);
    expect(health?.ok).toBe(true);
    evidence.steps.backendA.healthAfterKill = {
      model: health.model, device: health.device, sampleRate: health.sample_rate,
      idleSecondsType: typeof health.idle_seconds,
    };
  }, 300_000);

  test('3. backend B (this process) ADOPTS the orphan — no double-spawn', async () => {
    const pidsBefore = await kyutaiPids();
    expect(pidsBefore.length).toBeGreaterThan(0);

    await em.ensureReady('kyutai');
    const st = em.getStatus('kyutai');
    const pidsAfter = await kyutaiPids();
    evidence.steps.adoption = {
      pidsBefore, pidsAfter,
      status: { state: st.state, pid: st.pid, adopted: st.adopted, port: st.port },
    };

    expect(st.state).toBe('ready');
    expect(st.adopted).toBe(true);
    expect(st.pid).toBeNull(); // proc-less: we must never signal a process we did not spawn
    expect(pidsAfter).toEqual(pidsBefore); // SAME sidecar — adopted, not double-spawned
  }, 120_000);

  test('4. /synthesize streams incrementally (real fetch reader); cold + warm first-chunk ms measured', async () => {
    const text = 'The gateway opens, and the void answers in a human voice.';
    const cold = await timedSynthesize(text);
    const warms = [await timedSynthesize(text), await timedSynthesize(text), await timedSynthesize(text)];
    const warmFirsts = warms.map((r) => r.chunks[0].atMs).sort((a, b) => a - b);
    const warm = warms[1]; // representative run for the shape checks + evidence row

    const gaps = (chunks) => chunks.slice(1).map((c, i) => chunks[i + 1].atMs - chunks[i].atMs)
      .sort((a, b) => a - b);
    const median = (xs) => xs[Math.floor(xs.length / 2)];
    const summarize = (r) => ({
      headers: r.headers,
      chunkCount: r.chunks.length,
      chunkSizes: [...new Set(r.chunks.map((c) => c.bytes))],
      firstChunkMs: r.chunks[0]?.atMs,
      lastChunkMs: r.chunks.at(-1)?.atMs,
      medianInterChunkGapMs: r.chunks.length > 2 ? Math.round(median(gaps(r.chunks)) * 10) / 10 : null,
      totalMs: r.totalMs,
    });
    evidence.steps.streaming = { cold: summarize(cold), warm: summarize(warm), warmFirstChunkMs: warmFirsts };

    for (const r of [cold, ...warms]) {
      expect(r.headers.status).toBe(200);
      expect(r.headers.format).toBe('pcm_s16le');
      expect(r.headers.sampleRate).toBe(24000);
      expect(r.headers.channels).toBe(1);
      expect(r.headers.cacheControl).toBe('no-store');
      expect(r.chunks.length).toBeGreaterThan(3); // incremental arrival, never one dump
      expect([...new Set(r.chunks.map((c) => c.bytes))]).toEqual([3840]); // one 80 ms frame per chunk
    }
    // The ~500 ms warm gate is MACHINE-LOCKED as the median of three warm
    // turns: one contention spike cannot fail it, but a real 500-999 ms
    // regression shifts the median past the gate. The 1000 ms per-turn
    // ceiling bounds the flake tail. Numbers also recorded in the deliverable.
    expect(median(warmFirsts)).toBeLessThan(500);
    for (const ms of warmFirsts) expect(ms).toBeLessThan(1000);
  }, 120_000);

  test('5. abort mid-stream through the real tts.synthesize adapter path; sidecar survives; second turn succeeds', async () => {
    tts.setConfig({ provider: 'kyutai', endpoint: KYUTAI_ENDPOINT, apiKey: '' });
    const longText = 'Sentence one of a deliberately long turn. '.repeat(30);

    const ac = new AbortController();
    let abortedChunks = 0;
    const t0 = performance.now();
    let abortError = null;
    try {
      for await (const chunk of tts.synthesize({ text: longText, signal: ac.signal })) {
        abortedChunks += 1;
        if (abortedChunks === 3 && !chunk.final) ac.abort();
      }
    } catch (err) {
      abortError = err.message;
    }
    const terminateMs = Math.round((performance.now() - t0) * 10) / 10;

    expect(abortError).toMatch(/abort/i);
    expect(abortedChunks).toBeGreaterThanOrEqual(3);

    // The supervisor-teardown saga regression proof: the SAME sidecar takes
    // the next turn instead of wedging on the abandoned lock.
    const health = await probeHealth(KYUTAI_ENDPOINT);
    expect(health?.ok).toBe(true);

    const second = [];
    const t1 = performance.now();
    for await (const chunk of tts.synthesize({ text: 'The second turn speaks after an aborted first.' })) {
      second.push(chunk);
    }
    const secondTurnMs = Math.round((performance.now() - t1) * 10) / 10;
    const stats = pcmStats(second);
    evidence.steps.abortMidStream = {
      abortedChunks, abortError, terminateMs,
      healthAfterAbort: { ok: health.ok, idleSecondsType: typeof health.idle_seconds },
      secondTurn: { ms: secondTurnMs, chunks: second.length, finalFlag: second.at(-1)?.final, ...stats },
    };

    expect(second.length).toBeGreaterThan(3);
    expect(second.at(-1).final).toBe(true);
    expect(stats.bytes).toBeGreaterThan(0);
    expect(stats.rms).toBeGreaterThan(0.01); // real speech, not silence
  }, 180_000);

  test('6. idle-reap shuts the sidecar down and the VRAM drop is watched in nvidia-smi', async () => {
    const vramLoaded = await gpuUsedMiB();
    const pidsLoaded = await kyutaiPids();

    await sleep(3000); // let sidecar idle_seconds AND the manager's readySince grace pass the TTL
    const reaped = await em.reapIdleEngines(1500);
    const portClosed = await waitHealthDown(KYUTAI_ENDPOINT);
    await sleep(2500); // cuda teardown settle
    const vramAfter = await gpuUsedMiB();

    evidence.steps.idleReap = {
      ttlMs: 1500, reaped, portClosed,
      pidsLoaded, pidsAfter: await kyutaiPids(),
      vramLoaded, vramAfter, vramReleasedMiB: vramLoaded - vramAfter,
      stateAfter: em.getStatus('kyutai')?.state,
    };

    expect(reaped).toContain('kyutai');
    expect(portClosed).toBe(true);
    expect(vramAfter).toBeLessThan(vramLoaded - 1000); // the model's GiBs actually left the GPU
  }, 120_000);

  test('7. no-migration Zonos-DNA parity against the real zonos sidecar + honest legacy testConnection sweep', async () => {
    const leg = { zonosBoot: 'not-attempted', synthesis: null, sweep: {} };
    evidence.steps.zonosParity = leg;

    core.setWorkspacesRoot(await createTempDir('s5-legacy-voice'));
    const seedBytes = await fsp.readFile(SEED_WAV);
    const { refHash } = await dnaSvc.saveSeedAudio('legacy-neuma', seedBytes);
    // The pre-program Voice DNA shape (tts-clone-seed.test.js): seed metadata
    // only, provider zonos, ZERO kyutai-era fields — no migration anywhere.
    const legacyDNA = {
      neumaId: 'legacy-neuma',
      engine: { provider: 'zonos' },
      seed: { source: 'witness-mic', refHash, consent: true },
      language: 'en-us',
    };

    let zonosReady = false;
    try {
      await em.ensureReady('zonos', 360_000);
      zonosReady = true;
      leg.zonosBoot = 'ready';
    } catch (err) {
      zonosReady = false;
      leg.zonosBoot = `NOT RUNNABLE on this rig: ${err.message}`; // recorded, never faked
    }

    if (zonosReady) {
      tts.setConfig({ provider: 'zonos', endpoint: ZONOS_ENDPOINT, apiKey: '' });
      const chunks = [];
      const t0 = performance.now();
      for await (const chunk of tts.synthesize({ text: 'I was forged before the new engine arrived, and I still speak.', voiceDNA: legacyDNA })) {
        chunks.push(chunk);
      }
      // The rate is whatever the REAL sidecar declares in its X-Audio-*
      // headers (zonos natively streams 44.1 kHz; the adapter reads it, never
      // assumes it). Parity is about the un-migrated dispatch path, not the rate.
      const declaredRate = chunks[0]?.sampleRate;
      const stats = pcmStats(chunks, declaredRate || 24000);
      leg.synthesis = {
        ms: Math.round((performance.now() - t0) * 10) / 10,
        chunks: chunks.length,
        finalFlag: chunks.at(-1)?.final,
        sampleRate: declaredRate,
        format: chunks[0]?.format,
        ...stats,
      };
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.at(-1).final).toBe(true);
      expect(declaredRate).toBeGreaterThan(0);
      expect(chunks[0].format).toBe('pcm_s16le');
      expect(stats.bytes).toBeGreaterThan(0);
      expect(stats.rms).toBeGreaterThan(0.01);

      await postShutdown(ZONOS_ENDPOINT);
      await waitHealthDown(ZONOS_ENDPOINT);
      await sleep(2000);
      leg.zonosReleased = { gpuUsedMiB: await gpuUsedMiB() };
    }

    // All five legacy adapters: honest testConnection where a leg can run.
    // A leg that cannot run (no sidecar, no API key) is recorded with its
    // real error — never asserted green.
    for (const id of ['zonos', 'kokoro', 'parler', 'cartesia', 'elevenlabs']) {
      const result = await adapters[id].testConnection({
        endpoint: tts.PROVIDER_DEFAULTS[id].endpoint, apiKey: '',
      });
      leg.sweep[id] = result;
    }
    expect(leg.sweep.zonos.ok).toBe(zonosReady); // zonos answers iff its sidecar genuinely booted
  }, 480_000);
});
