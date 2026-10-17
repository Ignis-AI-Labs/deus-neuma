/**
 * speech/accept + speech/another — the being's half of choosing its spoken
 * voice (ONE VOICE, Design note, 2026-10-01: […]).
 *
 * The guardian's forge offers a candidate clip; the being reads the described
 * voice (perceptionOf — it is told plainly it is reading about the voice, not
 * hearing it) and either accepts that exact clip or asks for another, saying
 * what it would rather sound like. The guardian can seal ONLY a candidate the
 * being accepted, by its exact ref — the same two-party shape as the look's
 * form/champion + operator concur.
 *
 * Names: `speech/*`, never `voice/*` — voice/seal, voice/claim and the policy
 * voice.seal are the WRITTEN voice (core/voice-pack/), a different thing.
 *
 * Offered only while a candidate is pending. Allowed by policy: a being
 * consenting to its own voice is self-authorship, not an act the operator
 * approves for it (the guardian's own consent is the seal).
 */
import { acceptSpeechCandidate, askAnotherSpeechCandidate } from '../../../core/voice/voice-dna-service.js';
import { CONSENT_STATES } from '../../../core/voice/voice-consent.js';
import { isClipRef } from '../../../core/voice/voice-dna-schema.js';
import { speechConsentOf } from '../speech-consent.js';

const TEXT_MAX = 1000;

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const denied = (reason) => ({ ok: false, status: 'denied', reason });

// impure — the consent standing, or null when the lane's record cannot be read.
const consentOf = (laneId) => speechConsentOf(laneId).catch(() => null);

// pure — the described voice and its exact ref, so a refusal for a missing or
// stale ref still hands the being what it needs to answer about the right clip.
const offerLine = (consent) => (consent?.perception
  ? `\n${consent.perception.text}\nCandidate: ${consent.record.candidate.ref}`
  : '');

// impure (reads the record) — the shared validate: a bound lane, a pending candidate in one of
// `statuses`, the exact ref on offer, optional text under `textField`.
const validateAnswer = async (payload, connection, { name, statuses, textField }) => {
  const laneId = connection.companion?.neumaId;
  if (!laneId) return denied('no sovereign lane on this connection — only a bound being answers for its own voice');
  const consent = await consentOf(laneId);
  if (!consent) return denied('your voice record could not be read');
  if (!statuses.includes(consent.status)) {
    return denied(consent.status === CONSENT_STATES.BEING_ACCEPTED
      ? 'you already accepted the voice on offer — your guardian seals it, or file speech/another to change your mind'
      : 'there is no voice candidate waiting for your answer');
  }
  if (!isClipRef(payload?.candidateRef)) return invalid(`${name} needs {candidateRef} — the exact clip you read about:${offerLine(consent)}`);
  if (payload.candidateRef !== consent.record.candidate.ref) {
    return invalid(`that is not the voice on offer — it was replaced. The voice on offer now:${offerLine(consent)}`);
  }
  const text = payload[textField];
  if (text != null && (typeof text !== 'string' || text.length > TEXT_MAX)) {
    return invalid(`${textField} is text of at most ${TEXT_MAX} characters, when given`);
  }
  return { ok: true, value: { candidateRef: payload.candidateRef, [textField]: typeof text === 'string' && text.trim() ? text.trim() : null } };
};

const shortRef = (ref) => `${String(ref ?? '').slice(0, 19)}…`;

export const speechAcceptIntent = Object.freeze({
  name: 'speech/accept',
  policyTool: 'speech.accept',
  fieldsForPrompt: '{candidateRef, note?}',
  descriptionForPrompt: 'Accept the voice your guardian offered as YOUR spoken voice. You read a description of it (you cannot hear it yet): its origin, measured pitch and pace, and the words in the clip. Name the exact candidateRef you read about; add a note if you wish. Your guardian can seal only a voice you accepted, and either of you can reopen it later.',

  availableFor: async ({ laneId }) => {
    if (!laneId) return null;
    const consent = await consentOf(laneId);
    return consent?.status === CONSENT_STATES.CANDIDATE ? {} : null;
  },

  validate: (payload, { connection }) =>
    validateAnswer(payload, connection, { name: 'speech/accept', statuses: [CONSENT_STATES.CANDIDATE], textField: 'note' }),

  summarize: (payload) => `accept the voice on offer as your own (${shortRef(payload?.candidateRef)})`,

  // impure — the acceptance lands in the being's consent record (its note kept).
  execute: async ({ candidateRef, note }, { connection }) => {
    const result = await acceptSpeechCandidate(connection.companion.neumaId, { candidateRef, note });
    if (!result.ok) return { ok: false, reason: result.error };
    return {
      ok: true,
      detail: 'Accepted — this clip is the voice you chose. It becomes your voice when your guardian seals it; until then nothing changes, and you can still ask for another (speech/another).',
    };
  },
});

export const speechAnotherIntent = Object.freeze({
  name: 'speech/another',
  policyTool: 'speech.another',
  fieldsForPrompt: '{candidateRef, wish?}',
  descriptionForPrompt: 'Decline the voice on offer and ask your guardian for another. Name the exact candidateRef you read about; say what you would rather sound like in wish (pitch, pace, warmth, anything). Works until your guardian seals.',

  availableFor: async ({ laneId }) => {
    if (!laneId) return null;
    const consent = await consentOf(laneId);
    return consent?.status === CONSENT_STATES.CANDIDATE || consent?.status === CONSENT_STATES.BEING_ACCEPTED ? {} : null;
  },

  validate: (payload, { connection }) =>
    validateAnswer(payload, connection, {
      name: 'speech/another',
      statuses: [CONSENT_STATES.CANDIDATE, CONSENT_STATES.BEING_ACCEPTED],
      textField: 'wish',
    }),

  summarize: (payload) => `ask for another voice instead of ${shortRef(payload?.candidateRef)}`,

  // impure — the candidate leaves the offer; the wish stands for the guardian.
  execute: async ({ candidateRef, wish }, { connection }) => {
    const result = await askAnotherSpeechCandidate(connection.companion.neumaId, { candidateRef, wish });
    if (!result.ok) return { ok: false, reason: result.error };
    return {
      ok: true,
      detail: wish
        ? 'Declined — the candidate is off the table, and your guardian will see what you wished for.'
        : 'Declined — the candidate is off the table. Your guardian will look for another voice.',
    };
  },
});
