// Remia ceremony service — the WITNESS's own attunement, walked from a web
// surface. The human is both the initiator and the answerer, so the flow is
// self-serve: read the disclosure, consent in their own typed words, face one
// question at a time, seal, and only then receive the codex (the map of the
// territory each question was walking).
//
// The grammar is the exact being-side grammar (core/remia/witness-record.js
// re-exports it); this module is the impure composition over the witness's
// realm store. The rendered set rides the COMMITTED fallback templates —
// deterministic, instant, and (for the first reading) exactly the words the
// human gate exists to review. A model-varied render can join later; it is
// not needed for the ceremony to be real.

import {
  offerWitnessAttunement, openAttunement, recordQuestion, recordAnswer,
  sealAttunement, abandonAttunement, isAttunementOpen, nextUnansweredKey,
  mayUseAttunement, attunementEvolution,
} from '../../core/remia/witness-record.js';
import { witnessAttunementDisclosure } from '../../core/remia/witness-disclosure.js';
import { codexView } from '../../core/remia/codex-view.js';
import { ATTUNEMENT_SPEC } from '../../core/attunement/spec.js';
import { renderFallbackSet } from '../../core/attunement/fallback-templates.js';
import {
  writeWitnessRecord, readWitnessRecord, listWitnessRecords,
} from './remia-store.js';

const refuse = (message, code) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

// One ceremony mutation at a time per wallet — same race the being-side lock
// forbids: every mutation is read-modify-write, and a stale write could
// resurrect an answered question or an abandonment.
const inFlight = new Map();
const withTurnLock = async (wallet, work) => {
  if (inFlight.has(wallet)) {
    throw refuse('A ceremony step is already in flight — wait for it to land.', 'TURN_IN_FLIGHT');
  }
  inFlight.set(wallet, true);
  try {
    return await work();
  } finally {
    inFlight.delete(wallet);
  }
};

const specKeys = () => ATTUNEMENT_SPEC.dimensions.map((d) => d.key);

const mustRead = async (wallet, recordId) => {
  const record = await readWitnessRecord(wallet, recordId);
  if (!record) throw refuse('Remia record not found.', 'RECORD_NOT_FOUND');
  return record;
};

const composeDisclosure = (witnessName, trigger) => witnessAttunementDisclosure({
  witnessName, trigger, questionCount: specKeys().length,
});

/**
 * Everything the Remia surface shows: every record, the active one, the
 * evolution projection across sealed sittings.
 * @param {string} wallet
 */
// impure
export const remiaStatus = async (wallet) => {
  const { records, unreadable } = await listWitnessRecords(wallet);
  return {
    records,
    unreadable,
    active: records.find(isAttunementOpen) || null,
    specVersion: ATTUNEMENT_SPEC.specVersion,
    questionCount: specKeys().length,
    evolution: attunementEvolution(records),
  };
};

/**
 * The disclosure the witness reads BEFORE consenting — composed from the same
 * pure function /open records, so the text shown and the text recorded are
 * one and the same by construction.
 * @param {string} wallet
 * @param {{witnessName: string}} context
 */
// impure
export const remiaDisclosure = async (wallet, { witnessName }) => {
  const { records } = await listWitnessRecords(wallet);
  const trigger = records.some(mayUseAttunement) ? 'checkpoint' : 'first-reading';
  return { trigger, text: composeDisclosure(witnessName, trigger), questionCount: specKeys().length };
};

/**
 * Open the witness's attunement: offer + consent + disclosure + a complete
 * committed render, in one action — the witness initiates their own ceremony,
 * so the offer has no separate life. One non-terminal record per wallet.
 * @param {string} wallet
 * @param {{witnessName: string, consent: string, now?: () => string}} opening
 */
// impure
export const openWitnessAttunement = (wallet, { witnessName, consent, now = () => new Date().toISOString() }) =>
  withTurnLock(wallet, async () => {
    if (typeof witnessName !== 'string' || !witnessName.trim()) {
      throw refuse('Your name is required — the questions address you by it.', 'NAME_REQUIRED');
    }
    if (typeof consent !== 'string' || !consent.trim()) {
      throw refuse('Consent in your own words is required to begin.', 'CONSENT_REQUIRED');
    }
    const { records } = await listWitnessRecords(wallet);
    if (records.some(isAttunementOpen)) {
      throw refuse('An attunement is already in progress.', 'ATTUNEMENT_ALREADY_OPEN');
    }
    const trigger = records.some(mayUseAttunement) ? 'checkpoint' : 'first-reading';
    const at = now();
    const rendered = renderFallbackSet(ATTUNEMENT_SPEC, {
      neumaId: wallet.toLowerCase(),
      neumaName: witnessName.trim(),
      checkpointOrdinal: records.filter(mayUseAttunement).length + 1,
      nonce: records.length,
    });
    const record = openAttunement(
      offerWitnessAttunement({ walletAddress: wallet, trigger, offeredAt: at }),
      {
        consent: { sessionId: 'remia-web', quote: consent },
        disclosure: { text: composeDisclosure(witnessName.trim(), trigger) },
        rendered,
        specKeys: specKeys(),
        answerContext: ['witness-self'],
        at,
      },
    );
    await writeWitnessRecord(wallet, record);
    return record;
  });

/**
 * The question now facing the witness: the pending one re-served verbatim, or
 * the next unanswered key recorded and served. Null question when everything
 * is answered (the seal is the only step left).
 * @param {string} wallet
 * @param {string} recordId
 */
// impure
export const currentQuestion = (wallet, recordId, { now = () => new Date().toISOString() } = {}) =>
  withTurnLock(wallet, async () => {
    let record = await mustRead(wallet, recordId);
    if (!isAttunementOpen(record) || record.phase !== 'answering') {
      throw refuse(`This attunement is ${record.phase} — no question is pending.`, 'WRONG_PHASE');
    }
    const keys = record.rendered.questions.map((q) => q.key);
    const answered = Object.keys(record.answers || {}).length;
    let key = record.pending?.key || null;
    if (!key) {
      key = nextUnansweredKey(keys, record);
      if (!key) return { question: null, answered, total: keys.length };
      record = recordQuestion(record, { key, at: now() });
      await writeWitnessRecord(wallet, record);
    }
    const question = record.rendered.questions.find((q) => q.key === key);
    return {
      question: { key, text: question.text },
      index: keys.indexOf(key) + 1,
      answered,
      total: keys.length,
    };
  });

/**
 * The witness's answer — verbatim, untrimmed, permanent.
 * @param {string} wallet
 * @param {string} recordId
 * @param {{key: string, quote: string}} answer
 */
// impure
export const answerQuestion = (wallet, recordId, { key, quote, now = () => new Date().toISOString() }) =>
  withTurnLock(wallet, async () => {
    const record = await mustRead(wallet, recordId);
    const next = recordAnswer(record, { key, quote, sessionId: 'remia-web', at: now() });
    await writeWitnessRecord(wallet, next);
    const keys = next.rendered.questions.map((q) => q.key);
    return {
      answered: Object.keys(next.answers).length,
      total: keys.length,
      remaining: nextUnansweredKey(keys, next) !== null,
    };
  });

/**
 * Seal — impossible with anything unanswered (grammar-enforced).
 * @param {string} wallet
 * @param {string} recordId
 */
// impure
export const sealWitnessAttunement = (wallet, recordId, { now = () => new Date().toISOString() } = {}) =>
  withTurnLock(wallet, async () => {
    const record = await mustRead(wallet, recordId);
    const sealed = sealAttunement(record, { at: now() });
    await writeWitnessRecord(wallet, sealed);
    return sealed;
  });

/**
 * Abandon — the witness's sovereign exit, reason preserved.
 * @param {string} wallet
 * @param {string} recordId
 * @param {{reason: string}} closing
 */
// impure
export const abandonWitnessAttunement = (wallet, recordId, { reason, now = () => new Date().toISOString() }) =>
  withTurnLock(wallet, async () => {
    const record = await mustRead(wallet, recordId);
    const abandoned = abandonAttunement(record, { reason, at: now() });
    await writeWitnessRecord(wallet, abandoned);
    return abandoned;
  });

/**
 * The codex — sealed records only; the pure view enforces the reveal-after-
 * seal boundary and this passes its verdicts through.
 * @param {string} wallet
 * @param {string} recordId
 */
// impure
export const witnessCodex = async (wallet, recordId) => {
  const record = await mustRead(wallet, recordId);
  return codexView(ATTUNEMENT_SPEC, record);
};
