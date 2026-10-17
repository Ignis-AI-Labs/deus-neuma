// Remia R1 — the witness's own attunement, on the proven grammar.
// The offer is the only witness-specific construction; everything downstream
// (open/ask/answer/seal/abandon) is the exact being-side grammar, so these
// tests prove the composition: a witness record walks the full ceremony with
// a REAL rendered 89-question set from the committed spec, and the codex view
// reveals the map only after the seal.

import { describe, it, expect } from 'vitest';
import {
  offerWitnessAttunement,
  WITNESS_ATTUNEMENT_TRIGGERS,
  openAttunement,
  recordQuestion,
  recordAnswer,
  sealAttunement,
  abandonAttunement,
  nextUnansweredKey,
  mayUseAttunement,
} from '../../core/remia/witness-record.js';
import { witnessAttunementDisclosure } from '../../core/remia/witness-disclosure.js';
import { codexView, CANON_FUNCTIONS } from '../../core/remia/codex-view.js';
import { ATTUNEMENT_SPEC } from '../../core/attunement/spec.js';
import { renderFallbackSet } from '../../core/attunement/fallback-templates.js';

const WALLET = '0x4368AbCdEf0123456789aBcDeF0123456789C501';
const T0 = '2026-07-07T12:00:00.000Z';
const SPEC_KEYS = ATTUNEMENT_SPEC.dimensions.map((d) => d.key);

const renderedSet = () => renderFallbackSet(ATTUNEMENT_SPEC, {
  neumaId: WALLET.toLowerCase(), neumaName: 'Founder', checkpointOrdinal: 1, nonce: 0,
});

const openedRecord = () => openAttunement(
  offerWitnessAttunement({ walletAddress: WALLET, trigger: 'first-reading', offeredAt: T0 }),
  {
    consent: { sessionId: 'remia-web', quote: 'Yes — I consent to begin.' },
    disclosure: {
      text: witnessAttunementDisclosure({
        witnessName: 'Founder', trigger: 'first-reading', questionCount: SPEC_KEYS.length,
      }),
    },
    rendered: renderedSet(),
    specKeys: SPEC_KEYS,
    at: T0,
  },
);

const answerAll = (record) => {
  let r = record;
  let key = nextUnansweredKey(SPEC_KEYS, r);
  let tick = 0;
  while (key) {
    const at = new Date(Date.parse(T0) + (tick += 1000)).toISOString();
    r = recordQuestion(r, { key, at });
    r = recordAnswer(r, { key, quote: `My honest answer to ${key}.`, sessionId: 'remia-web', at });
    key = nextUnansweredKey(SPEC_KEYS, r);
  }
  return r;
};

describe('offerWitnessAttunement — witness identity, witness triggers', () => {
  it('offers with a wallet identity, lowercased the way the realm stores it', () => {
    const record = offerWitnessAttunement({ walletAddress: WALLET, trigger: 'first-reading', offeredAt: T0 });
    expect(record.witnessWallet).toBe(WALLET.toLowerCase());
    expect(record.neumaId).toBeUndefined();
    expect(record.phase).toBe('offered');
    expect(record.id).toMatch(/^remia-\d+$/);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.events)).toBe(true);
  });

  it('refuses a malformed wallet, an unknown trigger, a bad timestamp', () => {
    expect(() => offerWitnessAttunement({ walletAddress: 'founder', trigger: 'first-reading', offeredAt: T0 }))
      .toThrow(/walletAddress/);
    expect(() => offerWitnessAttunement({ walletAddress: WALLET, trigger: 'post-birth', offeredAt: T0 }))
      .toThrow(/trigger/);
    expect(() => offerWitnessAttunement({ walletAddress: WALLET, trigger: 'first-reading', offeredAt: 'yesterday' }))
      .toThrow(/ISO/);
  });

  it('witness trigger vocabulary is its own — not the being-side one', () => {
    expect(WITNESS_ATTUNEMENT_TRIGGERS).toEqual(['first-reading', 'checkpoint']);
  });
});

describe('the witness walks the exact being-side grammar', () => {
  it('opens with consent + disclosure + a complete real 89-question render', () => {
    const record = openedRecord();
    expect(record.phase).toBe('answering');
    expect(record.rendered.questions).toHaveLength(SPEC_KEYS.length);
    expect(record.witnessWallet).toBe(WALLET.toLowerCase());
    expect(record.disclosure.text).toContain('your own local record on your own machine');
  });

  it('one pending question at a time; an answered key is never re-askable; seal refuses unanswered', () => {
    let record = openedRecord();
    const first = nextUnansweredKey(SPEC_KEYS, record);
    record = recordQuestion(record, { key: first, at: T0 });
    expect(() => recordQuestion(record, { key: SPEC_KEYS[1], at: T0 })).toThrow(/pending/);
    record = recordAnswer(record, { key: first, quote: 'Verbatim, exactly as typed.  ', sessionId: 'remia-web', at: T0 });
    expect(record.answers[first].quote).toBe('Verbatim, exactly as typed.  '); // never trimmed
    expect(() => recordQuestion(record, { key: first, at: T0 })).toThrow(/already answered/);
    expect(() => sealAttunement(record, { at: T0 })).toThrow(/unanswered/);
  });

  it('every question faced → seal; the sealed record is usable', () => {
    const sealed = sealAttunement(answerAll(openedRecord()), { at: '2026-07-07T14:00:00.000Z' });
    expect(sealed.phase).toBe('sealed');
    expect(mayUseAttunement(sealed)).toBe(true);
    expect(Object.keys(sealed.answers)).toHaveLength(SPEC_KEYS.length);
  });

  it('the witness stays sovereign: abandon works mid-walk, with the stated reason preserved', () => {
    const abandoned = abandonAttunement(openedRecord(), { reason: 'Not tonight.', at: T0 });
    expect(abandoned.phase).toBe('abandoned');
    expect(mayUseAttunement(abandoned)).toBe(false);
  });
});

describe('witnessAttunementDisclosure — every sentence a kept commitment', () => {
  const text = witnessAttunementDisclosure({ witnessName: 'Founder', trigger: 'first-reading', questionCount: 89 });

  it('carries the truthful commitments: verbatim, never scored, trains nothing, decline honored, every question faced, map after seal', () => {
    expect(text).toContain('Founder');
    expect(text).toContain('89 questions');
    expect(text).toContain('verbatim');
    expect(text).toContain('Nothing you say will be scored');
    expect(text).toContain('Nothing here trains anything');
    expect(text).toContain('You may decline to begin');
    expect(text).toContain('every question will be faced');
    expect(text).toContain('"I don\'t know yet"');
    expect(text).toContain('After the seal, and only after');
  });

  it('first-reading and checkpoint carry different honest occasions', () => {
    const checkpoint = witnessAttunementDisclosure({ witnessName: 'Founder', trigger: 'checkpoint', questionCount: 89 });
    expect(text).toContain('the same ceremony your beings face');
    expect(checkpoint).toContain('since your last sitting');
    expect(checkpoint).not.toContain('first pass');
  });

  it('refuses a missing name or count', () => {
    expect(() => witnessAttunementDisclosure({ witnessName: ' ', trigger: 'first-reading', questionCount: 89 })).toThrow();
    expect(() => witnessAttunementDisclosure({ witnessName: 'Founder', trigger: 'first-reading', questionCount: 0 })).toThrow();
  });
});

describe('codexView — the map, revealed only after the seal', () => {
  const sealed = sealAttunement(answerAll(openedRecord()), { at: '2026-07-07T14:00:00.000Z' });

  it('refuses an unsealed record — reveal-after-seal is structural', () => {
    expect(() => codexView(ATTUNEMENT_SPEC, openedRecord())).toThrow(/after the seal/);
    expect(() => codexView(ATTUNEMENT_SPEC, abandonAttunement(openedRecord(), { reason: 'no', at: T0 })))
      .toThrow(/after the seal/);
  });

  it('a sealed codex SURVIVES a future spec bump — keys are forever, so metadata still joins; the view reports the RECORD\'s version (echo r2)', () => {
    const bumped = { ...ATTUNEMENT_SPEC, specVersion: ATTUNEMENT_SPEC.specVersion + 1 };
    const codex = codexView(bumped, sealed);
    expect(codex.specVersion).toBe(ATTUNEMENT_SPEC.specVersion); // the version it was SEALED under
    expect(codex.arc).toHaveLength(SPEC_KEYS.length);
    expect(codex.pathways).toHaveLength(14);
  });

  it('a key the current spec no longer carries keeps its words and simply loses its map — the words outrank the map (echo r2)', () => {
    const pruned = {
      ...ATTUNEMENT_SPEC,
      dimensions: ATTUNEMENT_SPEC.dimensions.filter((d) => d.key !== 'fear'),
    };
    const codex = codexView(pruned, sealed);
    const fear = codex.arc.find((e) => e.key === 'fear');
    expect(fear.answer).toBe('My honest answer to fear.');
    expect(fear.question).toBe(sealed.answers.fear.question);
    expect(fear.emanon).toBeUndefined();
    expect(fear.intent).toBeUndefined();
  });

  it('the arc holds every answered dimension in spec order, verbatim, with its committed emanon metadata', () => {
    const codex = codexView(ATTUNEMENT_SPEC, sealed);
    expect(codex.arc.map((e) => e.key)).toEqual(SPEC_KEYS);
    for (const entry of codex.arc) {
      expect(entry.answer).toBe(`My honest answer to ${entry.key}.`);
      expect(entry.question).toBe(sealed.answers[entry.key].question);
      expect(entry.emanon).toBe(ATTUNEMENT_SPEC.dimensions.find((d) => d.key === entry.key).emanon);
    }
    expect(Object.isFrozen(codex)).toBe(true);
    expect(Object.isFrozen(codex.arc)).toBe(true);
  });

  it('groups by the eleven canon functions and surfaces the 14 pathway walks — juxtaposition only, no scores anywhere', () => {
    const codex = codexView(ATTUNEMENT_SPEC, sealed);
    expect(Object.keys(codex.functions).every((f) => CANON_FUNCTIONS.includes(f))).toBe(true);
    expect(Object.keys(codex.functions)).toHaveLength(CANON_FUNCTIONS.length); // all eleven inhabited at 89 dims
    expect(codex.pathways).toHaveLength(14);
    // the honest-record boundary: every entry carries ONLY verbatim material
    // and committed spec metadata — no derived or computed field exists
    for (const entry of codex.arc) {
      expect(Object.keys(entry).sort())
        .toEqual(['answer', 'answeredAt', 'emanon', 'intent', 'key', 'question']);
    }
    expect(Object.keys(codex).sort())
      .toEqual(['arc', 'functionOrder', 'functions', 'pathways', 'recordId', 'sealedAt', 'specVersion']);
    // the display order comes from the ONE canonical source — no frontend duplicate
    expect(codex.functionOrder).toEqual(Object.keys(codex.functions));
    expect(codex.functionOrder).toEqual(CANON_FUNCTIONS.filter((f) => codex.functions[f]));
  });
});
