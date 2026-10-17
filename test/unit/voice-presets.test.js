/**
 * Frontend preset-gallery + warming-panel pure helpers (FR-3/FR-4).
 * Pure logic only — no fetch, no DOM, no mocks.
 */

import { describe, test, expect } from 'vitest';
import { groupPresetsByEngine, warmingStageLabel } from '../../frontend/app/RelinkShell/voice-presets.js';

describe('groupPresetsByEngine', () => {
  const manifest = [
    { id: 'af_heart', name: 'Heart · US F', engine: 'kokoro', engineName: 'Kokoro-82M', license: 'Apache-2.0' },
    { id: 'af_sky', name: 'Sky · US F', engine: 'kokoro', engineName: 'Kokoro-82M', license: 'Apache-2.0' },
    { id: 'voice-donations/James.wav', name: 'James', engine: 'kyutai', engineName: 'Kyutai TTS', license: 'CC0' },
    { id: 'am_adam', name: 'Adam · US M', engine: 'kokoro', engineName: 'Kokoro-82M', license: 'Apache-2.0' },
  ];

  test('groups presets under their engine, preserving first-seen order', () => {
    const sections = groupPresetsByEngine(manifest);
    expect(sections.map((s) => s.engine)).toEqual(['kokoro', 'kyutai']);
    expect(sections[0].engineName).toBe('Kokoro-82M');
    expect(sections[0].presets.map((p) => p.id)).toEqual(['af_heart', 'af_sky', 'am_adam']);
    expect(sections[1].presets.map((p) => p.id)).toEqual(['voice-donations/James.wav']);
  });

  test('empty / missing input yields no sections', () => {
    expect(groupPresetsByEngine([])).toEqual([]);
    expect(groupPresetsByEngine(null)).toEqual([]);
    expect(groupPresetsByEngine(undefined)).toEqual([]);
  });
});

describe('voice-client gallery/prewarm functions — non-critical fallback contract', () => {
  // Real module, real behavior in node: no sessionStorage exists, so
  // authHeadersOrNull() bails before any fetch — the functions resolve their
  // documented empty values. (The authed live path needs a browser base URL —
  // relative fetch URLs do not parse in node — and is covered at the route
  // layer by test/integration/api-voice-forge-presets.test.js.)
  test('getForgePresets resolves [] unauthenticated (no token → no fetch)', async () => {
    const { getForgePresets } = await import('../../frontend/app/RelinkShell/voice-client.js');
    await expect(getForgePresets()).resolves.toEqual([]);
  });

  test('prewarmEngine resolves null unauthenticated (fire-and-forget never throws)', async () => {
    const { prewarmEngine } = await import('../../frontend/app/RelinkShell/voice-client.js');
    await expect(prewarmEngine('kokoro')).resolves.toBeNull();
  });

  test('getEngineStatus resolves null unauthenticated', async () => {
    const { getEngineStatus } = await import('../../frontend/app/RelinkShell/voice-client.js');
    await expect(getEngineStatus('kokoro')).resolves.toBeNull();
  });

  test('a real fetch failure resolves the safe fallback, never a rejection', async () => {
    // A token IS present here, so the functions genuinely attempt the fetch —
    // which really fails in node (relative URL, no base) — and the catch
    // contract resolves []/null. The failure is real; the claim is only the
    // fallback behavior.
    globalThis.sessionStorage = { getItem: (k) => (k === 'authToken' ? 'test-token' : null) };
    try {
      const { getForgePresets, prewarmEngine, getEngineStatus } = await import('../../frontend/app/RelinkShell/voice-client.js');
      await expect(getForgePresets()).resolves.toEqual([]);
      await expect(prewarmEngine('kokoro')).resolves.toBeNull();
      await expect(getEngineStatus('kokoro')).resolves.toBeNull();
    } finally {
      delete globalThis.sessionStorage;
    }
  });
});

describe('warmingStageLabel — mapped from the real engine-manager STATES', () => {
  test('every real state has an exact label', () => {
    expect(warmingStageLabel('stopped')).toBe('IDLE');
    expect(warmingStageLabel('syncing')).toBe('SYNCING ENVIRONMENT');
    expect(warmingStageLabel('launching')).toBe('SPAWNING — LOADING MODEL');
    expect(warmingStageLabel('ready')).toBe('READY');
    expect(warmingStageLabel('failed')).toBe('LAUNCH FAILED');
    expect(warmingStageLabel('crashed')).toBe('CRASHED');
  });

  test('an unlearned state names the probe, never a fabricated stage', () => {
    expect(warmingStageLabel(null)).toBe('PROBING ENGINE STATE');
    expect(warmingStageLabel(undefined)).toBe('PROBING ENGINE STATE');
  });

  test('an unknown state is surfaced raw (uppercased), not hidden', () => {
    expect(warmingStageLabel('adopting')).toBe('ADOPTING');
  });
});
