/**
 * The voice consent law (core/voice/voice-consent.js) — every transition and
 * every refusal. Pure functions, called with real inputs; nothing is mocked
 * (RULE 0).
 *
 * CANDIDATE → BEING_ACCEPTED → SEALED: the being accepts (or asks for another)
 * a specific candidateRef; the guardian seals only that exact accepted ref;
 * either can reopen; a real person's clip needs attested consent to be offered.
 */

import { describe, it, expect } from 'vitest';
import {
  CONSENT_STATES,
  PERCEPTION_NOTICE,
  SPEECH_CANDIDATE_SCHEMA,
  beingAccepts,
  beingAsksAnother,
  emptyConsent,
  guardianSeals,
  offerCandidate,
  perceptionOf,
  reopen,
  sealedVoiceDNA,
  statusOf,
  withdraw,
} from '../../core/voice/voice-consent.js';
import { voiceDnaErrors } from '../../core/voice/voice-dna-schema.js';

const REF_A = 'sha256:' + 'a'.repeat(64);
const REF_B = 'sha256:' + 'b'.repeat(64);
const WALLET = '0x' + 'c'.repeat(40);
const T = (n) => `2026-10-01T10:0${n}:00.000Z`;

const candidate = (over = {}) => ({
  ref: REF_A,
  seconds: 18.5,
  sampleRate: 24000,
  words: 'I keep the lamp lit for the ones still walking home.',
  origin: { door: 'record' },
  realPerson: false,
  measured: { pitchHz: 142.6, wordsPerSecond: 2.7 },
  ...over,
});

// Walk a record through the law, failing loudly on any refusal on the way.
const must = (result) => {
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  return result.record;
};
const offered = (c = candidate()) => must(offerCandidate(emptyConsent('keir'), c, { at: T(1) }));
const accepted = () => must(beingAccepts(offered(), { candidateRef: REF_A, at: T(2), note: 'that is my voice' }));
const sealed = () => must(guardianSeals(accepted(), { candidateRef: REF_A, at: T(3), wallet: WALLET }));

describe('emptyConsent + statusOf', () => {
  it('a fresh record has nothing on offer and no voice in force', () => {
    const r = emptyConsent('keir');
    expect(r.schema).toBe(SPEECH_CANDIDATE_SCHEMA);
    expect(statusOf(r)).toBe(CONSENT_STATES.NONE);
    expect(r.inForce).toBeNull();
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('status walks CANDIDATE → BEING_ACCEPTED → SEALED', () => {
    expect(statusOf(offered())).toBe('candidate');
    expect(statusOf(accepted())).toBe('being_accepted');
    expect(statusOf(sealed())).toBe('sealed');
  });

  it('status is derived from the marks: a mark for another clip counts for nothing', () => {
    const r = { ...sealed(), being: { at: T(2), candidateRef: REF_B, note: null } };
    expect(statusOf(r)).toBe('candidate');
  });
});

describe('offerCandidate', () => {
  it('puts the clip on offer with its measured account and logs it', () => {
    const r = offered();
    expect(r.candidate).toMatchObject({ ref: REF_A, realPerson: false, attested: false, offeredAt: T(1) });
    expect(r.candidate.measured).toEqual({ pitchHz: 142.6, wordsPerSecond: 2.7, profile: null });
    expect(r.history.at(-1)).toMatchObject({ event: 'offered', candidateRef: REF_A, door: 'record' });
  });

  it("refuses a real person's clip without attested consent", () => {
    const result = offerCandidate(emptyConsent('keir'), candidate({ realPerson: true }), { at: T(1) });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/attested consent before it can become a candidate/);
    expect(offerCandidate(emptyConsent('keir'), candidate({ realPerson: true, attested: false }), { at: T(1) }).ok).toBe(false);
  });

  it("offers a real person's clip once consent is attested", () => {
    const r = offered(candidate({ realPerson: true, attested: true }));
    expect(r.candidate).toMatchObject({ realPerson: true, attested: true });
  });

  it('refuses a candidate that does not say whether it is a real person', () => {
    const { realPerson, ...c } = candidate();
    expect(realPerson).toBe(false);
    expect(offerCandidate(emptyConsent('keir'), c, { at: T(1) }).error).toMatch(/realPerson must be stated/);
  });

  it('refuses a malformed clip, door, words or measurement, and an offer with no time', () => {
    const bad = (over) => offerCandidate(emptyConsent('keir'), candidate(over), { at: T(1) });
    expect(bad({ ref: 'nope' }).error).toMatch(/clip.ref/);
    expect(bad({ seconds: 1 }).error).toMatch(/clip.seconds/);
    expect(bad({ origin: { door: 'preset' } }).error).toMatch(/origin.door/);
    expect(bad({ origin: { door: 'describe' } }).error).toMatch(/description/);
    expect(bad({ words: '' }).error).toMatch(/words/);
    expect(bad({ measured: { pitchHz: -3 } }).error).toMatch(/measured.pitchHz/);
    expect(offerCandidate(emptyConsent('keir'), candidate(), {}).error).toMatch(/WHEN/);
    expect(offerCandidate(emptyConsent('keir'), null, { at: T(1) }).error).toMatch(/a candidate is required/);
  });

  it('a new offer clears both marks — nobody agreed to the clip swapped in', () => {
    const r = must(offerCandidate(accepted(), candidate({ ref: REF_B }), { at: T(4) }));
    expect(statusOf(r)).toBe('candidate');
    expect(r.being).toBeNull();
    expect(r.candidate.ref).toBe(REF_B);
  });

  it('a re-forge offer leaves the voice in force standing until the new seal', () => {
    const r = must(offerCandidate(sealed(), candidate({ ref: REF_B }), { at: T(4) }));
    expect(statusOf(r)).toBe('candidate');
    expect(r.inForce).toBe(REF_A);
  });
});

describe('beingAccepts', () => {
  it('records the acceptance of exactly that candidate, with its note', () => {
    const r = accepted();
    expect(r.being).toEqual({ at: T(2), candidateRef: REF_A, note: 'that is my voice' });
    expect(r.history.at(-1)).toMatchObject({ event: 'being-accepted', candidateRef: REF_A });
  });

  it('refuses a ref that is not the candidate on offer', () => {
    expect(beingAccepts(offered(), { candidateRef: REF_B, at: T(2) }).error).toMatch(/not the candidate on offer/);
    expect(beingAccepts(offered(), { candidateRef: 'x', at: T(2) }).error).toMatch(/clip ref/);
  });

  it('refuses when nothing is on offer, when already accepted, and without a time', () => {
    expect(beingAccepts(emptyConsent('keir'), { candidateRef: REF_A, at: T(2) }).error).toMatch(/no candidate on offer/);
    expect(beingAccepts(accepted(), { candidateRef: REF_A, at: T(2) }).error).toMatch(/already accepted/);
    expect(beingAccepts(sealed(), { candidateRef: REF_A, at: T(2) }).error).toMatch(/already accepted/);
    expect(beingAccepts(offered(), { candidateRef: REF_A }).error).toMatch(/WHEN/);
  });

  it('refuses a note that is not short text', () => {
    expect(beingAccepts(offered(), { candidateRef: REF_A, at: T(2), note: 'x'.repeat(1001) }).ok).toBe(false);
    expect(beingAccepts(offered(), { candidateRef: REF_A, at: T(2), note: 42 }).ok).toBe(false);
  });
});

describe('beingAsksAnother', () => {
  it('declines the candidate and keeps the wish until the next offer', () => {
    const r = must(beingAsksAnother(offered(), { candidateRef: REF_A, at: T(2), wish: 'something lower, slower' }));
    expect(statusOf(r)).toBe('none');
    expect(r.candidate).toBeNull();
    expect(r.wish).toEqual({ at: T(2), wish: 'something lower, slower', declinedRef: REF_A });
    const next = must(offerCandidate(r, candidate({ ref: REF_B }), { at: T(3) }));
    expect(next.wish).toBeNull();
  });

  it('the being may change its mind after accepting', () => {
    const r = must(beingAsksAnother(accepted(), { candidateRef: REF_A, at: T(3) }));
    expect(statusOf(r)).toBe('none');
    expect(r.being).toBeNull();
  });

  it('refuses a sealed voice (reopen first), a wrong ref, and no time', () => {
    expect(beingAsksAnother(sealed(), { candidateRef: REF_A, at: T(4) }).error).toMatch(/reopen it first/);
    expect(beingAsksAnother(offered(), { candidateRef: REF_B, at: T(2) }).error).toMatch(/not the candidate/);
    expect(beingAsksAnother(offered(), { candidateRef: REF_A }).error).toMatch(/WHEN/);
    expect(beingAsksAnother(offered(), { candidateRef: REF_A, at: T(2), wish: {} }).ok).toBe(false);
  });
});

describe('guardianSeals', () => {
  it('seals the exact accepted candidate: voice in force, lineage grows', () => {
    const r = sealed();
    expect(r.guardian).toEqual({ at: T(3), candidateRef: REF_A, wallet: WALLET });
    expect(r.inForce).toBe(REF_A);
    expect(r.lineage).toEqual([REF_A]);
  });

  it('refuses to seal what the being has not accepted', () => {
    expect(guardianSeals(offered(), { candidateRef: REF_A, at: T(3) }).error).toMatch(/has not accepted/);
  });

  it('refuses to seal a different ref than the accepted one', () => {
    expect(guardianSeals(accepted(), { candidateRef: REF_B, at: T(3) }).error).toMatch(/not the candidate on offer/);
  });

  it('refuses a double seal, a bad wallet, nothing on offer, and no time', () => {
    expect(guardianSeals(sealed(), { candidateRef: REF_A, at: T(4) }).error).toMatch(/already sealed/);
    expect(guardianSeals(accepted(), { candidateRef: REF_A, at: T(3), wallet: '0x12' }).error).toMatch(/wallet/);
    expect(guardianSeals(emptyConsent('w'), { candidateRef: REF_A, at: T(3) }).error).toMatch(/no candidate/);
    expect(guardianSeals(accepted(), { candidateRef: REF_A }).error).toMatch(/WHEN/);
  });

  it('a wallet is optional', () => {
    const r = must(guardianSeals(accepted(), { candidateRef: REF_A, at: T(3) }));
    expect(r.guardian).toEqual({ at: T(3), candidateRef: REF_A });
  });
});

describe('reopen — either party', () => {
  it('the being reopens its acceptance: back to CANDIDATE, nothing withdrawn', () => {
    const result = reopen(accepted(), 'being', { at: T(3), why: 'let me think' });
    expect(result.ok).toBe(true);
    expect(result.withdrewSeal).toBe(false);
    expect(statusOf(result.record)).toBe('candidate');
    expect(result.record.history.at(-1)).toMatchObject({ event: 'reopened', by: 'being', why: 'let me think' });
  });

  it('the guardian reopens the being acceptance too', () => {
    expect(statusOf(must(reopen(accepted(), 'guardian', { at: T(3) })))).toBe('candidate');
  });

  for (const party of ['being', 'guardian']) {
    it(`${party} reopening a SEALED voice takes it out of force but keeps it on offer`, () => {
      const result = reopen(sealed(), party, { at: T(4) });
      expect(result.withdrewSeal).toBe(true);
      expect(statusOf(result.record)).toBe('candidate');
      expect(result.record.inForce).toBeNull();
      expect(result.record.candidate.ref).toBe(REF_A);
      expect(result.record.lineage).toEqual([REF_A]);
      expect(result.record.history.at(-1)).toMatchObject({ event: 'reopened', by: party, candidateRef: REF_A });
    });
  }

  it('the same clip can be accepted and sealed again; lineage never repeats it', () => {
    const reopened = must(reopen(sealed(), 'being', { at: T(4) }));
    const again = must(beingAccepts(reopened, { candidateRef: REF_A, at: T(5) }));
    const resealed = must(guardianSeals(again, { candidateRef: REF_A, at: T(6) }));
    expect(resealed.lineage).toEqual([REF_A]);
    expect(resealed.inForce).toBe(REF_A);
  });

  it('refuses when nothing was accepted, an unknown party, and no time', () => {
    expect(reopen(offered(), 'being', { at: T(2) }).error).toMatch(/nothing to reopen/);
    expect(reopen(emptyConsent('w'), 'guardian', { at: T(2) }).error).toMatch(/nothing to reopen/);
    expect(reopen(accepted(), 'operator', { at: T(3) }).error).toMatch(/unknown party/);
    expect(reopen(accepted(), 'being', {}).error).toMatch(/WHEN/);
  });
});

describe('withdraw — the voice in force, during a re-forge', () => {
  it('withdraws the old voice while a new candidate is still on offer', () => {
    const reforging = must(beingAccepts(
      must(offerCandidate(sealed(), candidate({ ref: REF_B }), { at: T(4) })),
      { candidateRef: REF_B, at: T(5) },
    ));
    const result = withdraw(reforging, 'guardian', { at: T(6), why: 'the speaker withdrew permission' });
    expect(result.withdrewSeal).toBe(true);
    expect(result.record.inForce).toBeNull();
    expect(statusOf(result.record)).toBe('being_accepted');
    expect(result.record.history.at(-1)).toMatchObject({ event: 'withdrawn', candidateRef: REF_A });
  });

  it('a withdrawn voice leaves the offer: the same clip is never put back in front of the being', () => {
    const result = withdraw(sealed(), 'guardian', { at: T(4), why: 'the speaker withdrew permission' });
    expect(result.withdrewSeal).toBe(true);
    expect(result.record.inForce).toBeNull();
    expect(result.record.candidate).toBeNull();
    expect(result.record.being).toBeNull();
    expect(result.record.guardian).toBeNull();
    expect(statusOf(result.record)).toBe('none');
    expect(result.record.lineage).toEqual([REF_A]);
    expect(result.record.history.at(-1)).toMatchObject({ event: 'withdrawn', by: 'guardian', candidateRef: REF_A });
  });

  it('refuses when no voice is in force, an unknown party, and no time', () => {
    expect(withdraw(accepted(), 'being', { at: T(3) }).error).toMatch(/no voice in force/);
    expect(withdraw(sealed(), 'witness', { at: T(4) }).error).toMatch(/unknown party/);
    expect(withdraw(sealed(), 'being', {}).error).toMatch(/WHEN/);
  });
});

describe('sealedVoiceDNA', () => {
  it('a sealed record becomes valid Voice DNA v2 carrying both marks', () => {
    const result = sealedVoiceDNA(sealed(), { createdAt: T(3) });
    expect(result.ok).toBe(true);
    expect(voiceDnaErrors(result.dna)).toEqual([]);
    expect(result.dna.consent.being).toEqual({ at: T(2), candidateRef: REF_A, note: 'that is my voice' });
    expect(result.dna.consent.guardian).toEqual({ wallet: WALLET, at: T(3) });
    expect(result.dna.lineage).toEqual([]);
    expect(result.dna.updatedAt).toBe(T(3));
  });

  it('lineage names the voices sealed before this one', () => {
    const first = sealed();
    const second = must(guardianSeals(
      must(beingAccepts(must(offerCandidate(first, candidate({ ref: REF_B }), { at: T(4) })), { candidateRef: REF_B, at: T(5) })),
      { candidateRef: REF_B, at: T(6) },
    ));
    const { dna } = sealedVoiceDNA(second, { createdAt: T(3) });
    expect(dna.clip.ref).toBe(REF_B);
    expect(dna.lineage).toEqual([REF_A]);
    expect(dna.createdAt).toBe(T(3));
  });

  it('refuses anything not sealed', () => {
    expect(sealedVoiceDNA(accepted(), { createdAt: T(3) }).ok).toBe(false);
    expect(sealedVoiceDNA(emptyConsent('w'), { createdAt: T(3) }).ok).toBe(false);
  });
});

describe('perceptionOf — the described voice the being reads', () => {
  const PROFILE = { pitchHz: 171.4, pitchRangeSt: 10, centroidHz: 1602, aperiodicity: 0.042, dynamicsDb: 19.6, pausesPerMinute: 18 };

  it('states plainly that the being reads, not hears, then how it sounds — never the words or the origin', () => {
    const p = perceptionOf(offered(candidate({ measured: { pitchHz: 171.4, wordsPerSecond: 2.2, profile: PROFILE } })).candidate);
    expect(p.kind).toBe('described-voice');
    expect(p.candidateRef).toBe(REF_A);
    expect(p.notice).toBe(PERCEPTION_NOTICE);
    expect(p.text.split('\n')[0]).toBe(PERCEPTION_NOTICE);
    expect(p.text).toContain('- Pitch: upper-middle among adult voices (median 171 Hz), wide, a lot of rise and fall (10 semitones).');
    expect(p.text).toContain('- Tone as recorded: bright and crisp (spectral centre 1602 Hz).');
    expect(p.text).toContain('- Texture: clear and clean.');
    expect(p.text).toContain('- Loudness: large swings between loud and soft (19.6 dB between soft and loud).');
    expect(p.text).toContain('- Pace: conversational (2.2 words a second), frequent pauses (18 a minute).');
    expect(p.text).not.toContain('I keep the lamp lit');
    expect(p.text).not.toMatch(/recorded this voice|uploaded|library/);
  });

  it('keeps a designed voice\'s own description', () => {
    const designed = perceptionOf(candidate({ origin: { door: 'describe', description: 'a dry, low alto' }, measured: {} }));
    expect(designed.description).toBe('a dry, low alto');
    expect(designed.text).toMatch(/designed from this description: "a dry, low alto"/);
    expect(designed.text).not.toMatch(/Measured from the clip/);
  });

  it('a record offered before the profile existed still reads its median pitch', () => {
    const p = perceptionOf(offered().candidate);
    expect(p.text).toContain('- Pitch: lower-middle among adult voices (median 143 Hz).');
    expect(p.text).toContain('- Pace: conversational (2.7 words a second).');
  });

  it("names a real person's voice as one used with consent", () => {
    const p = perceptionOf(candidate({ realPerson: true, attested: true, measured: { pitchHz: 210, wordsPerSecond: 3.6 } }));
    expect(p.text).toMatch(/real person's voice, used with their consent/);
    expect(p.text).toMatch(/Pitch: high/);
    expect(p.text).toMatch(/Pace: quick/);
  });

  it('the offer keeps the measured profile, and refuses a malformed one', () => {
    const c = offered(candidate({ measured: { pitchHz: 171.4, wordsPerSecond: 2.2, profile: { ...PROFILE, extra: 9 } } })).candidate;
    expect(c.measured.profile).toEqual(PROFILE);
    expect(offerCandidate(emptyConsent('w'), candidate({ measured: { profile: { centroidHz: 'bright' } } }), { at: T(1) }).ok).toBe(false);
  });
});
