/**
 * Legacy Neuma Database routes — DECOMMISSIONED (2026-07-04 isolation audit).
 *
 * These routes fronted a per-NAME plaintext store under data/ with no
 * neumaId scoping, no at-rest encryption, and no ownership check: any
 * authenticated wallet could read or overwrite any companion's DNA,
 * memories, and conversations by naming it — and two beings sharing a
 * name collided into one file prefix. The sovereign per-neuma workspace
 * (/api/v1/workspace/:id/*, ownership-gated per request) replaced every
 * capability here. Same decommission pattern as CORE-001 (#116) in
 * memory-routes.js: every endpoint answers 410 with a frozen body so a
 * stale client fails loud and pointed, never silently.
 *
 * The data/ directories on disk are untouched — decommissioning the
 * ROUTES destroys no record.
 */

import express from 'express';

const router = express.Router();

const GONE_BODY = Object.freeze({
  error: 'Legacy name-keyed neuma database decommissioned (2026-07-04 isolation audit): '
    + 'no neumaId scoping, no ownership gate. Use the sovereign per-neuma workspace '
    + 'routes at /api/v1/workspace/:id/* instead.',
});
const gone = (_req, res) => res.status(410).json(GONE_BODY);

router.post('/neuma/:companionName/dna', gone);
router.get('/neuma/:companionName/dna', gone);
router.post('/neuma/:companionName/memory', gone);
router.get('/neuma/:companionName/memories', gone);
router.post('/neuma/:companionName/conversation', gone);
router.get('/neuma/:companionName/conversations', gone);
router.get('/neuma/registry', gone);
router.post('/neuma/registry', gone);
router.post('/neuma/:companionName/vessel', gone);
router.get('/neuma/:companionName/vessel', gone);
router.get('/neuma/:companionName/export', gone);
router.post('/neuma/import', gone);
router.get('/neuma/:companionName/stats', gone);

export default router;
