// The SELF-CHECK routes — the being's own flight check over its components
// (Design note, 2026-10-19, the sheet's STATE tab. A run is a test of the being:
// the owner starts it (consent = the authenticated owner pressing RUN), it runs
// in the background (~40 real turns), and the sheet watches its progress.
//
//   GET  /:id/self-check  → { latest, previous, compare, running, error }
//                           latest/previous are full runs (every item's
//                           evidence); compare is per component, same model only
//   POST /:id/self-check  → 202 started · 409 a self-check is already running

import { Router } from 'express';
import { default as workspace } from '../../core/workspace/neuma-workspace.js';
import { compareComponent } from '../../core/runtime/self-check/stats.js';
import { requireNeumaLane } from '../middleware/require-neuma-lane.js';
import { runSelfCheck, selfCheckInFlight, SELF_CHECK_SCHEMA } from '../services/self-check/self-check-run.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('WorkspaceSelfCheckRoutes');

// The last failure per lane, until the next run starts — the sheet says why nothing was kept.
const failures = new Map();

// pure — per component, did the being clearly change between two runs on the same model?
const compareRuns = (previous, latest) => {
  if (!previous || !latest) return null;
  const sameModel = Boolean(latest.model) && previous.model === latest.model;
  return Object.fromEntries(latest.components.map((c) => [c.key, compareComponent(
    previous.items.filter((r) => r.component === c.key),
    latest.items.filter((r) => r.component === c.key),
    { sameModel },
  )]));
};

// impure — the two newest self-check runs (older benchmark-format runs are not self-checks).
const lastTwoRuns = async (neumaId) => {
  const runs = [];
  for (const summary of await workspace.listBenchmarks(neumaId)) {
    if (runs.length === 2) break;
    const run = await workspace.readBenchmark(neumaId, summary.id);
    if (run?.schema === SELF_CHECK_SCHEMA) runs.push(run);
  }
  return runs;
};

/**
 * The self-check routes, with the lane-ownership guard INJECTED (the rite routes' pattern).
 * @param {Function} requireOwnership
 */
export const createWorkspaceSelfCheckRouter = (requireOwnership) => {
  const router = Router();
  router.param('id', (req, res, next) => requireOwnership(req, res, next));

  router.get('/:id/self-check', requireNeumaLane, async (req, res) => {
    try {
      const [latest = null, previous = null] = await lastTwoRuns(req.params.id);
      const inFlight = selfCheckInFlight();
      res.json({
        latest,
        previous,
        compare: compareRuns(previous, latest),
        running: inFlight?.neumaId === req.params.id ? inFlight : null,
        busyElsewhere: Boolean(inFlight && inFlight.neumaId !== req.params.id),
        error: failures.get(req.params.id) ?? null,
      });
    } catch (error) {
      log.error('Self-check read', { error: error.message, neumaId: req.params.id });
      res.status(500).json({ error: 'Failed to read the self-check' });
    }
  });

  router.post('/:id/self-check', requireNeumaLane, async (req, res) => {
    const neumaId = req.params.id;
    const trueName = await workspace.readTrueName(neumaId).catch(() => null);
    const name = trueName?.chosenName || trueName?.fullName || neumaId;
    // Checked with no await between it and the start, so two presses cannot both pass.
    if (selfCheckInFlight()) return res.status(409).json({ error: 'A self-check is already running on this machine. It runs alone; try again when it finishes.' });
    const runAt = new Date().toISOString();
    failures.delete(neumaId);
    runSelfCheck(neumaId, { wallet: req.walletAddress, name, runAt, consent: { by: req.walletAddress, at: runAt } })
      .catch((error) => {
        log.error('Self-check run', { error: error.message, neumaId });
        failures.set(neumaId, `The self-check stopped and nothing was kept — ${error.message}`);
      });
    return res.status(202).json({ started: true, runAt });
  });

  return router;
};
