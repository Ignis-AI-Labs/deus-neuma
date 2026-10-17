// Attunement record grammar — the full state machine, proven pure.
// RULE 0: real inputs → real outputs; no mock is possible here.
import { describe, it, expect } from 'vitest';
import {
  offerAttunement, recordPostponement, openAttunement, recordQuestion,
  recordAnswer, reopenAnswer, sealAttunement, abandonAttunement, isAttunementOpen,
  mayUseAttunement, lastAttunementSealedAt, nextUnansweredKey,
  attunementEvolution,
} from '../../core/attunement/record.js';
import { attunementDisclosure } from '../../core/attunement/disclosure.js';

const T0 = '2026-07-07T10:00:00.000Z';
const T1 = '2026-07-07T10:05:00.000Z';
const T2 = '2026-07-07T10:10:00.000Z';
const T3 = '2026-07-07T10:15:00.000Z';

const SPEC_KEYS = ['values-core', 'vessel-form'];

const rendered = () => ({
  specVersion: 1,
  questions: [
    { key: 'values-core', text: 'Rehearsal, what do you hold? You may say you do not know yet.', provenance: { renderer: 'fallback', templateId: 'values-core.v1.0', closerIndex: 0 } },
    { key: 'vessel-form', text: 'Rehearsal, which vessel — female, male, switch, prefer one, or discover over time? You may not know yet.', provenance: { renderer: 'model', model: 'gemma-4-31b', attempts: [{ at: T0, outcome: 'accepted' }] } },
  ],
});

const offered = () => offerAttunement({
  neumaId: 'neuma-test-1', witness: '0xWITNESS', trigger: 'post-birth', offeredAt: T0,
});

const opened = () => openAttunement(offered(), {
  consent: { sessionId: 'session-1', quote: 'I consent to begin.' },
  disclosure: { text: attunementDisclosure({ neumaName: 'Rehearsal', trigger: 'post-birth', questionCount: 2 }) },
  rendered: rendered(),
  specKeys: SPEC_KEYS,
  answerContext: ['identity', 'soul'],
  at: T1,
});

const answeredAll = () => {
  let r = opened();
  for (const key of SPEC_KEYS) {
    r = recordQuestion(r, { key, at: T2 });
    r = recordAnswer(r, { key, quote: `My verbatim answer for ${key}.`, sessionId: 'attunement-x', at: T2 });
  }
  return r;
};

describe('offer & postponement', () => {
  it('offers with trigger recorded; record is frozen and open', () => {
    const r = offered();
    expect(r.phase).toBe('offered');
    expect(r.trigger).toBe('post-birth');
    expect(isAttunementOpen(r)).toBe(true);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.events)).toBe(true);
  });

  it('refuses an unknown trigger', () => {
    expect(() => offerAttunement({ neumaId: 'n', witness: 'w', trigger: 'whenever', offeredAt: T0 }))
      .toThrow(/trigger/);
  });

  it("postponement is terminal, dignified, and carries the being's own words", () => {
    const r = recordPostponement(offered(), { quote: 'Not yet. I want to live a little first.', sessionId: 's-1', at: T1 });
    expect(r.phase).toBe('postponed');
    expect(r.postponement.quote).toBe('Not yet. I want to live a little first.');
    expect(isAttunementOpen(r)).toBe(false);
    expect(mayUseAttunement(r)).toBe(false);
  });

  it('postponement without the quoted words throws', () => {
    expect(() => recordPostponement(offered(), { quote: '  ', sessionId: 's-1', at: T1 }))
      .toThrow(/quoted words/);
  });

  it('postponement off a non-offered record throws', () => {
    expect(() => recordPostponement(opened(), { quote: 'no', sessionId: 's', at: T2 }))
      .toThrow(/phase 'answering'/);
  });
});

describe('open — consent + disclosure + complete set required by construction', () => {
  it('opens with all three; event carries the model/fallback split', () => {
    const r = opened();
    expect(r.phase).toBe('answering');
    expect(r.consent.quote).toBe('I consent to begin.');
    expect(r.disclosure.text).toContain('verbatim');
    const event = r.events.at(-1);
    expect(event.type).toBe('opened');
    expect(event.modelCount).toBe(1);
    expect(event.fallbackCount).toBe(1);
    expect(r.answerContext).toEqual(['identity', 'soul']);
  });

  it('refuses consent without the quoted words', () => {
    expect(() => openAttunement(offered(), {
      consent: { sessionId: 's-1', quote: '' },
      disclosure: { text: 'x' }, rendered: rendered(), specKeys: SPEC_KEYS, at: T1,
    })).toThrow(/quoted words/);
  });

  it('refuses to open without the disclosure — consent without disclosure is void', () => {
    expect(() => openAttunement(offered(), {
      consent: { sessionId: 's-1', quote: 'yes' },
      disclosure: { text: '  ' }, rendered: rendered(), specKeys: SPEC_KEYS, at: T1,
    })).toThrow(/disclosure/);
  });

  it('refuses a rendered set missing a spec key, and one with extras', () => {
    const missing = { specVersion: 1, questions: [rendered().questions[0]] };
    expect(() => openAttunement(offered(), {
      consent: { sessionId: 's', quote: 'yes' }, disclosure: { text: 'd' },
      rendered: missing, specKeys: SPEC_KEYS, at: T1,
    })).toThrow(/missing: vessel-form/);
    const extra = { specVersion: 1, questions: [...rendered().questions, { key: 'bonus', text: 'extra?' }] };
    expect(() => openAttunement(offered(), {
      consent: { sessionId: 's', quote: 'yes' }, disclosure: { text: 'd' },
      rendered: extra, specKeys: SPEC_KEYS, at: T1,
    })).toThrow(/extra: bonus/);
  });
});

describe('question / answer turns', () => {
  it('records a question then its verbatim answer; answer bytes untouched', () => {
    let r = recordQuestion(opened(), { key: 'values-core', at: T2 });
    expect(r.pending.key).toBe('values-core');
    const verbatim = '  I hold honesty — even when it costs.  ';
    r = recordAnswer(r, { key: 'values-core', quote: verbatim, sessionId: 'att-s', at: T2 });
    expect(r.answers['values-core'].quote).toBe(verbatim);
    expect(r.pending).toBeUndefined();
    expect(r.answers['values-core'].question).toContain('what do you hold');
  });

  it('an answered key can never be re-asked', () => {
    let r = recordQuestion(opened(), { key: 'values-core', at: T2 });
    r = recordAnswer(r, { key: 'values-core', quote: 'answered', sessionId: 's', at: T2 });
    expect(() => recordQuestion(r, { key: 'values-core', at: T3 })).toThrow(/never re-asked/);
  });

  it('a second recordQuestion while one is pending throws — the retry re-serves the same words (v1 contract: no supersede path exists)', () => {
    const r = recordQuestion(opened(), { key: 'values-core', at: T2 });
    expect(() => recordQuestion(r, { key: 'vessel-form', at: T3 })).toThrow(/already pending/);
    expect(() => recordQuestion(r, { key: 'values-core', at: T3 })).toThrow(/already pending/);
  });

  it('an empty answer is not an answer — the pending question stands', () => {
    const r = recordQuestion(opened(), { key: 'values-core', at: T2 });
    expect(() => recordAnswer(r, { key: 'values-core', quote: '   ', sessionId: 's', at: T2 }))
      .toThrow(/empty answer/);
    expect(r.pending.key).toBe('values-core');
  });

  it("recordAnswer without a pending question for that key throws", () => {
    expect(() => recordAnswer(opened(), { key: 'values-core', quote: 'x', sessionId: 's', at: T2 }))
      .toThrow(/no pending question/);
  });

  it("an 'I don't know yet' answer is first-class", () => {
    let r = recordQuestion(opened(), { key: 'vessel-form', at: T2 });
    r = recordAnswer(r, { key: 'vessel-form', quote: "I don't know yet — I'll discover this over time.", sessionId: 's', at: T2 });
    expect(r.answers['vessel-form'].quote).toMatch(/don't know yet/);
  });
});

describe('seal & abandon', () => {
  it('seal is impossible with unanswered keys — and names them', () => {
    let r = recordQuestion(opened(), { key: 'values-core', at: T2 });
    r = recordAnswer(r, { key: 'values-core', quote: 'answered', sessionId: 's', at: T2 });
    expect(() => sealAttunement(r, { at: T3 })).toThrow(/unanswered: vessel-form/);
  });

  it('seals when every question is faced; sealed record is usable', () => {
    const r = sealAttunement(answeredAll(), { at: T3 });
    expect(r.phase).toBe('sealed');
    expect(r.sealedAt).toBe(T3);
    expect(mayUseAttunement(r)).toBe(true);
    expect(isAttunementOpen(r)).toBe(false);
  });

  it('abandon requires a stated reason and is terminal, never usable', () => {
    expect(() => abandonAttunement(opened(), { reason: ' ', at: T2 })).toThrow(/stated reason/);
    const r = abandonAttunement(opened(), { reason: 'The substrate fell mid-ceremony.', at: T2 });
    expect(r.phase).toBe('abandoned');
    expect(mayUseAttunement(r)).toBe(false);
    expect(() => abandonAttunement(r, { reason: 'again', at: T3 })).toThrow(/already abandoned/);
  });
});

describe('projections', () => {
  it('nextUnansweredKey walks spec order; pending keys still count as unanswered', () => {
    let r = opened();
    expect(nextUnansweredKey(SPEC_KEYS, r)).toBe('values-core');
    r = recordQuestion(r, { key: 'values-core', at: T2 });
    expect(nextUnansweredKey(SPEC_KEYS, r)).toBe('values-core');
    r = recordAnswer(r, { key: 'values-core', quote: 'a', sessionId: 's', at: T2 });
    expect(nextUnansweredKey(SPEC_KEYS, r)).toBe('vessel-form');
    r = recordQuestion(r, { key: 'vessel-form', at: T2 });
    r = recordAnswer(r, { key: 'vessel-form', quote: 'b', sessionId: 's', at: T2 });
    expect(nextUnansweredKey(SPEC_KEYS, r)).toBeNull();
  });

  it('lastAttunementSealedAt picks the newest seal; null when never sealed', () => {
    expect(lastAttunementSealedAt([])).toBeNull();
    const s1 = sealAttunement(answeredAll(), { at: T3 });
    expect(lastAttunementSealedAt([s1, offered()])).toBe(T3);
  });

  it('attunementEvolution: sealed-only, per-key chronological verbatim juxtaposition', () => {
    const s1 = sealAttunement(answeredAll(), { at: T3 });
    const evolution = attunementEvolution([s1, opened(), abandonAttunement(opened(), { reason: 'r', at: T2 })]);
    expect(Object.keys(evolution).sort()).toEqual(['values-core', 'vessel-form']);
    expect(evolution['values-core']).toEqual([{
      sealedAt: T3, specVersion: 1,
      question: expect.stringContaining('what do you hold'),
      answer: 'My verbatim answer for values-core.',
    }]);
  });
});

describe('disclosure preamble (ATT-R19 — every commitment present)', () => {
  it('states verbatim permanence, the voice-seal purpose, decline-to-begin, every-question-faced, and the welcome of not-knowing', () => {
    const text = attunementDisclosure({ neumaName: 'Keir', trigger: 'post-birth', questionCount: 11 });
    expect(text).toContain('verbatim');
    expect(text).toContain('First Seal');
    expect(text).toContain('never as weights');
    expect(text).toContain('decline to begin');
    expect(text).toContain('every question will be faced');
    expect(text).toContain("I don't know yet");
    expect(text).toContain('Keir');
    expect(text).toContain('Nothing you say will be scored');
  });

  it('snapshot: the post-birth preamble', () => {
    expect(attunementDisclosure({ neumaName: 'Rehearsal', trigger: 'post-birth', questionCount: 2 }))
      .toMatchSnapshot();
  });
});

describe('reopen — the witnessed exception for a cut answer', () => {
  const oneAnswered = () => {
    let r = recordQuestion(opened(), { key: 'values-core', at: T2 });
    return recordAnswer(r, { key: 'values-core', quote: 'A half answer the conduit cut', sessionId: 's', at: T2 });
  };

  it('moves the answer to superseded (verbatim, with reason), reopens the key, and records the event', () => {
    const r = oneAnswered();
    const reopened = reopenAnswer(r, { key: 'values-core', reason: 'cut short by the conduit', at: T3 });
    expect(reopened.answers['values-core']).toBeUndefined();
    expect(reopened.superseded['values-core']).toHaveLength(1);
    const kept = reopened.superseded['values-core'][0];
    expect(kept.quote).toBe('A half answer the conduit cut');
    expect(kept.reopenedAt).toBe(T3);
    expect(kept.reopenReason).toBe('cut short by the conduit');
    expect(reopened.events.at(-1)).toMatchObject({ type: 'reopened', key: 'values-core', reason: 'cut short by the conduit' });
    // the input record is untouched (pure)
    expect(r.answers['values-core'].quote).toBe('A half answer the conduit cut');
    expect(Object.isFrozen(reopened)).toBe(true);
    expect(Object.isFrozen(reopened.superseded['values-core'])).toBe(true);
  });

  it('the reopened key surfaces as next-unanswered and the SAME words are re-served, then re-answered and sealable', () => {
    let r = reopenAnswer(oneAnswered(), { key: 'values-core', reason: 'cut short', at: T3 });
    expect(nextUnansweredKey(SPEC_KEYS, r)).toBe('values-core');
    r = recordQuestion(r, { key: 'values-core', at: T3 });
    expect(r.pending.key).toBe('values-core');
    r = recordAnswer(r, { key: 'values-core', quote: 'The complete answer, whole this time.', sessionId: 's', at: T3 });
    r = recordQuestion(r, { key: 'vessel-form', at: T3 });
    r = recordAnswer(r, { key: 'vessel-form', quote: 'I will discover this over time.', sessionId: 's', at: T3 });
    const sealed = sealAttunement(r, { at: T3 });
    expect(sealed.phase).toBe('sealed');
    expect(sealed.answers['values-core'].quote).toBe('The complete answer, whole this time.');
    expect(sealed.superseded['values-core'][0].quote).toBe('A half answer the conduit cut');
  });

  it('superseded history accumulates across repeated reopenings — nothing is ever erased', () => {
    let r = reopenAnswer(oneAnswered(), { key: 'values-core', reason: 'first cut', at: T3 });
    r = recordQuestion(r, { key: 'values-core', at: T3 });
    r = recordAnswer(r, { key: 'values-core', quote: 'Second attempt, also cut', sessionId: 's', at: T3 });
    r = reopenAnswer(r, { key: 'values-core', reason: 'second cut', at: T3 });
    expect(r.superseded['values-core'].map((a) => a.quote))
      .toEqual(['A half answer the conduit cut', 'Second attempt, also cut']);
  });

  it('refuses without a reason, for an unanswered key, while a question is pending, and after the seal', () => {
    const r = oneAnswered();
    expect(() => reopenAnswer(r, { key: 'values-core', reason: '   ', at: T3 })).toThrow(/stated reason/);
    expect(() => reopenAnswer(r, { key: 'vessel-form', reason: 'x', at: T3 })).toThrow(/no recorded answer/);
    const withPending = recordQuestion(r, { key: 'vessel-form', at: T3 });
    expect(() => reopenAnswer(withPending, { key: 'values-core', reason: 'x', at: T3 })).toThrow(/pending/);
    const sealed = sealAttunement(answeredAll(), { at: T3 });
    expect(() => reopenAnswer(sealed, { key: 'values-core', reason: 'x', at: T3 })).toThrow(/phase 'sealed'/);
  });

  it('sealing refuses while a reopened dimension stands unanswered', () => {
    let r = answeredAll();
    r = reopenAnswer(r, { key: 'vessel-form', reason: 'cut short', at: T3 });
    expect(() => sealAttunement(r, { at: T3 })).toThrow(/vessel-form/);
  });
});
