/**
 * Preset manifest builder — pure tests over the REAL catalog data and the
 * REAL frozen registry view (engine-registry imports engines.json once; no
 * IO, no mocks anywhere in the claimed path).
 *
 * Proves the FR-1 contract: Kokoro's 54 packs + CC0 voice-donations carry
 * license metadata, and expresso/ (CC-BY-NC) is excluded at BUILD time —
 * present in the source catalog, absent from the built artifact.
 */

import { describe, test, expect } from 'vitest';
import { VOICE_PRESET_CATALOG } from '../../core/voice/voice-presets-data.js';
import { buildPresetManifest } from '../../core/voice/voice-preset-manifest.js';
import { toPublicJSON } from '../../backend/services/voice/engine-registry.js';

const MANIFEST = buildPresetManifest(VOICE_PRESET_CATALOG, toPublicJSON());
const kokoro = MANIFEST.presets.filter((p) => p.engine === 'kokoro');
const kyutai = MANIFEST.presets.filter((p) => p.engine === 'kyutai');

describe('preset manifest — real catalog over the real registry view', () => {
  test('builds 62 presets: Kokoro 54 packs + 8 CC0 voice-donations', () => {
    expect(MANIFEST.version).toBe(1);
    expect(MANIFEST.presets).toHaveLength(62);
    expect(kokoro).toHaveLength(54);
    expect(kyutai).toHaveLength(8);
  });

  test('every kokoro preset resolves license + engineName from the registry view', () => {
    for (const p of kokoro) {
      expect(p.license).toBe('Apache-2.0');
      expect(p.engineName).toBe('Kokoro-82M');
    }
    // spot-check the known default pack
    expect(kokoro.some((p) => p.id === 'af_heart')).toBe(true);
  });

  test('every kyutai donation carries its curated CC0 metadata', () => {
    for (const p of kyutai) {
      expect(p.license).toBe('CC0');
      expect(p.engineName).toBe('Kyutai TTS 1.6B'); // registry-resolved — kyutai landed in engines.json (B-3)
      expect(p.id.startsWith('voice-donations/')).toBe(true);
    }
  });

  test('expresso is excluded at build time: present in the catalog, absent from the manifest', () => {
    // The exclusion is real only because the source data has something to exclude.
    const sourceExpresso = VOICE_PRESET_CATALOG
      .flatMap((s) => s.voices)
      .filter((v) => v.id.startsWith('expresso/'));
    expect(sourceExpresso).toHaveLength(2);
    expect(sourceExpresso.every((v) => v.license === 'CC-BY-NC' && v.commercial === false)).toBe(true);
    // …and none of it survives the build.
    expect(MANIFEST.presets.some((p) => p.id.includes('expresso'))).toBe(false);
  });

  test('preset shape is exactly the route contract — ids, names, engine, license badge', () => {
    for (const p of MANIFEST.presets) {
      expect(Object.keys(p).sort()).toEqual(['engine', 'engineName', 'id', 'license', 'name']);
    }
  });

  test('no path-shaped strings anywhere in the manifest', () => {
    for (const p of MANIFEST.presets) {
      for (const value of Object.values(p)) {
        expect(value).not.toContain('..');
        expect(value.startsWith('/')).toBe(false);
        expect(value).not.toContain('\\');
        expect(value).not.toContain('voice-engines/');
        expect(value).not.toContain('_models');
      }
    }
  });

  test('the built manifest is frozen', () => {
    expect(Object.isFrozen(MANIFEST)).toBe(true);
    expect(Object.isFrozen(MANIFEST.presets)).toBe(true);
    expect(MANIFEST.presets.every((p) => Object.isFrozen(p))).toBe(true);
  });
});

describe('preset manifest — license resolution rules (synthetic catalog)', () => {
  const registry = Object.freeze({
    open: Object.freeze({ name: 'Open Engine', license: 'Apache-2.0', commercial: true }),
    nc: Object.freeze({ name: 'NC Engine', license: 'CC-BY-NC', commercial: false }),
  });
  const section = (engine, voices) => Object.freeze({ engine, engineName: `${engine} fallback`, voices: Object.freeze(voices) });

  test('voice-level commercial:false overrides a commercial engine (the expresso case)', () => {
    const m = buildPresetManifest(
      [section('open', [{ id: 'open/nc-voice', name: 'NC Voice', license: 'CC-BY-NC', commercial: false }])],
      registry
    );
    expect(m.presets).toHaveLength(0);
  });

  test('a non-commercial engine in the registry excludes its voices at build', () => {
    const m = buildPresetManifest([section('nc', [{ id: 'v1', name: 'V1' }])], registry);
    expect(m.presets).toHaveLength(0);
  });

  test('unknown engine with no voice-level metadata fails closed (excluded)', () => {
    const m = buildPresetManifest([section('ghost', [{ id: 'v1', name: 'V1' }])], registry);
    expect(m.presets).toHaveLength(0);
  });

  test('unknown engine ships a voice only via explicit CC0 voice-level metadata', () => {
    const m = buildPresetManifest(
      [section('ghost', [{ id: 'voice-donations/X.wav', name: 'X', license: 'CC0', commercial: true }])],
      registry
    );
    expect(m.presets).toHaveLength(1);
    expect(m.presets[0]).toEqual({
      id: 'voice-donations/X.wav',
      name: 'X',
      engine: 'ghost',
      engineName: 'ghost fallback',
      license: 'CC0',
    });
  });

  test('voice-level license wins over the engine license; registry name wins over the fallback', () => {
    const m = buildPresetManifest(
      [section('open', [{ id: 'v1', name: 'V1', license: 'CC0', commercial: true }])],
      registry
    );
    expect(m.presets[0].license).toBe('CC0');
    expect(m.presets[0].engineName).toBe('Open Engine');
  });
});
