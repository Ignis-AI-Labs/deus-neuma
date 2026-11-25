// lead-call-routes — the operator's own hand on a lead's call (mounted inside lead-engine-routes.js, behind its
// auth): book one, move it (booking again with a new time), or call it off. The records are sales/booked-calls.js.
import express from 'express';
import { callOf, callOffOf, readCall, bookCall, cancelCall, markCallShow } from '../services/sales/booked-calls.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('LeadCallRoutes');
const router = express.Router();
const shown = (lead) => ({ id: lead.id, status: lead.status, call: callOf(lead), callOff: callOffOf(lead) });
const statusOf = (reason) => (reason === 'no lead with that id' ? 404 : /^no call is booked|has not happened yet/.test(reason) ? 409 : /^show:/.test(reason) ? 400 : 500);

// {at (with its time zone), title?, link?}. A lead that already has a call coming has it MOVED to this time.
router.post('/leads/:id/call', async (req, res) => {
  const read = readCall(req.body);
  if (!read.ok) return res.status(400).json({ error: read.reason });
  const done = await bookCall(req.walletAddress, { leadId: req.params.id, call: read.call, by: 'operator' }).catch((err) => ({ ok: false, reason: err.message }));
  if (!done.ok) { log.warn('A call could not be booked', { id: req.params.id, reason: done.reason }); return res.status(statusOf(done.reason)).json({ error: done.reason }); }
  return res.json({ ok: true, moved: done.moved, lead: shown(done.lead) });
});

// The call is called off: it leaves CALLS and the house calendar. The lead stays open.
router.delete('/leads/:id/call', async (req, res) => {
  const done = await cancelCall(req.walletAddress, { leadId: req.params.id, by: 'operator', why: req.body?.why }).catch((err) => ({ ok: false, reason: err.message }));
  if (!done.ok) return res.status(statusOf(done.reason)).json({ error: done.reason });
  return res.json({ ok: true, lead: shown(done.lead) });
});

// WHO SHOWED for a call whose time has passed: {show: 'held' | 'me' | 'them'}. The lead stays open whichever it is.
router.post('/leads/:id/call/show', async (req, res) => {
  const done = await markCallShow(req.walletAddress, { leadId: req.params.id, show: req.body?.show, by: 'operator' }).catch((err) => ({ ok: false, reason: err.message }));
  if (!done.ok) return res.status(statusOf(done.reason)).json({ error: done.reason });
  return res.json({ ok: true, lead: shown(done.lead) });
});

export default router;
