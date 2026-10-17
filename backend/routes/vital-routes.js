/**
 * Vital routes — the witness's body log (their vessel's maintenance record).
 * Realm-persisted (<realm>/<wallet>/vitals.jsonl); auth-gated like every
 * realm lane. Validation corrections from the pure module arrive tagged
 * `.correction` and map to 400s with the safe correction text.
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import { readVitals, appendVital, vitalsSummary } from '../services/user-vitals.js';

const router = Router();
const log = createLogger('Vitals');

router.use(requireAuth);

const answerError = (res, error, op) => {
  if (error.correction) {
    res.status(400).json({ error: error.message });
    return;
  }
  log.error(op, { error: error.message });
  res.status(500).json({ error: op });
};

// GET /mine?limit=N — the log, newest first (default last 100, capped at 500)
router.get('/mine', async (req, res) => {
  try {
    const parsed = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 500) : 100;
    const entries = await readVitals(req.walletAddress, { limit });
    res.json({ entries: entries.slice().reverse() });
  } catch (error) {
    answerError(res, error, 'Could not read the vitals log');
  }
});

// GET /mine/summary — the aggregates (PR board, trends, streak, markers)
router.get('/mine/summary', async (req, res) => {
  try {
    res.json({ summary: await vitalsSummary(req.walletAddress) });
  } catch (error) {
    answerError(res, error, 'Could not summarize the vitals log');
  }
});

// POST /mine — { kind, ...fields } → the stored entry
router.post('/mine', async (req, res) => {
  try {
    const entry = await appendVital(req.walletAddress, req.body || {});
    res.status(201).json({ entry });
  } catch (error) {
    answerError(res, error, 'Could not log the entry');
  }
});

export default router;
