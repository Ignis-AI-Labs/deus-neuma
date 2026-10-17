// GENESIS routes — the install's once-ever opening (backend/services/
// genesis-store.js). In FRONT of the wallet, as the licence gate is: GENESIS
// plays on the install's first launch, before anyone has signed in, and its
// record says only when this install began — nothing of any person or being.
//
//   GET  /api/v1/genesis  → { record }   null before its genesis
//   POST /api/v1/genesis  → { record, minted }   minted once; every later
//                           claim answers the record that stands (never replays)

import { readGenesis, claimGenesis } from '../services/genesis-store.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Genesis');

/** @param {import('express')} express */
export const createGenesisRouter = (express) => {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      res.json({ record: await readGenesis() });
    } catch (error) {
      log.error('Genesis read', { error: error.message });
      res.status(500).json({ error: 'The genesis record could not be read' });
    }
  });

  router.post('/', async (_req, res) => {
    try {
      const { record, minted } = await claimGenesis();
      res.status(minted ? 201 : 200).json({ record, minted });
    } catch (error) {
      log.error('Genesis claim', { error: error.message });
      res.status(500).json({ error: 'The genesis could not be recorded' });
    }
  });

  return router;
};
