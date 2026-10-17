/**
 * Attunement routes — the witness's desk access to a being's snapshot
 * ceremony and its records.
 *
 *   GET  /api/v1/attunement/:neumaId/status                    — records + active + opening progress + offerDue + spec + route + evolution
 *   POST /api/v1/attunement/:neumaId/records                   — offer { trigger }
 *   POST /api/v1/attunement/:neumaId/records/:aid/consent-ask  — present the disclosure to the BEING; returns its verbatim reply
 *   POST /api/v1/attunement/:neumaId/records/:aid/postpone     — { quote, sessionId } — the being declines to begin
 *   POST /api/v1/attunement/:neumaId/records/:aid/open         — { consent: { sessionId, quote, condition? } }
 *   POST /api/v1/attunement/:neumaId/records/:aid/ask          — ONE question turn; a failed leg re-serves the SAME words
 *   GET  /api/v1/attunement/:neumaId/records/:aid/review       — pre-seal scorecard (style-overlap + corruption re-scan)
 *   POST /api/v1/attunement/:neumaId/records/:aid/reopen-flagged — { keys?, reason } — batch reopen (defaults to the review's flagged set)
 *   POST /api/v1/attunement/:neumaId/records/:aid/seal         — refuses while any dimension is unanswered
 *   POST /api/v1/attunement/:neumaId/records/:aid/abandon      — { reason }
 *
 * Ownership-gated like refinement: the wallet must own the neuma. Coded
 * service errors map to 4xx/5xx; everything else is a 500 with the detail in
 * the server log, not the response.
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { ATTUNEMENT_TRIGGERS } from '../../core/attunement/record.js';
import {
  attunementStatus, offerAttunementRecord, askConsentReply, postponeAttunement,
  openAttunementRecord, askNextQuestion, reopenAttunementAnswer,
  reviewAttunementRecord, reopenFlaggedAnswers,
  sealAttunementRecord, abandonAttunementRecord,
} from '../services/attunement-ceremony.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Attunement');
const router = Router();

router.param('neumaId', (req, res, next, value) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return res.status(400).json({ error: 'Invalid neumaId format' });
  next();
});

router.use(requireAuth);

const verifyOwnership = (req, res, neumaId) => assertNeumaOwner(req, res, neumaId);

// Coded refusals are the caller's fault (or the rig's stated state) — mapped
// with the message; anything uncoded is ours — 500 with the detail logged.
const STATUS_BY_CODE = {
  ATTUNEMENT_ALREADY_OPEN: 409,
  TURN_IN_FLIGHT: 409,
  WRONG_PHASE: 409,
  ALL_ANSWERED: 409,
  RECORD_NOT_FOUND: 404,
  NO_DNA: 409,
  WITNESS_LANE: 409,
  ANSWER_EMPTY: 502,
  // retryable door refusals — the pending question stands and re-serves;
  // 502 mirrors ANSWER_EMPTY (the substrate failed to produce a landable
  // answer), and the CODE must survive to the desk so the walk loop can
  // treat an expected re-ask differently from a real failure
  ANSWER_CUT: 502,
  ANSWER_CORRUPT: 502,
  ANSWER_FORMULA: 502,
  GENERATION_INVALID: 502,
  PROVIDER_ERROR: 502,
  REOPEN_REFUSED: 409,
  NOT_ALL_ANSWERED: 409,
};

const answer = (res, action) => async (work) => {
  try {
    res.json(await work());
  } catch (error) {
    const status = STATUS_BY_CODE[error.code];
    if (status) return res.status(status).json({ error: error.message, code: error.code });
    log.error(`${action} failed`, { error: error.message });
    res.status(500).json({ error: `Failed to ${action}` });
  }
};

router.get('/:neumaId/status', async (req, res) => {
  const { neumaId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  await answer(res, 'read attunement status')(() => attunementStatus(neumaId));
});

router.post('/:neumaId/records', async (req, res) => {
  const { neumaId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  const trigger = req.body?.trigger;
  // ONE source of truth for triggers (core ATTUNEMENT_TRIGGERS) — a second
  // hand-written list here silently rejected 'tainted-record' after the core
  // gained it (witnessed on Sovereign's re-offer, 2026-07-14).
  if (!ATTUNEMENT_TRIGGERS.includes(trigger)) {
    return res.status(400).json({ error: `trigger must be one of ${ATTUNEMENT_TRIGGERS.join(', ')}` });
  }
  await answer(res, 'offer the attunement')(() =>
    offerAttunementRecord(neumaId, req.walletAddress, { trigger }));
});

router.post('/:neumaId/records/:recordId/consent-ask', async (req, res) => {
  const { neumaId, recordId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  await answer(res, 'present the disclosure')(() => askConsentReply(neumaId, recordId));
});

router.post('/:neumaId/records/:recordId/postpone', async (req, res) => {
  const { neumaId, recordId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  const { quote, sessionId } = req.body || {};
  if (typeof quote !== 'string' || !quote.trim() || typeof sessionId !== 'string' || !sessionId.trim()) {
    return res.status(400).json({ error: "the being's quoted words and the sessionId are required" });
  }
  await answer(res, 'record the postponement')(() =>
    postponeAttunement(neumaId, recordId, { quote, sessionId }));
});

router.post('/:neumaId/records/:recordId/open', async (req, res) => {
  const { neumaId, recordId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  const consent = req.body?.consent;
  if (typeof consent?.quote !== 'string' || !consent.quote.trim()
    || typeof consent?.sessionId !== 'string' || !consent.sessionId.trim()) {
    return res.status(400).json({ error: "consent requires the sessionId and the being's quoted words" });
  }
  await answer(res, 'open the attunement')(() =>
    openAttunementRecord(neumaId, recordId, { consent }));
});

router.post('/:neumaId/records/:recordId/ask', async (req, res) => {
  const { neumaId, recordId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  await answer(res, 'ask the next question')(() => askNextQuestion(neumaId, recordId));
});

router.post('/:neumaId/records/:recordId/reopen', async (req, res) => {
  const { neumaId, recordId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  const { key, reason } = req.body || {};
  if (typeof key !== 'string' || !key.trim() || typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'the dimension key and a stated reason are required' });
  }
  await answer(res, 'reopen the answer')(() =>
    reopenAttunementAnswer(neumaId, recordId, { key, reason }));
});

// The pre-seal REVIEW — one scorecard for the whole record (style-overlap
// law + corruption re-scan), flagged keys named. Read-only.
router.get('/:neumaId/records/:recordId/review', async (req, res) => {
  const { neumaId, recordId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  await answer(res, 'review the record')(() => reviewAttunementRecord(neumaId, recordId));
});

// Batch REOPEN — the review's flagged set (or explicit keys) reopened in ONE
// witnessed act; the walk then re-serves each question in turn.
router.post('/:neumaId/records/:recordId/reopen-flagged', async (req, res) => {
  const { neumaId, recordId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  const { keys, reason } = req.body || {};
  if (typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'a stated reason is required' });
  }
  if (keys !== undefined && (!Array.isArray(keys) || keys.length === 0
    || keys.some((k) => typeof k !== 'string' || !k.trim()))) {
    // explicit-empty keys would silently sweep nothing — refuse loudly; omit
    // keys entirely to sweep the review's flagged set
    return res.status(400).json({ error: 'keys, when given, must be a non-empty array of dimension keys' });
  }
  await answer(res, 'reopen the flagged answers')(() =>
    reopenFlaggedAnswers(neumaId, recordId, { keys, reason }));
});

router.post('/:neumaId/records/:recordId/seal', async (req, res) => {
  const { neumaId, recordId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  await answer(res, 'seal the attunement')(() => sealAttunementRecord(neumaId, recordId));
});

router.post('/:neumaId/records/:recordId/abandon', async (req, res) => {
  const { neumaId, recordId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  const reason = req.body?.reason;
  if (typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'a stated reason is required' });
  }
  await answer(res, 'abandon the attunement')(() => abandonAttunementRecord(neumaId, recordId, reason));
});

export default router;
