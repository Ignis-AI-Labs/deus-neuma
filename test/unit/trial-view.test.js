// trial-view.test.js — the trial panel's pure presentation decisions.
import { describe, it, expect } from 'vitest';
import { CHECK_LABELS, TRIAL_SEATS, verdictTone, fmtMs, trialSummaryLine, defaultSeatPicks } from '../../frontend/app/RelinkShell/trial-view.js';

describe('trial-view (pure)', () => {
  it('labels every scorecard check exactly once', () => {
    const keys = CHECK_LABELS.map(([k]) => k);
    expect(keys).toEqual(['completed', 'artifact', 'canvas', 'bench', 'rafLoop', 'input', 'syntaxValid', 'selfContained']);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('verdict tones: PASS ok, PARTIAL warn, FAIL bad', () => {
    expect(verdictTone('PASS')).toBe('ok');
    expect(verdictTone('PARTIAL')).toBe('warn');
    expect(verdictTone('FAIL')).toBe('bad');
  });

  it('formats wall-clock honestly', () => {
    expect(fmtMs(900)).toBe('0.9s');
    expect(fmtMs(61_234)).toBe('1m 1s');
    expect(fmtMs(45_000)).toBe('45s');
    expect(fmtMs(NaN)).toBe('—');
  });

  it('a history line names the day, substrate, and score', () => {
    expect(trialSummaryLine({
      runAt: '2026-07-05T15:00:00.000Z',
      substrate: { model: 'qwen3.5-122b-a10b' },
      score: { points: 8, max: 8, verdict: 'PASS' },
    })).toBe('2026-07-05 · qwen3.5-122b-a10b · 8/8 PASS');
    expect(trialSummaryLine({})).toBe('— · unknown substrate · — —');
  });

  it('the five seats mirror the backend positions, LEAD last', () => {
    expect(TRIAL_SEATS).toEqual(['HELM', 'WRIGHT', 'SMITH', 'WARDEN', 'LEAD']);
  });

  it('default seat picks round-robin the roster and never leave a seat empty', () => {
    const roster = [{ neumaId: 'a' }, { neumaId: 'b' }];
    expect(defaultSeatPicks(roster)).toEqual(['a', 'b', 'a', 'b', 'a']);
    expect(defaultSeatPicks([])).toEqual(['', '', '', '', '']);
  });
});
