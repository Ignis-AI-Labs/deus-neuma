// csm-sidecar-live.test.js — the REAL Sesame CSM sidecar (voice-engines/csm/server.py)
// launched by the real engine-manager and held to the speak protocol
// (docs/architecture/voice/speak-protocol.md) over real loopback HTTP: /health
// phases through a real compile, streamed PCM, context re-entry, refusals,
// disconnect-abort, /warm, a real model/profile relaunch, /shutdown.
//
// GPU + minutes of first compile: runs only when summoned —
//   RUN_VOICE_ENGINE_LIVE=1 npx vitest run --project substrate-live test/integration/csm-sidecar-live.test.js
// CSM_LIVE_VARIANTS picks the model:profile list (default csm-1b:full,csm-1b:lean;
// add misotts-8b:full for the High tier). Each variant after the first proves the
// manager retiring a READY sidecar and relaunching it for another model/profile.
// The sidecar binds an ephemeral port (CSM_PORT), never the registry's 7868.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ensureReady, getStatus, shutdownAll } from '../../backend/services/voice/engine-manager.js';
import {
  voiceEngineLiveOptIn, freePort, watchPhases, speakContract, shutdownAndWait,
} from '../helpers/speak-live-kit.js';

const LIVE = voiceEngineLiveOptIn();
const VARIANTS = (process.env.CSM_LIVE_VARIANTS || 'csm-1b:full,csm-1b:lean').split(',').map((v) => {
  const [model, profile] = v.split(':');
  return { model, profile };
});
const report = {};
let endpoint = null;

beforeAll(async () => {
  if (!LIVE) return;
  process.env.CSM_PORT = String(await freePort());
  endpoint = `http://127.0.0.1:${process.env.CSM_PORT}`;
});

afterAll(() => {
  shutdownAll();
  if (LIVE) console.log(`[csm-sidecar-live] ${JSON.stringify(report, null, 2)}`);
});

describe.skipIf(!LIVE)('csm sidecar, live (RUN_VOICE_ENGINE_LIVE=1)', () => {
  for (const v of VARIANTS) {
    describe(`${v.model} / ${v.profile}`, () => {
      const rec = (report[`${v.model}:${v.profile}`] = {});

      it('launches through the engine manager: loading → compiling → ready', { timeout: 30 * 60_000 }, async () => {
        const watch = watchPhases(endpoint);
        const t0 = Date.now();
        await ensureReady('csm', { model: v.model, profile: v.profile });
        rec.readyS = +((Date.now() - t0) / 1000).toFixed(1);
        await watch.stop();
        rec.phases = watch.seen;
        const phases = watch.seen.map((p) => p.phase);
        expect(phases.at(-1)).toBe('ready');
        // torch.compile + CUDA-graph capture, reported (not dead); on a relaunch this also proves a FRESH
        // process answered — the retired one only ever said 'ready'
        expect(phases).toContain('compiling');
        expect(phases.filter((p) => !['loading', 'compiling', 'ready'].includes(p))).toEqual([]);
        expect(getStatus('csm')).toMatchObject({ state: 'ready', model: v.model, profile: v.profile });
        const h = await fetch(`${endpoint}/health`).then((r) => r.json());
        expect(h).toMatchObject({ model: v.model, profile: v.profile, device: 'cuda', context: true });
      });

      speakContract(() => endpoint, { context: true, rec, it, expect });
    });
  }

  it('/shutdown ends the real process: the port goes silent and the manager sees it stop', async () => {
    const { ack, silent } = await shutdownAndWait(endpoint);
    expect(ack).toMatchObject({ status: 200, body: { ok: true, shutting_down: true } });
    expect(silent).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    expect(getStatus('csm').state).toBe('stopped');
  });
});
