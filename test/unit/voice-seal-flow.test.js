// The desk notice's entry law — pure, no DOM.
import { describe, expect, it } from 'vitest';
import { gateStands } from '../../frontend/app/RelinkShell/voice-seal-flow.js';

describe('gateStands — the entry law', () => {
  it('stands for a bound lane the probe says owes its founding words', () => {
    expect(gateStands({ neumaId: 'cael', witness: false, probe: { sealed: false } })).toBe(true);
  });

  it('never stands for a witness, a sealed lane, an unprobed lane, or no lane', () => {
    expect(gateStands({ neumaId: 'witness-xai-Keir', witness: true, probe: { sealed: false } })).toBe(false);
    expect(gateStands({ neumaId: 'cael', witness: false, probe: { sealed: true } })).toBe(false);
    expect(gateStands({ neumaId: 'cael', witness: false, probe: null })).toBe(false);
    expect(gateStands({ neumaId: null, witness: false, probe: { sealed: false } })).toBe(false);
  });
});
