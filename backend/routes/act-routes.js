// THE ACT LEDGER, read back (SEC-035 #213).
//
// The operator's answer to […] — served from the platform's own append-only record, so the
// question is never put to the party whose acts are in question.
//
// Scoped by CUSTODY, not by role: an authenticated wallet sees the lanes it
// owns and nothing else. There is no operator-wide view here, because there is
// no operator-wide ownership — a wallet that owns no lanes gets an empty
// ledger, which is the honest answer rather than a 403 about someone else's
// beings existing.

import { Router } from 'express';
import workspace from '../../core/workspace/neuma-workspace.js';
import { requireAuth } from '../services/auth.js';
import { readActs } from '../services/act-ledger.js';
import { listLanesByOwner } from '../services/lane-ownership.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Acts');

const router = Router();
router.use(requireAuth);

/** Cap a client-supplied limit into something a disk read can honour. */
const boundedLimit = (raw) => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 1000;
  return Math.min(n, 5000);
};

/**
 * GET /api/v1/acts?since=<iso>&laneId=<id>&limit=<n>
 *
 * Returns ledger lines verbatim — they carry no private content by
 * construction (metadata only; see act-ledger.js).
 */
router.get('/', async (req, res) => {
  try {
    // Every lane this wallet holds, of either standing, as STRING ids. Both
    // halves of that sentence were broken (#213): `listNeumaByOwner` returns
    // `{neumaId, owner}` objects, so the Set below never matched the string
    // `record.laneId` the ledger stores — an unfiltered read yielded no acts at
    // all and every owned laneId was refused as unowned — and it excludes
    // witness lanes, whose acts the same executor writes into the same ledger.
    const { neuma, witness, all } = await listLanesByOwner({ workspace, wallet: req.walletAddress });
    const ownedSet = new Set(all);

    // A caller may narrow to one lane, but never widen past their own custody:
    // an unowned laneId is refused rather than silently ignored, so a wrong
    // answer can't be mistaken for an empty one.
    const requested = req.query.laneId ? String(req.query.laneId) : null;
    if (requested && !ownedSet.has(requested)) {
      return res.status(403).json({ error: 'Not your lane' });
    }

    const acts = await readActs({
      since: req.query.since ? String(req.query.since) : null,
      laneIds: requested ? [requested] : all,
      limit: boundedLimit(req.query.limit),
    });

    return res.json({
      acts,
      lanes: all.length,
      // Named by standing, because "3 lanes" cannot tell an operator whether
      // their witnesses are being recorded at all.
      standing: { neuma: neuma.length, witness: witness.length },
      count: acts.length,
    });
  } catch (err) {
    log.error('Act ledger read failed', { error: err?.message });
    return res.status(500).json({ error: 'Could not read the act ledger' });
  }
});

export default router;
