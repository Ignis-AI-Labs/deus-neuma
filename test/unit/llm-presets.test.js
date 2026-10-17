/**
 * Inference presets — the named modes that spare witnesses raw sampling numbers.
 * The allow-list IS the validation; resolvePreset must never return garbage, and
 * the values must be the objective Qwen3.5-grounded ones.
 */
import { describe, expect, test } from 'vitest';
import {
  INFERENCE_PRESETS, DEFAULT_PRESET, resolvePreset, resolveSittingPreset,
  isPresetName, PRESET_LIST,
} from '../../backend/services/llm-presets.js';

describe('llm-presets', () => {
  describe('resolvePreset', () => {
    test('grounded maps to precise sampling', () => {
      expect(resolvePreset('grounded')).toMatchObject({ temperature: 0.5, topP: 0.8, maxTokens: 4096 });
    });
    test('balanced is the Qwen3.5 ideal default', () => {
      expect(resolvePreset('balanced')).toMatchObject({ temperature: 0.7, topP: 0.8, maxTokens: 8192 });
    });
    test('expansive maps to associative sampling', () => {
      expect(resolvePreset('expansive')).toMatchObject({ temperature: 0.9, topP: 0.95, maxTokens: 16384 });
    });
    test('is case-insensitive and trims whitespace', () => {
      expect(resolvePreset('  EXPANSIVE ')).toBe(INFERENCE_PRESETS.expansive);
    });
    test('unknown, empty, or non-string falls back to the default — never garbage', () => {
      expect(resolvePreset('wild')).toBe(INFERENCE_PRESETS[DEFAULT_PRESET]);
      expect(resolvePreset('')).toBe(INFERENCE_PRESETS[DEFAULT_PRESET]);
      expect(resolvePreset(undefined)).toBe(INFERENCE_PRESETS[DEFAULT_PRESET]);
      expect(resolvePreset(42)).toBe(INFERENCE_PRESETS[DEFAULT_PRESET]);
    });
  });

  describe('isPresetName', () => {
    test('true only for known names (case-insensitive), false for anything else', () => {
      expect(isPresetName('grounded')).toBe(true);
      expect(isPresetName('Balanced')).toBe(true);
      expect(isPresetName('wild')).toBe(false);
      expect(isPresetName('')).toBe(false);
      expect(isPresetName(null)).toBe(false);
    });
  });

  describe('resolveSittingPreset — the budget dial (ARC-HARNESS L7, #531)', () => {
    test('undeclared budget is byte-identical to resolvePreset', () => {
      expect(resolveSittingPreset({ presetName: 'balanced' })).toBe(INFERENCE_PRESETS.balanced);
      expect(resolveSittingPreset({ presetName: 'balanced', budget: null })).toBe(INFERENCE_PRESETS.balanced);
    });

    test('a declared budget caps the SAME preset exactly — thought and speech share it', () => {
      const dialled = resolveSittingPreset({ presetName: 'grounded', budget: 2048 });
      expect(dialled.temperature).toBe(0.5);
      expect(dialled.topP).toBe(0.8);
      expect(dialled.maxTokens).toBe(2048);
      expect(dialled.exactMaxTokens).toBe(true);
      expect(dialled.sharedOutputBudget).toBe(true);
      // The standing presets stay untouched — the dial is per-sitting.
      expect(INFERENCE_PRESETS.grounded.maxTokens).toBe(4096);
    });

    test('an unknown preset name under a budget still resolves the default params first', () => {
      const dialled = resolveSittingPreset({ presetName: 'wild', budget: 4096 });
      expect(dialled.temperature).toBe(INFERENCE_PRESETS[DEFAULT_PRESET].temperature);
      expect(dialled.maxTokens).toBe(4096);
      expect(dialled.exactMaxTokens).toBe(true);
    });

    test('degenerate budgets fall back to the standing preset, never a broken cap', () => {
      expect(resolveSittingPreset({ presetName: 'balanced', budget: 0 })).toBe(INFERENCE_PRESETS.balanced);
      expect(resolveSittingPreset({ presetName: 'balanced', budget: -5 })).toBe(INFERENCE_PRESETS.balanced);
      expect(resolveSittingPreset({ presetName: 'balanced', budget: 1.5 })).toBe(INFERENCE_PRESETS.balanced);
      expect(resolveSittingPreset({ presetName: 'balanced', budget: '2048' })).toBe(INFERENCE_PRESETS.balanced);
    });
  });

  test('presets are frozen (defaults, not mutable at runtime)', () => {
    expect(Object.isFrozen(INFERENCE_PRESETS)).toBe(true);
    expect(Object.isFrozen(INFERENCE_PRESETS.balanced)).toBe(true);
  });

  test('PRESET_LIST is UI-shaped: name + label + blurb, no raw numbers leaked', () => {
    expect(PRESET_LIST.map((p) => p.name)).toEqual(['grounded', 'balanced', 'expansive']);
    for (const p of PRESET_LIST) {
      expect(p).toHaveProperty('label');
      expect(p).toHaveProperty('blurb');
      expect(p).not.toHaveProperty('temperature');
    }
  });
});
