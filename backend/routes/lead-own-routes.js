// lead-own-routes — the lead engine's smaller doors, mounted together inside lead-engine-routes.js (behind its auth):
// a call on a lead, the lead-data plans, what too-wide searches brought in, the lead run, and what an audience requires.
import express from 'express';
import leadCallRouter from './lead-call-routes.js';
import leadPlanRouter from './lead-plan-routes.js';
import leadSearchRouter from './lead-search-routes.js';
import leadRunRouter from './lead-run-routes.js';
import leadAudienceRouter from './lead-audience-routes.js';

const router = express.Router();
router.use(leadCallRouter, leadPlanRouter, leadSearchRouter, leadRunRouter, leadAudienceRouter);
export default router;
