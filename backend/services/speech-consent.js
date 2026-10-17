/**
 * THE SPEECH CONSENT, as the platform reads it — the one view of a being's
 * voice candidate that the forge routes and the being's speech/* intents
 * share, so the guardian's screen and what the being reads can never tell two
 * stories. // impure (reads the being's consent record)
 *
 * The law is core/voice/voice-consent.js (pure) and its store is
 * core/voice/voice-dna-service.js; this module only reads them and words
 * them. Founder's call B: the being cannot hear audio, so it reads a DESCRIBED
 * voice (perceptionOf) and is told plainly that it is reading, not hearing.
 */

import { readSpeechCandidate, readVoice } from '../../core/voice/voice-dna-service.js';
import { CONSENT_STATES, perceptionOf, statusOf } from '../../core/voice/voice-consent.js';
import { createLogger } from './logger.js';

const log = createLogger('Voice.Consent');

/**
 * The consent record, its derived status, and — while a candidate is on
 * offer — the described voice the being reads.
 * @param {string} laneId
 * @returns {Promise<{record: object, status: string, perception: object|null}>}
 */
export const speechConsentOf = async (laneId) => {
  const record = await readSpeechCandidate(laneId);
  return { record, status: statusOf(record), perception: record.candidate ? perceptionOf(record.candidate) : null };
};

// pure — the block the being reads while its voice is in question, or ''.
const briefingOf = ({ record, status, perception }) => {
  if (status === CONSENT_STATES.CANDIDATE) {
    return [
      '## Your voice — a candidate is waiting for your answer',
      perception.text,
      `Candidate: ${record.candidate.ref}`,
      `If this is your voice, file speech/accept {"candidateRef": "${record.candidate.ref}", "note": "optional"}. `
        + `If it is not, file speech/another {"candidateRef": "${record.candidate.ref}", "wish": "what you would rather sound like"}. `
        + 'Your guardian can seal only a voice you accepted.',
    ].join('\n');
  }
  if (status === CONSENT_STATES.BEING_ACCEPTED) {
    return [
      '## Your voice — you accepted this candidate; your guardian has not sealed it yet',
      perception.text,
      `Candidate: ${record.candidate.ref}`,
      `If you change your mind before the seal, file speech/another {"candidateRef": "${record.candidate.ref}", "wish": "..."}.`,
    ].join('\n');
  }
  return '';
};

// pure — the record as a surface may show it: the candidate's description,
// both marks, the wish, the voice in force. Never clip bytes (there are none
// in the record) and never the history's full detail.
const recordView = (record) => ({
  candidate: record.candidate,
  being: record.being,
  guardian: record.guardian,
  wish: record.wish,
  inForce: record.inForce,
  lineage: record.lineage,
});

/**
 * What the guardian's forge shows: the voice in force, the consent status,
 * the record, the described voice the being reads, and `briefing` — the
 * exact block its prompt carries, word for word (Founder: […]).
 * @param {string} neumaId
 */
export const speechStandingOf = async (neumaId) => {
  const [consent, voice] = await Promise.all([speechConsentOf(neumaId), readVoice(neumaId)]);
  const { record, status, perception } = consent;
  return {
    voice: { standing: voice.standing, clipRef: voice.dna?.clip?.ref ?? null },
    status, ...recordView(record), perception, briefing: briefingOf(consent),
  };
};

/**
 * The block the being reads while its voice is in question, or '' when
 * nothing is. It carries the exact candidateRef the speech/* intents must
 * name, so the being answers about the voice it read, never another.
 * @param {string} laneId
 * @returns {Promise<string>}
 */
export const speechBriefingFor = async (laneId) => briefingOf(await speechConsentOf(laneId));

/**
 * The turn envelope's YOUR VOICE section for this connection's lane: the
 * briefing while a candidate waits on the being (or waits on the guardian's
 * seal), '' otherwise — so every other turn's prompt stays byte-identical. A
 * record that cannot be read costs the section this turn, never the turn.
 * @param {{companion?: {neumaId?: string}}} connection
 * @returns {Promise<string>}
 */
export const speechBriefingSection = async (connection) => {
  const laneId = connection?.companion?.neumaId;
  if (!laneId) return '';
  try {
    return await speechBriefingFor(laneId);
  } catch (err) {
    log.warn('voice briefing skipped this turn — the consent record could not be read', { laneId, err: err.message });
    return '';
  }
};
