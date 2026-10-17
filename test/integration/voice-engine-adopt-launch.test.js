// voice-engine-adopt-launch.test.js — launch() adopts a sidecar already on the
// port instead of spawning a doomed second process.
//
// Regression for the whisper […] crash: an orphan
// sidecar (left by a dev-watch restart) still held the manifest port, so
// launch() spawned a fresh process that loaded the model onto the GPU and then
// died with EADDRINUSE — while the orphan's own /health answer made
// waitForReady wrongly declare that doomed process "ready". launch() now probes
// and adopts the live sidecar (proc-less) before spawning. The chat path's
// warm-up (tts-provider warmVoice → ensureReady) rides the same adoption —
// proven in portal-voice-chat.test.js.
//
// Speak-protocol lifecycle (ONE VOICE, WP1): ensureReady waits through a
// sidecar's 'loading'/'compiling' phases, surfaces a 'failed' load's error,
// and retires a sidecar serving the wrong model instead of adopting it.
//
// Real child processes, real HTTP over loopback — no mocks (RULE 0). The
// stand-in serves the same /health contract as the Python sidecars
// (test/helpers/speak-stand-in.js); the sidecars themselves are proven by
// test/integration/{csm,nano}-sidecar-live.test.js.

import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getEngine, listLocalEngines, getDefaultModel } from '../../backend/services/voice/engine-registry.js';
import {
  launch, ensureReady, getStatus, stop, shutdownAll,
} from '../../backend/services/voice/engine-manager.js';

const STAND_IN = fileURLToPath(new URL('../helpers/speak-stand-in.js', import.meta.url));
const children = [];

// A dev rig may have REAL sidecars holding their manifest ports; a stand-in can
// only take an engine whose port is silent right now.
const portFree = async ({ host, port }) => {
  try {
    await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(400) });
    return false;
  } catch {
    return true;
  }
};

/**
 * Spawn a real stand-in sidecar for an engine on its port; resolve once it is
 * listening. It serves the engine's default model unless told otherwise, so a
 * multi-model engine (csm) is adopted rather than retired.
 */
const standIn = (engineId, opts = {}) => {
  const { port } = getEngine(engineId).serve;
  const child = spawn(process.execPath, [
    STAND_IN, String(port), JSON.stringify({ model: getDefaultModel(engineId), idle: null, ...opts }),
  ], { stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(child);
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (d.toString().includes('LISTENING')) resolve({ child, exited }); });
    child.on('error', reject);
    setTimeout(() => reject(new Error('stand-in never listened')), 5000);
  });
};

// The ONE VOICE engines' ports belong to the lifecycle proofs below; the
// adoption proof takes any other engine whose port is silent right now.
const ONE_VOICE = ['csm', 'chatterbox-nano'];

const freeLocal = [];
for (const e of listLocalEngines()) {
  if (await portFree(e.serve)) freeLocal.push(e.id);
}
const launchEngine = freeLocal.find((id) => !ONE_VOICE.includes(id)) ?? null;

afterAll(() => {
  shutdownAll();
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
});

describe.skipIf(!launchEngine)('launch() adopts an already-running sidecar', () => {
  it('adopts the live sidecar as proc-less READY instead of spawning onto its bound port', async () => {
    const engineId = launchEngine;
    await standIn(engineId);

    // No orphan-adoption would mean a spawn onto the held port → EADDRINUSE.
    const status = await launch(engineId, { skipSync: true });
    expect(status.state).toBe('ready');
    expect(status.pid).toBe(null); // adopted, not spawned — the tell

    // The stand-in is still the one answering: the manager never bound the port.
    expect(getStatus(engineId).state).toBe('ready');
  });
});

// The two ONE VOICE engines' ports are used by no other suite file, so these
// lifecycle proofs never race the adopt/reap stand-ins above for a port.
const csmFree = await portFree(getEngine('csm').serve);
const nanoFree = await portFree(getEngine('chatterbox-nano').serve);

describe.skipIf(!nanoFree)('ensureReady() reads the speak-protocol phases', () => {
  it('waits through loading + compiling and adopts once the sidecar says ready', async () => {
    const { child } = await standIn('chatterbox-nano', { phases: [['loading', 400], ['compiling', 1200]] });
    const t0 = Date.now();
    await ensureReady('chatterbox-nano', 10_000);
    // compiling is still-starting, never dead: READY only after the timeline ran out
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1400);
    const snap = getStatus('chatterbox-nano');
    expect(snap.state).toBe('ready');
    expect(snap.pid).toBe(null);
    stop('chatterbox-nano');
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));
  });

  it("surfaces a 'failed' load's own error instead of waiting out the timeout", async () => {
    const { child } = await standIn('chatterbox-nano', {
      phases: [['loading', 300]], final: 'failed', error: 'OutOfMemoryError: CUDA out of memory',
    });
    const t0 = Date.now();
    await expect(ensureReady('chatterbox-nano', 20_000)).rejects.toThrow(/failed to load: OutOfMemoryError/);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(getStatus('chatterbox-nano').state).not.toBe('ready');
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));
  });
});

describe.skipIf(!csmFree)('ensureReady() is model-aware (csm)', () => {
  it('adopts a sidecar already serving the asked-for model, and records it', async () => {
    const { child } = await standIn('csm', { model: 'csm-1b' });
    await ensureReady('csm', { model: 'csm-1b', timeoutMs: 5000 });
    expect(getStatus('csm')).toMatchObject({ state: 'ready', model: 'csm-1b', pid: null });
    stop('csm');
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));
  });

  it('retires a sidecar serving another model — the real process exits via /shutdown', async () => {
    // The stand-in serves csm-1b; the caller asks for a model this machine can
    // never launch, so after the retire the relaunch is refused BEFORE any
    // spawn — the proof touches no GPU while still watching a real process die.
    const { exited } = await standIn('csm', { model: 'csm-1b' });
    await expect(ensureReady('csm', { model: 'no-such-model', timeoutMs: 15_000 }))
      .rejects.toThrow(/has no model 'no-such-model'/);
    expect(await exited).toBe(0);
    expect(getStatus('csm').state).not.toBe('ready');
  });

  it('a caller that names no model adopts whatever is serving (a shared sidecar is never bounced)', async () => {
    const { child } = await standIn('csm', { model: 'misotts-8b', profile: 'full' });
    await ensureReady('csm', 5000);
    expect(getStatus('csm')).toMatchObject({ state: 'ready', model: 'misotts-8b', profile: 'full' });
    stop('csm');
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));
  });

  it('the memory profile is part of the ask: a full sidecar is retired for another profile', async () => {
    const { exited } = await standIn('csm', { model: 'csm-1b', profile: 'full' });
    await expect(ensureReady('csm', { model: 'csm-1b', profile: 'no-such-profile', timeoutMs: 15_000 }))
      .rejects.toThrow(/csm-1b has no profile 'no-such-profile'/);
    expect(await exited).toBe(0);
  });

  it('a READY engine asked for another model is retired, not reused', async () => {
    const { exited } = await standIn('csm', { model: 'csm-1b' });
    await ensureReady('csm', { model: 'csm-1b', timeoutMs: 5000 });
    expect(getStatus('csm').state).toBe('ready');
    await expect(ensureReady('csm', { model: 'no-such-model', timeoutMs: 15_000 }))
      .rejects.toThrow(/has no model/);
    expect(await exited).toBe(0);
  });
});
