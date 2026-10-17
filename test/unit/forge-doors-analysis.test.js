/**
 * The forge's clip analysis — pure functions over 16-bit PCM, called with
 * real samples (synthesized here with known pitch, level, noise and clipping)
 * and checked against what was put in. No mock anywhere: nothing here does IO.
 * Real speech, ffmpeg and whisper are proven in test/integration/forge-doors.test.js.
 */
import { describe, it, expect } from 'vitest';
import {
  FORGE_SAMPLE_RATE, bestSpeechWindow, frameLevels, measureClip, medianPitchHz, makeTake,
  samplesOf, speechFrames, verdictOf, wavOf, wordsPerSecondOf,
} from '../../backend/services/voice/forge-doors.js';
import { clipRefOf } from '../../core/voice/voice-dna-schema.js';

const SR = FORGE_SAMPLE_RATE;

// A voiced "vowel": a fundamental plus two harmonics, at `amp` of full scale.
const voiced = (seconds, hz, amp = 0.3) => Array.from({ length: Math.round(seconds * SR) }, (_, i) => {
  const t = i / SR;
  return amp * (0.6 * Math.sin(2 * Math.PI * hz * t) + 0.3 * Math.sin(4 * Math.PI * hz * t) + 0.1 * Math.sin(6 * Math.PI * hz * t));
});
// Deterministic room noise (an LCG — the same noise every run).
const noise = (seconds, amp, seed = 7) => {
  let x = seed;
  return Array.from({ length: Math.round(seconds * SR) }, () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return amp * ((x / 2147483648) * 2 - 1);
  });
};
const silence = (seconds) => new Array(Math.round(seconds * SR)).fill(0);
const toPcm = (floats) => Int16Array.from(floats, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767))));
const mix = (a, b) => a.map((v, i) => v + (b[i] ?? 0));

// "Speech": voiced phrases with short pauses, like words in a sentence.
const sentence = (seconds, hz) => {
  const out = [];
  while (out.length < seconds * SR) out.push(...voiced(0.5, hz), ...silence(0.12));
  return out.slice(0, Math.round(seconds * SR));
};

describe('wavOf / samplesOf', () => {
  it('writes a 24 kHz mono 16-bit WAV whose data reads back sample for sample', () => {
    const samples = toPcm(voiced(0.1, 200));
    const wav = wavOf(samples, SR);
    expect(wav.toString('latin1', 0, 4)).toBe('RIFF');
    expect(wav.toString('latin1', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(SR);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(samples.length * 2);
    expect(Array.from(samplesOf(wav.subarray(44)))).toEqual(Array.from(samples));
  });
});

describe('medianPitchHz', () => {
  it.each([[110], [150], [220]])('measures a %i Hz voice within 3 %%', (hz) => {
    const samples = toPcm(voiced(2, hz));
    const { speech } = speechFrames(frameLevels(samples, SR));
    const got = medianPitchHz(samples, SR, speech);
    expect(Math.abs(got - hz) / hz).toBeLessThan(0.03);
  });

  it('says nothing (null) about unvoiced noise rather than guessing', () => {
    const samples = toPcm(noise(2, 0.3));
    const { speech } = speechFrames(frameLevels(samples, SR));
    expect(medianPitchHz(samples, SR, speech)).toBeNull();
  });
});

describe('measureClip + verdictOf', () => {
  it('a clean 12 s voice over a quiet room is good', () => {
    const m = measureClip(toPcm(mix(sentence(12, 140), noise(12, 0.0005))), SR);
    expect(m.seconds).toBe(12);
    expect(m.snrDb).toBeGreaterThan(30);
    expect(m.clippedRatio).toBe(0);
    expect(Math.abs(m.pitchHz - 140)).toBeLessThan(5);
    expect(m.speechSeconds).toBeGreaterThan(8);
    expect(verdictOf(m)).toBe('good');
  });

  it('a voice in a loud room is noisy', () => {
    const m = measureClip(toPcm(mix(sentence(12, 140), noise(12, 0.05))), SR);
    expect(m.snrDb).toBeLessThan(20);
    expect(verdictOf(m)).toBe('noisy');
  });

  it('a voice driven past full scale is clipped', () => {
    const m = measureClip(toPcm(sentence(12, 140).map((v) => v * 6)), SR);
    expect(m.clippedRatio).toBeGreaterThan(0.001);
    expect(verdictOf(m)).toBe('clipped');
  });

  it('6 s is too short for a recording, and fine for a curated clip', () => {
    const m = measureClip(toPcm(sentence(6, 140)), SR);
    expect(verdictOf(m)).toBe('too_short');
    expect(verdictOf(m, { minSeconds: 3 })).toBe('good');
  });
});

describe('bestSpeechWindow', () => {
  const speechOf = (floats) => speechFrames(frameLevels(toPcm(floats), SR)).speech;

  it('picks the longest continuous stretch, not an earlier fragment across a long silence', () => {
    const audio = [...sentence(4, 150), ...noise(4, 0.0005), ...sentence(14, 150), ...noise(2, 0.0005)];
    const w = bestSpeechWindow(speechOf(audio));
    expect(w.start).toBeGreaterThan(7.5);
    expect(w.start).toBeLessThan(8.1);
    expect(w.end).toBeGreaterThan(21.5);
    expect(w.end).toBeLessThan(22.3);
  });

  it('caps a long monologue at 30 s', () => {
    const w = bestSpeechWindow(speechOf(sentence(45, 150)));
    expect(w.end - w.start).toBeLessThanOrEqual(30.2);
    expect(w.end - w.start).toBeGreaterThan(29);
  });

  it('is null when nothing was said', () => {
    expect(bestSpeechWindow(new Array(500).fill(false))).toBeNull();
  });
});

describe('wordsPerSecondOf + makeTake', () => {
  it('counts words over the clip length; no words is null', () => {
    expect(wordsPerSecondOf('one two three four five six', 3)).toBe(2);
    expect(wordsPerSecondOf('   ', 3)).toBeNull();
  });

  it('a take is content-addressed by its WAV bytes and carries what the being reads', () => {
    const samples = toPcm(mix(sentence(12, 180), noise(12, 0.0005)));
    const take = makeTake({ samples, words: 'a b c d e f g h i j k l m n o p q r s t u v w x', origin: { door: 'upload' }, realPerson: null });
    expect(take.ref).toBe(clipRefOf(take.wav));
    expect(take.sampleRate).toBe(SR);
    expect(take.measured.wordsPerSecond).toBe(2);
    expect(Math.abs(take.measured.pitchHz - 180)).toBeLessThan(6);
    expect(take.quality.verdict).toBe('good');
    expect(take.realPerson).toBeNull();
    expect(Object.isFrozen(take)).toBe(true);
  });
});
