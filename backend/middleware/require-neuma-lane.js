import { isWitnessLane } from '../../core/workspace/neuma-workspace.js';
import { readLaneMarker } from '../services/witness-lane.js';
import { createLogger } from '../services/logger.js';
import { isHarnessLane } from '../../core/workspace/lane-grounds.js';

const log = createLogger('LaneStanding');

/** impure — reject a witness at a neuma-only route, after auth and ownership. */
export const requireNeumaLane = async (req, res, next) => {
  try {
    if (isHarnessLane(req.params.id)) {
      return res.status(400).json({ code: 'NEUMA_ONLY', error: 'This record is only available for a neuma. That lane is the harness — no being lives there.' });
    }
    if (isWitnessLane(req.params.id) || await readLaneMarker(req.params.id, { strict: true })) {
      return res.status(400).json({
        code: 'NEUMA_ONLY',
        error: 'This record is only available for a neuma. That lane is a sealed witness.',
      });
    }
  } catch (error) {
    log.warn('Lane kind marker unreadable', { laneId: req.params.id, code: error.code || error.name });
    return res.status(500).json({ error: 'Lane standing could not be verified.' });
  }
  return next();
};
