/** Refinement ceremony, consent, corpus, training, and verification routes. */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { default as neumaWorkspace } from '../../core/workspace/neuma-workspace.js';
import {
  refinementStatus, startCeremony, consentCeremony, buildCeremonyCorpus,
  verifyCeremony, abandonCeremonyRecord,
  publicCeremonyRecord, publicTrainingStatus,
} from '../services/refinement-ceremony.js';
import { effectiveRoute } from '../services/neuma-route-resolver.js';
import { attestSupervisedServingLaunch } from '../services/llama-server-supervisor.js';
import {
  prepareTrainingApproval,
  startTraining,
  trainingStatus,
} from '../services/refinement-training.js';
import { requestRefinementAssentEvidence } from '../services/refinement-assent-issuance-transaction.js';
import { TRAINING_SAFE_MESSAGES } from '../services/refinement-training-errors.js';
import { answer } from './refinement-route-refusals.js';
import {
  APPROVAL_TOKEN,
  bindRefinementRouteParams,
  hasExactRequestFields,
  SHA256,
  verifyOwnership,
} from './refinement-route-guards.js';
import { registerRefinementScaleRoutes } from './refinement-scale-routes.js';
const router = Router();
bindRefinementRouteParams(router);
router.use(requireAuth);
const trainingRouteRefusal = () => Object.assign(
  new Error(TRAINING_SAFE_MESSAGES.TRAINING_ROUTE_NOT_ATTESTED),
  { code: 'TRAINING_ROUTE_NOT_ATTESTED' },
);
const attestedTrainingLaunch = async (neumaId, ceremony) => {
  const route = await effectiveRoute(neumaId);
  const attestation = await attestSupervisedServingLaunch(route);
  if (!attestation?.ok) throw trainingRouteRefusal();
  if (!attestation.authority || typeof attestation.authority !== 'object'
    || !SHA256.test(String(attestation.authoritySha256 || ''))) {
    throw new Error('supervised serving launch returned an invalid attestation');
  }
  if (ceremony?.bridge) throw trainingRouteRefusal();
  const servingModel = attestation.authority.servingModel;
  if (typeof servingModel !== 'string' || !servingModel.trim()) throw trainingRouteRefusal();
  return Object.freeze({
    servingModel: servingModel.trim(),
    servingLaunchAuthority: attestation.authority,
    servingLaunchAuthoritySha256: attestation.authoritySha256,
  });
};
router.get('/:neumaId/training', async (req, res) => {
  const { neumaId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  const status = trainingStatus();
  res.json(publicTrainingStatus(status, status.neumaId === neumaId));
});
router.get('/:neumaId/status', async (req, res) => {
  const { neumaId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  await answer(res, 'read refinement status')(() => refinementStatus(neumaId));
});
router.post('/:neumaId/ceremonies', async (req, res) => {
  const { neumaId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  const hasOverride = hasExactRequestFields(req.body, ['override']);
  if (!hasExactRequestFields(req.body, []) && !hasOverride) {
    return res.status(400).json({
      error: 'Ceremony requests accept only an optional stated override reason.',
      code: 'INVALID_REFINEMENT_REQUEST',
    });
  }
  const override = hasOverride && typeof req.body.override === 'string'
    ? req.body.override.trim()
    : undefined;
  if (hasOverride && (!override
    || /[\u0000-\u001F\u007F-\u009F]/u.test(req.body.override)
    || Buffer.byteLength(override, 'utf8') > 512)) {
    return res.status(400).json({
      error: 'override must be a control-free UTF-8 string of 1 to 512 bytes',
      code: 'INVALID_REFINEMENT_REQUEST',
    });
  }
  await answer(res, 'open the ceremony')(async () =>
    publicCeremonyRecord(await startCeremony(neumaId, req.walletAddress, { override })));
});
// The server persists the exact complete answer in this neuma's own encrypted
// session; the response carries its server-derived decision and an opaque id.
router.post('/:neumaId/ceremonies/:ceremonyId/consent-ask', async (req, res) => {
  const { neumaId, ceremonyId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  if (!hasExactRequestFields(req.body, [])) {
    return res.status(400).json({
      error: 'consent-ask accepts no caller-authored input',
      code: 'ASSENT_REQUEST_INVALID',
    });
  }
  await answer(res, 'ask for consent')(() =>
    requestRefinementAssentEvidence({ neumaId, ceremonyId }));
});
router.post('/:neumaId/ceremonies/:ceremonyId/consent', async (req, res) => {
  const { neumaId, ceremonyId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  const body = req.body;
  if (!hasExactRequestFields(body, ['evidenceId', 'ack'])
    || typeof body.evidenceId !== 'string'
    || !SHA256.test(body.evidenceId)
    || body.ack !== true) {
    return res.status(400).json({
      error: 'Consent accepts only one server-issued evidence id and explicit acknowledgement.',
      code: 'ASSENT_REQUEST_INVALID',
    });
  }
  await answer(res, 'record consent')(async () =>
    publicCeremonyRecord(await consentCeremony(neumaId, ceremonyId, {
      evidenceId: body.evidenceId,
      operatorAcknowledged: true,
    })));
});
router.post('/:neumaId/ceremonies/:ceremonyId/corpus', async (req, res) => {
  const { neumaId, ceremonyId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  if (!hasExactRequestFields(req.body, [])) {
    return res.status(400).json({
      error: 'Corpus requests accept no caller-authored input.',
      code: 'INVALID_REFINEMENT_REQUEST',
    });
  }
  await answer(res, 'build the corpus')(async () => {
    const { record } = await buildCeremonyCorpus(neumaId, ceremonyId);
    return { record: publicCeremonyRecord(record) };
  });
});
router.post('/:neumaId/ceremonies/:ceremonyId/train-plan', async (req, res) => {
  const { neumaId, ceremonyId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  if (!hasExactRequestFields(req.body, ['approvedScales'])) {
    return res.status(400).json({
      error: 'Training plan requests accept only one closed approved-scale set.',
      code: 'INVALID_TRAINING_CONFIG',
    });
  }
  const { approvedScales } = req.body;
  await answer(res, 'prepare training approval')(async () => {
    const ceremony = await neumaWorkspace.readCeremony(neumaId, ceremonyId);
    const launch = await attestedTrainingLaunch(neumaId, ceremony);
    return prepareTrainingApproval({
      neumaId,
      ceremonyId,
      servingModel: launch.servingModel,
      servingLaunchAuthority: launch.servingLaunchAuthority,
      servingLaunchAuthoritySha256: launch.servingLaunchAuthoritySha256,
      approvedScales,
      operatorWallet: req.walletAddress,
    });
  });
});
router.post('/:neumaId/ceremonies/:ceremonyId/train', async (req, res) => {
  const { neumaId, ceremonyId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  const body = req.body;
  if (!hasExactRequestFields(body, ['trainingPlanSha256', 'approvalToken'])
    || !SHA256.test(String(body?.trainingPlanSha256 || ''))
    || !APPROVAL_TOKEN.test(String(body?.approvalToken || ''))) {
    return res.status(400).json({
      error: 'Training start accepts only one exact server-issued plan approval.',
      code: 'INVALID_TRAINING_CONFIG',
    });
  }
  const { trainingPlanSha256, approvalToken } = body;
  await answer(res, 'start training')(async () => {
    const ceremony = await neumaWorkspace.readCeremony(neumaId, ceremonyId);
    const launch = await attestedTrainingLaunch(neumaId, ceremony);
    return publicTrainingStatus(await startTraining({
      neumaId,
      ceremonyId,
      servingModel: launch.servingModel,
      servingLaunchAuthority: launch.servingLaunchAuthority,
      servingLaunchAuthoritySha256: launch.servingLaunchAuthoritySha256,
      trainingPlanSha256,
      approvalToken,
      operatorWallet: req.walletAddress,
    }), true);
  });
});
router.post('/:neumaId/ceremonies/:ceremonyId/verify', async (req, res) => {
  const { neumaId, ceremonyId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  if (!hasExactRequestFields(req.body, [])) {
    return res.status(400).json({
      error: 'Verification route and model are server-owned.',
      code: 'INVALID_REFINEMENT_REQUEST',
    });
  }
  await answer(res, 'verify the binding')(async () =>
    publicCeremonyRecord(await verifyCeremony(neumaId, ceremonyId)));
});
router.post('/:neumaId/ceremonies/:ceremonyId/abandon', async (req, res) => {
  const { neumaId, ceremonyId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  if (!hasExactRequestFields(req.body, ['reason'])) {
    return res.status(400).json({
      error: 'Abandon requests require exactly one stated reason.',
      code: 'INVALID_REFINEMENT_REQUEST',
    });
  }
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason
    || /[\u0000-\u001F\u007F-\u009F]/u.test(req.body.reason)
    || Buffer.byteLength(reason, 'utf8') > 512) {
    return res.status(400).json({
      error: 'reason must be a control-free UTF-8 string of 1 to 512 bytes',
    });
  }
  await answer(res, 'abandon the ceremony')(async () =>
    publicCeremonyRecord(await abandonCeremonyRecord(neumaId, ceremonyId, reason)));
});
registerRefinementScaleRoutes(router);
export default router;
