/**
 * The voice designer sidecar, LIVE: the real VoxCPM2 weights on the real GPU,
 * served by voice-engines/designer/server.py in its own uv venv, called over
 * real loopback HTTP. Proves the describe door's raw material — a clip and its
 * exact words from a written description — and, once the engine is in
 * voice-engines/engines.json, the backend door itself (findFromDescription
 * adopts the sidecar this test launched). No mocks (RULE 0).
 *
 * Summoned only: RUN_VOICE_ENGINE_LIVE=1 npx vitest run --project substrate-live test/integration/voice-designer-live.test.js
 * One voice sidecar at a time on this rig: the test launches its own process
 * on an ephemeral port and ends it (POST /shutdown, then its own PID) when done.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { decodeAudio, findFromDescription, makeTake, DESIGN_TAKES } from '../../backend/services/voice/forge-doors.js';
import { getEngine } from '../../backend/services/voice/engine-registry.js';
import { uvBin } from '../../backend/services/voice/engine-manager.js';

const LIVE = process.env.RUN_VOICE_ENGINE_LIVE === '1';
if (!LIVE) console.warn('[designer-live] skipped — summon with RUN_VOICE_ENGINE_LIVE=1');

const VOICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../voice-engines');
const DESCRIPTION = 'A warm, easygoing woman in her thirties, soft and slightly husky voice, relaxed conversational pace';

// The weights: DESIGNER_MODEL_DIR, the engine's own model dir, or the bake-off's HF cache snapshot.
const modelDir = () => {
  if (process.env.DESIGNER_MODEL_DIR) return process.env.DESIGNER_MODEL_DIR;
  const own = path.join(VOICE, '_models', 'designer');
  if (existsSync(path.join(own, 'config.json'))) return own;
  const snaps = path.join(VOICE, '_models', '_hf_cache', 'hub', 'models--openbmb--VoxCPM2', 'snapshots');
  return existsSync(snaps) ? path.join(snaps, readdirSync(snaps)[0]) : own;
};

const freePort = () => new Promise((resolve) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

describe.skipIf(!LIVE)('voice designer sidecar (VoxCPM2, live GPU)', () => {
  let proc;
  let base;
  let loadMs;
  const previousPort = process.env.DESIGNER_PORT;

  beforeAll(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    // findFromDescription's ensureReady probes ${ID}_PORT first: it adopts THIS sidecar.
    process.env.DESIGNER_PORT = String(port);
    const t0 = Date.now();
    proc = spawn(uvBin(), ['run', '--project', path.join(VOICE, 'designer'), 'python', path.join(VOICE, 'designer', 'server.py')], {
      env: { ...process.env, DESIGNER_HOST: '127.0.0.1', DESIGNER_PORT: String(port), DESIGNER_MODEL_DIR: modelDir() },
      stdio: 'ignore',
      // Its own process group, so teardown reaches uv's python child too.
      detached: true,
    });
    for (;;) {
      if (proc.exitCode !== null) throw new Error(`designer exited (${proc.exitCode}) before it was ready`);
      const health = await fetch(`${base}/health`).then((r) => r.json(), () => null);
      if (health?.phase === 'failed') throw new Error(`designer failed to load: ${health.error}`);
      if (health?.ok) break;
      if (Date.now() - t0 > 600_000) throw new Error('designer not ready after 10 min');
      await new Promise((r) => setTimeout(r, 1000));
    }
    loadMs = Date.now() - t0;
  }, 620_000);

  afterAll(async () => {
    if (previousPort === undefined) delete process.env.DESIGNER_PORT;
    else process.env.DESIGNER_PORT = previousPort;
    if (!proc || proc.exitCode !== null) return;
    const exited = new Promise((r) => proc.once('exit', r));
    // /shutdown abandons the exit when a request ended < 0.5 s ago — let that pass first.
    await new Promise((r) => setTimeout(r, 800));
    await fetch(`${base}/shutdown`, { method: 'POST' }).catch(() => null);
    const gone = await Promise.race([exited.then(() => true), new Promise((r) => setTimeout(() => r(false), 10_000))]);
    if (!gone) process.kill(-proc.pid, 'SIGTERM');
  }, 20_000);

  it('reports ready on /health with the speak-protocol fields', async () => {
    const health = await (await fetch(`${base}/health`)).json();
    expect(health).toMatchObject({ ok: true, model: 'voxcpm2', phase: 'ready', error: null, device: 'cuda' });
    expect(typeof health.idle_seconds).toBe('number');
    console.info(`[designer-live] load ${(loadMs / 1000).toFixed(1)} s`);
  });

  it('refuses a request it cannot design, as JSON', async () => {
    const res = await fetch(`${base}/design`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('bad_request');
  });

  it(`designs ${DESIGN_TAKES} distinct voices from one description: real WAV, exact words, measurable`, async () => {
    const takes = [];
    for (let seed = 11; seed < 11 + DESIGN_TAKES; seed++) {
      const t0 = Date.now();
      const res = await fetch(`${base}/design`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: DESCRIPTION, seed }),
      });
      expect(res.status).toBe(200);
      const out = await res.json();
      const wav = Buffer.from(out.wav_b64, 'base64');
      expect(wav.toString('latin1', 0, 4)).toBe('RIFF');
      expect(out).toMatchObject({ seed, model: 'voxcpm2' });
      expect(out.words).toMatch(/glad you called/);
      const take = makeTake({
        samples: await decodeAudio(wav), words: out.words, realPerson: false, minSeconds: 3,
        origin: { door: 'describe', description: DESCRIPTION, designer: { model: out.model, seed } },
      });
      expect(take.seconds).toBeGreaterThan(8);
      expect(take.seconds).toBeLessThan(40);
      expect(take.quality.clippedRatio).toBe(0);
      expect(take.measured.pitchHz).toBeGreaterThan(80);
      console.info(`[designer-live] seed ${seed}: ${out.seconds}s audio in ${out.gen_ms} ms (wall ${Date.now() - t0} ms), `
        + `pitch ${take.measured.pitchHz} Hz, ${take.measured.wordsPerSecond} w/s, snr ${take.quality.snrDb} dB, ${take.quality.verdict}`);
      takes.push(take);
    }
    expect(new Set(takes.map((t) => t.ref)).size).toBe(DESIGN_TAKES);
  }, 300_000);

  it.skipIf(!getEngine('designer'))('the describe door itself: three takes through the registered engine', async () => {
    const takes = await findFromDescription({ description: DESCRIPTION, seed: 21 });
    expect(takes).toHaveLength(DESIGN_TAKES);
    expect(takes.every((t) => t.door === 'describe' && t.realPerson === false && t.origin.designer.model === 'voxcpm2')).toBe(true);
  }, 300_000);
});
