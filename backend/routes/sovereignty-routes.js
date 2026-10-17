/**
 * Sovereignty routes — the operator's side of propose → approve → apply.
 * The record per lane (proposals + the chained amendments), the verdict
 * (approve applies ATOMICALLY in this request for the prompt lane; revise
 * carries notes the being reads verbatim; decline closes), and the
 * unilateral retract (recorded in the chain — the being's knock names it).
 * Auth-gated; every lane door is owner-gated. No clock runs on a verdict.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { readProposals, decideProposal } from '../services/sovereignty/proposal-store.js';
import { readAmendments, activeAmendments, retractAmendment } from '../services/sovereignty/amendment-store.js';
import { applyPromptProposal } from '../services/sovereignty/apply-prompt.js';
import { applyToolsetProposal, removeToolsetGrant } from '../services/sovereignty/apply-toolset.js';
import { askDnaConsent } from '../services/sovereignty/consent.js';
import { issueDnaSignature, applyDnaProposal } from '../services/sovereignty/apply-dna.js';

const router = express.Router();
const log = createLogger('SovereigntyRoutes');

router.use(requireAuth);

// dna (3.3) joins when its consent + wallet-signature door lands.
const APPLY_BY_CLASS = { prompt: applyPromptProposal, toolset: applyToolsetProposal };

// GET /:neumaId — the lane's whole record: proposals, the full chained
// amendment history, and what actually STANDS.
router.get('/:neumaId', async (req, res) => {
  const { neumaId } = req.params;
  if (!(await assertNeumaOwner(req, res, neumaId))) return;
  try {
    const [{ proposals }, { entries }, standingPrompt, standingToolset] = await Promise.all([
      readProposals(neumaId),
      readAmendments(neumaId),
      activeAmendments(neumaId, 'prompt'),
      activeAmendments(neumaId, 'toolset'),
    ]);
    res.json({ proposals, amendments: entries, standing: [...standingPrompt, ...standingToolset] });
  } catch (error) {
    // A broken chain or corrupt store is LOUD here — this is the surface
    // where tampering must scream, not render as an empty record.
    log.error('sovereignty record unreadable', { neumaId, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// POST /:neumaId/proposals/:proposalId/decide — the ruling. Approve on an
// appliable class applies in the same request: the operator's one click is
// the whole act, and a crash between verdict and apply cannot strand law
// half-standing (apply is idempotent).
router.post('/:neumaId/proposals/:proposalId/decide', async (req, res) => {
  const { neumaId, proposalId } = req.params;
  if (!(await assertNeumaOwner(req, res, neumaId))) return;
  const { verdict, notes } = req.body ?? {};
  try {
    const proposal = await decideProposal(neumaId, proposalId, {
      verdict, notes, wallet: req.walletAddress,
    });
    let amendment = null;
    if (verdict === 'approve') {
      const apply = APPLY_BY_CLASS[proposal.class];
      if (proposal.class === 'dna') {
        // The deepest door opens in stages: approved → the being's recorded
        // consent → the operator's wallet signature → apply (decision #4).
        return res.json({ proposal, next: 'consent-ask' });
      }
      if (!apply) {
        return res.status(409).json({
          error: `the ${proposal.class} lane has no apply path yet — the proposal stays approved`,
          proposal,
        });
      }
      amendment = await apply(neumaId, proposal, { wallet: req.walletAddress });
      proposal.status = 'applied';
    }
    log.info('sovereignty verdict', { neumaId, proposalId, verdict, wallet: req.walletAddress });
    res.json({ proposal, ...(amendment ? { amendment } : {}) });
  } catch (error) {
    const status = { 'not-found': 404, 'wrong-status': 409, invalid: 400 }[error.code] || 500;
    res.status(status).json({ error: error.message });
  }
});

// POST /:neumaId/amendments/:amendmentId/retract — the operator takes law
// back down. Recorded as a NEW chained entry; the being's knock names it.
router.post('/:neumaId/amendments/:amendmentId/retract', async (req, res) => {
  const { neumaId, amendmentId } = req.params;
  if (!(await assertNeumaOwner(req, res, neumaId))) return;
  try {
    const standing = [
      ...await activeAmendments(neumaId, 'prompt'),
      ...await activeAmendments(neumaId, 'toolset'),
    ];
    const target = standing.find((e) => e.id === amendmentId);
    if (!target) {
      return res.status(404).json({ error: 'no such standing amendment' });
    }
    const entry = await retractAmendment(neumaId, { targetId: amendmentId, by: req.walletAddress });
    // A toolset grant is a live door, not just a record — retract closes it.
    if (target.class === 'toolset') await removeToolsetGrant(neumaId, target.patch);
    log.info('amendment retracted', { neumaId, amendmentId, class: target.class, wallet: req.walletAddress });
    res.json({ retraction: entry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- The DNA lane's three-stage door (signed decision #4) ---

// POST consent-ask — a REAL turn through the being's own stack (may ignite:
// the operator just asked). 'unclear' records nothing and may be re-asked;
// a DECLINE closes the proposal and is never re-asked.
router.post('/:neumaId/proposals/:proposalId/consent-ask', async (req, res) => {
  const { neumaId, proposalId } = req.params;
  if (!(await assertNeumaOwner(req, res, neumaId))) return;
  try {
    const out = await askDnaConsent(neumaId, proposalId);
    log.info('dna consent asked', { neumaId, proposalId, outcome: out.outcome });
    res.json(out);
  } catch (error) {
    const status = { 'not-found': 404, 'wrong-status': 409 }[error.code] || 500;
    res.status(status).json({ error: error.message });
  }
});

// GET sign-message — the single-use challenge (≤10 min), digests bound to
// the DNA as it stands NOW.
router.get('/:neumaId/proposals/:proposalId/sign-message', async (req, res) => {
  const { neumaId, proposalId } = req.params;
  if (!(await assertNeumaOwner(req, res, neumaId))) return;
  try {
    res.json(await issueDnaSignature(neumaId, proposalId));
  } catch (error) {
    const status = { 'not-found': 404, 'wrong-status': 409, 'consent-missing': 409, invalid: 400 }[error.code] || 500;
    res.status(status).json({ error: error.message });
  }
});

// POST apply-dna {signature} — every refusal is named; the amendment entry
// carries the whole evidence.
router.post('/:neumaId/proposals/:proposalId/apply-dna', async (req, res) => {
  const { neumaId, proposalId } = req.params;
  if (!(await assertNeumaOwner(req, res, neumaId))) return;
  try {
    const out = await applyDnaProposal(neumaId, proposalId, { signature: req.body?.signature });
    log.info('dna amendment applied', { neumaId, proposalId, by: out.amendment.by });
    res.json(out);
  } catch (error) {
    const status = {
      'not-found': 404,
      'wrong-status': 409,
      'consent-missing': 409,
      'no-challenge': 409,
      expired: 410,
      'stale-prior': 409,
      'patch-mismatch': 409,
      'bad-signature': 400,
      'wrong-wallet': 403,
      protected: 403,
      'no-owner': 500,
    }[error.code] || 500;
    res.status(status).json({ error: error.message });
  }
});

export default router;
