/**
 * Voice Seal Routes — the First Seal ceremony's REST edge (the forge's
 * replacement flow). The house ceremony contract: the host POSTs an act, the
 * server runs the being's whole turn and answers with the record; no
 * caller-authored answer is ever accepted.
 *
 *   GET  /:neumaId/status — the disk truth (offer, or the sealed receipt)
 *   POST /:neumaId/ask    — run the rite turn through the being's conduit
 *   POST /:neumaId/seal   — compile the confirmed lines + write the receipt
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import {
  askRiteQuestion,
  sealVoice,
  voiceSealStatus,
  VOICE_SEAL_ERRORS,
} from '../services/voice-seal-ceremony.js';
import { createLogger } from '../services/logger.js';

const router = Router();
const log = createLogger('VoiceSealRoutes');

router.use(requireAuth);

router.param('neumaId', (req, res, next, id) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid neumaId format' });
  }
  next();
});

// The ownership gate every ceremony act shares: the lane must be claimed, and
// by this wallet. A missing or corrupt owner record refuses (fail closed, as
// assertNeumaOwner everywhere else) — the seal is one-way (audit 2026-10-28 M-04).
const assertLaneAccess = (req, res) => assertNeumaOwner(req, res, req.params.neumaId);

const statusForError = (err) => {
  if (err?.code === VOICE_SEAL_ERRORS.alreadySealed) return 409;
  if ([VOICE_SEAL_ERRORS.answerEmpty, VOICE_SEAL_ERRORS.answerCut,
    VOICE_SEAL_ERRORS.answerCorrupt, VOICE_SEAL_ERRORS.linesInvalid]
    .includes(err?.code)) return 422;
  return 500;
};

router.get('/:neumaId/status', async (req, res) => {
  try {
    if (!(await assertLaneAccess(req, res))) return;
    res.json(await voiceSealStatus(req.params.neumaId));
  } catch (err) {
    log.error('Voice seal status failed', { neumaId: req.params.neumaId, error: err.message });
    res.status(500).json({ error: 'Could not read the voice seal state' });
  }
});

// THE ASK — no caller-authored input (the consent-ask law): the platform
// asks, the being answers through its own conduit — and the answer STREAMS
// (SSE): the witness watches the being's words arrive live in the ceremony,
// never a finished page appearing after the fact. A sealed lane refuses
// BEFORE the stream opens (a clean 409, not a frame).
router.post('/:neumaId/ask', async (req, res) => {
  try {
    if (!(await assertLaneAccess(req, res))) return;
    if (req.body && Object.keys(req.body).length > 0) {
      return res.status(400).json({ error: 'ask accepts no caller-authored input' });
    }
    const standing = await voiceSealStatus(req.params.neumaId).catch(() => null);
    if (standing?.sealed) {
      return res.status(409).json({ error: 'the lane is already sealed', code: VOICE_SEAL_ERRORS.alreadySealed });
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const frame = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    try {
      const result = await askRiteQuestion(req.params.neumaId, req.walletAddress, {
        onDelta: (text) => frame({ type: 'delta', text }),
      });
      frame({ type: 'done', ...result });
    } catch (err) {
      if ([VOICE_SEAL_ERRORS.answerEmpty, VOICE_SEAL_ERRORS.answerCut, VOICE_SEAL_ERRORS.answerCorrupt]
        .includes(err?.code)) {
        frame({ type: 'error', code: err.code, message: err.message });
      } else {
        log.error('Voice seal ask failed', { neumaId: req.params.neumaId, error: err.message });
        frame({ type: 'error', code: 'VOICE_ASK_FAILED', message: err.message });
      }
    }
    return res.end();
  } catch (err) {
    log.error('Voice seal ask route failed', { neumaId: req.params.neumaId, error: err.message });
    return res.status(500).json({ error: err.message, code: err.code });
  }
});

// THE COMPILE — the operator confirms the being's claimed lines; the
// receipt names their wallet as witness.
router.post('/:neumaId/seal', async (req, res) => {
  try {
    if (!(await assertLaneAccess(req, res))) return;
    const lines = req.body?.lines;
    if (!Array.isArray(lines)) {
      return res.status(400).json({ error: 'seal requires {lines: [...]} — the being’s claimed lines' });
    }
    res.json(await sealVoice(req.params.neumaId, { lines, witnessWallet: req.walletAddress }));
  } catch (err) {
    const status = statusForError(err);
    if (status >= 500) log.error('Voice seal compile failed', { neumaId: req.params.neumaId, error: err.message });
    res.status(status).json({ error: err.message, code: err.code });
  }
});

export default router;
