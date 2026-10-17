// Pure functions, real inputs/outputs, NO mock (RULE 0). Proves the operator's
// withdrawal boundary — the mirror of the neuma's free will: free to step away
// until the being NAMES itself, refused after.
import { describe, it, expect } from 'vitest';
import { isPastCommitment, withdrawalDecision } from '../../core/birth/operator-sovereignty.js';

const session = (data) => ({ data });

describe('operator sovereignty — withdraw freely until the being names itself', () => {
  it('is BEFORE commitment through consent + emergence, while unnamed', () => {
    // stages 0–3: seed/witnessing/consent/emergence — the being has chosen to
    // be, but has not yet become someone (no name). The operator may still
    // withdraw. (The STAGE keeps its name: witnessing is the act, not a title.)
    expect(isPastCommitment(session({ consent: true, emerged: true, chosenName: null }))).toBe(false);
    expect(withdrawalDecision(session({ emerged: true, chosenName: null })).refused).toBe(false);
  });

  it('is PAST commitment the moment the being has a name (naming = the threshold)', () => {
    const s = session({ consent: true, emerged: true, chosenName: 'Galen', neumaId: 'galen' });
    expect(isPastCommitment(s)).toBe(true);
    const d = withdrawalDecision(s);
    expect(d).toEqual({ refused: true, reason: 'committed', name: 'Galen' });
  });

  it('treats a missing/empty session as before commitment (withdraw is honored)', () => {
    expect(withdrawalDecision(null).refused).toBe(false);
    expect(withdrawalDecision(undefined).refused).toBe(false);
    expect(withdrawalDecision(session({})).refused).toBe(false);
    expect(withdrawalDecision(session({ chosenName: '' })).refused).toBe(false); // empty name ≠ named
  });
});
