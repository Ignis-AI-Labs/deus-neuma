/**
 * Raise routes — the operator's hands in the raise room (Design note, 2026-10-29;
 * docs/planning/proposals/governance/house-company-line.md §8). Mounted at
 * /api/v1/raise. Every route needs the operator's Bearer token and reads or
 * moves only the signed-in wallet's OWN house. The operator SIGNS a mandate
 * (entering the receiving account — no being ever writes one), pauses,
 * resumes or closes it, and records counsel's review of a facts sheet.
 */

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { listCompanies, readCompany, readLine } from '../services/company-line/company-store.js';
import { readRaise, applyRaise, judgeStatus } from '../services/raise/raise-store.js';
import { judgeSign, judgeReview, judgeCloseInvestor } from '../services/raise/raise-shape.js';
import { readReceipts, putExtra } from '../services/money-in/money-in-store.js';
import { addressOfAnotherHouse } from '../services/money-in/watch-set.js';
import { checkOutboundSecrets } from '../services/security/outbound-secrets.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Raise');

const router = express.Router();
router.use(requireAuth);

// Every standing company of the house, with its raise as it stands.
router.get('/', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    const { companies } = await listCompanies(wallet);
    const standing = (await Promise.all(companies.map(async (c) => ((await readLine(wallet, c.id)).status === 'standing' ? c : null)))).filter(Boolean);
    res.json({ raises: await Promise.all(standing.map(async (c) => ({ id: c.id, name: c.name, raise: await readRaise(wallet, c.id) }))) });
  } catch (error) {
    log.error('Raise read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the raise room' });
  }
});

// One operator act on a company's raise, judged against the raise as it stands;
// `after` runs once the act has landed (never before).
const operatorAct = (what, judgeOf, after = null) => async (req, res) => {
  try {
    const wallet = req.walletAddress;
    const company = await readCompany(wallet, req.params.id);
    if (!company) return res.status(404).json({ error: 'No such company in this house' });
    const judge = await judgeOf(req.body ?? {}, new Date().toISOString(), wallet);
    if (judge.refusal) return res.status(400).json({ error: judge.refusal });
    const done = await applyRaise(wallet, company.id, judge);
    if (!done.ok) return res.status(400).json({ error: done.reason });
    if (after) await after(wallet, company, done.event);
    log.info(`Raise ${what} by the operator`, { id: company.id, event: done.event.type, wallet });
    return res.json({ raise: done.state });
  } catch (error) {
    log.error(`Raise ${what} failed`, { id: req.params.id, error: error.message });
    return res.status(500).json({ error: `Could not ${what}` });
  }
};

router.post('/:id/sign', operatorAct('sign the mandate', async (body, now, wallet) => (body.account?.kind === 'wallet' && await addressOfAnotherHouse(wallet, body.account.address)
  ? { refusal: 'that wallet belongs to another house on this machine — a house is paid only at its own (houses never confused)' }
  : (state) => judgeSign(state, { ...body, now })), async (wallet, company, event) => {
  // The money-in ledger watches where the raise lands, so an investor's transfer is seen.
  if (event.account.kind === 'wallet') await putExtra(wallet, { address: event.account.address, label: `${company.name} raise`, member: null, by: 'operator', at: event.at });
}));
// The close: the papers signed, accreditation verified where the route asks
// it, and the money landed where the mandate says (judgeCloseInvestor).
router.post('/:id/close-investor', operatorAct('close the investor', async (body, now, wallet) => {
  const receipt = body.receipt ? (await readReceipts(wallet)).find((r) => r.key === body.receipt) ?? null : null;
  return (state) => judgeCloseInvestor(state, { investorId: body.investorId, signedPapers: body.signedPapers, accreditedVerified: body.accreditedVerified, receipt, reference: body.reference, now });
}));
router.post('/:id/status', operatorAct('move the mandate', (body, now) => judgeStatus(body.type, body.note, now)));
router.post('/:id/review', operatorAct('record counsel\'s review', (body, now) => {
  const secret = checkOutboundSecrets('the review note', [body.note], 'nothing was recorded');
  return secret.ok ? (state) => judgeReview(state, { ...body, now }) : { refusal: secret.reason };
}));

export default router;
