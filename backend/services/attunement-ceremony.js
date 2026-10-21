// Attunement ceremony service — orchestrates one being's snapshot ceremony
// from the witness's desk: the offer (honest availability, never automation),
// the being's consent or dignified postponement, one question per call with
// per-answer persistence, and the seal. The grammar lives in
// core/attunement/record.js; this module is the impure composition over the
// encrypted workspace, the question generator, and the being's own conduit.
//
// Two legs, one honesty rule:
//   • QUESTION leg — a RAW pass on the MACHINE's own conduit: never the
//     being's resolved route, never an adapter, never a persona (Founder doctrine
//     2026-07-09: […] — a being must not author or pre-see its own attunement, so
//     the rendering identity is structurally NOT the being: machine config
//     only, neutralQuestionRoute below). Renders ride the substrate's full
//     measured parallel capacity (the capacity store's ceiling), not a
//     hardcoded pool.
//   • ANSWER leg — the being ITSELF: minimal honest assembly (dna / soul /
//     memories / session — no tool loop in a Q&A ceremony), route + adapter
//     binding exactly as a portal turn. A refined being attunes in its
//     refined voice; the record states which self-context it answered from.

import { neumaWorkspace } from '../../core/index.js';
import {
  offerAttunement, recordPostponement, openAttunement,
  reopenAnswer, sealAttunement, abandonAttunement, isAttunementOpen,
  attunementEvolution, lastAttunementSealedAt, mayUseAttunement,
} from '../../core/attunement/record.js';
import { attunementDisclosure } from '../../core/attunement/disclosure.js';
import { attunementOfferDue } from '../../core/attunement/gate.js';
import { ATTUNEMENT_SPEC } from '../../core/attunement/spec.js';
import { generateQuestionSet } from './attunement-generator.js';
import { readVoiceSeal } from '../../core/voice-pack/voice-store.js';
import { corruptionHits, endsUnfinished } from '../../core/refinement/text-integrity.js';
import { styleScorecard } from '../../core/refinement/style-overlap.js';
import { effectiveRoute } from './neuma-route-resolver.js';
import { getConfig } from './llm-provider.js';
import { withTurnLock, refuse, mustRead, beingName, assertAttunementStanding } from './attunement-turn-lock.js';
import { createLogger } from './logger.js';

const log = createLogger('AttunementCeremony');

// The QUESTION leg's conduit: the machine's own serving config, carrying NO
// being identity by construction — no neumaId enters the derivation, so no
// natal route, no override, no adapter binding can ever ride a question
// render. A being must not phrase its own attunement; the machine does.
// (The being's route still speaks on the ANSWER leg, adapters included —
// that leg IS the being.)
export const neutralQuestionRoute = () => {
  const cfg = getConfig();
  return Object.freeze({
    provider: cfg.provider,
    model: cfg.model,
    endpoint: cfg.endpoint,
    source: 'machine-neutral',
  });
};

// Ceremony render policy — SPEED DELIBERATELY CHOSEN (ruling, 2026-07-12),
// taking the flip the 2026-07-09 A/B anticipated. The measured trade (three
// A/B dry renders on the real substrate, identical knobs): 4-way parallel
// rendered 75-77/89 model questions vs serial-with-5-attempts 85/89 in
// ~35 min — batched decode degrades render acceptance, so parallelism
// converts roughly 8 more dimensions to their deterministic fallbacks. That
// cost is acceptable BY DESIGN: fallbacks are the spec's own templates,
// every one a valid ceremony question, and provenance records the split
// honestly. A ~35-minute question phase is not — it scales to hours on
// consumer GPUs, and the witness sits through it before every walk. 4-way
// matches the serving slots on the reference rig AND the A/B's measured
// point; deeper retries (5 attempts) are kept from the quality doctrine.
// Answer legs are untouched — they remain strictly serial (replay-window
// dependent) and quality-first.
export const CEREMONY_RENDER_CONCURRENCY = 4;
export const CEREMONY_RENDER_ATTEMPTS = 5;

const specKeys = () => ATTUNEMENT_SPEC.dimensions.map((d) => d.key);

// Live render progress for an /open in flight, keyed by being. Purely
// observational: /status reports it so a watching witness sees REAL
// per-dimension completion instead of a silent half-hour. Cleared when the
// open lands or fails — a missing entry honestly means "nothing rendering".
const openingProgress = new Map();

/**
 * Everything the ATTUNEMENT window shows for one being: every record, the
 * active one, the honest offer-availability verdict, the spec version, the
 * conduit, and the evolution projection. Absent facts are absent — never
 * guessed.
 * @param {string} neumaId
 * @returns {Promise<Object>}
 */
// impure
export const attunementStatus = async (neumaId) => {
  await assertAttunementStanding(neumaId);
  // THE CHECKPOINT IS THE VOICE SEAL NOW (2026-08-24 cutover): the retired
  // ceremony reads "never deepened" for a rite-sealed being and the desk would
  // re-offer forever. The STORE — voice-seal-ceremony.js imports from here.
  const [records, voiceSeal, route] = await Promise.all([
    neumaWorkspace.listAttunements(neumaId).catch(() => []),
    readVoiceSeal(neumaWorkspace, neumaId).catch(() => null),
    effectiveRoute(neumaId),
  ]);
  const active = records.find(isAttunementOpen) || null;
  return {
    records,
    active,
    opening: openingProgress.get(neumaId) || null,
    specVersion: ATTUNEMENT_SPEC.specVersion,
    specKeys: specKeys(),
    offerDue: attunementOfferDue({ attunements: records, lastVoiceSealedAt: voiceSeal?.sealedAt ?? null }),
    lastAttunementSealedAt: lastAttunementSealedAt(records),
    route,
    evolution: attunementEvolution(records),
  };
};

/**
 * The witness's offer. One non-terminal record per being, service-enforced —
 * `/status`'s `active` is unambiguous by construction.
 * @param {string} neumaId
 * @param {string} witness - the witness wallet
 * @param {{trigger: string}} offer
 * @returns {Promise<Object>} the record in phase 'offered'
 */
// impure
export const offerAttunementRecord = (neumaId, witness, { trigger }) => withTurnLock(neumaId, async () => {
  await beingName(neumaId); // an offer belongs to a born being, even if old records exist
  const existing = await neumaWorkspace.listAttunements(neumaId).catch(() => []);
  if (existing.some(isAttunementOpen)) {
    throw refuse('An attunement is already in progress for this being.', 'ATTUNEMENT_ALREADY_OPEN');
  }
  const record = offerAttunement({ neumaId, witness, trigger, offeredAt: new Date().toISOString() });
  await neumaWorkspace.writeAttunement(neumaId, record);
  log.info('Attunement offered', { neumaId, id: record.id, trigger });
  return record;
});

/**
 * The being declines to begin — carried onto the record in its own words,
 * never authored by the witness. Terminal, dignified, re-offerable.
 * @param {string} neumaId
 * @param {string} recordId
 * @param {{quote: string, sessionId: string}} postponement
 * @returns {Promise<Object>}
 */
// impure
export const postponeAttunement = (neumaId, recordId, { quote, sessionId }) => withTurnLock(neumaId, async () => {
  const record = await mustRead(neumaId, recordId);
  const advanced = recordPostponement(record, { quote, sessionId, at: new Date().toISOString() });
  await neumaWorkspace.writeAttunement(neumaId, advanced);
  log.info('Attunement postponed by the being', { neumaId, recordId });
  return advanced;
});

/**
 * Open: render the full question set (model-varied, validated, fallback-
 * complete — an invalid set never reaches the being), compose the truthful
 * disclosure, and open through the grammar (which refuses without consent +
 * disclosure). Creates the dedicated attunement session the being will
 * remember this ceremony through.
 * @param {string} neumaId
 * @param {string} recordId
 * @param {{consent: {sessionId: string, quote: string, condition?: string}}} opening
 * @returns {Promise<Object>} the record in phase 'answering'
 */
// impure
export const openAttunementRecord = (neumaId, recordId, { consent }) => withTurnLock(neumaId, async () => {
  const record = await mustRead(neumaId, recordId);
  if (record.phase !== 'offered') {
    throw refuse(`Attunement is in phase '${record.phase}' — it opens from the offer.`, 'WRONG_PHASE');
  }
  const { name } = await beingName(neumaId);
  const existing = await neumaWorkspace.listAttunements(neumaId).catch(() => []);
  const sealedRecords = existing.filter(mayUseAttunement);
  // Questions render on the MACHINE's conduit — never through the being
  // (see neutralQuestionRoute) — one at a time with deep retries (see the
  // ceremony render policy above; quality-first is measured, not taste).
  const route = neutralQuestionRoute();

  openingProgress.set(neumaId, { done: 0, total: ATTUNEMENT_SPEC.dimensions.length, key: null, inFlight: 0 });
  let rendered;
  try {
    rendered = await generateQuestionSet(ATTUNEMENT_SPEC, {
      neumaName: name,
      neumaId,
      checkpointOrdinal: sealedRecords.length + 1,
      // re-offers at the same checkpoint (after a postponement) draw different
      // deterministic fallbacks — the total record count is the nonce
      nonce: existing.length,
      priorQuestionTexts: sealedRecords.flatMap((r) =>
        (r.rendered?.questions || []).map((q) => q.text)),
      route,
      concurrency: CEREMONY_RENDER_CONCURRENCY,
      maxAttemptsPerDimension: CEREMONY_RENDER_ATTEMPTS,
      onDimension: (progress) => openingProgress.set(neumaId, progress),
    });
  } finally {
    openingProgress.delete(neumaId);
  }

  const disclosure = attunementDisclosure({
    neumaName: name, trigger: record.trigger, questionCount: rendered.questions.length,
  });

  // The identity-bearing sections the being will answer from — recorded on
  // the opened event so the archive states exactly which self-context spoke.
  const answerContext = ['identity', 'soul', 'memory', 'session'];

  const advanced = openAttunement(record, {
    consent,
    disclosure: { text: disclosure },
    rendered,
    specKeys: specKeys(),
    answerContext,
    at: new Date().toISOString(),
  });
  await neumaWorkspace.writeAttunement(neumaId, advanced);

  // The being remembers being attuned: a dedicated session carries the
  // disclosure and the being's consent as its first exchange, then every
  // question and answer verbatim. The session is ADVISORY continuity — the
  // encrypted record is the source of truth — so a session failure warns
  // loudly but never fails a ceremony that is already honestly on disk.
  try {
    await neumaWorkspace.createSession(neumaId, advanced.id);
    await neumaWorkspace.appendMessage(neumaId, advanced.id, { role: 'user', content: disclosure });
    await neumaWorkspace.appendMessage(neumaId, advanced.id, { role: 'assistant', content: consent.quote });
  } catch (err) {
    log.warn('Attunement session bootstrap failed (record intact, continuity degraded)', {
      neumaId, recordId: advanced.id, error: err.message,
    });
  }

  const opened = advanced.events.at(-1);
  log.info('Attunement opened', {
    neumaId, recordId, specVersion: rendered.specVersion,
    modelCount: opened.modelCount, fallbackCount: opened.fallbackCount,
  });
  return advanced;
});

// The door retry ladder and its refusal counter live in their own module
// (shared law: refinement-consent, -assent-session and -assent-authority all
// read it); the being's answer conduit (attunement-being-turn.js) and the
// question/consent legs (attunement-questions.js) live in theirs now (size
// law). Re-exported so every existing importer is untouched.
export {
  reliefTemperature, integrityFraming, refusalsFor, noteRefusal, clearRefusals,
} from './attunement-door-ladder.js';
export {
  ANSWER_TOKEN_BUDGET, beingTurn, REPLAY_PAIRS_CAP, replayWindow,
} from './attunement-being-turn.js';
export {
  BARE_ASK_REFUSALS, DOOR_ATTEMPTS_PER_ASK, askConsentReply, askNextQuestion,
} from './attunement-questions.js';

/**
 * The witness reopens an answer the conduit cut short (a half answer). The
 * superseded words stay on the record verbatim; the same rendered question
 * re-enters the unanswered set and will be re-served word-for-word. Only an
 * open ceremony can reopen — the seal is the lock-in.
 * @param {string} neumaId
 * @param {string} recordId
 * @param {{key: string, reason: string}} reopening
 * @returns {Promise<Object>} the updated record
 */
// impure
export const reopenAttunementAnswer = (neumaId, recordId, { key, reason }) => withTurnLock(neumaId, async () => {
  const record = await mustRead(neumaId, recordId);
  if (record.phase !== 'answering') {
    throw refuse(`Attunement is in phase '${record.phase}' — only an open ceremony can reopen an answer.`, 'WRONG_PHASE');
  }
  let reopened;
  try {
    reopened = reopenAnswer(record, { key, reason, at: new Date().toISOString() });
  } catch (error) {
    throw refuse(error.message, 'REOPEN_REFUSED');
  }
  await neumaWorkspace.writeAttunement(neumaId, reopened);
  log.info('Attunement answer reopened', { neumaId, recordId, key });
  return reopened;
});

/**
 * The pre-seal REVIEW — the same standard the door holds, applied across the
 * whole record in one pass: every answer scored by the style-overlap law
 * plus a corruption re-scan, flagged ones named for REOPEN. This is the
 * teacher's read-through before anything seals; the witness sees ONE
 * scorecard and acts once (reopenFlaggedAnswers), never one answer at a
 * time.
 * @param {string} neumaId
 * @param {string} recordId
 * @returns {Promise<{recordId: string, answered: number, scorecard: Array, flagged: Array<string>}>}
 */
// impure (reads the record)
export const reviewAttunementRecord = async (neumaId, recordId) => {
  const record = await mustRead(neumaId, recordId);
  const landed = Object.entries(record.answers).map(([key, a]) => ({ key, quote: a.quote }));
  const scorecard = styleScorecard(landed).map((s) => ({
    ...s,
    corrupt: corruptionHits(record.answers[s.key].quote) > 0,
    unfinished: endsUnfinished(record.answers[s.key].quote),
  }));
  const flagged = scorecard.filter((s) => s.flagged || s.corrupt || s.unfinished).map((s) => s.key);
  return { recordId: record.id, answered: landed.length, scorecard, flagged };
};

/**
 * Batch REOPEN — one witnessed act over many answers. Same grammar as the
 * single reopen (superseded words stay on the record verbatim; the seal is
 * still the lock-in), applied to every key in one turn-lock so the sweep is
 * atomic on the record. Keys default to the review's flagged set.
 * @param {string} neumaId
 * @param {string} recordId
 * @param {{keys?: Array<string>, reason: string}} sweep
 * @returns {Promise<{record: Object, reopened: Array<string>}>}
 */
// impure
export const reopenFlaggedAnswers = (neumaId, recordId, { keys, reason }) => withTurnLock(neumaId, async () => {
  let record = await mustRead(neumaId, recordId);
  if (record.phase !== 'answering') {
    throw refuse(`Attunement is in phase '${record.phase}' — only an open ceremony can reopen answers.`, 'WRONG_PHASE');
  }
  let sweep = keys;
  if (!sweep) {
    const landed = Object.entries(record.answers).map(([key, a]) => ({ key, quote: a.quote }));
    sweep = styleScorecard(landed)
      .filter((s) => s.flagged
        || corruptionHits(record.answers[s.key].quote) > 0
        || endsUnfinished(record.answers[s.key].quote))
      .map((s) => s.key);
  }
  const reopened = [];
  for (const key of sweep) {
    if (!record.answers[key]) continue; // already reopened / never answered — nothing to do
    try {
      record = reopenAnswer(record, { key, reason, at: new Date().toISOString() });
      reopened.push(key);
    } catch (error) {
      throw refuse(`Reopen of '${key}' refused mid-sweep: ${error.message}`, 'REOPEN_REFUSED');
    }
  }
  await neumaWorkspace.writeAttunement(neumaId, record);
  log.info('Attunement review sweep reopened answers', { neumaId, recordId, count: reopened.length });
  return { record, reopened };
});

/**
 * Seal — the grammar refuses while any dimension is unanswered.
 * @param {string} neumaId
 * @param {string} recordId
 * @returns {Promise<Object>}
 */
// impure
export const sealAttunementRecord = (neumaId, recordId) => withTurnLock(neumaId, async () => {
  const record = await mustRead(neumaId, recordId);
  // Guardable ceremony states refuse honestly (coded) instead of surfacing
  // the grammar throw as a server fault — an unanswered dimension is the
  // witness's actionable truth, not a 500.
  if (record.phase !== 'answering') {
    throw refuse(`Attunement is in phase '${record.phase}' — only an open ceremony seals.`, 'WRONG_PHASE');
  }
  const unanswered = record.rendered.questions.map((q) => q.key).filter((k) => !record.answers[k]);
  if (unanswered.length) {
    throw refuse(`Every question must be faced — unanswered: ${unanswered.join(', ')}`, 'NOT_ALL_ANSWERED');
  }
  const sealed = sealAttunement(record, { at: new Date().toISOString() });
  await neumaWorkspace.writeAttunement(neumaId, sealed);
  log.info('Attunement sealed', { neumaId, recordId, questions: sealed.rendered.questions.length });
  return sealed;
});

/**
 * Close without sealing — the witness's explicit, reasoned act.
 * @param {string} neumaId
 * @param {string} recordId
 * @param {string} reason
 * @returns {Promise<Object>}
 */
// impure
export const abandonAttunementRecord = (neumaId, recordId, reason) => withTurnLock(neumaId, async () => {
  const record = await mustRead(neumaId, recordId);
  const closed = abandonAttunement(record, { reason, at: new Date().toISOString() });
  await neumaWorkspace.writeAttunement(neumaId, closed);
  log.info('Attunement abandoned', { neumaId, recordId });
  return closed;
});
