// lead-audience-routes — what an audience REQUIRES, set by the operator on the desk (mounted inside
// lead-engine-routes.js, behind its auth). Design note, 2026-11-21, after funds that invest in nothing crypto were written to
// for the crypto raise: […]
//
//   PUT /segments/:id/required   {required: [{sign, evidence: [words], otherwise?: audience id}]}   ([] clears it)
// A required sign is a hard no proved by the company's OWN words (required-signs.js): a page that names none of the
// evidence words is not this audience, whatever else it scores, and goes to `otherwise` when one is named.
import express from 'express';
import { setSegmentRequired } from '../services/sales/sales-store.js';
import { readNeverList, setNeverList, reviewNeverList, makeNeverList } from '../services/legal/never-list.js';
import { startAudienceTest } from '../services/sales/audience-test.js';
import { startLeadRun } from '../services/sales/lead-run.js';
import { salesIntents } from '../services/intents/sales-acts.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('LeadAudienceRoutes');
const router = express.Router();

router.put('/segments/:id/required', async (req, res) => {
  try {
    const set = await setSegmentRequired(req.walletAddress, String(req.params.id), req.body?.required, 'operator');
    if (!set.ok) return res.status(set.reason === 'no such segment' ? 404 : 400).json({ error: set.reason });
    log.info('What an audience requires was set by the operator', { id: req.params.id, signs: set.required.length });
    return res.json({ ok: true, required: set.required });
  } catch (error) {
    log.error('What an audience requires could not be set', { error: error.message });
    return res.status(500).json({ error: 'Could not set what the audience requires' });
  }
});

// THE AUDIENCE TEST (services/sales/audience-test.js): {companies: "acme.com, other.vc" | [domains]} — the companies that ARE
// this audience are screened now, from their own pages, and the standing then says how many it kept.
router.post('/segments/:id/test', async (req, res) => {
  try {
    const started = await startAudienceTest(req.walletAddress, { segmentId: String(req.params.id), domains: req.body?.companies }, { start: (wallet, ask) => startLeadRun(wallet, ask, { intents: salesIntents }) });
    if (!started.ok) return res.status(409).json({ error: started.reason });
    log.info('An audience test was started by the operator', { id: req.params.id, companies: started.domains.length });
    return res.json({ ok: true, run: started.run, companies: started.domains });
  } catch (error) { log.error('The audience test could not start', { error: error.message }); return res.status(500).json({ error: 'Could not start the audience test' }); }
});

// THE NEVER-LIST (services/legal/never-list.js): the places the house never writes to, kept by its legal office and
// read by its sales office. The operator reads it, sets it (it stands at once), or answers what the legal seat proposed.
//   GET /never-list · PUT /never-list {home?, countries: [{code, why, source?}]} · POST /never-list/review {verdict, note?}
router.get('/never-list', async (req, res) => {
  try { return res.json(await readNeverList(req.walletAddress)); } catch (error) { log.error('The never-list could not be read', { error: error.message }); return res.status(500).json({ error: 'Could not read the never-list' }); }
});
router.put('/never-list', async (req, res) => {
  let list;
  try { list = makeNeverList(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    await setNeverList(req.walletAddress, list);
    log.info('The never-list was set by the operator', { places: list.countries.length });
    return res.json(await readNeverList(req.walletAddress));
  } catch (error) { log.error('The never-list could not be set', { error: error.message }); return res.status(500).json({ error: 'Could not set the never-list' }); }
});
router.post('/never-list/review', async (req, res) => {
  try {
    const done = await reviewNeverList(req.walletAddress, { verdict: req.body?.verdict, note: req.body?.note });
    if (!done.ok) return res.status(409).json({ error: done.reason });
    log.info('The proposed never-list was answered by the operator', { verdict: req.body?.verdict });
    return res.json(await readNeverList(req.walletAddress));
  } catch (error) { log.error('The never-list review failed', { error: error.message }); return res.status(500).json({ error: 'Could not answer the proposed never-list' }); }
});

export default router;
