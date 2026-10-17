// nano-sidecar-live.test.js — the REAL Chatterbox Nano sidecar
// (voice-engines/chatterbox-nano/server.py, the Light tier, CPU only) launched
// by the real engine-manager and held to the speak protocol
// (docs/architecture/voice/speak-protocol.md) over real loopback HTTP. Nano
// accepts and validates context but ignores it (X-Context-Used: 0).
//
// Heavy CPU (8 threads by default): runs only when summoned —
//   RUN_VOICE_ENGINE_LIVE=1 npx vitest run --project substrate-live test/integration/nano-sidecar-live.test.js
// The sidecar binds an ephemeral port (CHATTERBOX_NANO_PORT), never the registry's 7869.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ensureReady, getStatus, shutdownAll } from '../../backend/services/voice/engine-manager.js';
import {
  voiceEngineLiveOptIn, freePort, watchPhases, speakContract, shutdownAndWait,
} from '../helpers/speak-live-kit.js';

const LIVE = voiceEngineLiveOptIn();
const rec = {};
let endpoint = null;

beforeAll(async () => {
  if (!LIVE) return;
  process.env.CHATTERBOX_NANO_PORT = String(await freePort());
  endpoint = `http://127.0.0.1:${process.env.CHATTERBOX_NANO_PORT}`;
});

afterAll(() => {
  shutdownAll();
  if (LIVE) console.log(`[nano-sidecar-live] ${JSON.stringify(rec, null, 2)}`);
});

describe.skipIf(!LIVE)('chatterbox-nano sidecar, live (RUN_VOICE_ENGINE_LIVE=1)', () => {
  it('launches through the engine manager: loading → ready, on the CPU', { timeout: 10 * 60_000 }, async () => {
    const watch = watchPhases(endpoint);
    const t0 = Date.now();
    await ensureReady('chatterbox-nano');
    rec.readyS = +((Date.now() - t0) / 1000).toFixed(1);
    await watch.stop();
    rec.phases = watch.seen;
    expect(watch.seen.at(-1).phase).toBe('ready');
    expect(watch.seen.map((p) => p.phase)).toContain('loading');
    expect(getStatus('chatterbox-nano').state).toBe('ready');
    const h = await fetch(`${endpoint}/health`).then((r) => r.json());
    expect(h).toMatchObject({ model: 'chatterbox-nano', device: 'cpu', context: false });
  });

  speakContract(() => endpoint, { context: false, rec, it, expect });

  it('/shutdown ends the real process: the port goes silent and the manager sees it stop', async () => {
    const { ack, silent } = await shutdownAndWait(endpoint);
    expect(ack).toMatchObject({ status: 200, body: { ok: true, shutting_down: true } });
    expect(silent).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    expect(getStatus('chatterbox-nano').state).toBe('stopped');
  });
});
