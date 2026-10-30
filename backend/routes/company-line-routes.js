/**
 * Company-line routes — the operator's window onto their house's companies and
 * each company's founding line (Design note, 2026-10-29,
 * docs/planning/proposals/governance/house-company-line.md). Mounted at
 * /api/v1/company-line (the brand-kit companies stand apart at
 * /api/v1/companies). Every route needs the operator's Bearer token and reads
 * or moves only the signed-in wallet's OWN house — a company is opened for a
 * house, never for the machine.
 *
 * The operator acts on the line through the same law the beings' filed acts
 * use (company-line/line-acts.js): they hand on the stages they master (FORM, and
 * any seat they hold themselves) and answer the inspections that wait on them
 * — the floor, and the gates their dial takes. 'counsel' inspections are
 * theirs to record: the lawyer's answer, carried back.
 */

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { seatHolders } from '../services/company-line/stage-holders.js';
import { houseStop } from '../services/company-line/house-dial.js';
import { stopSays, FLOOR } from '../services/company-line/involvement-dial.js';
import { makeCompany, openCompany, listCompanies, readCompany, readLine, appendLineEvent } from '../services/company-line/company-store.js';
import { judgeInspect } from '../services/company-line/line-acts.js';
import { prepareHandOn, keepWorksheet } from '../services/company-line/line-hand-on.js';
import { announceMove } from '../services/company-line/line-notices.js';
import { lineView } from '../services/company-line/company-view.js';
import { readHands, answerHands } from '../services/company-line/hands-store.js';
import { readRoundWorksheets } from '../services/company-line/worksheet-store.js';
import { checkOutboundSecrets } from '../services/security/outbound-secrets.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('CompanyLine');

const router = express.Router();
router.use(requireAuth);

const STATUS_OF = Object.freeze({ invalid: 400, denied: 403 });

// impure — one company as the desk reads it: its line, its HANDS asks, the round's worksheets.
const viewOf = async (wallet, company, holders) => {
  const line = await readLine(wallet, company.id);
  const [{ items }, worksheets] = await Promise.all([readHands(wallet, company.id), readRoundWorksheets(wallet, company.id, line.round)]);
  return lineView(company, line, holders, items, worksheets);
};

// The house's dial and every company's line, in one read.
router.get('/', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    const [stop, holders, { companies, unreadable }] = await Promise.all([houseStop(wallet), seatHolders(wallet), listCompanies(wallet)]);
    const lines = await Promise.all(companies.map((c) => viewOf(wallet, c, holders)));
    res.json({ dial: { stop, says: stopSays(stop), floor: FLOOR }, holders, companies: lines, unreadable });
  } catch (error) {
    log.error('Company read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read this house\'s companies' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const company = await readCompany(req.walletAddress, req.params.id);
    if (!company) return res.status(404).json({ error: 'No such company in this house' });
    const holders = await seatHolders(req.walletAddress);
    return res.json({ company: await viewOf(req.walletAddress, company, holders) });
  } catch (error) {
    log.error('Company line read failed', { id: req.params.id, error: error.message });
    return res.status(500).json({ error: 'Could not read this company\'s line' });
  }
});

// The operator opens a company themselves (the Rector and the Optio may too, by intent).
router.post('/', async (req, res) => {
  let company;
  try {
    company = makeCompany({ name: req.body?.name, mode: req.body?.mode, openedBy: 'operator', now: new Date().toISOString() });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    const wallet = req.walletAddress;
    await openCompany(wallet, company);
    const [line, holders] = await Promise.all([readLine(wallet, company.id), seatHolders(wallet)]);
    await announceMove({ wallet, company, event: { type: 'opened', by: 'operator', at: company.openedAt }, line, holders });
    log.info('Company opened', { id: company.id, wallet });
    return res.status(201).json({ company: lineView(company, line, holders) });
  } catch (error) {
    log.error('Company open failed', { error: error.message });
    return res.status(500).json({ error: 'Could not open the company' });
  }
});

// One operator move on a company's line, judged by the shared law (a judge
// may read the ground: a hand-on's worksheet is judged where it lands).
const operatorMove = (judge) => async (req, res) => {
  try {
    const wallet = req.walletAddress;
    const company = await readCompany(wallet, req.params.id);
    if (!company) return res.status(404).json({ error: 'No such company in this house' });
    const [line, holders, stop] = await Promise.all([readLine(wallet, company.id), seatHolders(wallet), houseStop(wallet)]);
    const judged = await judge({ wallet, company, line, holders, stop, actor: 'operator', stageId: req.body?.stage, ...req.body, now: new Date().toISOString() });
    if (!judged.ok) return res.status(STATUS_OF[judged.status] ?? 400).json({ error: judged.reason });
    await keepWorksheet(judged);
    const landed = await appendLineEvent(wallet, company.id, judged.event);
    if (!landed.ok) return res.status(409).json({ error: 'The line moved before this landed — read it again' });
    await announceMove({ wallet, company, event: judged.event, line: landed.line, holders });
    log.info('Company line moved by the operator', { id: company.id, stage: judged.event.stage, type: judged.event.type, verdict: judged.event.verdict ?? null, wallet });
    return res.json({ company: await viewOf(wallet, company, holders) });
  } catch (error) {
    log.error('Company line move failed', { id: req.params.id, error: error.message });
    return res.status(500).json({ error: 'Could not move the line' });
  }
};

router.post('/:id/hand-on', operatorMove(prepareHandOn));
router.post('/:id/inspect', operatorMove(async (args) => judgeInspect(args)));

// The operator answers a HANDS item: done (with the fact, or where a secret is
// kept) or declined (with why). The answer is screened like anything that
// leaves a hand: a secret's value is refused, never written down.
router.post('/:id/hands/:handsId', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    const company = await readCompany(wallet, req.params.id);
    if (!company) return res.status(404).json({ error: 'No such company in this house' });
    const secret = checkOutboundSecrets('the answer', [req.body?.text], 'nothing was recorded');
    if (!secret.ok) return res.status(400).json({ error: secret.reason });
    const answered = await answerHands(wallet, company.id, req.params.handsId, { status: req.body?.status, text: req.body?.text, now: new Date().toISOString() });
    if (!answered.ok) return res.status(400).json({ error: answered.reason });
    log.info('HANDS answered by the operator', { id: company.id, handsId: req.params.handsId, status: answered.event.status, wallet });
    return res.json({ answered: answered.event });
  } catch (error) {
    log.error('HANDS answer failed', { id: req.params.id, error: error.message });
    return res.status(500).json({ error: 'Could not record the answer' });
  }
});

export default router;
