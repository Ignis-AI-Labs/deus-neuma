/**
 * Mind routes — the operator's window onto the mind layer (#317): the
 * influence gates as things that can be seen and set, the shadow rings'
 * fill (the validation data accumulating), and a per-being posture in
 * COUNTS ONLY — what a being holds beneath its turns stays beneath them
 * (the ceremony-disclosure counts-only law). Auth-gated; the per-being
 * read is owner-gated; the gate switch refuses under the env lock. The gates
 * are the machine's (data/settings/mind.json, every house's beings ride them),
 * so only the install owner flips one, at this computer's own desk.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { createLogger } from '../services/logger.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { mindGateSettings } from '../services/mind-gate-settings.js';
import { undercurrentShadowMetrics, depthShadowMetrics } from '../services/memory-context.js';
import { persistedShadow } from '../services/mind-shadow-log.js';
import { neumaWorkspace } from '../../core/index.js';
import { activeMindRecords } from '../../core/continuity/index.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';

const router = express.Router();
const log = createLogger('MindRoutes');

router.use(requireAuth);

// pure — entries folded to what the panel needs: fill, freshness, spread.
const ringSummary = (ring) => ({
  entries: ring.length,
  beings: new Set(ring.map((e) => e.neumaId)).size,
  latestAt: ring.length ? ring[ring.length - 1].at : null,
});

// GET / — the gates' true modes (env lock named) and the shadow evidence, in
// two honest halves. `live` is this process's own ring, so a fresh boot reads
// empty and says so. `sinceFirstRun` is the persisted log, which is the half a
// promotion decision is actually made from: a shadow lane that forgot its
// findings at every restart could never answer whether it was worth promoting.
router.get('/', async (req, res) => {
  try {
    const [undercurrentLog, depthLog] = await Promise.all([
      persistedShadow('undercurrent'),
      persistedShadow('depth'),
    ]);
    res.json({
      gates: await mindGateSettings.read(),
      shadow: {
        undercurrent: {
          live: ringSummary(undercurrentShadowMetrics()),
          sinceFirstRun: ringSummary(undercurrentLog),
        },
        depth: {
          live: ringSummary(depthShadowMetrics()),
          sinceFirstRun: ringSummary(depthLog),
        },
      },
    });
  } catch (error) {
    log.error('mind gate read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the mind gates' });
  }
});

// PUT /gates — the operator's switch: { gate, mode }. A 409 carries the env
// lock's own words (or the depth-live refusal) — never a shrug.
router.put('/gates', requireInstallOwner, async (req, res) => {
  const { gate, mode } = req.body ?? {};
  if (typeof gate !== 'string' || typeof mode !== 'string') {
    return res.status(400).json({ error: 'gate and mode are required strings' });
  }
  try {
    const gates = await mindGateSettings.setGate(gate, mode, { wallet: req.walletAddress });
    res.json({ gates });
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

// GET /:neumaId — one being's mind posture, counts only: how many working
// thoughts by kind, and how fresh. Contents never ride this route.
router.get('/:neumaId', async (req, res) => {
  const { neumaId } = req.params;
  if (!(await assertNeumaOwner(req, res, neumaId))) return;
  try {
    const adapter = new WorkspaceAdapter(neumaId, { workspace: neumaWorkspace });
    const records = await activeMindRecords(adapter);
    const kinds = {};
    for (const r of records) kinds[r.meta.kind] = (kinds[r.meta.kind] || 0) + 1;
    const latestAt = records
      .map((r) => r.validFrom || r.at || null)
      .filter(Boolean)
      .sort()
      .pop() || null;
    res.json({ neumaId, total: records.length, kinds, latestAt });
  } catch (error) {
    log.error('mind posture read failed', { neumaId, error: error.message });
    res.status(500).json({ error: 'Could not read the mind posture' });
  }
});

export default router;
