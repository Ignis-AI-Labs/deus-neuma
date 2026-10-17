// voice-engine-idle-reap.test.js — idle sidecars release their VRAM.
//
// The manager's whole reap path runs for real: probe → adopt → read the
// sidecar's own idle_seconds over HTTP → POST /shutdown → a real process
// exits. The engine-side counterpart is a real child process serving the
// sidecar HTTP contract (test/helpers/speak-stand-in.js, serving the engine's
// default model so a multi-model engine is adopted, not retired); the Python
// implementation of that same contract is proven by the live-engine test at
// the bottom (VOICE_ENGINES_LIVE=1 — needs downloaded weights + GPU) and by
// the speak sidecars' own *-sidecar-live tests.

import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getEngine, listLocalEngines, getDefaultModel } from '../../backend/services/voice/engine-registry.js';
import {
  ensureReady, reapIdleEngines, getStatus, launch, stop, shutdownAll, isDownloaded,
} from '../../backend/services/voice/engine-manager.js';

const STAND_IN = fileURLToPath(new URL('../helpers/speak-stand-in.js', import.meta.url));

const children = [];

// A dev rig may have REAL sidecars holding their manifest ports (the app
// spawns them on demand) — stand-ins can only take engines whose ports are
// silent right now.
const portFree = async ({ host, port }) => {
  try {
    await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(400) });
    return false;
  } catch {
    return true;
  }
};

const FREE_ENGINES = [];
for (const e of listLocalEngines()) {
  if (await portFree(e.serve)) FREE_ENGINES.push(e.id);
  if (FREE_ENGINES.length === 3) break;
}

/** Spawn a real stand-in sidecar on an engine's manifest port; resolve when listening. */
const standIn = async (engineId, idleSeconds, { attempts = 3 } = {}) => {
  const { port } = getEngine(engineId).serve;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    // Wait for port to clear between sequential tests (reap/kill race under suite load)
    for (let w = 0; w < 20; w++) {
      if (await portFree({ host: '127.0.0.1', port })) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const opts = { model: getDefaultModel(engineId), idle: idleSeconds === 'none' ? null : idleSeconds };
    const child = spawn(process.execPath, [STAND_IN, String(port), JSON.stringify(opts)], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    children.push(child);
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    try {
      await new Promise((resolve, reject) => {
        let buf = '';
        child.stdout.on('data', (d) => {
          buf += d.toString();
          if (buf.includes('LISTENING')) resolve();
        });
        child.on('error', reject);
        child.on('exit', (code) => reject(new Error(`stand-in exited before listen (code ${code})`)));
        setTimeout(() => reject(new Error('stand-in never listened')), 12_000);
      });
      return { child, exited, listening: Promise.resolve() };
    } catch (err) {
      lastErr = err;
      try { child.kill('SIGKILL'); } catch { /* gone */ }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw lastErr || new Error('stand-in never listened');
};

afterAll(() => {
  shutdownAll();
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
});

describe.skipIf(FREE_ENGINES.length < 3)('idle reap lifecycle (real processes, real HTTP)', () => {
  const [idleEngine, activeEngine, preContractEngine] = FREE_ENGINES;

  // Sequential within this file — each stand-in needs exclusive port ownership
  it('adopts a long-idle sidecar and reaps it after the grace window — the process dies', async () => {
    const { exited } = await standIn(idleEngine, 3600);

    await ensureReady(idleEngine, 5000);
    expect(getStatus(idleEngine).state).toBe('ready');

    // Inside the fresh-ready grace window nothing is reaped …
    expect(await reapIdleEngines(200)).toEqual([]);
    await new Promise((r) => setTimeout(r, 250));

    // … past it, the sidecar's own idle report drives the reap.
    expect(await reapIdleEngines(200)).toEqual([idleEngine]);
    expect(getStatus(idleEngine).state).toBe('stopped');
    expect(await exited).toBe(0); // the real process exited via POST /shutdown
  });

  it('never reaps a sidecar reporting recent activity', async () => {
    const { child } = await standIn(activeEngine, 0);

    await ensureReady(activeEngine, 5000);
    await new Promise((r) => setTimeout(r, 250));
    expect(await reapIdleEngines(200)).toEqual([]);
    expect(getStatus(activeEngine).state).toBe('ready');
    expect(child.exitCode).toBeNull(); // still alive
    stop(activeEngine);
    child.kill('SIGKILL');
  });

  it('never reaps a pre-contract sidecar (no idle_seconds in /health)', async () => {
    const { child } = await standIn(preContractEngine, 'none');

    await ensureReady(preContractEngine, 5000);
    await new Promise((r) => setTimeout(r, 250));
    expect(await reapIdleEngines(200)).toEqual([]);
    expect(getStatus(preContractEngine).state).toBe('ready');
    expect(child.exitCode).toBeNull();
    stop(preContractEngine);
    child.kill('SIGKILL');
  });

  it('a non-positive TTL disables reaping', async () => {
    expect(await reapIdleEngines(0)).toEqual([]);
    expect(await reapIdleEngines(-1)).toEqual([]);
  });
});

// The real Python sidecar proving the same contract end-to-end: launch the
// actual engine, watch its own idle_seconds, reap it, and see the real
// process release its port. Heavy (model load, GPU) — explicitly opted into.
describe.skipIf(process.env.VOICE_ENGINES_LIVE !== '1' || !isDownloaded('zonos'))(
  'live zonos: launch → idle → reap (VOICE_ENGINES_LIVE=1)', () => {
    it('reaps the real engine after idle TTL and the port goes silent', { timeout: 300_000 }, async () => {
      const { host, port } = getEngine('zonos').serve;
      await launch('zonos');
      expect(getStatus('zonos').state).toBe('ready');

      const health = await fetch(`http://${host}:${port}/health`).then((r) => r.json());
      expect(typeof health.idle_seconds).toBe('number');

      await new Promise((r) => setTimeout(r, 600));
      expect(await reapIdleEngines(500)).toEqual(['zonos']);
      expect(getStatus('zonos').state).toBe('stopped');

      // the real process is gone: the port stops answering
      await new Promise((r) => setTimeout(r, 1500));
      await expect(
        fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(1500) }),
      ).rejects.toThrow();
    });
  },
);
