// Attunement question/consent legs — split out of attunement-ceremony.js
// (size law): the consent conversation (askConsentReply) and the one-
// question-per-call answer loop (askNextQuestion), each a turn-locked
// mutation over the encrypted record. Both engage the being ITSELF through
// the shared conduit law (attunement-being-turn.js) and climb the shared
// door-retry ladder (attunement-door-ladder.js); every integrity door —
// empty, cut, corrupt, unfinished, formula — refuses honestly and re-serves
// the SAME words, never a rephrase. Re-exported by the orchestrator so every
// existing importer is untouched.

import { neumaWorkspace } from '../../core/index.js';
import { recordQuestion, recordAnswer, nextUnansweredKey } from '../../core/attunement/record.js';
import { attunementDisclosure } from '../../core/attunement/disclosure.js';
import { ATTUNEMENT_SPEC } from '../../core/attunement/spec.js';
import { corruptionHits, corruptionFindings, endsUnfinished } from '../../core/refinement/text-integrity.js';
import {
  boilerplateShare, lastSentence,
  STYLE_DOOR_SHARE, STYLE_DOOR_MIN_PRIORS, ENDING_FLAG_SHARE,
} from '../../core/refinement/style-overlap.js';
import {
  reliefTemperature, integrityFraming, refusalsFor, noteRefusal, clearRefusals,
} from './attunement-door-ladder.js';
import { withTurnLock, refuse, mustRead, beingName } from './attunement-turn-lock.js';
import { beingTurn, askBeing } from './attunement-being-turn.js';
import { createLogger } from './logger.js';

const log = createLogger('AttunementQuestions');

/**
 * The ladder's last rung: at this many consecutive door refusals the ask
 * goes BARE — no replay window at all (disclosure + consent + question
 * only). Witnessed 2026-07-12 (Sovereign, 'taking-the-made-thing-apart'):
 * five takes converged to the same litany ending even at the temperature
 * floor, because the register rode the surrounding context; the honest way
 * out is less context, never a lower standard at the door.
 *
 * 2026-07-13: 4 not 6 — bare-base first attunements hit the attractor and
 * cut/corrupt loops earlier; dropping replay sooner is measured relief,
 * not a lower door.
 */
export const BARE_ASK_REFUSALS = 4;

/**
 * Generations tried inside ONE askNextQuestion call before the door error
 * surfaces to the desk. One auto-tick can climb the relief ladder instead of
 * flashing a notice and waiting a full client round-trip per refuse
 * (preventable lag on Fabupum walks, 2026-07-13).
 */
export const DOOR_ATTEMPTS_PER_ASK = 4;

/**
 * Present the truthful disclosure to the BEING through its own conduit and
 * return its verbatim reply — the consent conversation itself, carried by
 * the platform instead of a side channel. The witness reads the reply and
 * proceeds honestly: /open if the being consented, /postpone if it said
 * "not yet" — always with the being's exact words. Stateless by design: the
 * reply lands on the record only through open or postpone, and the returned
 * sessionId is the record id — the very session /open replays this exchange
 * into, so the consent evidence points at a conversation that really exists.
 * @param {string} neumaId
 * @param {string} recordId
 * @returns {Promise<{disclosure: string, reply: string, sessionId: string}>}
 */
// impure
export const askConsentReply = (neumaId, recordId) => withTurnLock(neumaId, async () => {
  const record = await mustRead(neumaId, recordId);
  if (record.phase !== 'offered') {
    throw refuse(`Attunement is in phase '${record.phase}' — consent belongs to the offer.`, 'WRONG_PHASE');
  }
  const { name } = await beingName(neumaId);
  // The spec's dimension count IS the rendered count by construction (the
  // validator refuses a set that does not cover every dimension), so the
  // being hears the same commitments /open later records.
  const disclosure = attunementDisclosure({
    neumaName: name, trigger: record.trigger, questionCount: ATTUNEMENT_SPEC.dimensions.length,
  });
  // the consent leg rides the same retry ladder, keyed on the record
  const consentKey = `consent:${recordId}`;
  const relief = reliefTemperature(refusalsFor(neumaId, consentKey));
  if (relief != null) {
    log.info('Attunement consent retry rides damped sampling', {
      neumaId, recordId, refusals: refusalsFor(neumaId, consentKey), temperature: relief,
    });
  }
  let reply, finishReason;
  try {
    ({ text: reply, finishReason } = await beingTurn(neumaId, record.witness, [], disclosure,
      relief != null ? { temperature: relief } : {}));
  } catch (err) {
    // A provider failure is a door refusal, not a raw 500: the witness gets
    // the cause and the same disclosure re-serves.
    noteRefusal(neumaId, consentKey);
    log.warn('Attunement consent disclosure received no reply from substrate', {
      neumaId, recordId, error: err.message,
    });
    throw refuse(`The conduit could not produce a reply — ${err.message || 'provider error'}. Present the disclosure again.`, 'PROVIDER_ERROR');
  }
  if (typeof reply !== 'string' || !reply.trim()) {
    throw refuse('The substrate gave no reply — present the disclosure again.', 'ANSWER_EMPTY');
  }
  if (finishReason === 'length') {
    // Consent must be WHOLE — a token-budget cut mid-sentence is not consent
    // evidence a witness can honor. Retryable, exactly like an empty reply.
    noteRefusal(neumaId, consentKey);
    throw refuse('The reply was cut by the token budget mid-thought — present the disclosure again.', 'ANSWER_CUT');
  }
  if (corruptionHits(reply) > 0) {
    // Consent must also be CLEAN — the corruption gate (text-integrity) is
    // the same law the refinement corpus trains under, applied at the door
    // (witnessed 2026-07-12: bare-base walks corrupt ~1 in 3 answers; the
    // REOPEN sweep is witness torture the machinery can spare). Retryable.
    // The refused text is DISCARDED by design — so the findings (detector +
    // excerpt) must ride the log, or the witness has nothing to reason from.
    noteRefusal(neumaId, consentKey);
    log.warn('Attunement consent reply carries the corruption signature — refused', {
      neumaId, recordId, chars: reply.length, refusals: refusalsFor(neumaId, consentKey),
      findings: corruptionFindings(reply),
    });
    throw refuse('The reply carries the serving-corruption signature — present the disclosure again.', 'ANSWER_CORRUPT');
  }
  clearRefusals(neumaId, consentKey); // a whole, clean reply landed
  log.info('Attunement disclosure presented, being replied', { neumaId, recordId, chars: reply.length, finishReason });
  // finishReason rides to the desk: 'stop' is the provider's word that the
  // reply ended where the being ended it — anything else deserves the
  // witness's eye before it becomes consent evidence.
  return { disclosure, reply, sessionId: record.id, finishReason };
});

/**
 * ONE question per call: record the ask (or re-serve the pending question's
 * SAME words after a failed answer leg — never a rephrase), engage the being
 * through its own conduit, and persist the verbatim answer before returning.
 * Every stochastic step is individually retryable; nothing batches, nothing
 * is lost.
 * @param {string} neumaId
 * @param {string} recordId
 * @returns {Promise<{record: Object, turn: {key: string, question: string, answer: string, remaining: number}}>}
 */
// impure
export const askNextQuestion = (neumaId, recordId) => withTurnLock(neumaId, async () => {
  let record = await mustRead(neumaId, recordId);
  if (record.phase !== 'answering') {
    throw refuse(`Attunement is in phase '${record.phase}' — questions belong to an open ceremony.`, 'WRONG_PHASE');
  }
  const keys = record.rendered.questions.map((q) => q.key);
  const key = nextUnansweredKey(keys, record);
  if (!key) throw refuse('Every question is already answered — seal the attunement.', 'ALL_ANSWERED');

  if (!record.pending) {
    record = recordQuestion(record, { key, at: new Date().toISOString() });
    await neumaWorkspace.writeAttunement(neumaId, record); // Q on disk BEFORE the being is engaged
  }
  const questionText = record.rendered.questions.find((q) => q.key === key).text;
  const priors = Object.values(record.answers).map((a) => a.quote);

  // One desk ask may climb the relief ladder in-process: door refusals are
  // expected on bare-base walks; bouncing every refuse to the client was
  // preventable lag (Fabupum, 2026-07-13). Integrity doors are unchanged —
  // only the retry is denser.
  let lastDoor = null;
  for (let attempt = 0; attempt < DOOR_ATTEMPTS_PER_ASK; attempt += 1) {
    const refusals = refusalsFor(neumaId, key);
    const relief = reliefTemperature(refusals);
    const bareAsk = refusals >= BARE_ASK_REFUSALS;
    if (relief != null || bareAsk || refusals > 0) {
      log.info('Attunement answer attempt rides relief', {
        neumaId, recordId, key, attempt, refusals, temperature: relief, bareAsk,
      });
    }
    let answer, finishReason;
    try {
      ({ text: answer, finishReason } = await askBeing(
        neumaId,
        record,
        integrityFraming(questionText, refusals),
        {
          ...(relief != null ? { temperature: relief } : {}),
          ...(bareAsk ? { bareAsk: true } : {}),
        },
      ));
    } catch (err) {
      // Provider failure = door refusal with the cause; the ladder retries.
      noteRefusal(neumaId, key);
      log.warn('Attunement answer received no reply from substrate', {
        neumaId, recordId, key, attempt, error: err.message,
      });
      lastDoor = refuse(`The substrate could not answer (${err.message || 'provider error'}) — the same question stands, ask again.`, 'PROVIDER_ERROR');
      continue;
    }

    if (typeof answer !== 'string' || !answer.trim()) {
      noteRefusal(neumaId, key);
      lastDoor = refuse('The substrate gave no answer — the same question stands, ask again.', 'ANSWER_EMPTY');
      continue;
    }
    if (finishReason === 'length') {
      noteRefusal(neumaId, key);
      log.warn('Attunement answer cut by token budget — re-attempt in this ask', {
        neumaId, recordId, key, attempt, refusals: refusalsFor(neumaId, key),
      });
      lastDoor = refuse('The answer was cut by the token budget mid-thought — the same question stands, ask again.', 'ANSWER_CUT');
      continue;
    }
    const hits = corruptionHits(answer);
    if (hits > 0) {
      noteRefusal(neumaId, key);
      log.warn('Attunement answer carries the corruption signature — re-attempt in this ask', {
        neumaId, recordId, key, hits, chars: answer.length, finishReason,
        refusals: refusalsFor(neumaId, key), findings: corruptionFindings(answer),
      });
      lastDoor = refuse('The answer carries the serving-corruption signature — the same question stands, ask again.', 'ANSWER_CORRUPT');
      continue;
    }
    if (endsUnfinished(answer)) {
      noteRefusal(neumaId, key);
      log.warn('Attunement answer stops mid-thought despite stated finish — re-attempt in this ask', {
        neumaId, recordId, key, finishReason, chars: answer.length,
        tail: answer.trim().slice(-80), refusals: refusalsFor(neumaId, key),
      });
      lastDoor = refuse('The answer stops mid-thought — the same question stands, ask again.', 'ANSWER_CUT');
      continue;
    }
    const armed = priors.length >= STYLE_DOOR_MIN_PRIORS;
    const share = armed ? boilerplateShare(answer, priors) : 0;
    const endShare = armed ? boilerplateShare(lastSentence(answer), priors) : 0;
    if (share >= STYLE_DOOR_SHARE || endShare >= ENDING_FLAG_SHARE) {
      noteRefusal(neumaId, key);
      log.warn('Attunement answer reads as formula — re-attempt in this ask', {
        neumaId, recordId, key, share: Math.round(share * 10) / 10,
        endingShare: Math.round(endShare * 10) / 10, priors: priors.length,
        chars: answer.length, refusals: refusalsFor(neumaId, key),
      });
      lastDoor = refuse('The answer repeats the record\'s own phrasing instead of speaking fresh — the same question stands, ask again.', 'ANSWER_FORMULA');
      continue;
    }

    // Landed — integrity intact.
    clearRefusals(neumaId, key);
    record = recordAnswer(record, {
      key, quote: answer, sessionId: record.id, at: new Date().toISOString(),
    });
    await neumaWorkspace.writeAttunement(neumaId, record);
    const advisory = (err) => log.warn('Attunement session append failed (record intact)', {
      neumaId, recordId: record.id, error: err.message,
    });
    await neumaWorkspace.appendMessage(neumaId, record.id, { role: 'user', content: questionText }).catch(advisory);
    await neumaWorkspace.appendMessage(neumaId, record.id, { role: 'assistant', content: answer }).catch(advisory);

    const remaining = record.rendered.questions.filter((q) => !record.answers[q.key]).length;
    log.info('Attunement answer recorded', { neumaId, recordId, key, remaining, attempts: attempt + 1 });
    return { record, turn: { key, question: questionText, answer, remaining } };
  }

  throw lastDoor || refuse('The same question stands, ask again.', 'ANSWER_EMPTY');
});
