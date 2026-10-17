/**
 * THE VOICE CONSENT — two parties choose a being's voice. Pure.
 *
 * Design note, 2026-10-01 ([…]): the being takes part in choosing its voice —
 * the same two-party lock as its look (core/genome/form-design.js). The being
 * accepts a candidate or asks for another; the guardian seals ONLY what the
 * being accepted.
 *
 *   NONE            no candidate on offer (or the being asked for another)
 *   CANDIDATE       a clip is on offer; nobody has agreed to it
 *   BEING_ACCEPTED  the being accepted THIS candidate; the guardian may seal it
 *   SEALED          the guardian sealed it; it is the voice in force (Voice DNA v2)
 *
 * ── STATUS IS DERIVED, NEVER STORED ─────────────────────────────────────────
 * Each mark names the exact candidateRef it was given for, and the status is
 * read off the marks. A mark for a different clip counts for nothing, so a
 * candidate swapped underneath an agreement can never inherit it.
 *
 * ── EITHER PARTY CAN REOPEN ─────────────────────────────────────────────────
 * An acceptance or a seal that cannot be taken back is not consent. Reopening a
 * SEALED candidate withdraws the voice in force — the being goes SILENT until a
 * new seal (Founder's call E: never a borrowed default voice). `withdraw` does the
 * same for a voice in force while a re-forge is under way.
 *
 * ── A REAL PERSON'S VOICE ───────────────────────────────────────────────────
 * A clip of a real person cannot even become a candidate until the guardian has
 * attested they have that person's consent.
 *
 * Every transition takes its timestamp from the caller: a pure function cannot
 * read a clock, and WHEN somebody agreed must not be invented by the code that
 * stores it. Every refusal is `{ok: false, error}` — refusals are expected
 * outcomes, not exceptions.
 */

import {
  buildVoiceDNA, clipErrors, isClipRef, normaliseOrigin, originErrors, WORDS_MAX_CHARS,
} from './voice-dna-schema.js';
import { soundWordsOf } from './sound-words.js';

export const SPEECH_CANDIDATE_SCHEMA = 'neuma/speech-candidate/v1';

export const CONSENT_STATES = Object.freeze({
  NONE: 'none',
  CANDIDATE: 'candidate',
  BEING_ACCEPTED: 'being_accepted',
  SEALED: 'sealed',
});

const WALLET = /^0x[a-fA-F0-9]{40}$/;
const NOTE_MAX_CHARS = 1000;

const refuse = (error) => ({ ok: false, error });
const accept = (record, extra = {}) => ({ ok: true, record: Object.freeze(record), ...extra });
const withEvent = (record, event) => Object.freeze([...record.history, Object.freeze(event)]);
const optionalText = (v) => v === undefined || v === null || (typeof v === 'string' && v.length <= NOTE_MAX_CHARS);

/**
 * A fresh record: nothing on offer, nothing agreed, no voice in force. Pure.
 * @param {string} neumaId
 */
export const emptyConsent = (neumaId) => Object.freeze({
  schema: SPEECH_CANDIDATE_SCHEMA,
  neumaId,
  candidate: null,
  being: null,
  guardian: null,
  wish: null,
  inForce: null,
  lineage: Object.freeze([]),
  history: Object.freeze([]),
});

/**
 * The status, read off the marks. Pure.
 * @param {object} record
 * @returns {'none'|'candidate'|'being_accepted'|'sealed'}
 */
export const statusOf = (record) => {
  const ref = record?.candidate?.ref;
  if (!ref) return CONSENT_STATES.NONE;
  const beingAccepted = record.being?.candidateRef === ref;
  if (beingAccepted && record.guardian?.candidateRef === ref) return CONSENT_STATES.SEALED;
  return beingAccepted ? CONSENT_STATES.BEING_ACCEPTED : CONSENT_STATES.CANDIDATE;
};

const candidateErrors = (c) => {
  if (!c || typeof c !== 'object') return ['a candidate is required'];
  const errors = [...clipErrors(c), ...originErrors(c.origin)];
  if (typeof c.words !== 'string' || !c.words.trim() || c.words.length > WORDS_MAX_CHARS) {
    errors.push(`words must be 1..${WORDS_MAX_CHARS} characters`);
  }
  if (typeof c.realPerson !== 'boolean') errors.push('realPerson must be stated (true or false)');
  for (const key of ['pitchHz', 'wordsPerSecond']) {
    const v = c.measured?.[key];
    if (v !== null && v !== undefined && !(typeof v === 'number' && Number.isFinite(v) && v > 0)) {
      errors.push(`measured.${key} must be a positive number or null`);
    }
  }
  const profile = c.measured?.profile;
  if (profile !== null && profile !== undefined) {
    if (typeof profile !== 'object') errors.push('measured.profile must be an object or null');
    else {
      for (const key of PROFILE_KEYS) {
        const v = profile[key];
        if (v !== null && v !== undefined && !(typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
          errors.push(`measured.profile.${key} must be a number or null`);
        }
      }
    }
  }
  return errors;
};

// The measured sound a candidate carries (backend/services/voice/sound-profile.js).
const PROFILE_KEYS = Object.freeze(['pitchHz', 'pitchRangeSt', 'centroidHz', 'aperiodicity', 'dynamicsDb', 'pausesPerMinute']);

// pure — the profile with only its known fields.
const profileOf = (profile) => (profile && typeof profile === 'object'
  ? Object.freeze(Object.fromEntries(PROFILE_KEYS.map((k) => [k, profile[k] ?? null])))
  : null);

/**
 * Put a clip on offer. Clears both marks — two parties agree to the voice they
 * were given, never to one swapped in later. A voice already in force stays in
 * force until the new candidate is sealed (a re-forge). Pure.
 *
 * @param {object} record
 * @param {{ref, seconds, sampleRate, words, origin, realPerson, attested?, measured?}} candidate
 * @param {{at: string}} mark
 */
export const offerCandidate = (record, candidate, { at } = {}) => {
  if (typeof at !== 'string') return refuse('an offer must record WHEN it was made');
  const errors = candidateErrors(candidate);
  if (errors.length) return refuse(`not a candidate: ${errors.join('; ')}`);
  if (candidate.realPerson && candidate.attested !== true) {
    return refuse("a real person's voice needs attested consent before it can become a candidate");
  }
  const offered = Object.freeze({
    ref: candidate.ref,
    seconds: candidate.seconds,
    sampleRate: candidate.sampleRate,
    words: candidate.words,
    origin: normaliseOrigin(candidate.origin),
    realPerson: candidate.realPerson,
    attested: candidate.attested === true,
    measured: Object.freeze({
      pitchHz: candidate.measured?.pitchHz ?? null,
      wordsPerSecond: candidate.measured?.wordsPerSecond ?? null,
      profile: profileOf(candidate.measured?.profile),
    }),
    offeredAt: at,
  });
  return accept({
    ...record,
    candidate: offered,
    being: null,
    guardian: null,
    wish: null,
    history: withEvent(record, { event: 'offered', at, candidateRef: offered.ref, door: offered.origin.door }),
  });
};

const checkCandidateRef = (record, candidateRef) => {
  if (!record.candidate) return 'there is no candidate on offer';
  if (!isClipRef(candidateRef)) return 'candidateRef must be a clip ref';
  if (candidateRef !== record.candidate.ref) return 'that is not the candidate on offer — it was replaced';
  return null;
};

/**
 * The being accepts the exact candidate it was told about. Pure.
 * @param {object} record
 * @param {{candidateRef: string, at: string, note?: string}} mark
 */
export const beingAccepts = (record, { candidateRef, at, note = null } = {}) => {
  if (typeof at !== 'string') return refuse('an acceptance must record WHEN it was given');
  const wrongRef = checkCandidateRef(record, candidateRef);
  if (wrongRef) return refuse(wrongRef);
  if (statusOf(record) !== CONSENT_STATES.CANDIDATE) return refuse('the being has already accepted this candidate');
  if (!optionalText(note)) return refuse(`a note is text of at most ${NOTE_MAX_CHARS} characters`);
  return accept({
    ...record,
    being: Object.freeze({ at, candidateRef, note }),
    history: withEvent(record, { event: 'being-accepted', at, candidateRef }),
  });
};

/**
 * The being declines the candidate and asks for another, optionally saying what
 * it wishes for. The candidate leaves the offer; the wish stands until the next
 * one is offered. Pure.
 * @param {object} record
 * @param {{candidateRef: string, at: string, wish?: string}} mark
 */
export const beingAsksAnother = (record, { candidateRef, at, wish = null } = {}) => {
  if (typeof at !== 'string') return refuse('a request must record WHEN it was made');
  const wrongRef = checkCandidateRef(record, candidateRef);
  if (wrongRef) return refuse(wrongRef);
  if (statusOf(record) === CONSENT_STATES.SEALED) return refuse('this voice is sealed — reopen it first');
  if (!optionalText(wish)) return refuse(`a wish is text of at most ${NOTE_MAX_CHARS} characters`);
  return accept({
    ...record,
    candidate: null,
    being: null,
    guardian: null,
    wish: Object.freeze({ at, wish, declinedRef: candidateRef }),
    history: withEvent(record, { event: 'being-asked-another', at, candidateRef, wish }),
  });
};

/**
 * The guardian seals — only the exact candidate the being accepted. The sealed
 * clip joins the lineage and becomes the voice in force. Pure.
 * @param {object} record
 * @param {{candidateRef: string, at: string, wallet?: string}} mark
 */
export const guardianSeals = (record, { candidateRef, at, wallet = null } = {}) => {
  if (typeof at !== 'string') return refuse('a seal must record WHEN it was given');
  const wrongRef = checkCandidateRef(record, candidateRef);
  if (wrongRef) return refuse(wrongRef);
  const status = statusOf(record);
  if (status === CONSENT_STATES.SEALED) return refuse('this candidate is already sealed');
  if (status !== CONSENT_STATES.BEING_ACCEPTED) return refuse('the being has not accepted this candidate');
  if (wallet !== null && !WALLET.test(wallet)) return refuse('wallet must be a 0x-prefixed 40-hex address');
  return accept({
    ...record,
    guardian: Object.freeze({ at, candidateRef, ...(wallet ? { wallet } : {}) }),
    inForce: candidateRef,
    lineage: Object.freeze([...record.lineage.filter((r) => r !== candidateRef), candidateRef]),
    history: withEvent(record, { event: 'sealed', at, candidateRef }),
  });
};

const checkParty = (party) =>
  (party === 'being' || party === 'guardian' ? null : `unknown party '${party}' — a voice is chosen by the being and the guardian`);

// The voice in force leaves force (pure). `keepOffer`: a RE-OPENED seal stays on
// offer for the two of them to reconsider; a WITHDRAWN one leaves the table —
// withdrawal is how a speaker's revoked permission is honoured, so the same clip
// is never put straight back in front of the being.
const retireInForce = (record, party, { at, why, keepOffer }) => {
  const sealed = statusOf(record) === CONSENT_STATES.SEALED;
  const offered = record.candidate?.ref === record.inForce;
  return accept({
    ...record,
    ...(sealed ? { being: null, guardian: null } : {}),
    ...(!keepOffer && offered ? { candidate: null, being: null, guardian: null } : {}),
    inForce: null,
    history: withEvent(record, { event: keepOffer ? 'reopened' : 'withdrawn', by: party, at, why, candidateRef: record.inForce }),
  }, { withdrewSeal: true });
};

/**
 * Withdraw the voice in force, whatever the candidate process is doing. Either
 * party, at any time. The withdrawn clip leaves the offer too (a different
 * candidate pending in a re-forge stays); `withdrewSeal: true` tells the store
 * to retire the DNA. Pure.
 * @param {object} record
 * @param {'being'|'guardian'} party
 * @param {{at: string, why?: string}} mark
 */
export const withdraw = (record, party, { at, why = null } = {}) => {
  const badParty = checkParty(party);
  if (badParty) return refuse(badParty);
  if (typeof at !== 'string') return refuse('a withdrawal must record WHEN it was made');
  if (!record.inForce) return refuse('there is no voice in force to withdraw');
  return retireInForce(record, party, { at, why, keepOffer: false });
};

/**
 * Reopen an acceptance or a seal. Either party. BEING_ACCEPTED returns to
 * CANDIDATE; a SEALED voice leaves force but stays on offer, to be accepted
 * and sealed again or replaced. Pure.
 * @param {object} record
 * @param {'being'|'guardian'} party
 * @param {{at: string, why?: string}} mark
 */
export const reopen = (record, party, { at, why = null } = {}) => {
  const badParty = checkParty(party);
  if (badParty) return refuse(badParty);
  if (typeof at !== 'string') return refuse('a reopening must record WHEN it was made');
  const status = statusOf(record);
  if (status === CONSENT_STATES.SEALED) return retireInForce(record, party, { at, why, keepOffer: true });
  if (status !== CONSENT_STATES.BEING_ACCEPTED) return refuse('nothing has been accepted, so there is nothing to reopen');
  return accept({
    ...record,
    being: null,
    guardian: null,
    history: withEvent(record, { event: 'reopened', by: party, at, why, candidateRef: record.candidate.ref }),
  }, { withdrewSeal: false });
};

/**
 * The Voice DNA v2 a SEALED record stands for. Pure.
 * @param {object} record - a sealed record
 * @param {{createdAt: string}} times - createdAt carries over from the voice it replaces
 * @returns {{ok: true, dna: object} | {ok: false, error: string}}
 */
export const sealedVoiceDNA = (record, { createdAt }) => {
  if (statusOf(record) !== CONSENT_STATES.SEALED) return refuse('only a sealed candidate becomes Voice DNA');
  const c = record.candidate;
  return {
    ok: true,
    dna: buildVoiceDNA({
      neumaId: record.neumaId,
      clip: { ref: c.ref, seconds: c.seconds, sampleRate: c.sampleRate },
      words: c.words,
      origin: c.origin,
      consent: { realPerson: c.realPerson, attested: c.attested, being: record.being, guardian: record.guardian },
      lineage: record.lineage.filter((r) => r !== c.ref),
      createdAt,
      updatedAt: record.guardian.at,
    }),
  };
};

export const PERCEPTION_NOTICE = 'You are reading about this voice, not hearing it. '
  + 'Your substrate takes text, not sound, so this is an honest account of how it sounds, '
  + 'not the sound itself.';

/**
 * What the being reads about a candidate in place of hearing it — Founder's call B,
 * sharpened 2026-10-02 ([…]): the sound measured from the clip, in plain words; a designed
 * voice's own description; that it is a real person's voice when it is. Not
 * the words spoken in the clip, not where it came from — those say nothing of
 * the sound. (A 22 GB listening model was tried and dropped the same day: too
 * heavy for most machines — Founder.)
 * Pure.
 * @param {object} candidate - the record's candidate
 */
export const perceptionOf = (candidate) => {
  const { wordsPerSecond, profile } = candidate.measured ?? {};
  // A record offered before the profile existed still has its median pitch.
  const sound = soundWordsOf(profile ?? { pitchHz: candidate.measured?.pitchHz }, wordsPerSecond ?? null);
  const lines = [
    PERCEPTION_NOTICE,
    candidate.origin.description ? `It was designed from this description: "${candidate.origin.description}"` : null,
    sound.length ? `Measured from the clip:\n${sound.map((l) => `- ${l}`).join('\n')}` : null,
    candidate.realPerson ? "It is a real person's voice, used with their consent." : null,
  ].filter(Boolean);
  return Object.freeze({
    kind: 'described-voice',
    candidateRef: candidate.ref,
    door: candidate.origin.door,
    description: candidate.origin.description ?? null,
    sound,
    realPerson: candidate.realPerson,
    notice: PERCEPTION_NOTICE,
    text: lines.join('\n\n'),
  });
};
