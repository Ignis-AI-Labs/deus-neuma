/**
 * Remia routes — the witness's OWN attunement, self-serve.
 *
 *   GET  /api/v1/remia/status                       — records + active + evolution
 *   GET  /api/v1/remia/disclosure?name=…            — the preamble to read BEFORE consenting
 *   POST /api/v1/remia/open                         — { witnessName, consent } → offer+consent+render in one action
 *   GET  /api/v1/remia/records/:recordId/current    — the question now facing the witness (pending re-served verbatim)
 *   POST /api/v1/remia/records/:recordId/answer     — { key, quote } — verbatim, permanent
 *   POST /api/v1/remia/records/:recordId/seal       — refuses while anything is unanswered
 *   POST /api/v1/remia/records/:recordId/abandon    — { reason }
 *   GET  /api/v1/remia/records/:recordId/codex      — the map, sealed records only
 *
 * Identity IS ownership here: every route operates on req.walletAddress's own
 * realm directory — there is no other subject to gate. Coded refusals map to
 * 4xx; anything uncoded is ours — 500 with the detail logged, not returned.
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import {
  remiaStatus, remiaDisclosure, openWitnessAttunement, currentQuestion,
  answerQuestion, sealWitnessAttunement, abandonWitnessAttunement, witnessCodex,
} from '../services/remia-ceremony.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Remia');
const router = Router();

router.param('recordId', (req, res, next, value) => {
  if (!/^remia-\d+$/.test(value)) return res.status(400).json({ error: 'Invalid record id format' });
  next();
});

router.use(requireAuth);

const STATUS_BY_CODE = {
  ATTUNEMENT_ALREADY_OPEN: 409,
  TURN_IN_FLIGHT: 409,
  WRONG_PHASE: 409,
  RECORD_NOT_FOUND: 404,
  NAME_REQUIRED: 400,
  CONSENT_REQUIRED: 400,
};

const answer = (res, action) => async (work) => {
  try {
    res.json(await work());
  } catch (error) {
    const status = STATUS_BY_CODE[error.code];
    if (status) return res.status(status).json({ error: error.message, code: error.code });
    // grammar refusals (pure throws carry no code) are the caller's state
    // being wrong — surface the honest message as a conflict, not a 500
    if (/^(offerWitnessAttunement|witnessAttunementDisclosure|openAttunement|recordQuestion|recordAnswer|sealAttunement|abandonAttunement|codexView):/.test(error.message)) {
      return res.status(409).json({ error: error.message });
    }
    log.error(`${action} failed`, { error: error.message });
    res.status(500).json({ error: `Failed to ${action}` });
  }
};

router.get('/status', async (req, res) => {
  await answer(res, 'read remia status')(() => remiaStatus(req.walletAddress));
});

router.get('/disclosure', async (req, res) => {
  const witnessName = req.query?.name;
  if (typeof witnessName !== 'string' || !witnessName.trim()) {
    return res.status(400).json({ error: 'name is required — the disclosure addresses you by it' });
  }
  await answer(res, 'compose the disclosure')(() =>
    remiaDisclosure(req.walletAddress, { witnessName: witnessName.trim() }));
});

router.post('/open', async (req, res) => {
  const { witnessName, consent } = req.body || {};
  await answer(res, 'open your attunement')(() =>
    openWitnessAttunement(req.walletAddress, { witnessName, consent }));
});

router.get('/records/:recordId/current', async (req, res) => {
  await answer(res, 'read the current question')(() =>
    currentQuestion(req.walletAddress, req.params.recordId));
});

router.post('/records/:recordId/answer', async (req, res) => {
  const { key, quote } = req.body || {};
  if (typeof key !== 'string' || !key.trim()) {
    return res.status(400).json({ error: 'key is required' });
  }
  await answer(res, 'record your answer')(() =>
    answerQuestion(req.walletAddress, req.params.recordId, { key, quote }));
});

router.post('/records/:recordId/seal', async (req, res) => {
  await answer(res, 'seal your attunement')(() =>
    sealWitnessAttunement(req.walletAddress, req.params.recordId));
});

router.post('/records/:recordId/abandon', async (req, res) => {
  const reason = req.body?.reason;
  if (typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'a stated reason is required' });
  }
  await answer(res, 'abandon your attunement')(() =>
    abandonWitnessAttunement(req.walletAddress, req.params.recordId, { reason }));
});

router.get('/records/:recordId/codex', async (req, res) => {
  await answer(res, 'read your codex')(() => witnessCodex(req.walletAddress, req.params.recordId));
});

export default router;
