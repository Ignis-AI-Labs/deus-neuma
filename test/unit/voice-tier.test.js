/**
 * The voice tier rule (backend/services/voice/voice-tier.js) and the voice
 * settings file (voice-settings.js) — pure law called with real inputs, and
 * the settings store against a real temp file. No mocks (RULE 0).
 *
 * The memory figures come from the REAL registry (voice-engines/engines.json),
 * so a re-measured profile moves these thresholds with it: the assertions read
 * needGB rather than restating numbers.
 */

import { describe, test, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { getTier } from '../../backend/services/voice/engine-registry.js';
import { autoTier, needGB, MEMORY_HEADROOM, TIER_CHOICES } from '../../backend/services/voice/voice-tier.js';
import {
  createVoiceSettings, resolveVoiceSetting, voiceSettingError, measuredMindGB,
} from '../../backend/services/voice/voice-settings.js';

const nvidia = (vramGB) => ({ name: 'test card', vendor: 'nvidia', vramGB, unified: false });
const FULL = needGB('standard', 'full');
const LEAN = needGB('standard', 'lean');

describe('needGB — read from engines.json, padded by the headroom', () => {
  test('each GPU profile needs its measured memMB plus the headroom', () => {
    expect(FULL).toBeCloseTo((getTier('standard').profiles.full.memMB * MEMORY_HEADROOM) / 1024, 1);
    expect(LEAN).toBeCloseTo((getTier('standard').profiles.lean.memMB * MEMORY_HEADROOM) / 1024, 1);
  });

  test('the rungs land where the plan put them (~6.5 / ~2.8 GB)', () => {
    expect(FULL).toBeGreaterThan(5.8);
    expect(FULL).toBeLessThan(7);
    expect(LEAN).toBeGreaterThan(2.5);
    expect(LEAN).toBeLessThan(3.2);
  });

  test('an unknown tier or profile has no need', () => {
    expect(needGB('nope', 'full')).toBe(null);
    expect(needGB('standard', 'nope')).toBe(null);
    expect(needGB('high', 'full')).toBe(null); // High/MisoTTS dropped (ruling, 2026-10-01)
  });
});

describe('autoTier — the best tier that fits beside the mind', () => {
  test('no GPU → light (the processor)', () => {
    const t = autoTier({ gpu: null, mindGB: 0 });
    expect(t).toMatchObject({ tier: 'light', profile: 'cpu' });
    expect(t.reason).toMatch(/No GPU/);
  });

  test('a non-NVIDIA GPU → light, even with room to spare', () => {
    const t = autoTier({ gpu: { vendor: 'amd', vramGB: 48 }, mindGB: 0 });
    expect(t.tier).toBe('light');
    expect(t.reason).toMatch(/amd/);
  });

  test('an unreadable VRAM size → light', () => {
    expect(autoTier({ gpu: { vendor: 'nvidia', vramGB: null }, mindGB: 0 }).tier).toBe('light');
  });

  test('a big card with room → standard/full (Sesame is the top voice)', () => {
    const t = autoTier({ gpu: nvidia(96), mindGB: 30 });
    expect(t).toMatchObject({ tier: 'standard', profile: 'full', spareGB: 66 });
    expect(t.needGB).toBe(FULL);
  });

  test('spare just under the full rung → standard/lean', () => {
    expect(autoTier({ gpu: nvidia(24), mindGB: 24 - (FULL - 0.2) })).toMatchObject({ tier: 'standard', profile: 'lean' });
  });

  test('an 8 GB card beside a small mind → standard/lean (the shrunk Sesame voice)', () => {
    expect(autoTier({ gpu: nvidia(8), mindGB: 4 })).toMatchObject({ tier: 'standard', profile: 'lean', spareGB: 4 });
  });

  test('exactly at a rung counts as fitting', () => {
    expect(autoTier({ gpu: nvidia(10), mindGB: 10 - LEAN })).toMatchObject({ tier: 'standard', profile: 'lean' });
  });

  test('too little room → light, saying what the smallest voice needs', () => {
    const t = autoTier({ gpu: nvidia(24), mindGB: 22.5 });
    expect(t.tier).toBe('light');
    expect(t.reason).toContain(String(LEAN));
  });

  test('an unknown mind footprint counts as none (the whole card is spare)', () => {
    expect(autoTier({ gpu: nvidia(24), mindGB: null })).toMatchObject({ tier: 'standard', profile: 'full' });
  });
});

describe('autoTier — the person overrides, and is told the cost', () => {
  test('a tier that fits says so', () => {
    const t = autoTier({ gpu: nvidia(96), mindGB: 30, override: 'standard' });
    expect(t).toMatchObject({ tier: 'standard', profile: 'full' });
    expect(t.reason).toMatch(/^Chosen by you/);
  });

  test('a tier with no profile named takes its roomiest profile that fits', () => {
    expect(autoTier({ gpu: nvidia(8), mindGB: 4, override: { tier: 'standard' } }).profile).toBe('lean');
  });

  test('a tier that does NOT fit is honoured, with a plain warning about the mind', () => {
    const t = autoTier({ gpu: nvidia(24), mindGB: 23, override: { tier: 'standard', profile: 'full' } });
    expect(t).toMatchObject({ tier: 'standard', profile: 'full' });
    expect(t.reason).toMatch(/mind may run out of room/);
  });

  test('a named profile is kept', () => {
    expect(autoTier({ gpu: nvidia(96), mindGB: 0, override: { tier: 'standard', profile: 'lean' } }).profile).toBe('lean');
  });

  test('light on a big card is honoured', () => {
    expect(autoTier({ gpu: nvidia(96), mindGB: 0, override: 'light' })).toMatchObject({ tier: 'light', profile: 'cpu' });
  });

  test("'auto' and garbage overrides recommend", () => {
    expect(autoTier({ gpu: nvidia(96), mindGB: 0, override: 'auto' }).tier).toBe('standard');
    expect(autoTier({ gpu: nvidia(96), mindGB: 0, override: 'ultra' }).tier).toBe('standard');
    // a pick saved before High was dropped reads as auto
    expect(autoTier({ gpu: nvidia(96), mindGB: 0, override: 'high' })).toMatchObject({ tier: 'standard', profile: 'full' });
  });
});

describe('voice settings — data/settings/voice.json', () => {
  test('TIER_CHOICES is auto plus every registry tier', () => {
    expect(TIER_CHOICES).toEqual(['auto', 'light', 'standard']);
  });

  test('resolveVoiceSetting: unknown reads as auto; a profile survives only on its tier', () => {
    expect(resolveVoiceSetting(null)).toEqual({ tier: 'auto', profile: null });
    expect(resolveVoiceSetting({ tier: 'ultra' })).toEqual({ tier: 'auto', profile: null });
    expect(resolveVoiceSetting({ tier: 'standard', profile: 'lean' })).toEqual({ tier: 'standard', profile: 'lean' });
    expect(resolveVoiceSetting({ tier: 'light', profile: 'lean' })).toEqual({ tier: 'light', profile: null });
    expect(resolveVoiceSetting({ tier: 'high', profile: 'full' })).toEqual({ tier: 'auto', profile: null });
  });

  test('voiceSettingError names what is wrong', () => {
    expect(voiceSettingError({ tier: 'standard', profile: 'lean' })).toBe(null);
    expect(voiceSettingError({ tier: 'auto' })).toBe(null);
    expect(voiceSettingError({ tier: 'ultra' })).toMatch(/tier must be one of/);
    expect(voiceSettingError({ tier: 'auto', profile: 'lean' })).toMatch(/only be named with a tier/);
    expect(voiceSettingError({ tier: 'light', profile: 'lean' })).toMatch(/light tier has profiles cpu/);
    expect(voiceSettingError({ tier: 'high' })).toMatch(/tier must be one of/);
  });

  test('a real file: absent = auto, write persists, a bad pick throws and leaves the file', async () => {
    const dir = await createTempDir('voice-settings');
    const file = path.join(dir, 'nested', 'voice.json');
    const store = createVoiceSettings({ path: () => file });
    expect(await store.read()).toEqual({ tier: 'auto', profile: null });
    expect(await store.write({ tier: 'standard', profile: 'lean' })).toEqual({ tier: 'standard', profile: 'lean' });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ tier: 'standard', profile: 'lean' });
    await expect(store.write({ tier: 'ultra' })).rejects.toThrow(/tier must be one of/);
    expect(await store.read()).toEqual({ tier: 'standard', profile: 'lean' });
    await fs.writeFile(file, '{ not json');
    expect(await store.read()).toEqual({ tier: 'auto', profile: null });
  });
});

describe('measuredMindGB — the mind on the card', () => {
  test('sums every llama-server, ignores everything else', () => {
    expect(measuredMindGB([
      { pid: 1, name: 'llama-server', memMB: 20480 },
      { pid: 2, name: 'python', memMB: 5000 },
      { pid: 3, name: 'llama-server', memMB: 1024 },
    ])).toBe(21);
  });

  test('none on the card → null (falls back to the recommendation)', () => {
    expect(measuredMindGB([{ pid: 2, name: 'python', memMB: 5000 }])).toBe(null);
    expect(measuredMindGB(undefined)).toBe(null);
  });
});
