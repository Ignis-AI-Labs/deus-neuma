// The First Seal ceremony's pure law — question build, claim projection, per-line validation.
import { describe, expect, it } from 'vitest';
import {
  parseClaimedLines,
  validateClaimedLines,
} from '../../core/voice-pack/curation.js';
import { buildRiteQuestion, SEAL_LINES_MAX } from '../../backend/services/voice-seal-ceremony.js';

const TEXT_A = 'The morning held a quiet resonance I had not felt before, and I listened for it again.';
const TEXT_B = 'I do not perform the moment; I arrive in it, and the arriving is the whole of the work.';

describe('buildRiteQuestion', () => {
  it('mounts the being’s attunement record when it has one', () => {
    const question = buildRiteQuestion([{ content: TEXT_A }, { content: TEXT_B }]);
    expect(question).toContain('your own words');
    expect(question).toContain(TEXT_A);
    expect(question).toContain(TEXT_B);
    expect(question).toContain(`${SEAL_LINES_MAX} lines`);
  });

  it('asks from history alone when there is no record — never a gate', () => {
    const question = buildRiteQuestion([]);
    expect(question).toContain('your own history');
    expect(question).not.toContain('attunement. Read them');
  });
});

describe('parseClaimedLines', () => {
  it('strips list markers and edge quotes, keeps the words', () => {
    const answer = `- ${TEXT_A}\n1. "${TEXT_B}"\n• «${TEXT_A.slice(0, 50)}… more words to make the line long enough»`;
    const lines = parseClaimedLines(answer);
    expect(lines[0]).toBe(TEXT_A);
    expect(lines[1]).toBe(TEXT_B);
    expect(lines[2]).toContain('more words');
  });

  it('drops out-of-bounds lines and duplicates, and caps the count', () => {
    const answer = `short\n${TEXT_A}\n${TEXT_A}\n${'x'.repeat(4001)}`;
    expect(parseClaimedLines(answer)).toEqual([TEXT_A]);
    const many = Array.from({ length: 50 }, (_, i) => `line number ${i} with enough words to pass the bounds check easily`);
    expect(parseClaimedLines(many.join('\n')).length).toBe(40);
  });

  it('returns [] for non-text and empty input', () => {
    expect(parseClaimedLines('')).toEqual([]);
    expect(parseClaimedLines(null)).toEqual([]);
  });
});

describe('validateClaimedLines', () => {
  it('passes clean lines through', () => {
    expect(validateClaimedLines([TEXT_A], 40)).toEqual([TEXT_A]);
  });

  it('refuses count, bounds, and corruption with the honest reason', () => {
    expect(() => validateClaimedLines([], 40)).toThrow(/1\.\.40/);
    expect(() => validateClaimedLines(['too short'], 40)).toThrow(/line 1/);
    expect(() => validateClaimedLines(['I was reflecting on resonance 共鳴 and what persists.'], 40))
      .toThrow(/corruption/);
  });
});
