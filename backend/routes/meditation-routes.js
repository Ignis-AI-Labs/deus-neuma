/**
 * Meditation routes — the operator's window onto the dream cycle: the live
 * posture (why the last tick deferred, by name), the per-being consent
 * switch, and the ONE manual wake door. Auth-gated; the switch and the door
 * are owner-gated per lane.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { meditationSettings } from '../services/meditation/meditation-settings.js';
import { readMeditationState, appendMeditationRun } from '../services/meditation/meditation-state.js';
import { meditationSchedulerStatus, abortMeditationForLane } from '../services/meditation/meditation-scheduler.js';
import { readPosture } from '../services/meditation/substrate-posture.js';
import { runMeditation } from '../services/meditation/meditation-cycle.js';
import { localTurnSnapshot } from './portal-routes.js';

const router = express.Router();
const log = createLogger('MeditationRoutes');

router.use(requireAuth);

// GET / — settings + per-lane state + the scheduler's live posture.
router.get('/', async (req, res) => {
  try {
    const [settings, state] = await Promise.all([
      meditationSettings.read(),
      readMeditationState(),
    ]);
    res.json({ settings, state, scheduler: meditationSchedulerStatus() });
  } catch (error) {
    // A corrupt state file is LOUD here too — never rendered as "never ran".
    log.error('meditation state read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read meditation state' });
  }
});

// PUT /:neumaId — the consent switch. Turning a lane OFF also aborts its
// in-flight cycle (visible-and-reversible: the switch does what it says NOW).
router.put('/:neumaId', async (req, res) => {
  const { neumaId } = req.params;
  if (!(await assertNeumaOwner(req, res, neumaId))) return;
  const { enabled, cadenceHours } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  try {
    const posture = await meditationSettings.setBeing(
      neumaId,
      { enabled, ...(cadenceHours !== undefined ? { cadenceHours } : {}) },
      { wallet: req.walletAddress },
    );
    if (!enabled && abortMeditationForLane(neumaId)) {
      log.info('in-flight meditation aborted by the consent switch', { neumaId });
    }
    res.json(posture);
  } catch (error) {
    // The env lock refuses with its own words — surface them, not a shrug.
    res.status(409).json({ error: error.message });
  }
});

// POST /:neumaId/run — the manual wake door (Founder-signed decision #2: the ONE
// path that may ignite the substrate, because the operator just asked). Still
// refuses over a mid-generation server, live turns, or a training lease —
// consent to wake is not consent to collide. A QUIET open portal does NOT
// refuse (unlike the scheduler's gate): the desk holds the companion's portal
// whenever the operator is seated, so refusing it meant the door could never
// open from the very seat that offers it — found by the first e2e desk walk.
// Residual, named: an operator-run cycle has no yield hook; a turn sent
// mid-cycle queues behind ~1 min of decode on the substrate's slots.
router.post('/:neumaId/run', async (req, res) => {
  const { neumaId } = req.params;
  if (!(await assertNeumaOwner(req, res, neumaId))) return;
  try {
    const posture = await readPosture({ turnSnapshot: localTurnSnapshot() });
    const refusal = posture.busy && posture.serving ? 'substrate-busy'
      : posture.localTurns > 0 ? 'turns-in-flight'
      : posture.leaseHeld ? 'training-lease-held'
      : null;
    if (refusal) return res.status(409).json({ error: refusal });

    const startedAt = Date.now();
    const out = await runMeditation(neumaId);
    await appendMeditationRun(neumaId, {
      at: new Date(startedAt).toISOString(),
      outcome: out.outcome,
      cycleId: out.cycleId,
      durationMs: Date.now() - startedAt,
      reason: 'operator-run',
      ...(out.phases ? { phases: out.phases } : {}),
      ...(out.notes !== undefined ? { notes: out.notes } : {}),
    });
    log.info('operator-run meditation settled', { neumaId, outcome: out.outcome, wallet: req.walletAddress });
    res.json({ outcome: out.outcome, cycleId: out.cycleId, ...(out.notes !== undefined ? { notes: out.notes } : {}) });
  } catch (error) {
    log.error('operator-run meditation failed', { neumaId, error: error.message });
    res.status(500).json({ error: 'Meditation run failed', detail: error.message });
  }
});

export default router;
