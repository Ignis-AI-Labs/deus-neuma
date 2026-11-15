/**
 * LP wallet routes — the operator's side of a house member's LP wallet on
 * Umbrae (Design note, 2026-11-12. The operator opens the wallet and copies its
 * address to fund it, sets the budget, and answers deposits that waited.
 * Every route needs the operator's sign-in and ownership of the lane.
 *
 * GET  /api/v1/neuma/:neumaId/lp                        — the LP wallet (with its book), or {lp: null};
 *                                                         its goals, and how it runs round the clock
 * POST /api/v1/neuma/:neumaId/lp/open                   — make it (once); its address
 * PUT  /api/v1/neuma/:neumaId/lp/budget                 — { budgetUsd }
 * POST /api/v1/neuma/:neumaId/lp/pending/:id/approve    — run a waiting deposit
 * POST /api/v1/neuma/:neumaId/lp/pending/:id/decline    — end it
 * PUT  /api/v1/neuma/:neumaId/lp/pace                   — { minutes }: its portfolio round (0 = off)
 * POST /api/v1/neuma/:neumaId/lp/rewards/:id/approve    — { note? }: pay a requested reward to the operator
 * POST /api/v1/neuma/:neumaId/lp/rewards/:id/decline    — { note? }: say no, and why
 * POST /api/v1/neuma/:neumaId/lp/rewards/:id/delivered  — { note? }: the operator got it for the member
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { isWitnessLaneId } from '../services/witness-lane.js';
import { openLpWallet } from '../services/umbrae-lp/lp-wallet.js';
import { writeLpBudget } from '../services/umbrae-lp/lp-budget.js';
import { readLpView } from '../services/umbrae-lp/lp-view.js';
import { answerWaitingDeposit } from '../services/umbrae-lp/lp-run.js';
import { readGoals, answerReward } from '../services/umbrae-lp/lp-rewards.js';
import { roundTheClock, writeLpPace } from '../services/umbrae-lp/lp-watch.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('LpWallet');
const router = Router();

router.param('neumaId', (req, res, next, value) => (
  /^[a-zA-Z0-9_-]+$/.test(value) ? next() : res.status(400).json({ error: 'Invalid neumaId format' })));

// impure — the shared wrapper: sign-in, ownership, then the act; an error is
// logged by name and answered plainly.
const owned = (act) => [requireAuth, async (req, res) => {
  try {
    if (!(await assertNeumaOwner(req, res, req.params.neumaId))) return;
    await act(req, res);
  } catch (err) {
    log.error('LP wallet route failed', { neumaId: req.params.neumaId, error: err.message });
    res.status(500).json({ error: err.message });
  }
}];

router.get('/:neumaId/lp', ...owned(async (req, res) => {
  const lp = await readLpView(req.params.neumaId);
  const [goals, clock] = lp ? await Promise.all([readGoals(req.params.neumaId), roundTheClock(req.params.neumaId)]) : [[], null];
  res.json({ neumaId: req.params.neumaId, lp, goals, clock });
}));

router.post('/:neumaId/lp/open', ...owned(async (req, res) => {
  if (isWitnessLaneId(req.params.neumaId)) return res.status(403).json({ error: 'A witness seat holds no LP wallet on this platform.' });
  const opened = await openLpWallet(req.params.neumaId);
  log.info('LP wallet opened', { neumaId: req.params.neumaId, address: opened.address, created: opened.created });
  return res.json({ neumaId: req.params.neumaId, ...opened });
}));

router.put('/:neumaId/lp/budget', ...owned(async (req, res) => {
  try {
    const budgetUsd = await writeLpBudget(req.params.neumaId, req.body?.budgetUsd);
    res.json({ neumaId: req.params.neumaId, budgetUsd });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// The run behind a yes can take minutes (approvals, then the deposit, each
// confirmed on Base); the answer comes when it is done.
const answer = (verdict) => owned(async (req, res) => {
  const out = await answerWaitingDeposit(req.params.neumaId, req.params.id, verdict);
  log.info('LP deposit answered', { neumaId: req.params.neumaId, id: req.params.id, verdict, ok: out.ok });
  const missing = !out.ok && /no longer waiting/.test(out.reason);
  res.status(out.ok ? 200 : missing ? 404 : 409).json(out);
});
router.post('/:neumaId/lp/pending/:id/approve', ...answer('approved'));
router.post('/:neumaId/lp/pending/:id/decline', ...answer('declined'));

router.put('/:neumaId/lp/pace', ...owned(async (req, res) => {
  try {
    res.json({ neumaId: req.params.neumaId, pace: await writeLpPace(req.params.neumaId, req.body?.minutes) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// An approval pays on Base and waits for it; the answer comes when it is done.
const rewardAnswer = (verdict) => owned(async (req, res) => {
  const out = await answerReward(req.params.neumaId, req.params.id, verdict, { note: req.body?.note });
  log.info('LP reward answered', { neumaId: req.params.neumaId, id: req.params.id, verdict, ok: out.ok });
  res.status(out.ok ? 200 : 409).json(out);
});
router.post('/:neumaId/lp/rewards/:id/approve', ...rewardAnswer('approved'));
router.post('/:neumaId/lp/rewards/:id/decline', ...rewardAnswer('declined'));
router.post('/:neumaId/lp/rewards/:id/delivered', ...rewardAnswer('delivered'));

export default router;
