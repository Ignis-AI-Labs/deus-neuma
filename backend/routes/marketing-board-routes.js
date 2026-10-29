/**
 * /api/v1/marketing/board — the operator's MARKETING boards (marketing-panel-plan.md
 * §4), one per zoom level (`?level=house` or `?level=<companyId>`). GET reads a
 * level's saved board against the house as it stands (a panel whose campaign
 * is gone is dropped and named), or null when the level shows its default;
 * PUT records the operator's board whole (a refused board writes nothing and
 * names every reason); DELETE returns the level to its default. Every route
 * reads and moves only the signed-in operator's OWN house.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { boardStoreFor } from '../services/marketing/board-store.js';
import { BOARD_KINDS, BOARD_SPANS, BOARD_WINDOWS, TOP_COUNT, settleBoard } from '../services/marketing/board-shape.js';
import { BOARD_LEVEL, boardHouseOf as houseOf, levelRefusal } from '../services/marketing/board-house.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('MarketingBoard');
const router = express.Router();
router.use(requireAuth);

// pure — the level a request names, or a refusal.
const levelOf = (req) => {
  const level = String(req.query.level ?? '');
  return BOARD_LEVEL.test(level) ? { level } : { error: 'level is "house" or one of the house\'s company ids' };
};

const vocabulary = Object.freeze({ kinds: BOARD_KINDS, spans: BOARD_SPANS, windows: BOARD_WINDOWS, count: TOP_COUNT });

router.get('/', async (req, res) => {
  const { level, error } = levelOf(req);
  if (error) return res.status(400).json({ error });
  try {
    const ctx = await houseOf(req.walletAddress, level);
    const refused = levelRefusal(ctx);
    if (refused) return res.status(404).json({ error: refused });
    const saved = await (await boardStoreFor(req.walletAddress)).load(level);
    const settled = saved ? settleBoard(saved, ctx) : { panels: null, dropped: [] };
    res.json({ level, board: settled.panels, dropped: settled.dropped, ...vocabulary });
  } catch (err) {
    log.error('board read failed', { error: err.message });
    res.status(500).json({ error: 'Failed to read the board' });
  }
});

// The operator's own board — every panel it changes is stamped as theirs.
router.put('/', async (req, res) => {
  const { level, error } = levelOf(req);
  if (error) return res.status(400).json({ error });
  try {
    const ctx = await houseOf(req.walletAddress, level);
    const refused = levelRefusal(ctx);
    if (refused) return res.status(404).json({ error: refused });
    const saved = await (await boardStoreFor(req.walletAddress)).save(level, req.body?.panels, { ...ctx, setBy: 'operator' });
    if (!saved.ok) return res.status(400).json({ error: saved.reasons.join('; '), reasons: saved.reasons });
    log.info('board laid out', { wallet: req.walletAddress, level, panels: saved.panels.length });
    res.json({ level, board: saved.panels, dropped: [], ...vocabulary });
  } catch (err) {
    log.error('board write failed', { error: err.message });
    res.status(500).json({ error: 'Failed to save the board' });
  }
});

router.delete('/', async (req, res) => {
  const { level, error } = levelOf(req);
  if (error) return res.status(400).json({ error });
  try {
    const ctx = await houseOf(req.walletAddress, level);
    const refused = levelRefusal(ctx);
    if (refused) return res.status(404).json({ error: refused });
    await (await boardStoreFor(req.walletAddress)).reset(level, 'operator');
    log.info('board back to its default', { wallet: req.walletAddress, level });
    res.json({ level, board: null, dropped: [], ...vocabulary });
  } catch (err) {
    log.error('board reset failed', { error: err.message });
    res.status(500).json({ error: 'Failed to reset the board' });
  }
});

export default router;
