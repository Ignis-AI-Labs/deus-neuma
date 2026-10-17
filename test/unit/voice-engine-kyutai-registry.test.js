/**
 * Kyutai registry entry + downloader contract — pure tests over the REAL
 * frozen registry view (engine-registry imports the real engines.json once;
 * no IO, no network, no mocks anywhere in the claimed path).
 *
 * B-3 / FR-13: the engines.json kyutai entry must mirror the existing entry
 * shape and encode the landed S-2 spike contract exactly — 4 model files
 * (gated, revision-pinned kyutai/tts-1.6b-en_fr) + 8 checkpoint-specific CC0
 * voice embeddings (ungated, revision-pinned kyutai/tts-voices). The actual
 * download is NOT exercised here and is never faked: the pure manifest shape
 * is what this file proves; the file existence at the pinned revisions was
 * probed with the real HF API listing (Wave-2 B-3 report).
 */

import { describe, test, expect } from 'vitest';
import {
  getEngine, listLocalEngines, listCommercialEngines, toPublicJSON,
} from '../../backend/services/voice/engine-registry.js';
import { VOICE_PRESET_CATALOG } from '../../core/voice/voice-presets-data.js';

const kyutai = getEngine('kyutai');

// The S-2 spike's complete model load set (S2_LOADER_SPIKE.md "Model set").
const SPIKE_MODEL_FILES = [
  'dsm_tts_1e68beda@240.safetensors',
  'tokenizer-e351c8d8-checkpoint125.safetensors',
  'tokenizer_spm_8k_en_fr_audio.model',
  'config.json',
];

const SHA_RE = /^[0-9a-f]{40}$/;

describe('kyutai engines.json entry — FR-13 exact fields', () => {
  test('is registered and mirrors the local-engine entry shape', () => {
    expect(kyutai).not.toBeNull();
    expect(kyutai.id).toBe('kyutai');
    expect(kyutai.name).toBe('Kyutai TTS 1.6B');
    expect(kyutai.publisher).toBe('Kyutai');
    expect(kyutai.type).toBe('local');
    expect(kyutai.languages).toEqual(['en', 'fr']);
    expect(kyutai.adapter).toBe('kyutai');
    expect(kyutai.validated).toBe(false);
  });

  test('carries the CC-BY-4.0 weights + MIT code license split, commercial with attribution', () => {
    expect(kyutai.license).toBe('CC-BY-4.0 (weights); MIT (Python code)');
    expect(kyutai.commercial).toBe(true);
    expect(kyutai.notes).toContain('attribution');
  });

  test('capabilities: streaming true, embeddingVoices true, emotion honestly false', () => {
    expect(kyutai.capabilities.streaming).toBe(true);
    expect(kyutai.capabilities.embeddingVoices).toBe(true);
    expect(kyutai.capabilities.presetVoices).toBe(true);
    expect(kyutai.capabilities.cloning).toBe(true);
    expect(kyutai.capabilities.emotion).toBe(false);
  });

  test('requirements + serve block: 7 GB VRAM, port 7866 on loopback', () => {
    expect(kyutai.requirements.vramGb).toBe(7);
    expect(kyutai.requirements.gpu).toBe('required');
    expect(kyutai.serve).toEqual({
      host: '127.0.0.1',
      port: 7866,
      healthPath: '/health',
      startModule: 'voice-engines/kyutai/server.py',
      vramGb: 7,
    });
  });

  test('license-split notes keep the expresso exclusion + gating honest', () => {
    expect(kyutai.notes).toContain('CC-BY-NC');
    expect(kyutai.notes).toContain('GATED');
  });

  test('port 7866 collides with no other registered engine', () => {
    const ports = listLocalEngines().map((e) => e.serve.port);
    expect(new Set(ports).size).toBe(ports.length);
    expect(ports.filter((p) => p === 7866)).toHaveLength(1);
  });

  test('joins the local and commercial engine lists', () => {
    expect(listLocalEngines().map((e) => e.id)).toContain('kyutai');
    expect(listCommercialEngines().map((e) => e.id)).toContain('kyutai');
  });

  test('public JSON exposes kyutai capabilities without download internals', () => {
    const pub = toPublicJSON().kyutai;
    expect(pub.capabilities.embeddingVoices).toBe(true);
    expect(pub.validated).toBe(false);
    expect(JSON.stringify(pub)).not.toContain('allowPatterns');
    expect(JSON.stringify(pub)).not.toContain('revision');
  });
});

describe('kyutai download contract — S-2 spike file set', () => {
  const download = kyutai.download;

  test('rides the existing huggingface_snapshot machinery (isDownloaded-compatible)', () => {
    expect(download.method).toBe('huggingface_snapshot');
    expect(download.repo).toBe('kyutai/tts-1.6b-en_fr');
  });

  test('model repo is pinned to the spike revision', () => {
    expect(download.revision).toBe('f65439609986c392cb12df63938abcc550c3fb15');
    expect(download.revision).toMatch(SHA_RE);
  });

  test('allowPatterns are exactly the 4 spike model files — the complete load set', () => {
    expect([...download.allowPatterns].sort()).toEqual([...SPIKE_MODEL_FILES].sort());
  });

  test('one extra repo: kyutai/tts-voices, pinned to the spike revision', () => {
    expect(download.extraRepos).toHaveLength(1);
    const voices = download.extraRepos[0];
    expect(voices.repo).toBe('kyutai/tts-voices');
    expect(voices.revision).toBe('323332d33f997de8394f24a193e1a76df720e01a');
    expect(voices.revision).toMatch(SHA_RE);
  });

  test('voice set is exactly the 8 curated CC0 donations with the checkpoint suffix', () => {
    const patterns = download.extraRepos[0].allowPatterns;
    expect(patterns).toHaveLength(8);
    for (const p of patterns) {
      expect(p).toMatch(/^voice-donations\/[A-Za-z]+\.wav\.1e68beda@240\.safetensors$/);
    }
  });

  test('download voice set matches the Phase-0 preset catalog 1:1 (one store per concern, no drift)', () => {
    const catalogCC0 = VOICE_PRESET_CATALOG
      .find((s) => s.engine === 'kyutai')
      .voices.filter((v) => v.license === 'CC0')
      .map((v) => `${v.id}.1e68beda@240.safetensors`)
      .sort();
    expect([...download.extraRepos[0].allowPatterns].sort()).toEqual(catalogCC0);
  });

  test('no CC-BY-NC expresso path anywhere in the download set', () => {
    expect(JSON.stringify(download)).not.toContain('expresso');
  });
});
