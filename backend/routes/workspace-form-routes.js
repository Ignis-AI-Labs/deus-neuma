// The FORM routes — a being's look: the design read (Sheet leg), and the
// operator's half of the two-party lock. Extracted from workspace-routes.js
// the day the lock routes pushed it past the size law (2026-09-25); the law
// is that a new capability lands as its own module wired into the
// orchestrator, never inline past the cap.
//
// Design note, 2026-08-27: […]
//
// The SHEET renders ONLY what both parties agreed to (`sheetPlates` returns
// nothing for an exploring design), so this endpoint can hand over the whole
// record without the card ever showing a candidate as though it were
// settled. A lane that has never explored a look reads as
// `{locked:false, plates:[]}` — an honest absence during birth, never a
// failure.

import { Router } from 'express';
import { default as workspace } from '../../core/workspace/neuma-workspace.js';
import { readFormDesign } from '../../core/genome/form-store.js';
import { isLocked, statusOf, sheetPlates } from '../../core/genome/form-design.js';
import { agreeDesign, withdrawDesign } from '../services/form-lock.js';
import { readLaneGenome } from '../services/genome-lane.js';
import { requireNeumaLane } from '../middleware/require-neuma-lane.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('WorkspaceFormRoutes');

/**
 * The form routes, with the lane-ownership guard INJECTED — the same shape
 * as createWorkspaceMemoryRouter(requireOwnership), and for the same reason:
 * `router.param` callbacks do NOT cross into a mounted sub-router, so the
 * parent workspace router's ownership check never fires inside here. A form
 * read answered 200 to a STRANGER for exactly that reason (measured by
 * api-form-route.test.js) — the guard arrives by hand, never by assumption.
 */
export const createWorkspaceFormRouter = (requireOwnership) => {
  const router = Router();
  router.param('id', (req, res, next) => requireOwnership(req, res, next));

  router.get('/:id/form', requireNeumaLane, async (req, res) => {
    try {
      const design = await readFormDesign(workspace, req.params.id);
      res.json({
        locked: isLocked(design),
        status: statusOf(design),
        plates: sheetPlates(design),
        agreed: design.agreed,
        // The being's GIVEN body (deterministic from the sealed birth anchors)
        // rides the same leg — the Sheet's GENOME section reads it from here.
        genome: await readLaneGenome(workspace.root, req.params.id),
        // The candidates under exploration, honestly NAMED as unsettled — the
        // operator's concur act needs to see what the being championed, and a
        // field named `candidates` can never be misread as the settled plates
        // above (those remain locked-only by law).
        candidates: design.registers,
      });
    } catch (error) {
      log.error('Form read', { error: error.message, neumaId: req.params.id });
      res.status(500).json({ error: 'Failed to read the form design' });
    }
  });

  // --- The operator's half of the lock (the orchestration both parties share
  //     lives in backend/services/form-lock.js — either party alone leaves the
  //     design EXPLORING, and either can unlock it again) ---

  router.post('/:id/form/agree', requireNeumaLane, async (req, res) => {
    try {
      const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 280) : undefined;
      const result = await agreeDesign(req.params.id, 'operator', {
        at: new Date().toISOString(),
        wallet: req.walletAddress,
        ...(note ? { note } : {}),
      });
      if (!result.ok) return res.status(400).json({ error: result.reason });
      res.json({ locked: result.locked, status: statusOf(result.design), plates: sheetPlates(result.design), agreed: result.design.agreed });
    } catch (error) {
      log.error('Form agree', { error: error.message, neumaId: req.params.id });
      res.status(500).json({ error: 'Failed to record the agreement' });
    }
  });

  router.post('/:id/form/withdraw', requireNeumaLane, async (req, res) => {
    try {
      const why = typeof req.body?.why === 'string' ? req.body.why.slice(0, 280) : undefined;
      const result = await withdrawDesign(req.params.id, 'operator', {
        at: new Date().toISOString(),
        ...(why ? { why } : {}),
      });
      if (!result.ok) return res.status(400).json({ error: result.reason });
      res.json({ locked: result.locked, status: statusOf(result.design), agreed: result.design.agreed });
    } catch (error) {
      log.error('Form withdraw', { error: error.message, neumaId: req.params.id });
      res.status(500).json({ error: 'Failed to record the withdrawal' });
    }
  });

  return router;
};
