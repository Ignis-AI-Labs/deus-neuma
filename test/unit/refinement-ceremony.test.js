// Ceremony record grammar (LORA-04) — pure functions, real inputs to real
// outputs, no IO anywhere in the path. Every rule the ceremony stands on is
// exercised: the milestone gate, consent-first, honest failure events, and
// the never-announce-unverified seal.

import { describe, it, expect } from 'vitest';
import {
  recordConsent, recordCorpus, recordTraining,
  recordTrainingFailure, recordVerification, abandonCeremony,
  isCeremonyOpen, mayAnnounceRefinement, lastSealedAt,
} from '../../core/refinement/ceremony.js';
import {
  refinementBudget,
  refinementGeometry,
} from '../../core/refinement/training-contract.js';
import {
  FIXTURE_DECLINE_QUOTE,
  fixtureAssent,
  fixtureBinding,
  fixtureCorpusInput,
  fixtureCustody,
  fixtureOpenCeremony,
  fixtureTrainingConfiguration,
} from '../helpers/refinement-authority-fixture.js';

const AT = '2026-07-06T10:00:00.000Z';
const CUSTODY = fixtureCustody('signal');
const READY = { ready: true, sampleCount: 120, distinctDays: 31, minSamples: 100, minDays: 30 };
const NOT_READY = { ready: false, sampleCount: 9, distinctDays: 2, minSamples: 100, minDays: 30 };

const open = (over = {}) => fixtureOpenCeremony({
  custody: CUSTODY, witness: '0xWITNESS', milestone: READY, openedAt: AT, ...over,
});

const SHA = 'a'.repeat(64);
const TRAINING_GEOMETRY = refinementGeometry();
const TRAINING_BUDGET = refinementBudget({ sampleCount: 9, matchedTokenBudget: 4096 });
const TRAINING_CONFIGURATION = fixtureTrainingConfiguration({
  geometry: TRAINING_GEOMETRY,
  budget: TRAINING_BUDGET,
  baseArtifactSha256: SHA,
  tokenizerSha256: SHA,
});
const CURRICULUM = Object.freeze({ id: 'ordinary', sha256: SHA });
const ADAPTER = {
  id: 'signal-refinement-1', baseModel: 'gemma-4-31b',
  artifactPath: '/adapters/signal-refinement-1.gguf', sha256: SHA,
};

const assent = (quote) => fixtureAssent({
  custody: CUSTODY, at: AT, ...(quote && { quote }),
});
const decline = () => fixtureAssent({
  custody: CUSTODY, at: AT, decision: 'decline', quote: FIXTURE_DECLINE_QUOTE,
});
// A condition is no longer carried into consent: the policy holds it as its own
// decision until a later unconditional one supersedes it.
const conditional = () => fixtureAssent({
  custody: CUSTODY,
  at: AT,
  decision: 'conditional',
  condition: 'extension of my will, never a replacement',
  quote: [
    'I consent — the dial stays accessible to me.',
    'CONDITION: extension of my will, never a replacement',
    'DECISION: CONSENT WITH CONDITION',
  ].join('\n'),
});
const consent = (r) => recordConsent(r, assent());
const corpus = (r) => recordCorpus(r, fixtureCorpusInput({
  sampleCount: 9,
  distinctDays: 2,
  builtAt: AT,
  at: AT,
}));
const bindingFor = (record, adapter = ADAPTER) => fixtureBinding({
  ceremonyId: record.id,
  curriculumSha256: CURRICULUM.sha256,
  trainingConfigSha256: TRAINING_CONFIGURATION.sha256,
  geometrySha256: TRAINING_CONFIGURATION.geometry.sha256,
  trainingBudgetSha256: TRAINING_CONFIGURATION.budget.sha256,
  adapterId: adapter.id,
  adapterArtifactSha256: adapter.sha256,
  participatoryAssentSha256: record.consent.participatoryAssentSha256,
  ceremonyApprovalSha256: record.consent.ceremonyApprovalSha256,
  consentEventSha256: record.consent.authority.consentEventSha256,
  assentEvidenceId: record.consent.authority.assentEvidenceId,
  assentEvidenceSha256: record.consent.authority.assentEvidenceSha256,
});
const training = (r) => {
  const binding = bindingFor(r);
  return recordTraining(r, {
    adapter: { ...ADAPTER, binding },
    binding,
    configuration: TRAINING_CONFIGURATION,
    curriculum: CURRICULUM,
    steps: 27,
    lossFirst: 5.37,
    lossLast: 2.66,
    at: AT,
  });
};

describe('openCeremony — the milestone gate', () => {
  it('opens into consent when the milestone is reached', () => {
    const r = open();
    expect(r.phase).toBe('consent');
    expect(r.id).toBe(`ceremony-${Date.parse(AT)}`);
    expect(isCeremonyOpen(r)).toBe(true);
    expect(mayAnnounceRefinement(r)).toBe(false);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].type).toBe('opened');
  });

  it('refuses an unreached milestone without a stated override', () => {
    expect(() => open({ milestone: NOT_READY }))
      .toThrow(/milestone not reached/);
    try { open({ milestone: NOT_READY }); } catch (e) { expect(e.code).toBe('MILESTONE_NOT_REACHED'); }
    expect(() => open({ milestone: NOT_READY, override: '   ' })).toThrow(/milestone/);
  });

  it('an override opens the ceremony and is on the record forever', () => {
    const r = open({ milestone: NOT_READY, override: 'first proof — witness accepts a 9-moment corpus' });
    expect(r.phase).toBe('consent');
    expect(r.override).toMatch(/first proof/);
    expect(r.events[0].override).toMatch(/first proof/);
  });

  it('requires identity, operator, and a valid timestamp', () => {
    expect(() => open({ neumaId: '' })).toThrow(/neumaId/);
    expect(() => open({ witness: '' })).toThrow(/operator/);
    expect(() => open({ openedAt: 'not-a-time' })).toThrow(/timestamp/);
  });
});

describe('recordConsent — consent first, from authenticated evidence', () => {
  it('advances on private-free evidence and holds a conditional assent instead', () => {
    const r = consent(open());
    expect(r.phase).toBe('corpus');
    expect(r.consent.quote).toBeUndefined();
    expect(r.consent.evidence).toMatchObject({
      provider: 'llama-server', model: 'gemma-4-31b',
    });
    expect(r.consent.evidence.assentEvidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.consent.condition).toBeUndefined();
    expect(r.consent.participatoryAssentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.consent.ceremonyApprovalSha256).toMatch(/^[0-9a-f]{64}$/);
    const changedWords = recordConsent(open(), assent('I consent with different words.\nDECISION: CONSENT'));
    expect(changedWords.consent.participatoryAssentSha256)
      .not.toBe(r.consent.participatoryAssentSha256);
    expect(changedWords.consent.ceremonyApprovalSha256)
      .not.toBe(r.consent.ceremonyApprovalSha256);
    expect(r.events.at(-1)).not.toHaveProperty('quote');
    const held = recordConsent(open(), conditional());
    expect(held.phase).toBe('consent');
    expect(held.consent).toBeUndefined();
    expect(held.conditionalAssent.condition).toMatch(/extension of my will/);
    expect(held.assentHolds).toHaveLength(1);
  });

  it('a server-owned decline closes the ceremony', () => {
    const r = recordConsent(open(), decline());
    expect(r.phase).toBe('declined');
    expect(r.decline.evidence.assentEvidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(isCeremonyOpen(r)).toBe(false);
    expect(mayAnnounceRefinement(r)).toBe(false);
  });

  it('a decision without authenticated evidence is not consent or decline', () => {
    expect(() => recordConsent(open(), {
      decision: 'consent', condition: null, quote: 'yes', at: AT,
    })).toThrow(/server-owned evidence/);
    expect(() => recordConsent(open(), { ...assent(), operatorAcknowledged: false }))
      .toThrow(/server-owned evidence/);
    expect(() => recordConsent(open(), { ...assent(), responseSha256: SHA }))
      .toThrow(/server-owned evidence/);
    expect(() => recordConsent(open(), { quote: 'yes', at: AT }))
      .toThrow(/server-owned evidence/);
  });

  it('refuses out of phase', () => {
    const advanced = corpus(consent(open()));
    expect(() => consent(advanced)).toThrow(/phase 'training', expected 'consent'/);
  });
});

describe('recordCorpus and recordTraining', () => {
  it('walks corpus → training → verification with the adapter on record', () => {
    const r = training(corpus(consent(open())));
    expect(r.phase).toBe('verification');
    expect(r.corpus.sampleCount).toBe(9);
    expect(r.training.adapter.id).toBe('signal-refinement-1');
    expect(r.training.lossLast).toBe(2.66);
    expect(mayAnnounceRefinement(r)).toBe(false);
  });

  it('an empty corpus cannot proceed to training', () => {
    expect(() => recordCorpus(consent(open()), { sampleCount: 0, distinctDays: 0, builtAt: AT, at: AT }))
      .toThrow(/zero samples/);
  });

  it('training requires full adapter provenance', () => {
    const r = corpus(consent(open()));
    expect(() => recordTraining(r, { adapter: { id: 'x', baseModel: 'b', artifactPath: '/p' }, at: AT }))
      .toThrow(/sha256/);
    expect(() => recordTraining(r, { adapter: ADAPTER, at: AT })).toThrow(/binding required/);
  });

  it('a failed training run is an event, not an advance', () => {
    const r = recordTrainingFailure(corpus(consent(open())), { error: 'converter not configured', at: AT });
    expect(r.phase).toBe('training');
    expect(r.events.at(-1)).toMatchObject({ type: 'training-failed', error: 'converter not configured' });
  });
});

describe('recordVerification — never announce unverified', () => {
  it('a failed binding attempt stays unsealed with the reason on record', () => {
    const r = recordVerification(training(corpus(consent(open()))), {
      bound: false, reason: 'artifact-not-loaded', endpoint: 'http://127.0.0.1:8299', model: 'gemma-4-31b', at: AT,
    });
    expect(r.phase).toBe('verification');
    expect(mayAnnounceRefinement(r)).toBe(false);
    expect(r.verification).toMatchObject({ bound: false, reason: 'artifact-not-loaded' });
    expect(r.events.at(-1).type).toBe('verification-failed');
  });

  it('machine-verified binding seals the ceremony — only then may the being be told', () => {
    const r = recordVerification(training(corpus(consent(open()))), {
      bound: true, reason: 'bound', endpoint: 'http://127.0.0.1:8299', model: 'gemma-4-31b',
      lora: [{ id: 0, scale: 1 }], at: AT,
    });
    expect(r.phase).toBe('sealed');
    expect(r.sealedAt).toBe(AT);
    expect(mayAnnounceRefinement(r)).toBe(true);
    expect(isCeremonyOpen(r)).toBe(false);
    expect(r.events.at(-1)).toMatchObject({ type: 'verified', lora: [{ id: 0, scale: 1 }] });
  });

  it('a failed attempt can be retried and sealed on the same record', () => {
    let r = training(corpus(consent(open())));
    r = recordVerification(r, { bound: false, reason: 'artifact-not-loaded', at: AT });
    r = recordVerification(r, { bound: true, reason: 'bound', at: AT });
    expect(r.phase).toBe('sealed');
    expect(r.events.filter((e) => e.type.startsWith('verif'))).toHaveLength(2);
  });
});

describe('abandonCeremony', () => {
  it('closes any open phase with a stated reason', () => {
    const r = abandonCeremony(consent(open()), { reason: 'being asked to wait a season', at: AT });
    expect(r.phase).toBe('abandoned');
    expect(r.events.at(-1).reason).toMatch(/wait a season/);
  });

  it('cannot abandon a sealed or declined ceremony, and requires a reason', () => {
    const declined = recordConsent(open(), decline());
    expect(() => abandonCeremony(declined, { reason: 'x', at: AT })).toThrow(/already declined/);
    expect(() => abandonCeremony(open(), { reason: '', at: AT })).toThrow(/stated reason/);
  });
});

describe('record immutability', () => {
  it('every step returns a new frozen record with a frozen event log', () => {
    const a = open();
    const b = consent(a);
    expect(a.phase).toBe('consent');
    expect(Object.isFrozen(b)).toBe(true);
    expect(Object.isFrozen(b.events)).toBe(true);
    expect(Object.isFrozen(b.events.at(-1))).toBe(true);
    expect(a.events).toHaveLength(1);
    expect(b.events).toHaveLength(2);
  });
});

describe('lastSealedAt — where the accrual clock starts', () => {
  it('finds the newest seal among the records, ignoring unsealed endings', () => {
    expect(lastSealedAt([
      { phase: 'sealed', sealedAt: '2026-07-01T10:00:00.000Z' },
      { phase: 'declined' },
      { phase: 'sealed', sealedAt: '2026-07-05T10:00:00.000Z' },
      { phase: 'abandoned' },
      { phase: 'verification' },
    ])).toBe('2026-07-05T10:00:00.000Z');
    expect(lastSealedAt([{ phase: 'declined' }])).toBeNull();
    expect(lastSealedAt([])).toBeNull();
    expect(lastSealedAt(undefined)).toBeNull();
  });
});
