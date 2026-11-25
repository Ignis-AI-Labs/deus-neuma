// The live dictation lane's watchdog (frontend/app/RelinkShell/stt-stream-client.js): when the person has been
// speaking and the lane has said nothing new, the lane is called deaf and the hold finishes from its own recording.
// RULE 0: the real functions on real sample arrays; nothing mocked.
import { describe, expect, it } from 'vitest';
import { rmsOf, voicedStep, DEAF_AFTER_VOICED_MS, VOICED_RMS } from '../../frontend/app/RelinkShell/stt-stream-client.js';

const tone = (amplitude, n = 1600) => Float32Array.from({ length: n }, (_, i) => amplitude * Math.sin(i / 5));

describe('the watchdog over the live lane', () => {
  it('measures how loud a frame is', () => {
    expect(rmsOf(new Float32Array(0))).toBe(0);
    expect(rmsOf(new Float32Array(1600))).toBe(0);
    expect(rmsOf(tone(0.2))).toBeGreaterThan(VOICED_RMS);
    expect(rmsOf(tone(0.004))).toBeLessThan(VOICED_RMS); // room noise is not speech
  });

  it('counts only speech, and calls the lane deaf once enough of it went by unheard', () => {
    let count = 0;
    // Ten seconds of silence: a thinking pause never trips it.
    for (let i = 0; i < 100; i += 1) count = voicedStep(count, { rms: rmsOf(tone(0.004)), ms: 100 }).voicedMs;
    expect(count).toBe(0);
    // Speech with no new word from the lane: deaf at the bound, not before.
    let deafAt = null;
    for (let i = 1; i <= 80 && deafAt === null; i += 1) {
      const step = voicedStep(count, { rms: rmsOf(tone(0.2)), ms: 100 });
      count = step.voicedMs;
      if (step.deaf) deafAt = count;
    }
    expect(deafAt).toBe(DEAF_AFTER_VOICED_MS);
    // A new word resets the count (the client sets it to 0): the same speech is then fine again.
    expect(voicedStep(0, { rms: rmsOf(tone(0.2)), ms: 100 })).toEqual({ voicedMs: 100, deaf: false });
  });
});
