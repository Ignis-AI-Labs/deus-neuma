/**
 * A PERSON'S DATA — /api/v1/people (sales/person-data.js; docs/work/crm-match-blob.md, 2026-11-23).
 *
 *   GET  /record?address=…  everything the house holds on one address, as one file to hand them
 *   POST /erase {address, confirm}  erase them: confirm repeats the address, so a slip erases nobody. Desk only
 *                           (remote/wire.js LOCAL_ONLY_ROUTES): a paired phone never wipes records.
 *
 * The signed-in operator's own house only.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { personRecord, erasePerson } from '../services/sales/person-data.js';
import { normalizeEmail } from '../services/sales/suppress-shape.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('PersonData');
const router = express.Router();
router.use(requireAuth);

router.get('/record', async (req, res) => {
  const address = normalizeEmail(req.query.address);
  if (!address) return res.status(400).json({ error: 'name the person by their email address' });
  try {
    const record = await personRecord(req.walletAddress, address);
    log.info('a person\'s record was read whole', { stores: record.held.length });
    res.setHeader('Content-Disposition', `attachment; filename="data-held-on-${address.replace(/[^a-z0-9@._-]/g, '_')}.json"`);
    return res.json(record);
  } catch (error) {
    log.error('a person\'s record could not be read', { error: error.message });
    return res.status(500).json({ error: 'Could not read what the house holds on them' });
  }
});

router.post('/erase', async (req, res) => {
  const address = normalizeEmail(req.body?.address);
  if (!address) return res.status(400).json({ error: 'name the person by their email address' });
  if (normalizeEmail(req.body?.confirm) !== address) return res.status(400).json({ error: 'type their address again to confirm: erasing cannot be undone' });
  try {
    const erased = await erasePerson(req.walletAddress, address, { by: req.walletAddress });
    log.info('a person was erased at their request', { leads: erased.leads, stores: erased.dropped.length, left: erased.left.length });
    return res.json(erased);
  } catch (error) {
    log.error('a person could not be erased', { error: error.message });
    return res.status(500).json({ error: `Could not erase them: ${error.message}` });
  }
});

export default router;
