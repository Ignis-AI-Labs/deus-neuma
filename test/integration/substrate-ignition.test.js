/**
 * Substrate ignition — proven against the REAL lms CLI and the REAL LM Studio
 * daemon on this machine (RULE 0 — no mocks anywhere in the claimed path).
 *
 * The ignite test loads a real (small) model and unloads it afterward. It
 * requires the lms CLI + LM Studio installed; the suite skips honestly when
 * they are absent rather than pretending the path was proven.
 *
 * The live load/unload test is gated behind LIVE_IGNITION=1: the birth live
 * tests discover whatever models are loaded at their import moment, so a
 * mid-suite load/unload yanks state out from under them (proven the hard way
 * — it broke birth-native-tools-live in a full run). Run the live proof on
 * demand:  LIVE_IGNITION=1 npx vitest run test/integration/substrate-ignition.test.js
 */
import { describe, expect, it, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  isValidModelKey, isValidContextLength, parseLoadedModels, isTargetLoaded,
  isCliAvailable, listLoadedModels, igniteSubstrate, getIgnitionStatus,
} from '../../backend/services/substrate-ignition.js';

const execFileAsync = promisify(execFile);
const LMS = join(homedir(), '.lmstudio', 'bin', 'lms');
const HAVE_LMS = existsSync(LMS);

// A small real model for the live load test — must be downloaded already.
// mistral-7b-instruct-v0.3 deliberately: birth-llm-live's discovery excludes
// it by regex, so even a crashed run that leaves it loaded cannot draft it
// into another live suite.
const SMALL_MODEL = 'mistralai/mistral-7b-instruct-v0.3';
const LIVE = process.env.LIVE_IGNITION === '1';

describe('pure validation + planning', () => {
  it('accepts real LM Studio model keys', () => {
    expect(isValidModelKey('qwen3.5-122b-a10b')).toBe(true);
    expect(isValidModelKey('qwen/qwen2.5-7b')).toBe(true);
    expect(isValidModelKey('google/gemma-3-4b@q4_k_m')).toBe(true);
  });

  it('rejects shell-meaningful and malformed keys', () => {
    expect(isValidModelKey('model; rm -rf /')).toBe(false);
    expect(isValidModelKey('model && echo pwned')).toBe(false);
    expect(isValidModelKey('')).toBe(false);
    expect(isValidModelKey(null)).toBe(false);
    expect(isValidModelKey('x'.repeat(300))).toBe(false);
    // an option, never an argument (audit 2026-10-28 L-01)
    expect(isValidModelKey('--help')).toBe(false);
    expect(isValidModelKey('-y')).toBe(false);
  });

  it('bounds context length', () => {
    expect(isValidContextLength(32768)).toBe(true);
    expect(isValidContextLength(511)).toBe(false);
    expect(isValidContextLength(2 ** 21)).toBe(false);
    expect(isValidContextLength(4096.5)).toBe(false);
  });

  it('parses lms ps --json shape and matches targets by key or identifier', () => {
    const ps = [{
      identifier: 'gemma-summarizer', modelKey: 'google/gemma-3-4b',
      status: 'idle', contextLength: 4096,
    }];
    const loaded = parseLoadedModels(ps);
    expect(loaded).toEqual([{
      identifier: 'gemma-summarizer', modelKey: 'google/gemma-3-4b',
      status: 'idle', contextLength: 4096,
    }]);
    expect(isTargetLoaded('google/gemma-3-4b', loaded)).toBe(true);
    expect(isTargetLoaded('gemma-summarizer', loaded)).toBe(true);
    expect(isTargetLoaded('qwen3.5-122b-a10b', loaded)).toBe(false);
    expect(parseLoadedModels(null)).toEqual([]);
    expect(parseLoadedModels({ not: 'an array' })).toEqual([]);
  });
});

describe.skipIf(!HAVE_LMS)('against the real lms CLI', () => {
  it('detects the CLI and reads real loaded models', async () => {
    expect(await isCliAvailable()).toBe(true);
    const loaded = await listLoadedModels();
    expect(Array.isArray(loaded)).toBe(true);
    for (const m of loaded) {
      expect(m.modelKey).toBeTruthy();
      expect(typeof m.contextLength).toBe('number');
    }
  });

  it('reports honest ignition status for a real target', async () => {
    const status = await getIgnitionStatus('definitely-not-a-loaded-model');
    expect(status.available).toBe(true);
    expect(status.targetLoaded).toBe(false);
    expect(status.igniting).toBeNull();
  });

  it('short-circuits already-loaded without spawning a load', async () => {
    const loaded = await listLoadedModels();
    if (loaded.length === 0) return; // nothing loaded on this machine — covered by the live test below
    const result = await igniteSubstrate({ modelKey: loaded[0].modelKey, contextLength: 4096 });
    expect(result.status).toBe('already-loaded');
  });

  it('rejects invalid input before touching the CLI', async () => {
    await expect(igniteSubstrate({ modelKey: 'x; rm -rf /', contextLength: 4096 }))
      .rejects.toThrow(/Invalid model key/);
    await expect(igniteSubstrate({ modelKey: 'qwen/qwen2.5-7b', contextLength: 1 }))
      .rejects.toThrow(/Invalid context length/);
  });

  it.skipIf(!LIVE)('ignites a real model end-to-end: load starts, completes, model answers', async () => {
    const before = await listLoadedModels();
    if (isTargetLoaded(SMALL_MODEL, before)) {
      await execFileAsync(LMS, ['unload', SMALL_MODEL], { timeout: 60000 });
    }

    const result = await igniteSubstrate({ modelKey: SMALL_MODEL, contextLength: 2048 });
    expect(result.status).toBe('igniting');

    // observe completion through the same status endpoint the desk polls
    let loaded = false;
    const deadline = Date.now() + 120000;
    while (!loaded && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = await getIgnitionStatus(SMALL_MODEL);
      if (status.lastError) throw new Error(`Ignition failed: ${status.lastError.error}`);
      loaded = status.targetLoaded;
    }
    expect(loaded).toBe(true);

    // the loaded model must actually answer — a listed model that cannot
    // complete is not an ignited substrate
    const res = await fetch('http://localhost:1234/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: SMALL_MODEL,
        messages: [{ role: 'user', content: 'Say OK' }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(60000),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.choices[0].message.content.length).toBeGreaterThan(0);
  }, 300000);

  afterAll(async () => {
    if (!LIVE) return;
    // leave the machine as found — the test model must not stay resident
    try {
      await execFileAsync(LMS, ['unload', SMALL_MODEL], { timeout: 60000 });
    } catch { /* was not loaded */ }
  });
});
