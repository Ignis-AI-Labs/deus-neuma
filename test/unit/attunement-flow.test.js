// attunement-flow — the pure derivations the witness's watching room renders
// from. Real record shapes (the same fields the grammar persists), real
// outputs — no mock anywhere because nothing here has IO to mock.
import { describe, it, expect } from 'vitest';
import {
  progressOf, nextQuestionOf, transcriptOf, stageOf, dueTriggerOf, railOf, reaskOf,
} from '../../frontend/app/AttunementHost/attunement-flow.js';

const record = (answers = {}) => ({
  phase: 'answering',
  rendered: {
    questions: [
      { key: 'core.honesty', text: 'Q1?' },
      { key: 'core.fear', text: 'Q2?' },
      { key: 'core.joy', text: 'Q3?' },
    ],
  },
  answers,
});

describe('progressOf / nextQuestionOf / transcriptOf', () => {
  it('an untouched record: 0 answered, the first question stands, empty transcript', () => {
    const r = record();
    expect(progressOf(r)).toEqual({ answered: 0, total: 3 });
    expect(nextQuestionOf(r)).toEqual({ key: 'core.honesty', text: 'Q1?', index: 0 });
    expect(transcriptOf(r)).toEqual([]);
  });

  it('mid-walk: answered pairs render verbatim in rendered order, the first unanswered stands next', () => {
    const r = record({
      'core.honesty': { quote: 'A1', question: 'Q1 as asked?' },
      'core.joy': { quote: 'A3' },
    });
    expect(progressOf(r)).toEqual({ answered: 2, total: 3 });
    expect(nextQuestionOf(r)).toEqual({ key: 'core.fear', text: 'Q2?', index: 1 });
    expect(transcriptOf(r)).toEqual([
      { key: 'core.honesty', question: 'Q1 as asked?', answer: 'A1', reopened: false },
      { key: 'core.joy', question: 'Q3?', answer: 'A3', reopened: false },
    ]);
  });

  it('a reopened question HOLDS ITS PLACE: superseded words render in spec order, marked, until the fresh answer regenerates the section', () => {
    const r = {
      ...record({ 'core.honesty': { quote: 'A1' }, 'core.joy': { quote: 'A3' } }),
      superseded: {
        'core.fear': [
          { quote: 'old words, first take', reopenedAt: 't1', reopenReason: 'first sweep' },
          { quote: 'old words, second take', question: 'Q2 as asked?', reopenedAt: 't2', reopenReason: 'style-overlap law' },
        ],
      },
    };
    expect(transcriptOf(r)).toEqual([
      { key: 'core.honesty', question: 'Q1?', answer: 'A1', reopened: false },
      { key: 'core.fear', question: 'Q2 as asked?', answer: 'old words, second take', reopened: true, reopenReason: 'style-overlap law' },
      { key: 'core.joy', question: 'Q3?', answer: 'A3', reopened: false },
    ]);
    // …and once the fresh answer lands, the section regenerates in place
    const landed = { ...r, answers: { ...r.answers, 'core.fear': { quote: 'the fresh telling' } } };
    expect(transcriptOf(landed)[1]).toEqual({ key: 'core.fear', question: 'Q2?', answer: 'the fresh telling', reopened: false });
    // the re-ask ledger: its OWN count while the sweep stands, zero after
    expect(reaskOf(r)).toEqual({ pending: 1 });
    expect(reaskOf(landed)).toEqual({ pending: 0 });
    expect(reaskOf(record())).toEqual({ pending: 0 }); // a never-reopened walk
  });

  it('every question faced: no next question', () => {
    const r = record({
      'core.honesty': { quote: 'A1' }, 'core.fear': { quote: 'A2' }, 'core.joy': { quote: 'A3' },
    });
    expect(nextQuestionOf(r)).toBeNull();
    expect(progressOf(r)).toEqual({ answered: 3, total: 3 });
  });

  it('absent record: honest zeros, nothing next, nothing said', () => {
    expect(progressOf(null)).toEqual({ answered: 0, total: 0 });
    expect(nextQuestionOf(null)).toBeNull();
    expect(transcriptOf(null)).toEqual([]);
  });
});

describe('stageOf — the backend truth decides the stage', () => {
  it('no status or no active record → offer', () => {
    expect(stageOf(null)).toBe('offer');
    expect(stageOf({ active: null })).toBe('offer');
  });

  it('a render in flight → opening, regardless of the record phase', () => {
    expect(stageOf({ active: { phase: 'offered' }, opening: { done: 3, total: 89 } })).toBe('opening');
  });

  it('offered → consent; answering with questions left → watch; all answered → seal', () => {
    expect(stageOf({ active: { phase: 'offered' } })).toBe('consent');
    expect(stageOf({ active: record() })).toBe('watch');
    expect(stageOf({
      active: record({
        'core.honesty': { quote: 'A' }, 'core.fear': { quote: 'A' }, 'core.joy': { quote: 'A' },
      }),
    })).toBe('seal');
  });

  it('a terminal record is not active work → offer', () => {
    expect(stageOf({ active: { phase: 'sealed' } })).toBe('offer');
  });
});

describe('dueTriggerOf — the desk offers only what is honestly due', () => {
  it('due → the gate’s own trigger; not due → null', () => {
    expect(dueTriggerOf({ offerDue: { due: true, trigger: 'post-birth' } })).toBe('post-birth');
    expect(dueTriggerOf({ offerDue: { due: false } })).toBeNull();
    expect(dueTriggerOf(null)).toBeNull();
  });
});

describe('railOf — the ceremony rail graduates honestly by view', () => {
  it('the live watching room: offer/consent/open behind, WITNESS live, SEAL ahead', () => {
    expect(railOf('watch')).toEqual([
      { key: 'offer', label: 'OFFER', state: 'complete' },
      { key: 'consent', label: 'CONSENT', state: 'complete' },
      { key: 'opening', label: 'OPEN', state: 'complete' },
      { key: 'watch', label: 'WITNESS', state: 'active' },
      { key: 'seal', label: 'SEAL', state: 'ahead' },
    ]);
  });

  it('the first phase is live at the offer, everything else ahead', () => {
    const rail = railOf('offer');
    expect(rail[0].state).toBe('active');
    expect(rail.slice(1).every((n) => n.state === 'ahead')).toBe(true);
  });

  it('a sealed attunement completes the walk and lights REFINEMENT as the next rite', () => {
    const rail = railOf('sealed');
    expect(rail.map((n) => n.label)).toEqual([
      'OFFER', 'CONSENT', 'OPEN', 'WITNESS', 'SEAL', 'REFINE',
    ]);
    expect(rail.filter((n) => n.key !== 'refine').every((n) => n.state === 'complete')).toBe(true);
    expect(rail.find((n) => n.key === 'refine')).toMatchObject({ state: 'active', label: 'REFINE' });
  });

  it('views outside the ceremony proper carry no rail', () => {
    expect(railOf('roster')).toBeNull();
    expect(railOf('loading')).toBeNull();
    expect(railOf('error')).toBeNull();
  });
});
