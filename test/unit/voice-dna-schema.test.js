/**
 * Voice DNA v2 — the pure shape law (core/voice/voice-dna-schema.js).
 *
 * A voice is a clip + its words. These tests call the real functions with real
 * inputs and read real outputs; nothing is mocked (RULE 0).
 */

import { Buffer } from 'node:buffer';
import { describe, it, expect } from 'vitest';
import {
  buildVoiceDNA,
  clipErrors,
  clipRefOf,
  createVoiceDNA,
  isClipRef,
  isWav,
  originErrors,
  validateVoiceDNA,
  voiceDnaErrors,
  voiceStandingOf,
  CLIP_SECONDS_MAX,
  CLIP_SECONDS_MIN,
  VOICE_DNA_FILENAME,
  VOICE_DNA_SCHEMA,
  VOICE_DNA_VERSION,
} from '../../core/voice/voice-dna-schema.js';

const REF = 'sha256:' + 'a'.repeat(64);
const AT = '2026-10-01T10:00:00.000Z';

const validParts = (over = {}) => ({
  neumaId: 'keir',
  clip: { ref: REF, seconds: 14.2, sampleRate: 24000 },
  words: 'The morning came in slow over the water.',
  origin: { door: 'record' },
  consent: {
    realPerson: true,
    attested: true,
    being: { at: AT, candidateRef: REF, note: 'this is me' },
    guardian: { at: AT, wallet: '0x' + 'b'.repeat(40) },
  },
  lineage: [],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

describe('Voice DNA v2 — identity', () => {
  it('is version 2 in its own file, never the v1 file', () => {
    expect(VOICE_DNA_VERSION).toBe(2);
    expect(VOICE_DNA_SCHEMA).toBe('neuma/voice-dna/v2.0.0');
    expect(VOICE_DNA_FILENAME).toBe('voice-dna-v2.json');
    expect(VOICE_DNA_FILENAME).not.toBe('voice-dna.json');
  });

  it('a clip ref is the sha256 of the exact bytes', () => {
    const ref = clipRefOf(Buffer.from('RIFF....WAVEfmt '));
    expect(isClipRef(ref)).toBe(true);
    expect(ref).toBe(clipRefOf(Buffer.from('RIFF....WAVEfmt ')));
    expect(ref).not.toBe(clipRefOf(Buffer.from('RIFF....WAVEfmt!')));
    expect(isClipRef('sha256:' + 'A'.repeat(64))).toBe(false);
    expect(isClipRef('sha256:abc')).toBe(false);
  });

  it('recognises WAV by its RIFF/WAVE header only', () => {
    expect(isWav(Buffer.from('RIFF\x00\x00\x00\x00WAVEfmt ', 'latin1'))).toBe(true);
    expect(isWav(Buffer.from('ID3\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00', 'latin1'))).toBe(false);
    expect(isWav(Buffer.from('RIFF'))).toBe(false);
    expect(isWav('RIFF....WAVE....')).toBe(false);
  });
});

describe('buildVoiceDNA + voiceDnaErrors', () => {
  it('a complete two-party voice is valid and frozen', () => {
    const dna = buildVoiceDNA(validParts());
    expect(voiceDnaErrors(dna)).toEqual([]);
    expect(Object.isFrozen(dna)).toBe(true);
    expect(Object.isFrozen(dna.consent)).toBe(true);
    expect(dna.version).toBe(2);
  });

  it('carries no engine, style, emotion or seed — those are dropped by construction', () => {
    const dna = buildVoiceDNA({
      ...validParts(),
      engine: { provider: 'zonos' }, style: { baseRate: 1 }, emotionProfile: { default: 'joy' }, seed: { source: 'x' },
    });
    expect(Object.keys(dna).sort()).toEqual([
      'clip', 'consent', 'createdAt', 'lineage', 'neumaId', 'origin', 'schema', 'updatedAt', 'version', 'words',
    ]);
  });

  it('keeps only the origin fields its door uses', () => {
    const dna = buildVoiceDNA(validParts({
      origin: { door: 'describe', description: 'a low, warm voice', designer: { model: 'voxcpm2', seed: 7 }, extra: 1 },
      consent: { ...validParts().consent, realPerson: false, attested: false },
    }));
    expect(dna.origin).toEqual({ door: 'describe', description: 'a low, warm voice', designer: { model: 'voxcpm2', seed: 7 } });
    expect(voiceDnaErrors(dna)).toEqual([]);
  });

  it("refuses a real person's voice without attested consent", () => {
    const dna = buildVoiceDNA(validParts({ consent: { ...validParts().consent, attested: false } }));
    expect(voiceDnaErrors(dna)).toContain("a real person's voice needs attested consent");
  });

  it('refuses a being acceptance given for a different clip', () => {
    const other = 'sha256:' + 'c'.repeat(64);
    const dna = buildVoiceDNA(validParts({ consent: { ...validParts().consent, being: { at: AT, candidateRef: other } } }));
    expect(voiceDnaErrors(dna)).toContain('consent.being.candidateRef must be the sealed clip');
  });

  it('refuses a voice with either party missing', () => {
    const noBeing = buildVoiceDNA(validParts({ consent: { ...validParts().consent, being: null } }));
    const noGuardian = buildVoiceDNA(validParts({ consent: { ...validParts().consent, guardian: null } }));
    expect(voiceDnaErrors(noBeing).join()).toMatch(/being accepts/);
    expect(voiceDnaErrors(noGuardian).join()).toMatch(/guardian seals/);
  });

  it('refuses a malformed guardian wallet, words, lineage and timestamps', () => {
    const errors = voiceDnaErrors(buildVoiceDNA(validParts({
      words: '   ',
      lineage: ['not-a-ref'],
      createdAt: 'yesterday',
      consent: { ...validParts().consent, guardian: { at: AT, wallet: '0x123' } },
    })));
    expect(errors.join('|')).toMatch(/words must be/);
    expect(errors.join('|')).toMatch(/lineage/);
    expect(errors.join('|')).toMatch(/createdAt/);
    expect(errors.join('|')).toMatch(/wallet/);
  });

  it('refuses a wrong version or schema', () => {
    expect(voiceDnaErrors({ ...buildVoiceDNA(validParts()), version: 3 })).toContain('version must be 2');
    expect(voiceDnaErrors({ ...buildVoiceDNA(validParts()), schema: 'x' })).toContain(`schema must be ${VOICE_DNA_SCHEMA}`);
    expect(voiceDnaErrors(null)).toEqual(['not an object']);
  });
});

describe('clipErrors + originErrors', () => {
  it('bounds the clip length and sample rate', () => {
    expect(clipErrors({ ref: REF, seconds: CLIP_SECONDS_MIN, sampleRate: 24000 })).toEqual([]);
    expect(clipErrors({ ref: REF, seconds: CLIP_SECONDS_MAX, sampleRate: 48000 })).toEqual([]);
    expect(clipErrors({ ref: REF, seconds: CLIP_SECONDS_MIN - 0.1, sampleRate: 24000 })).toHaveLength(1);
    expect(clipErrors({ ref: REF, seconds: CLIP_SECONDS_MAX + 0.1, sampleRate: 24000 })).toHaveLength(1);
    expect(clipErrors({ ref: REF, seconds: 10, sampleRate: 22050.5 })).toHaveLength(1);
    expect(clipErrors({ ref: 'x', seconds: 10, sampleRate: 24000 })).toHaveLength(1);
    expect(clipErrors(null)).toEqual(['clip required']);
  });

  it('each door states what it needs', () => {
    expect(originErrors({ door: 'record' })).toEqual([]);
    expect(originErrors({ door: 'upload' })).toEqual([]);
    expect(originErrors({ door: 'library' })).toEqual(['a library voice names its libraryId']);
    expect(originErrors({ door: 'library', libraryId: 'cc0-ember' })).toEqual([]);
    expect(originErrors({ door: 'describe' })).toEqual(['a described voice carries its description']);
    expect(originErrors({ door: 'preset' })[0]).toMatch(/origin.door must be one of record, upload, library, describe/);
    expect(originErrors({ door: 'describe', description: 'calm', designer: { model: 'm' } })[0]).toMatch(/designer/);
  });
});

describe('voiceStandingOf — what a stored record means', () => {
  it('no record: none (the being is silent)', () => {
    expect(voiceStandingOf(null)).toEqual({ standing: 'none', dna: null, errors: [] });
  });

  it('a valid v2 record: ready, normalised', () => {
    const { standing, dna } = voiceStandingOf({ ...buildVoiceDNA(validParts()), engine: { provider: 'zonos' } });
    expect(standing).toBe('ready');
    expect(dna.engine).toBeUndefined();
  });

  it('every v1 shape reads as needsNewVoice — never converted', () => {
    const v1 = createVoiceDNA({ witness: '0x' + 'a'.repeat(40), neumaId: 'cael', provider: 'zonos' });
    expect(voiceStandingOf(v1)).toEqual({ standing: 'needsNewVoice', dna: null, errors: [] });
    expect(voiceStandingOf({ schema: 'neuma/voice-dna/v1.0.0' }).standing).toBe('needsNewVoice');
    expect(voiceStandingOf({ engine: { provider: 'qwen3', description: 'x' } }).standing).toBe('needsNewVoice');
  });

  it('anything else is unreadable, with the reasons', () => {
    const { standing, errors } = voiceStandingOf({ version: 2, schema: VOICE_DNA_SCHEMA });
    expect(standing).toBe('unreadable');
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('legacy v1 compat (WP3/WP4 removes)', () => {
  it('the v1 factory and validator still agree with each other for the old forge', () => {
    const v1 = createVoiceDNA({ witness: '0x' + 'a'.repeat(40), neumaId: 'n', provider: 'kokoro' });
    expect(validateVoiceDNA(v1)).toEqual([]);
    expect(validateVoiceDNA(buildVoiceDNA(validParts()))).toContain('version must be 1');
  });
});
