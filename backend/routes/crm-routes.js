/**
 * THE OPERATOR'S OWN RECORD OF PEOPLE — /api/v1/crm (docs/work/crm-match-blob.md slice 2; leads/lead-record.js).
 *
 *   GET  /fields               the house's own fields {fields, types}
 *   PUT  /fields {fields}      set the whole list (taking a field off keeps the values written in it)
 *   PUT  /leads/:id {tags?, fields?, about?}   a person's tags, field values and the note on top — one touch
 *   POST /leads/:id/merge {from}   the lead `from` is the same person: merged into this one, then removed
 *   GET  /search?q=…           one search across people, deals, invoices and companies
 *
 * The signed-in operator's own house only; every change is one touch on the lead's history, by their wallet.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { leadLedgerFor } from '../services/leads/lead-ledger.js';
import { readCrmFields, writeCrmFields, FIELD_TYPES } from '../services/leads/crm-fields.js';
import { searchHouse } from '../services/leads/crm-search.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Crm');
const router = express.Router();
router.use(requireAuth);

const failed = (res, what, error) => {
  log.error(`${what} failed`, { error: error.message });
  return res.status(500).json({ error: `Could not ${what}` });
};

router.get('/fields', async (req, res) => {
  try { return res.json({ fields: await readCrmFields(req.walletAddress), types: FIELD_TYPES }); } catch (error) { return failed(res, 'read the fields', error); }
});

router.put('/fields', async (req, res) => {
  try {
    const set = await writeCrmFields(req.walletAddress, req.body?.fields);
    if (!set.ok) return res.status(400).json({ error: set.reason });
    return res.json({ fields: set.fields, types: FIELD_TYPES });
  } catch (error) { return failed(res, 'save the fields', error); }
});

router.put('/leads/:id', async (req, res) => {
  try {
    const { tags, fields, about } = req.body ?? {};
    const ledger = await leadLedgerFor(req.walletAddress);
    const set = await ledger.setRecord(req.params.id, { tags, fields, about }, { defs: await readCrmFields(req.walletAddress), by: req.walletAddress });
    if (!set.ok) return res.status(set.error === 'no such lead' ? 404 : 400).json({ error: set.error });
    return res.json({ lead: set.lead, changed: set.changed });
  } catch (error) { return failed(res, 'save the record', error); }
});

router.post('/leads/:id/merge', async (req, res) => {
  try {
    const from = typeof req.body?.from === 'string' ? req.body.from : '';
    const merged = await (await leadLedgerFor(req.walletAddress)).merge(req.params.id, from, { by: req.walletAddress });
    if (!merged.ok) return res.status(merged.error === 'no such lead' ? 404 : 400).json({ error: merged.error });
    log.info('two leads merged into one', { keep: req.params.id });
    return res.json({ lead: merged.lead });
  } catch (error) { return failed(res, 'merge the leads', error); }
});

router.get('/search', async (req, res) => {
  try { return res.json(await searchHouse(req.walletAddress, req.query.q, { limit: Math.min(50, Number(req.query.limit) || 20) })); } catch (error) { return failed(res, 'search', error); }
});

export default router;
