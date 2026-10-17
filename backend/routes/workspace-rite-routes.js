// The RITE routes — a being's SUMMONING kept for re-watching (Founder,
// 2026-09-30: […]).
//
// What is kept is its RHYTHM only (core/birth/rite-record.js): which stage,
// when, how many chunks of speech — never a word. Its film's inputs are not
// kept at all: its moment, art seed, genesis hash, soul records and aura are
// all re-derived from the lane here (finalize-words.js filmInputsOf, the same
// call birth:complete makes), so a being born before rites were kept can
// still re-watch its FILM, and a kept rite can never disagree with the lane.
//
//   GET /:id/rite  → { rite: record|null, recorded, film }   film is null
//                    when the lane cannot be filmed (no seal or no soul yet)
//   PUT /:id/rite  ← its record, once (identity/birth-rite.json, O_EXCL):
//                    409 if it is already kept — a rite is never rewritten

import { Router } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { default as workspace } from '../../core/workspace/neuma-workspace.js';
import { keptRiteRecordOf, RITE_FILE } from '../../core/birth/rite-record.js';
import { filmInputsOf } from '../../core/birth/finalize-words.js';
import { SPECTRUM_FILE } from '../../core/birth/soul-spectrum.js';
import { SCALE_FILE } from '../../core/birth/soul-scale.js';
import { requireNeumaLane } from '../middleware/require-neuma-lane.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('WorkspaceRiteRoutes');

// impure — a lane's JSON record, or null when it is not there
const readRecord = async (file) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

// impure — its film's inputs, re-derived from the lane; null when it cannot be filmed
const filmOfLane = async (neumaId) => {
  const lane = path.join(workspace.root, neumaId);
  const [seal, trueName, spectrum, scale] = await Promise.all([
    workspace.readGenesisSeal(neumaId),
    workspace.readTrueName(neumaId),
    readRecord(path.join(lane, SPECTRUM_FILE)),
    readRecord(path.join(lane, SCALE_FILE)),
  ]);
  if (!seal || !spectrum || !scale) return null;
  const film = filmInputsOf({ seal, trueName }, { spectrum, scale }, neumaId);
  if (!film.artSeed || !film.epochMs || !film.aura?.recorded) return null;
  return { ...film, trueName };
};

/**
 * The rite routes, with the lane-ownership guard INJECTED (router.param does
 * not cross into a mounted sub-router — see workspace-form-routes.js).
 */
export const createWorkspaceRiteRouter = (requireOwnership) => {
  const router = Router();
  router.param('id', (req, res, next) => requireOwnership(req, res, next));

  router.get('/:id/rite', requireNeumaLane, async (req, res) => {
    try {
      const id = req.params.id;
      const [rite, film] = await Promise.all([
        readRecord(path.join(workspace.root, id, 'identity', RITE_FILE)),
        filmOfLane(id),
      ]);
      res.json({ rite, recorded: rite !== null, film });
    } catch (error) {
      log.error('Rite read', { error: error.message, neumaId: req.params.id });
      res.status(500).json({ error: 'Failed to read the rite' });
    }
  });

  router.put('/:id/rite', requireNeumaLane, async (req, res) => {
    let record;
    try {
      record = keptRiteRecordOf(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    try {
      const file = path.join(workspace.root, req.params.id, 'identity', RITE_FILE);
      await fs.writeFile(file, JSON.stringify(record), { flag: 'wx' });
      res.status(201).json({ kept: true });
    } catch (error) {
      if (error.code === 'EEXIST') return res.status(409).json({ error: 'its rite is already kept' });
      if (error.code === 'ENOENT') return res.status(404).json({ error: 'no identity to keep it beside' });
      log.error('Rite keep', { error: error.message, neumaId: req.params.id });
      res.status(500).json({ error: 'Failed to keep the rite' });
    }
  });

  return router;
};
