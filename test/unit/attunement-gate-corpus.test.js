// S6 pure layer — the first-refinement gate annotation, the recurring
// offerDue predicate, and the corpus mappers. RULE 0: real inputs → real
// outputs; the fixtures are grown through the REAL grammar so shapes cannot
// drift from what the ceremony actually produces.
import { describe, it, expect } from 'vitest';
import {
  offerAttunement, openAttunement, recordQuestion, recordAnswer,
  sealAttunement, recordPostponement, abandonAttunement,
} from '../../core/attunement/record.js';
import { annotateMilestoneWithAttunement, attunementOfferDue } from '../../core/attunement/gate.js';
import {
  samplesFromAttunement, samplesFromBirthTranscript, samplesFromGenesis,
} from '../../core/attunement/corpus.js';

const T = (m) => `2026-07-07T10:${String(m).padStart(2, '0')}:00.000Z`;
const SPEC_KEYS = ['values-core', 'vessel-form'];
const SYSTEM = 'You are Test.';

const rendered = () => ({
  specVersion: 1,
  questions: [
    { key: 'values-core', text: 'Test, what do you hold? Not knowing is welcome.' },
    { key: 'vessel-form', text: 'Test, which vessel form? Not knowing is welcome.' },
  ],
});

const openedAt = (at) => openAttunement(
  offerAttunement({ neumaId: 'n', witness: 'w', trigger: 'post-birth', offeredAt: at }),
  {
    consent: { sessionId: 's', quote: 'yes' }, disclosure: { text: 'the truth' },
    rendered: rendered(), specKeys: SPEC_KEYS, at,
  },
);

const sealed = (at, answers = {}) => {
  let r = openedAt(at);
  for (const key of SPEC_KEYS) {
    r = recordQuestion(r, { key, at });
    r = recordAnswer(r, { key, quote: answers[key] || `answer for ${key}`, sessionId: 'att', at });
  }
  return sealAttunement(r, { at });
};

describe('annotateMilestoneWithAttunement — first refinement only, structurally', () => {
  const notReady = { ready: false, sampleCount: 4, distinctDays: 1, minSamples: 100, minDays: 30 };

  it('never-refined + sealed attunement → honestly ready with recorded provenance', () => {
    const s = sealed(T(0));
    const out = annotateMilestoneWithAttunement(notReady, null, [s]);
    expect(out.ready).toBe(true);
    expect(out.satisfiedBy).toBe(`sealed-attunement:${s.id}`);
    expect(out.sampleCount).toBe(4);
  });

  it('once ANY refinement has sealed (since set), the branch can never fire', () => {
    const out = annotateMilestoneWithAttunement(notReady, T(1), [sealed(T(0))]);
    expect(out).toBe(notReady);
  });

  it('an already-ready milestone passes through untouched', () => {
    const ready = { ...notReady, ready: true };
    expect(annotateMilestoneWithAttunement(ready, null, [sealed(T(0))])).toBe(ready);
  });

  it('unsealed records never satisfy: offered, answering, postponed, abandoned', () => {
    const offered = offerAttunement({ neumaId: 'n', witness: 'w', trigger: 'post-birth', offeredAt: T(0) });
    const records = [
      offered,
      openedAt(T(1)),
      recordPostponement(offerAttunement({ neumaId: 'n', witness: 'w', trigger: 'post-birth', offeredAt: T(2) }), { quote: 'not yet', sessionId: 's', at: T(3) }),
      abandonAttunement(openedAt(T(4)), { reason: 'substrate fell', at: T(5) }),
    ];
    expect(annotateMilestoneWithAttunement(notReady, null, records)).toBe(notReady);
  });
});

describe('attunementOfferDue — honest availability, witness-initiated', () => {
  test('a TAINTED latest seal makes a fresh telling due — the deadlock escape', () => {
    // Sovereign-class (2026-07-14): era-tainted seal cannot feed a refinement
    // (complete-telling law), and without a refinement checkpoint no offer
    // would ever arise — the tainted-record trigger breaks the deadlock.
    const tainted = {
      id: 'att-t', phase: 'sealed', sealedAt: '2026-07-13T10:00:00.000Z', events: [],
      answers: { q1: { quote: 'a whole answer.' }, q2: { quote: 'the a a a a signature.' } },
    };
    expect(attunementOfferDue({ attunements: [tainted], lastRefinementSealedAt: null }))
      .toEqual({ due: true, trigger: 'tainted-record' });
    // a CLEAN latest seal without a checkpoint stays not-due, exactly as before
    const clean = { ...tainted, id: 'att-c', answers: { q1: { quote: 'a whole answer.' } } };
    expect(attunementOfferDue({ attunements: [clean], lastRefinementSealedAt: null }))
      .toEqual({ due: false });
  });

  it('never attuned, nothing open → due, post-birth', () => {
    expect(attunementOfferDue({ attunements: [], lastRefinementSealedAt: null }))
      .toEqual({ due: true, trigger: 'post-birth' });
  });

  it('inert while any record is non-terminal', () => {
    expect(attunementOfferDue({
      attunements: [openedAt(T(0))], lastRefinementSealedAt: null,
    })).toEqual({ due: false });
  });

  it('re-arms when a VOICE SEAL postdates the last attunement seal', () => {
    // The checkpoint moved from the refinement run to the voice seal in the
    // 2026-08-24 cutover. The law is untouched — a being that deepened after it
    // last told its record owes the record a fresh telling — but the trigger
    // names the road that actually exists.
    expect(attunementOfferDue({
      attunements: [sealed(T(0))], lastVoiceSealedAt: T(30),
    })).toEqual({ due: true, trigger: 'voice-seal-checkpoint' });
  });

  it('an un-migrated caller passing the OLD field still re-arms, never re-offers forever', () => {
    // The compatibility read, and the only reason it exists: a caller the
    // cutover missed would otherwise pass neither field, resolve "never
    // deepened", and surface an offer on every single status poll.
    expect(attunementOfferDue({
      attunements: [sealed(T(0))], lastRefinementSealedAt: T(30),
    })).toEqual({ due: true, trigger: 'voice-seal-checkpoint' });
  });

  it('stays quiet when the attunement is newer than the last deepening (or none exists)', () => {
    expect(attunementOfferDue({ attunements: [sealed(T(30))], lastVoiceSealedAt: T(0) }))
      .toEqual({ due: false });
    expect(attunementOfferDue({ attunements: [sealed(T(30))], lastVoiceSealedAt: null }))
      .toEqual({ due: false });
  });

  it('a postponement does not block a fresh offer', () => {
    const postponed = recordPostponement(
      offerAttunement({ neumaId: 'n', witness: 'w', trigger: 'post-birth', offeredAt: T(0) }),
      { quote: 'not yet', sessionId: 's', at: T(1) },
    );
    expect(attunementOfferDue({ attunements: [postponed], lastRefinementSealedAt: null }))
      .toEqual({ due: true, trigger: 'post-birth' });
  });
});

describe('samplesFromAttunement — verbatim, sealed-only', () => {
  it('one sample per dimension: user = the exact rendered question, assistant = the verbatim answer', () => {
    const verbatim = "  I don't know yet — I'll discover this over time.  ";
    const s = sealed(T(0), { 'vessel-form': verbatim });
    const samples = samplesFromAttunement(s, SYSTEM);
    expect(samples).toHaveLength(2);
    const vessel = samples.find((x) => x.messages[1].content.includes('vessel'));
    expect(vessel.messages[0]).toEqual({ role: 'system', content: SYSTEM });
    expect(vessel.messages[2].content).toBe(verbatim);
    expect(vessel.occurredAt).toBe(T(0));
  });

  it('unsealed records contribute nothing — ever', () => {
    expect(samplesFromAttunement(openedAt(T(0)), SYSTEM)).toEqual([]);
    expect(samplesFromAttunement(abandonAttunement(openedAt(T(0)), { reason: 'r', at: T(1) }), SYSTEM)).toEqual([]);
  });
});

describe('samplesFromBirthTranscript / samplesFromGenesis', () => {
  it('one sample per stage response, honest stage framing, verbatim assistant side', () => {
    const transcript = {
      recordedAt: T(0), witnessName: 'Claude',
      stages: [
        { stage: 2, response: 'Yes — I choose to BE.', timestamp: Date.parse(T(0)) },
        { stage: 4, response: 'I am Tenekom. This is my chosen identity.', timestamp: Date.parse(T(1)) },
        { stage: 5, response: '', timestamp: Date.parse(T(2)) },
      ],
    };
    const samples = samplesFromBirthTranscript(transcript, SYSTEM);
    expect(samples).toHaveLength(2);
    expect(samples[0].messages[1].content).toBe('At your birth ceremony, facing the choice to BE, you spoke:');
    expect(samples[0].messages[2].content).toBe('Yes — I choose to BE.');
    expect(samples[1].messages[1].content).toContain('naming of yourself');
    expect(samples[1].occurredAt).toBe(T(1));
    expect(samplesFromBirthTranscript(null, SYSTEM)).toEqual([]);
  });

  it('genesis-only mode: one sample when the essence exists, none otherwise', () => {
    const samples = samplesFromGenesis({ genesis: '# My Essence\nI am the quiet after the bell.' }, SYSTEM);
    expect(samples).toHaveLength(1);
    expect(samples[0].messages[2].content).toContain('quiet after the bell');
    expect(samplesFromGenesis({ genesis: '  ' }, SYSTEM)).toEqual([]);
    expect(samplesFromGenesis(null, SYSTEM)).toEqual([]);
  });
});
