/**
 * Utterance capture (backend/services/voice/utterance-capture.js) — pure law
 * with real 16 kHz s16le PCM: the pre-roll before speech, everything during
 * it (bounded), and the line closed by its words. No mocks.
 */

import { describe, test, expect } from 'vitest';
import {
  CAPTURE, emptyCapture, withPcm, withSpeechStarted, takeUtterance,
} from '../../backend/services/voice/utterance-capture.js';

// `ms` of 16 kHz s16le, every sample carrying `mark` so order is traceable.
const chunk = (ms, mark) => {
  const b = Buffer.alloc(Math.round((ms * CAPTURE.sampleRate) / 1000) * 2);
  for (let i = 0; i < b.length; i += 2) b.writeInt16LE(mark, i);
  return b;
};
const msOf = (bytes) => (bytes / 2 / CAPTURE.sampleRate) * 1000;
const feed = (cap, chunks) => chunks.reduce(withPcm, cap);

describe('before speech: a rolling pre-roll only', () => {
  test('keeps the newest pre-roll, never more', () => {
    const cap = feed(emptyCapture(), [chunk(400, 1), chunk(400, 2), chunk(400, 3)]);
    expect(msOf(cap.bytes)).toBe(CAPTURE.preRollMs);
    const all = Buffer.concat(cap.chunks);
    expect(all.readInt16LE(all.length - 2)).toBe(3);
    expect(all.readInt16LE(0)).toBe(2); // the oldest kept is the tail of chunk 2
  });

  test('no speech heard → no segment, even with words', () => {
    const { segment, capture } = takeUtterance(feed(emptyCapture(), [chunk(400, 1)]), 'hello');
    expect(segment).toBe(null);
    expect(capture).toEqual(emptyCapture());
  });
});

describe('during speech: everything, bounded', () => {
  test('speech_started keeps the pre-roll and everything after it', () => {
    let cap = feed(emptyCapture(), [chunk(200, 1)]);
    cap = withSpeechStarted(cap);
    cap = feed(cap, [chunk(1000, 2), chunk(1000, 3)]);
    const { segment, capture } = takeUtterance(cap, '  the line I said  ');
    expect(segment).toMatchObject({ speaker: 'person', words: 'the line I said', sampleRate: 16_000 });
    expect(msOf(segment.pcm.length)).toBe(2200);
    expect(segment.pcm.readInt16LE(0)).toBe(1);
    expect(capture.bytes).toBe(0);
  });

  test('a line longer than MAX keeps its newest MAX ms', () => {
    let cap = withSpeechStarted(emptyCapture());
    for (let i = 0; i < 35; i += 1) cap = withPcm(cap, chunk(1000, i));
    expect(msOf(cap.bytes)).toBe(CAPTURE.maxMs);
    const pcm = takeUtterance(cap, 'long').segment.pcm;
    expect(pcm.readInt16LE(pcm.length - 2)).toBe(34);
    expect(pcm.readInt16LE(0)).toBe(5);
  });

  test('a blip under MIN ms, or no words, is not a line', () => {
    const blip = feed(withSpeechStarted(emptyCapture()), [chunk(100, 1)]);
    expect(takeUtterance(blip, 'uh').segment).toBe(null);
    const heard = feed(withSpeechStarted(emptyCapture()), [chunk(1000, 1)]);
    expect(takeUtterance(heard, '   ').segment).toBe(null);
  });

  test('speech_started twice is the same capture; empty or non-buffer PCM is ignored', () => {
    const cap = withSpeechStarted(emptyCapture());
    expect(withSpeechStarted(cap)).toBe(cap);
    expect(withPcm(cap, Buffer.alloc(0))).toBe(cap);
    expect(withPcm(cap, 'pcm')).toBe(cap);
  });

  test('an odd trim never splits a sample', () => {
    let cap = emptyCapture();
    cap = withPcm(cap, Buffer.alloc(16_001, 1));
    expect(cap.bytes % 2).toBe(0);
  });
});
