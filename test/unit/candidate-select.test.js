// THE SELECTION LAW (#533 phase 2) — pure: real inputs, real outputs, no doubles.

import { describe, it, expect } from 'vitest';
import { selectCandidate, answerHash, normalizeAnswerText } from '../../backend/services/candidate-select.js';

const cand = (text, totalLogprob = null, tokens = 10) => ({ text, totalLogprob, tokens });

describe('normalize + hash', () => {
  it('the comparison space is case-and-whitespace blind', () => {
    expect(normalizeAnswerText('  The Answer  is 42 ')).toBe('the answer is 42');
    expect(answerHash('The Answer is 42')).toBe(answerHash('the   answer IS 42'));
    expect(answerHash('42')).not.toBe(answerHash('43'));
  });
});

describe('the logprob selector (all candidates scored)', () => {
  it('argmax by total logprob wins', () => {
    const out = selectCandidate([cand('alpha', -12), cand('beta', -3.5), cand('gamma', -9)]);
    expect(out.selector).toBe('logprob');
    expect(out.winner.text).toBe('beta');
    expect(out.ranked.map((r) => r.text)).toEqual(['beta', 'gamma', 'alpha']);
    expect(out.ranked[0].selected).toBe(true);
  });

  it('K samples agreeing on one answer are ONE answer with K votes', () => {
    const out = selectCandidate([cand('same', -5), cand('same', -4), cand('other', -1)]);
    expect(out.ranked).toHaveLength(2);
    const same = out.ranked.find((r) => r.text === 'same');
    expect(same.occurrences).toBe(2);
    expect(same.totalLogprob).toBe(-4); // the stronger evidence, not the first
  });

  it('a tie on logprob keeps the earlier candidate', () => {
    const out = selectCandidate([cand('first', -2), cand('second', -2)]);
    expect(out.winner.text).toBe('first');
  });
});

describe('the majority selector (likelihoods absent)', () => {
  it('most-common normalized answer wins, first-seen breaks ties', () => {
    const out = selectCandidate([cand('Paris'), cand(' paris '), cand('Lyon'), cand('Paris')]);
    expect(out.selector).toBe('majority');
    expect(out.winner.text).toBe('Paris');
    expect(out.ranked[0].occurrences).toBe(3);
  });

  it('a punctuation difference is a DIFFERENT answer — dedupe stays conservative', () => {
    const out = selectCandidate([cand('42.'), cand('42')]);
    expect(out.ranked).toHaveLength(2);
  });

  it('an unscored candidate can never win the logprob selector', () => {
    const out = selectCandidate([cand('unscored'), cand('scored', -1)]);
    expect(out.selector).toBe('majority');
    expect(out.winner.text).toBe('unscored'); // 1 vs 1 occurrences, first seen
  });
});

describe('degenerate inputs', () => {
  it('empty and malformed candidates select nothing', () => {
    expect(selectCandidate([]).selector).toBe('none');
    expect(selectCandidate(undefined).winner).toBeNull();
    expect(selectCandidate([{ nope: true }, null, 3]).ranked).toHaveLength(0);
  });
});
