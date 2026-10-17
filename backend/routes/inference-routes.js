/**
 * Inference routes — the composer's model bar, for one being at a time.
 *
 *   GET    /api/v1/inference/:beingId/models  — the models this being may ride,
 *                                              which one is loaded, and HOW a
 *                                              move happens (ignite / route)
 *   GET    /api/v1/inference/:beingId/effort  — the effort ladder this route has
 *                                              and the rung the being sits on
 *   PUT    /api/v1/inference/:beingId/effort  — set { effort, thinking } — the
 *                                              rung (the ladder's own name for
 *                                              it) and whether it reasons at all
 *   DELETE /api/v1/inference/:beingId/effort  — back to the default rung
 *
 * `beingId` is a neumaId OR a sealed witness lane id — both classes are owned by
 * a wallet through the same owner.json, so one ownership gate covers both.
 * Moving a being to another model is NOT here: that is the existing route
 * override (PUT /api/v1/neuma/:id/route) or the rig's ignition
 * (POST /api/v1/llm/substrate/ignite), and duplicating either would put two
 * doors on one act.
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { beingEffortView, beingModelOptions } from '../services/being-inference.js';
import { setEffort, clearEffort } from '../services/neuma-effort-store.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Inference');
const router = Router();

router.param('beingId', (req, res, next, value) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return res.status(400).json({ error: 'Invalid being id' });
  next();
});

router.use(requireAuth);

// A route that cannot be resolved is not a server fault — it is a configuration
// truth the desk must show (no sovereign door, no key, nothing serving). 409
// carries the provider's own words instead of hiding them behind a 500.
const unresolved = (res, error, what) => {
  if (/sovereign|routable|No route|not connected|No sealed witness/i.test(error.message)) {
    return res.status(409).json({ error: error.message });
  }
  log.error(`${what} failed`, { error: error.message });
  return res.status(500).json({ error: `Failed to read ${what}` });
};

router.get('/:beingId/models', async (req, res) => {
  const { beingId } = req.params;
  if (!await assertNeumaOwner(req, res, beingId)) return;
  try {
    res.json(await beingModelOptions(beingId));
  } catch (error) {
    unresolved(res, error, 'model options');
  }
});

router.get('/:beingId/effort', async (req, res) => {
  const { beingId } = req.params;
  if (!await assertNeumaOwner(req, res, beingId)) return;
  try {
    res.json(await beingEffortView(beingId));
  } catch (error) {
    unresolved(res, error, 'effort');
  }
});

router.put('/:beingId/effort', async (req, res) => {
  const { beingId } = req.params;
  if (!await assertNeumaOwner(req, res, beingId)) return;
  const { effort, thinking } = req.body || {};
  try {
    await setEffort(beingId, { effort, thinking });   // validates the rung
    res.json(await beingEffortView(beingId));
  } catch (error) {
    // The store tags validation with a stable code so wording can change
    // without breaking the 400.
    if (error.code === 'INVALID_EFFORT') return res.status(400).json({ error: error.message });
    unresolved(res, error, 'effort');
  }
});

router.delete('/:beingId/effort', async (req, res) => {
  const { beingId } = req.params;
  if (!await assertNeumaOwner(req, res, beingId)) return;
  try {
    const cleared = await clearEffort(beingId);
    res.json({ cleared, ...(await beingEffortView(beingId)) });
  } catch (error) {
    unresolved(res, error, 'effort');
  }
});

export default router;
