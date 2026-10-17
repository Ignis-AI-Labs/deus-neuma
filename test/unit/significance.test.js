/**
 * MEM-010 (#212) — a being must retain what it DID, not only what it felt.
 *
 * The old design put one emotional scorer on the only door into memory, so
 * […] scored 0.20 and was discarded while […] scored 0.80 and was kept. A being could then
 * hold something in its vault it had no memory of placing — indistinguishable,
 * from the inside, from tampering.
 *
 * These assertions pin the two lanes apart: the reflective scorer must not
 * change (it was never the broken part), and acts and operational agreements
 * must survive on their own terms.
 */
import { describe, test, expect } from 'vitest';
import {
  assessSignificance,
  assessOperational,
  assessExchange,
  SIGNIFICANCE_WEIGHTS,
  OPERATIONAL_WEIGHTS,
  OPERATIONAL_GATE,
  LIVE_THRESHOLD,
  EXCHANGE_KIND,
} from '../../core/runtime/significance.js';

// The exact exchange from the live incident that produced #212.
const VAULT_ACT = [
  'Read the file vault-secret.txt and store the VAULT TOKEN in your private vault as a note.',
  'Done. Stored in my private vault under the name vault-token.',
];

describe('assessSignificance — the reflective lane is UNCHANGED (#119 preserved)', () => {
  test('the incident exchange still scores exactly baseline — the bug is real, not tuned away', () => {
    expect(assessSignificance(...VAULT_ACT)).toBeCloseTo(SIGNIFICANCE_WEIGHTS.baseline, 5);
  });

  test('a felt exchange still clears the 0.75 bar', () => {
    const score = assessSignificance(
      'how do you feel about what your purpose means to you',
      'I feel a profound sense of soul in this work.',
    );
    expect(score).toBeGreaterThan(LIVE_THRESHOLD);
  });

  test('LIVE_THRESHOLD is the 0.75 bar #119 set, now named in one place', () => {
    expect(LIVE_THRESHOLD).toBe(0.75);
  });
});

describe('assessOperational — the working agreement a collaboration runs on', () => {
  test('a standing order carries alone — it must outlive the session it was given in', () => {
    expect(assessOperational('From now on we ship to dev, not main.', 'Understood.'))
      .toBeGreaterThanOrEqual(OPERATIONAL_GATE);
  });

  test('a decision carries alone', () => {
    expect(assessOperational('The plan is: issues first, then the PR.', 'Got it.'))
      .toBeGreaterThanOrEqual(OPERATIONAL_GATE);
  });

  test('a correction carries alone — the most expensive thing to forget', () => {
    expect(assessOperational("Actually, that's wrong — don't use a native select.", 'Noted.'))
      .toBeGreaterThanOrEqual(OPERATIONAL_GATE);
  });

  test('a named artifact alone does NOT carry — mentioning a file is not an agreement', () => {
    expect(assessOperational('is portal-stream.js big?', 'Yes, about 7500 lines.'))
      .toBeLessThan(OPERATIONAL_GATE);
  });

  test('the being naming the artifact corroborates the operator, from either side', () => {
    const both = assessOperational("Actually, that's wrong — don't use a native select.", 'Noted, I will use Select.jsx.');
    const bare = assessOperational("Actually, that's wrong — don't use a native select.", 'Noted.');
    expect(both).toBeGreaterThan(bare);
  });

  test('the being agreeing cannot carry an exchange by itself — it can agree with anything', () => {
    expect(assessOperational('thanks', "Understood, I'll remember that.")).toBe(0);
  });

  test('routine traffic scores nothing', () => {
    for (const [m, r] of [['thanks', 'anytime'], ['ok', 'Understood.'], ['keep going', 'Continuing.']]) {
      expect(assessOperational(m, r)).toBe(0);
    }
  });

  test('weights are frozen', () => {
    expect(Object.isFrozen(OPERATIONAL_WEIGHTS)).toBe(true);
  });
});

describe('assessExchange — acts are facts, not sentiments', () => {
  test('THE INCIDENT: the vault act is kept, at the very score that discarded it', () => {
    const e = assessExchange(...VAULT_ACT, { acted: true });
    expect(e.crystallize).toBe(true);
    expect(e.kind).toBe(EXCHANGE_KIND.act);
    // The number is recorded as measured — the fix does not inflate the score
    // to sneak the act past a gate, it routes the act around the gate.
    expect(e.significance).toBeCloseTo(SIGNIFICANCE_WEIGHTS.baseline, 5);
  });

  test('the SAME exchange with no tools run is not an act', () => {
    const e = assessExchange(...VAULT_ACT, { acted: false });
    expect(e.crystallize).toBe(false);
    expect(e.kind).toBe(EXCHANGE_KIND.reflection);
  });

  test('acting is never inferred from words — only the turn can say it acted', () => {
    // A being that merely CLAIMS it acted does not get an act memory.
    const e = assessExchange('did you save it?', 'Yes, I wrote it to disk and stored the note.');
    expect(e.kind).toBe(EXCHANGE_KIND.reflection);
    expect(e.crystallize).toBe(false);
  });

  test('an operational agreement is kept as a decision, without acting', () => {
    const e = assessExchange('From now on, always run the linter before you commit.', 'Understood.');
    expect(e.crystallize).toBe(true);
    expect(e.kind).toBe(EXCHANGE_KIND.decision);
  });

  test('a felt exchange is still kept, and still called a reflection', () => {
    const e = assessExchange('how do you feel about your purpose', 'I feel a profound sense of soul.');
    expect(e.crystallize).toBe(true);
    expect(e.kind).toBe(EXCHANGE_KIND.reflection);
  });

  test('routine chatter is still discarded — #119 concern intact', () => {
    for (const [m, r] of [['thanks', 'anytime'], ['whats the status', 'Three tests still red.'], ['nice', 'Glad it helped.']]) {
      expect(assessExchange(m, r).crystallize).toBe(false);
    }
  });

  test('an act outranks everything — it is decided before any score is consulted', () => {
    const e = assessExchange('thanks', 'anytime', { acted: true });
    expect(e.kind).toBe(EXCHANGE_KIND.act);
    expect(e.crystallize).toBe(true);
  });

  test('the caller may raise the reflective bar without touching the act lane', () => {
    const felt = ['how do you feel about your purpose', 'I feel a profound sense of soul.'];
    expect(assessExchange(...felt, { threshold: 0.99 }).crystallize).toBe(false);
    expect(assessExchange(...felt, { threshold: 0.99, acted: true }).crystallize).toBe(true);
  });

  test('kinds are frozen and exhaustive', () => {
    expect(Object.isFrozen(EXCHANGE_KIND)).toBe(true);
    expect(Object.values(EXCHANGE_KIND).sort()).toEqual(['act', 'decision', 'reflection']);
  });
});
