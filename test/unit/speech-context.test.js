/**
 * The speech-context ring (backend/services/voice/speech-context.js) — pure
 * law with real inputs: the protocol's bounds (≤ 6 segments, ≤ 45 s), one
 * voice per ring, and the wire form (refs first, WAV inline). No mocks.
 */

import { describe, test, expect } from 'vitest';
import {
  RING_LIMITS, emptyContext, audioMsOf, forVoice, withSegment, pcmToWav, wireContext,
} from '../../backend/services/voice/speech-context.js';

const pcm = (seconds, rate = 24_000, fill = 1) => Buffer.alloc(Math.round(seconds * rate) * 2, fill);
const being = (words, seconds = 1, ref = null) => ({ speaker: 'being', words, pcm: pcm(seconds), sampleRate: 24_000, ref });
const person = (words, seconds = 1) => ({ speaker: 'person', words, pcm: pcm(seconds, 16_000), sampleRate: 16_000 });
const V = 'sha256:' + 'a'.repeat(64);
const W = 'sha256:' + 'b'.repeat(64);

describe('the ring bounds', () => {
  test('starts empty and keyed to no voice', () => {
    expect(emptyContext()).toEqual({ voiceRef: null, segments: [] });
  });

  test('audioMsOf reads s16le mono at the segment rate', () => {
    expect(audioMsOf(being('x', 2))).toBe(2000);
    expect(audioMsOf(person('x', 1.5))).toBe(1500);
  });

  test('never more than 6 segments — the oldest falls away', () => {
    let ring = emptyContext();
    for (let i = 0; i < 9; i += 1) ring = withSegment(ring, being(`s${i}`, 0.5), V);
    expect(ring.segments).toHaveLength(RING_LIMITS.maxSegments);
    expect(ring.segments.map((s) => s.words)).toEqual(['s3', 's4', 's5', 's6', 's7', 's8']);
  });

  test('never more than 45 s of audio — the oldest falls away', () => {
    let ring = emptyContext();
    for (let i = 0; i < 4; i += 1) ring = withSegment(ring, being(`s${i}`, 14), V);
    expect(ring.segments.map((s) => s.words)).toEqual(['s1', 's2', 's3']);
    expect(ring.segments.reduce((ms, s) => ms + audioMsOf(s), 0)).toBeLessThanOrEqual(RING_LIMITS.maxAudioMs);
  });

  test('a segment longer than the whole ring, or malformed, leaves the ring as it was', () => {
    const ring = withSegment(emptyContext(), being('kept'), V);
    expect(withSegment(ring, being('too long', 46), V).segments.map((s) => s.words)).toEqual(['kept']);
    expect(withSegment(ring, { speaker: 'being', words: '', pcm: pcm(1), sampleRate: 24_000 }, V)).toBe(ring);
    expect(withSegment(ring, { speaker: 'narrator', words: 'x', pcm: pcm(1), sampleRate: 24_000 })).toBe(ring);
    expect(withSegment(ring, { speaker: 'person', words: 'x', pcm: 'nope', sampleRate: 16_000 })).toBe(ring);
  });

  test('the ring is frozen — a caller cannot mutate it in place', () => {
    const ring = withSegment(emptyContext(), being('x'), V);
    expect(Object.isFrozen(ring)).toBe(true);
    expect(Object.isFrozen(ring.segments)).toBe(true);
  });
});

describe('one voice per ring', () => {
  test("a being segment in another voice drops the old voice's segments, keeps the person's", () => {
    let ring = withSegment(emptyContext(), being('old voice'), V);
    ring = withSegment(ring, person('the person said'));
    ring = withSegment(ring, being('new voice'), W);
    expect(ring.voiceRef).toBe(W);
    expect(ring.segments.map((s) => s.words)).toEqual(['the person said', 'new voice']);
  });

  test('forVoice reads the ring as another voice would see it, without changing it', () => {
    const ring = withSegment(withSegment(emptyContext(), being('mine'), V), person('theirs'));
    expect(forVoice(ring, V)).toBe(ring);
    expect(forVoice(ring, W).segments.map((s) => s.words)).toEqual(['theirs']);
    expect(forVoice(null, V)).toEqual({ voiceRef: V, segments: [] });
  });
});

describe('the wire form', () => {
  test('pcmToWav writes a valid RIFF/WAVE header around the samples', () => {
    const wav = pcmToWav(pcm(0.5, 16_000), 16_000);
    expect(wav.toString('latin1', 0, 4)).toBe('RIFF');
    expect(wav.toString('latin1', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(16_000);
    expect(wav.length).toBe(44 + 16_000);
  });

  test("a being segment with a ref travels by ref; the person's audio as WAV", () => {
    const ring = withSegment(withSegment(emptyContext(), being('hi', 1, 'utt:' + '1'.repeat(32)), V), person('hello'));
    const wire = wireContext(ring.segments);
    expect(wire[0]).toEqual({ speaker: 'being', words: 'hi', ref: 'utt:' + '1'.repeat(32) });
    expect(wire[1].speaker).toBe('person');
    expect(Buffer.from(wire[1].audio_b64, 'base64').toString('latin1', 0, 4)).toBe('RIFF');
  });

  test('inline (after a 409) sends every segment as WAV', () => {
    const ring = withSegment(emptyContext(), being('hi', 1, 'utt:' + '1'.repeat(32)), V);
    const [seg] = wireContext(ring.segments, { inline: true });
    expect(seg.ref).toBeUndefined();
    expect(Buffer.from(seg.audio_b64, 'base64').readUInt32LE(24)).toBe(24_000);
  });
});
