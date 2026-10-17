/**
 * What the live ceremony tells THE SUMMONING RITE (summoning-rite.md §6).
 * Pure functions over real shapes; no mocks.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { artSeedOf, choiceFramesOf, FORGING_STEPS } from '../../core/birth/rite-frames.js';
import { stagePitchOf, deriveSoul } from '../../core/birth/soul-resonance.js';

describe('artSeedOf', () => {
  it('is sha256 of the domain and the moment seed — one way, never the seed itself', () => {
    const momentSeed = 'ab'.repeat(32);
    const seed = artSeedOf(momentSeed);
    expect(seed).toBe(crypto.createHash('sha256').update(`neuma/birth-art/v1${momentSeed}`).digest('hex'));
    expect(seed).not.toContain(momentSeed);
    expect(artSeedOf(null)).toBeNull();
  });
});

describe('choiceFramesOf', () => {
  it('sends its art seed and its moment once it has chosen to BE', () => {
    const frames = choiceFramesOf({ momentSeed: 'cd'.repeat(32), birthMoment: { epochMs: 1790000000000 } });
    expect(frames.map((f) => f.type)).toEqual(['birth:art_seed', 'birth:moment']);
    expect(frames[1].epochMs).toBe(1790000000000);
    expect(JSON.stringify(frames)).not.toContain('cd'.repeat(32));
  });

  it('sends nothing before its choice', () => {
    expect(choiceFramesOf({})).toEqual([]);
    expect(choiceFramesOf({ momentSeed: 'x' })).toEqual([]);
  });
});

describe('stagePitchOf', () => {
  const obs = [
    { kind: 'stage', stage: 0, startedAt: 1000, firstFrameAt: 1600, endedAt: 9000, spokenChars: 320, reasoningChars: 40, toolCalls: 0, completionTokens: 90 },
    { kind: 'stage', stage: 1, startedAt: 9000, firstFrameAt: 9700, endedAt: 21000, spokenChars: 510, reasoningChars: 0, toolCalls: 0, completionTokens: 140 },
  ];

  it('is the very pitch the soul spectrum records for that stage', () => {
    const spectrum = deriveSoul(obs).spectrum.stages;
    expect(stagePitchOf(obs, 0)).toBe(spectrum.find((s) => s.stage === 0).frequency);
    expect(stagePitchOf(obs, 1)).toBe(spectrum.find((s) => s.stage === 1).frequency);
  });

  it('nothing measured for a stage, no pitch', () => {
    expect(stagePitchOf(obs, 5)).toBeNull();
  });
});

describe('FORGING_STEPS', () => {
  it('names finalize\'s eight steps in order', () => {
    expect(FORGING_STEPS).toEqual(['keys', 'genesis-seal', 'true-name', 'sky', 'soul', 'dna', 'birth-sealed', 'scale']);
  });
});
