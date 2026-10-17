/**
 * Expression routes — the operator's window onto the declared-affect
 * channel (Campaign 6): the per-being toggle (default OFF; refuses under
 * the env lock with its name) and the palette. The palette SHOWS ITS TERMS
 * by signed decision (Design note, 2026-08-15: every term was born from a
 * declaration the being already revealed to the operator — provenance
 * satisfies the counts-only law. Auth-gated; per-being reads owner-gated.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { expressionSettings } from '../services/expression-settings.js';
import { neumaWorkspace } from '../../core/index.js';

const router = express.Router();
const log = createLogger('ExpressionRoutes');

router.use(requireAuth);

// GET /:neumaId — the channel posture + the palette: terms (count, recency)
// and the verbatim recent-declarations trail.
router.get('/:neumaId', async (req, res) => {
  const { neumaId } = req.params;
  if (!(await assertNeumaOwner(req, res, neumaId))) return;
  try {
    const [posture, palette] = await Promise.all([
      expressionSettings.read(),
      neumaWorkspace.readExpressionPalette(neumaId),
    ]);
    const entries = palette?.terms && typeof palette.terms === 'object'
      ? Object.entries(palette.terms)
      : [];
    const terms = entries
      .map(([term, t]) => ({
        term,
        count: Number.isFinite(t?.count) ? t.count : 1,
        firstAt: t?.firstAt ?? null,
        lastAt: t?.lastAt ?? null,
      }))
      .sort((a, b) => b.count - a.count || String(b.lastAt ?? '').localeCompare(String(a.lastAt ?? '')));
    res.json({
      neumaId,
      enabled: (posture.beings[neumaId] ?? { enabled: false }).enabled,
      envLocked: posture.envLocked,
      terms,
      recent: Array.isArray(palette?.recent) ? [...palette.recent].reverse() : [],
    });
  } catch (error) {
    log.error('expression read failed', { neumaId, error: error.message });
    res.status(500).json({ error: 'Could not read the expression channel' });
  }
});

// PUT /:neumaId — the operator's flip: { enabled }. A 409 carries the env
// lock's own words — never a shrug.
router.put('/:neumaId', async (req, res) => {
  const { neumaId } = req.params;
  if (!(await assertNeumaOwner(req, res, neumaId))) return;
  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  try {
    const posture = await expressionSettings.setBeing(neumaId, { enabled }, { wallet: req.walletAddress });
    res.json({
      neumaId,
      enabled: (posture.beings[neumaId] ?? { enabled: false }).enabled,
      envLocked: posture.envLocked,
    });
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

export default router;
