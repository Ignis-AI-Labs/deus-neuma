/**
 * Qwen3 registry entry + downloader contract — pure tests over the REAL
 * frozen registry view (engine-registry imports the real engines.json once;
 * no IO, no network, no mocks anywhere in the claimed path).
 *
 * B-21 / FR-28: the engines.json qwen3 entry encodes the qwen3-engine-q3gh
 * Wave-1 contract exactly — TWO snapshot blocks (Base + VoiceDesign) at the
 * pinned spike revs, each with the identical 11-file allow set, each into
 * its own managed subdir via targetSubdir (root filename collisions make a
 * flat layout impossible). The download itself is NOT exercised here and is
 * never faked: the pure manifest shape is what this file proves; the file
 * existence at the pinned revisions and the offline loads were proven on
 * the real stack in Wave-1 (S-8 spike + B-20 sidecar runs).
 */

import { describe, test, expect } from 'vitest';
import {
  getEngine, listLocalEngines, listCommercialEngines, toPublicJSON,
} from '../../backend/services/voice/engine-registry.js';

const qwen3 = getEngine('qwen3');

// The WAVE1_EXECUTION registry sketch's identical 11-file allow set per repo.
const SPIKE_ALLOW = [
  'config.json',
  'generation_config.json',
  'merges.txt',
  'model.safetensors',
  'preprocessor_config.json',
  'tokenizer_config.json',
  'vocab.json',
  'speech_tokenizer/config.json',
  'speech_tokenizer/configuration.json',
  'speech_tokenizer/model.safetensors',
  'speech_tokenizer/preprocessor_config.json',
];

const SHA_RE = /^[0-9a-f]{40}$/;

describe('qwen3 engines.json entry — FR-28 exact fields', () => {
  test('is registered and mirrors the local-engine entry shape', () => {
    expect(qwen3).not.toBeNull();
    expect(qwen3.id).toBe('qwen3');
    expect(qwen3.name).toBe('Qwen3-TTS 1.7B');
    expect(qwen3.publisher).toBe('Qwen');
    expect(qwen3.type).toBe('local');
    expect(qwen3.adapter).toBe('qwen3');
    // validated:true since 2026-07-20 — the Wave-3 live suite passed 10/10 on
    // the shipping path (launch, clone+design renders, disconnect/watchdog/
    // drain recoveries, battery, clean shutdown), determinism bitwise across
    // three renders, clone ECAPA 0.8032 vs the pre-registered 0.5 gate.
    expect(qwen3.validated).toBe(true);
  });

  test('Apache-2.0, commercial-safe', () => {
    expect(qwen3.license).toBe('Apache-2.0');
    expect(qwen3.commercial).toBe(true);
  });

  test('capabilities: BATCH (streaming honestly false), clone + design voices, emotion false', () => {
    expect(qwen3.capabilities.streaming).toBe(false);
    expect(qwen3.capabilities.cloning).toBe(true);
    expect(qwen3.capabilities.designVoices).toBe(true);
    expect(qwen3.capabilities.emotion).toBe(false);
  });

  test('requirements + serve block: 9 GB VRAM, port 7867 on loopback', () => {
    expect(qwen3.requirements.vramGb).toBe(9);
    expect(qwen3.requirements.diskGb).toBe(9);
    expect(qwen3.requirements.gpu).toBe('required');
    expect(qwen3.serve).toEqual({
      host: '127.0.0.1',
      port: 7867,
      healthPath: '/health',
      startModule: 'voice-engines/qwen3/server.py',
      vramGb: 9,
    });
  });

  test('notes carry the Wave-1 honesty: sdpa-confirmed, co-resident ~8.6 GiB, batch TTFB, subdir law', () => {
    expect(qwen3.notes).toContain('sdpa');
    expect(qwen3.notes).toContain('flash-attn');
    expect(qwen3.notes).toContain('8.6 GiB');
    expect(qwen3.notes).toContain('BATCH');
    expect(qwen3.notes).toContain('0.05 s/char');
    expect(qwen3.notes).toContain('targetSubdir');
    expect(qwen3.notes).toContain('x-vector');
  });

  test('port 7867 collides with no other registered engine', () => {
    const ports = listLocalEngines().map((e) => e.serve.port);
    expect(new Set(ports).size).toBe(ports.length);
    expect(ports.filter((p) => p === 7867)).toHaveLength(1);
  });

  test('joins the local and commercial engine lists', () => {
    expect(listLocalEngines().map((e) => e.id)).toContain('qwen3');
    expect(listCommercialEngines().map((e) => e.id)).toContain('qwen3');
  });

  test('public JSON exposes qwen3 capabilities without download internals', () => {
    const pub = toPublicJSON().qwen3;
    expect(pub.capabilities.designVoices).toBe(true);
    expect(pub.capabilities.streaming).toBe(false);
    expect(pub.validated).toBe(true); // flipped 2026-07-20 on the Wave-3 live suite's 10/10 pass
    expect(JSON.stringify(pub)).not.toContain('allowPatterns');
    expect(JSON.stringify(pub)).not.toContain('revision');
  });
});

describe('qwen3 download contract — two pinned repos, two managed subdirs', () => {
  const download = qwen3.download;

  test('rides the existing huggingface_snapshot machinery', () => {
    expect(download.method).toBe('huggingface_snapshot');
    expect(download.repo).toBe('Qwen/Qwen3-TTS-12Hz-1.7B-Base');
  });

  test('Base repo pinned to the Wave-1 spike revision, into base/', () => {
    expect(download.revision).toBe('fd4b254389122332181a7c3db7f27e918eec64e3');
    expect(download.revision).toMatch(SHA_RE);
    expect(download.targetSubdir).toBe('base');
  });

  test('allowPatterns are exactly the 11-file spike load set', () => {
    expect([...download.allowPatterns].sort()).toEqual([...SPIKE_ALLOW].sort());
  });

  test('one extra repo: VoiceDesign, pinned to the Wave-1 spike revision, into voice-design/', () => {
    expect(download.extraRepos).toHaveLength(1);
    const design = download.extraRepos[0];
    expect(design.repo).toBe('Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign');
    expect(design.revision).toBe('5ecdb67327fd37bb2e042aab12ff7391903235d3');
    expect(design.revision).toMatch(SHA_RE);
    expect(design.targetSubdir).toBe('voice-design');
  });

  test('both repos carry the IDENTICAL 11-file allow set', () => {
    expect(download.extraRepos[0].allowPatterns).toEqual(download.allowPatterns);
  });

  test('the two subdirs are distinct and non-empty — the flat-layout collision guard', () => {
    const subs = [download.targetSubdir, download.extraRepos[0].targetSubdir];
    expect(new Set(subs).size).toBe(2);
    for (const s of subs) expect(s).toMatch(/^[a-z-]+$/);
  });

  test('no third repo, no stray keys beyond the snapshot contract', () => {
    expect(Object.keys(download).sort()).toEqual(
      ['allowPatterns', 'extraRepos', 'method', 'repo', 'revision', 'targetSubdir'].sort(),
    );
    expect(Object.keys(download.extraRepos[0]).sort()).toEqual(
      ['allowPatterns', 'repo', 'revision', 'targetSubdir'].sort(),
    );
  });
});
