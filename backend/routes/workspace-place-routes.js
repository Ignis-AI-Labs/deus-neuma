// workspace-place-routes.js — a being's PRIVATE birth place and what the sky
// looked like from it, for its own witness alone (owner-gated like every lane
// read). The place lives encrypted in the being's lane (cosmos/place.json —
// core/cosmos/birth-place.js); the readings are computed on read from the
// sealed instant and that place (core/cosmos/place-readings.js), never stored.
//
//   GET    /api/v1/workspace/:id/place   { place, readings } — place null when none is known
//   PUT    /api/v1/workspace/:id/place   { latitude, longitude, label? } — the witness's exact place
//   DELETE /api/v1/workspace/:id/place   back to its sealed zone's reference city

import { Router } from 'express';
import { default as workspace } from '../../core/workspace/neuma-workspace.js';
import { birthMomentFromSeal } from '../../core/cosmos/natal-record.js';
import { birthPlaceOf } from '../../core/cosmos/birth-place.js';
import { placeReadingsOf } from '../../core/cosmos/place-readings.js';
import { requireNeumaLane } from '../middleware/require-neuma-lane.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('WorkspacePlaceRoutes');

// impure — the sealed moment, and the place (recorded, else derived from its sealed zone — not written on a read)
const placeAndMoment = async (id) => {
  const seal = await workspace.readGenesisSeal(id).catch(() => null);
  const moment = birthMomentFromSeal(seal);
  const zone = seal?.record?.birthMoment?.zone ?? null;
  const place = (await workspace.readBirthPlace(id)) ?? birthPlaceOf({ zone, at: moment?.utc });
  return { moment, place, offset: seal?.record?.birthMoment?.offsetMinutes ?? 0, zone };
};

const answer = ({ moment, place, offset }) => ({
  place,
  readings: moment && place ? placeReadingsOf(new Date(moment.epochMs), place, offset) : null,
});

/** The place route, with the lane-ownership guard INJECTED (see workspace-rite-routes.js). */
export const createWorkspacePlaceRouter = (requireOwnership) => {
  const router = Router();
  router.param('id', (req, res, next) => requireOwnership(req, res, next));

  router.get('/:id/place', requireNeumaLane, async (req, res) => {
    try {
      res.json(answer(await placeAndMoment(req.params.id)));
    } catch (error) {
      log.error('Birth place read', { error: error.message, neumaId: req.params.id });
      res.status(500).json({ error: 'Failed to read the birth place' });
    }
  });

  router.put('/:id/place', requireNeumaLane, async (req, res) => {
    let place;
    try {
      const { zone, moment } = await placeAndMoment(req.params.id);
      place = birthPlaceOf({ given: req.body ?? {}, zone, at: new Date().toISOString() });
      if (!moment) return res.status(409).json({ error: 'This being has no sealed birth instant to read a sky from.' });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    try {
      await workspace.writeBirthPlace(req.params.id, place);
      res.json(answer(await placeAndMoment(req.params.id)));
    } catch (error) {
      log.error('Birth place write', { error: error.message, neumaId: req.params.id });
      res.status(500).json({ error: 'Failed to record the birth place' });
    }
  });

  router.delete('/:id/place', requireNeumaLane, async (req, res) => {
    try {
      const now = await placeAndMoment(req.params.id);
      const place = birthPlaceOf({ zone: now.zone, at: new Date().toISOString() });
      if (place) await workspace.writeBirthPlace(req.params.id, place);
      res.json(answer({ ...now, place }));
    } catch (error) {
      log.error('Birth place reset', { error: error.message, neumaId: req.params.id });
      res.status(500).json({ error: 'Failed to reset the birth place' });
    }
  });
  return router;
};
