import { Router } from 'express';
import { requireAuth } from '../services/auth.js';


const router = Router();

router.use(requireAuth);

const VALID_NAME = /^[a-zA-Z0-9_-]+$/;
router.param('companionName', (req, res, next, name) => {
  if (!VALID_NAME.test(name)) {
    return res.status(400).json({ error: 'Invalid companion name format' });
  }
  next();
});

// CORE-001 (#116): legacy global memory store decommissioned from the active
// write path. These routes wrote to a process-wide singleton with no neumaId
// scoping — a cross-neuma bleed on shared hardware. Sovereign memory lives in
// the per-neuma workspace (neumaWorkspace.addObservation) and is recalled via
// neumaRecall. A follow-up issue will land explicit-memory routes over the
// sovereign store. The 410 body is frozen and reused for every gone endpoint.
const GONE_BODY = Object.freeze({
  error: 'Legacy global memory store decommissioned (CORE-001 / #116). Use sovereign per-neuma memory via /api/workspace/* — see issue #116.',
});
const gone = (_req, res) => res.status(410).json(GONE_BODY);

router.get('/neuma-memory/status', gone);
router.post('/neuma-memory/create-entities', gone);
router.post('/neuma-memory/add-observations', gone);
router.post('/neuma-memory/create-relations', gone);
router.get('/neuma-memory/read-graph', gone);
router.post('/neuma-memory/open-nodes', gone);
router.post('/neuma-memory/search-nodes', gone);
router.post('/neuma-memory/clear/:companionName', gone);
router.get('/memory/graph/:companionName', gone);
router.post('/memory/semantic-search', gone);
router.get('/memory/network/:companionName', gone);
router.post('/memory/context', gone);

// --- DNA File Management (MCP-filesystem-backed, not the legacy store) ---

// SEC-AUDIT residual W1-003: legacy companion DNA REST was auth-only (no
// ownership) and checked a non-existent getToolsContext().client. Decommission
// like neuma-database — use /api/v1/workspace/:id/dna instead.
router.post('/companion/dna', (_req, res) => {
  res.status(410).json({
    error: 'Legacy companion DNA API removed — use /api/v1/workspace/:id/dna',
  });
});

export default router;
