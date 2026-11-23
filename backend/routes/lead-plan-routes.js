// lead-plan-routes — the operator's lead-data plans (mounted inside lead-engine-routes.js, behind its auth): what
// each partner costs a month, so the house can say what a lead costs (sales/lead-plans.js, sales/lead-cost.js).
import express from 'express';
import { setPlan, endPlan, readPlans } from '../services/sales/lead-plans.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('LeadPlanRoutes');
const router = express.Router();

// {partner, monthly, currency?, credits?, since?} — filed again, it replaces the one that stood.
router.put('/plans', async (req, res) => {
  try {
    const plan = await setPlan(req.walletAddress, req.body ?? {});
    log.info('A lead-data plan was filed', { partner: plan.partner, monthly: plan.monthly });
    return res.json({ ok: true, plan, plans: await readPlans(req.walletAddress) });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// The plan ended: it stops counting from now.
router.delete('/plans/:partner', async (req, res) => {
  const ended = await endPlan(req.walletAddress, req.params.partner).catch(() => false);
  return ended ? res.json({ ok: true, plans: await readPlans(req.walletAddress) }) : res.status(404).json({ error: 'no plan with that partner' });
});

export default router;
