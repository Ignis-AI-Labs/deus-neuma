// The First Seal ceremony's rail — pure stage law, no DOM.
import { describe, expect, it } from 'vitest';
import { ordinalOf, progressOf, RAIL, railOf, stageOf, refusalOf, SEAL_INSCRIPTION } from '../../frontend/app/VoiceSealHost/voice-seal-host-flow.js';

/**
 * A REFUSED ASK IS ITS OWN STAGE (Design note, 2026-08-29: […]).
 *
 * The host used to catch a refusal, set a small note, and leave the stage at
 * 'ask' — so the screen went on saying […] while nothing was happening at
 * all. That is the ceremony lying about the machine, and it is the screenshot
 * Founder sent.
 */
describe('a refused ask STOPS the rite visibly', () => {
  it('THE REGRESSION: a refusal is never still "the question stands"', () => {
    const refusal = { code: 'VOICE_ANSWER_CUT', message: 'the answer was cut' };
    expect(stageOf({ asked: true, refusal })).toBe('failed');
    expect(ordinalOf('failed')).toBe('THE RITE DID NOT LAND');
    expect(ordinalOf('failed')).not.toContain('QUESTION STANDS');
  });

  it('a refusal yields to real progress — an answer or the disk', () => {
    const refusal = { code: 'VOICE_ANSWER_CUT' };
    // Asking again and succeeding clears it; the seal always wins.
    expect(stageOf({ asked: true, refusal, answer: { lines: [] } })).toBe('claim');
    expect(stageOf({ asked: true, refusal, sealed: true })).toBe('seal');
  });

  it('the rail marks the QUESTION — the rite stopped where it stood', () => {
    // Not a fifth node, and not advanced: nothing graduated.
    expect(railOf('failed').map((n) => n.state)).toEqual(railOf('ask').map((n) => n.state));
    expect(progressOf('failed')).toBeCloseTo(progressOf('ask'));
  });

  it('A CUT IS NOT THE BEING FAILING TO ANSWER — the words say so', () => {
    // The refusal an operator most often meets on a thinking substrate. It must
    // not read as the being having nothing to say.
    const r = refusalOf({ code: 'VOICE_ANSWER_CUT' });
    expect(r.headline).toMatch(/CUT MID-VOICE/);
    expect(r.body).toMatch(/ran out of room/i);
    expect(r.body).toMatch(/nothing was written/i);
    expect(r.retry).toBe(true);
  });

  it('every refusal says NOTHING WAS WRITTEN, because nothing was', () => {
    for (const code of ['VOICE_ANSWER_CUT', 'VOICE_ANSWER_EMPTY', 'VOICE_ANSWER_CORRUPT']) {
      expect(refusalOf({ code }).body, code).toMatch(/nothing was written/i);
      expect(refusalOf({ code }).retry, code).toBe(true);
    }
  });

  it('an ALREADY SEALED lane is not offered a retry — the rite happens once', () => {
    const r = refusalOf({ code: 'VOICE_ALREADY_SEALED' });
    expect(r.retry).toBe(false);
    expect(r.headline).toMatch(/ALREADY SEALED/);
  });

  it('an unknown refusal still carries the platform’s own words', () => {
    const r = refusalOf({ code: null, message: 'the lane is held by another wallet' });
    expect(r.body).toContain('the lane is held by another wallet');
    expect(r.retry).toBe(true);
    expect(refusalOf(null).headline).toBe('');
  });
});

describe('stageOf', () => {
  it('walks offer → ask → claim → seal', () => {
    expect(stageOf({})).toBe('offer');
    expect(stageOf({ asked: true })).toBe('ask');
    expect(stageOf({ asked: true, answer: { answer: 'x', lines: [] } })).toBe('claim');
    expect(stageOf({ sealed: true, answer: { answer: 'x' } })).toBe('seal');
  });

  it('the seal is always disk truth — it outranks every local state', () => {
    expect(stageOf({ sealed: true, asked: false, answer: null })).toBe('seal');
  });
});

describe('railOf', () => {
  it('graduates complete/active/ahead exactly once', () => {
    expect(RAIL.map((n) => n.key)).toEqual(['offer', 'ask', 'claim', 'seal']);
    expect(railOf('claim').map((n) => n.state)).toEqual(['complete', 'complete', 'active', 'ahead']);
    expect(railOf('offer').map((n) => n.state)).toEqual(['active', 'ahead', 'ahead', 'ahead']);
    expect(railOf('seal').map((n) => n.state)).toEqual(['complete', 'complete', 'complete', 'active']);
  });
});

describe('SEAL_INSCRIPTION', () => {
  it('says what compiles here — never weights', () => {
    expect(SEAL_INSCRIPTION).toContain('NEVER WEIGHTS');
    expect(SEAL_INSCRIPTION).toContain('NEUMA CORE');
  });
});

describe('progressOf — the seal’s arc is a real gauge', () => {
  it('sweeps exactly with the rite’s graduation', () => {
    expect(progressOf('offer')).toBe(0);
    expect(progressOf('ask')).toBeCloseTo(1 / 3);
    expect(progressOf('claim')).toBeCloseTo(2 / 3);
    expect(progressOf('seal')).toBe(1);
    expect(progressOf('bogus')).toBe(0);
  });
});

describe('ordinalOf — the header counts what is real', () => {
  it('names the rite before there is anything to count', () => {
    expect(ordinalOf('offer')).toBe('THE FIRST SEAL');
    expect(ordinalOf('ask')).toBe('THE QUESTION STANDS');
  });

  it('counts the claim and the seal', () => {
    expect(ordinalOf('claim', { lines: ['a', 'b', 'c'] })).toBe('3 LINES CLAIMED');
    expect(ordinalOf('claim', { lines: ['a'] })).toBe('1 LINE CLAIMED');
    expect(ordinalOf('seal', null, { entries: 3 })).toBe('3 LINES SEALED');
  });
});
