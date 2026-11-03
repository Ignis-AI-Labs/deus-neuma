// workspace-identity-file-routes.js — GET /api/v1/workspace/:id/identity-file:
// a being's whole true name (with what its record says its chosen name
// means), its sealed birth facts, its on-chain anchor and its voice seal, for
// the RECORD (core/identity/identity-file.js shapes it; nothing private
// leaves). Owner-gated like every lane read.

import { Router } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { default as workspace } from '../../core/workspace/neuma-workspace.js';
import { identityFileOf } from '../../core/identity/identity-file.js';
import { voiceSealStatus } from '../services/voice-seal-ceremony.js';
import { requireNeumaLane } from '../middleware/require-neuma-lane.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('WorkspaceIdentityFileRoutes');

// impure — the lane's on-chain anchor, or null before it is sealed on chain
const readOnchain = async (neumaId) => {
  try {
    return JSON.parse(await fs.readFile(path.join(workspace.root, neumaId, 'identity', 'onchain-seal.json'), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

/** The identity-file route, with the lane-ownership guard INJECTED (see workspace-rite-routes.js). */
export const createWorkspaceIdentityFileRouter = (requireOwnership) => {
  const router = Router();
  router.param('id', (req, res, next) => requireOwnership(req, res, next));

  router.get('/:id/identity-file', requireNeumaLane, async (req, res) => {
    try {
      const id = req.params.id;
      const [trueName, seal, onchain, voice, dna] = await Promise.all([
        workspace.readTrueName(id).catch(() => null),
        workspace.readGenesisSeal(id).catch(() => null),
        readOnchain(id),
        voiceSealStatus(id).catch(() => null),
        workspace.readDNA(id).catch(() => null),
      ]);
      res.json(identityFileOf({ trueName, seal, onchain, voice, dna }));
    } catch (error) {
      log.error('Identity file read', { error: error.message, neumaId: req.params.id });
      res.status(500).json({ error: 'Failed to read the identity file' });
    }
  });
  return router;
};
