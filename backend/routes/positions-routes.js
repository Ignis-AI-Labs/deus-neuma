/**
 * Position routes — every position of the signed-in operator's house in one
 * read (Design note, 2026-11-14: each position gets one hub holding everything it
 * handles). Mounted at /api/v1/positions.
 *
 *   GET /               {positions, members, gaps} — each position: who holds
 *                       it, its functions, what waits on the operator for it,
 *                       the connections it needs and whether each is on
 *   GET /campaigns      {campaigns} — every campaign of every position, each
 *                       with the campaigns it works with
 *   POST /campaigns/link    {a, b, note?} — link two campaigns of one company
 *   POST /campaigns/unlink  {a, b}
 *   GET /companies      {companies, fields} — each company's file, with its business model and the
 *                       parts a model is made of
 *   PUT /companies/:id/model          the operator writes a company's business model; it stands at once
 *   POST /companies/:id/model/approve the operator approves the model a member filed
 *   POST /companies/:id/model/return  {note} — or sends it back with what should change
 *   GET /:office/eyes   {eyes} — what the seat's holder reads at the top of
 *                       its turn (null when nobody holds the seat)
 *   DELETE /seating     the seating the members filed (house/seating) leaves the
 *                       board: applied seat by seat through each office's route,
 *                       or set aside
 *
 * The links are the one thing written here. Otherwise read-only: a seat is filled, a decision answered and a connection switched
 * through its own route, where every check that act needs already stands. The
 * house is the caller's wallet.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { positionsBoard, positionEyes } from '../services/positions/position-board.js';
import { positionOf } from '../services/positions/position-map.js';
import { houseCampaigns, linkCampaigns, unlinkCampaigns } from '../services/positions/campaign-links.js';
import { clearSeating } from '../services/positions/position-seating.js';
import { companyFiles } from '../services/positions/company-file.js';
import { MODEL_FIELDS, fileModel, settleModel } from '../services/positions/business-model.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Positions');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(await positionsBoard(req.walletAddress));
  } catch (error) {
    log.error('the positions board could not be read', { error: error.message });
    res.status(500).json({ error: 'Failed to read the house positions' });
  }
});

router.get('/campaigns', async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json({ campaigns: await houseCampaigns(req.walletAddress) });
  } catch (error) {
    log.error('the house campaigns could not be read', { error: error.message });
    res.status(500).json({ error: 'Failed to read the campaigns' });
  }
});

for (const [path, act] of [['link', linkCampaigns], ['unlink', unlinkCampaigns]]) {
  router.post(`/campaigns/${path}`, async (req, res) => {
    try {
      const moved = await act(req.walletAddress, req.body?.a, req.body?.b, { note: req.body?.note, by: 'operator' });
      if (!moved.ok) return res.status(409).json({ error: moved.reason });
      log.info(`Campaigns ${path}ed by the operator`, { a: req.body?.a, b: req.body?.b });
      return res.json({ ok: true, campaigns: await houseCampaigns(req.walletAddress) });
    } catch (error) {
      log.error(`campaign ${path} failed`, { error: error.message });
      return res.status(500).json({ error: `Failed to ${path} the campaigns` });
    }
  });
}

const companiesOf = async (wallet) => ({ companies: await companyFiles(wallet), fields: MODEL_FIELDS });

router.get('/companies', async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(await companiesOf(req.walletAddress));
  } catch (error) {
    log.error('the company files could not be read', { error: error.message });
    res.status(500).json({ error: 'Failed to read the companies' });
  }
});

// The operator's three moves on a company's business model; each answers with the companies as they now stand.
const MODEL_MOVES = [
  ['put', '/companies/:id/model', (wallet, id, body) => fileModel(wallet, id, body, { by: 'operator' })],
  ['post', '/companies/:id/model/approve', (wallet, id) => settleModel(wallet, id, { approve: true })],
  ['post', '/companies/:id/model/return', (wallet, id, body) => settleModel(wallet, id, { approve: false, note: body?.note })],
];
for (const [method, path, act] of MODEL_MOVES) {
  router[method](path, async (req, res) => {
    try {
      const { companies } = await companiesOf(req.walletAddress);
      if (!companies.some((c) => c.id === req.params.id)) return res.status(404).json({ error: 'No such company in this house' });
      const moved = await act(req.walletAddress, req.params.id, req.body);
      if (!moved.ok) return res.status(409).json({ error: moved.reason });
      log.info('a business model was moved by the operator', { company: req.params.id, path });
      return res.json({ ok: true, ...(await companiesOf(req.walletAddress)) });
    } catch (error) {
      log.error('a business model move failed', { error: error.message });
      return res.status(500).json({ error: 'Failed to save the business model' });
    }
  });
}

router.delete('/seating', async (req, res) => {
  try {
    await clearSeating(req.walletAddress);
    log.info('the filed seating left the board');
    return res.json({ ok: true });
  } catch (error) {
    log.error('the filed seating could not be cleared', { error: error.message });
    return res.status(500).json({ error: 'Failed to clear the seating' });
  }
});

router.get('/:office/eyes', async (req, res) => {
  if (!positionOf(req.params.office)) return res.status(404).json({ error: 'No such position' });
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.json({ eyes: await positionEyes(req.walletAddress, req.params.office) });
  } catch (error) {
    log.error('a position briefing could not be read', { office: req.params.office, error: error.message });
    return res.status(500).json({ error: 'Failed to read what this position is told' });
  }
});

export default router;
