// The operator-approved forge transaction.
//
// One branded process operation is minted at the turn boundary and owns every
// immutable input for the whole forge: the server's own training seed, the
// clean source proof, the packed execution authority, the resolved plan, and
// the target+snapshot owner. Approval binds that exact plan to one single-use
// token. Launch journals and consumes the operator's decision BEFORE the first
// source, model, or process side effect, then adopts the GPU lease, the disk
// quota bound to that lease's job identity, and the staged corpus — all of them
// or none of them.

import { canonicalAuthoritySha256 } from '../../core/shared/plain-data-canonical.js';
import { trainingOperationConfig } from '../../core/refinement/training-authority-contract.js';
import { getConfig } from './llm-provider.js';
import { activeLaunchConfig } from './llama-server-supervisor.js';
import { adapterBindingContext } from './refinement-trainer-contract.js';
import { codedTrainingError } from './refinement-training-errors.js';
import { createRefinementProcessOperation } from './refinement-process-operation.js';
import { refinementAuthoritySha256 } from './refinement-transaction-context.js';
import { openRefinementSourceAuthority } from './refinement-source-authority.js';
import {
  closeRefinementExecutionAuthority,
  openRefinementExecutionAuthority,
  retryRefinementExecutionAuthorityCleanup,
} from './refinement-execution-authority.js';
import { resolveTrainingPlan } from './refinement-training-plan.js';
import { refinementTrainingAuthority } from './refinement-training-authority.js';
import {
  prepareTrainingResourceReservation,
  trainingResourceReservationOperation,
  verifyPreparedTrainingResourceReservation,
  verifyTrainingResourceReservation,
} from './refinement-training-resource-reservation.js';
import {
  assertRefinementTrainingLaunchAuthority,
  closeRefinementTrainingLaunchAuthority,
  consumeRefinementTrainingApproval,
  issueRefinementTrainingApproval,
} from './refinement-training-launch-transaction.js';
import { acquireRefinementGpuReservation } from './refinement-gpu-reservation.js';
import { reserveRefinementTrainingDisk } from './refinement-training-reservation.js';
import {
  openRefinementTrainingCorpusAuthority,
  retryRefinementTrainingCorpusCleanup,
} from './refinement-training-corpus-authority.js';
import {
  finishActiveTraining,
  transferTrainingResourceReservation,
} from './refinement-active-training-token.js';
import { FORGE_MAX_DURATION_MS } from './refinement-training-watchdog.js';

const MAX_TRAINING_SEED = 0xffff_ffff;
const APPROVAL_TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const APPROVAL_TOKEN_DOMAIN = Object.freeze({
  domain: 'neuma.refinement.training-approval-token',
  schemaVersion: 1,
});

const fail = (code, diagnostic) => codedTrainingError(code, diagnostic);
const combine = (primary, cleanup, label) =>
  new AggregateError([primary, cleanup], `${label} and cleanup failed`);

/** The exact one-way digest the launch transaction binds its persisted token to. Pure. */
const approvalTokenSha256 = (token) => {
  if (typeof token !== 'string' || !APPROVAL_TOKEN.test(token)) {
    throw fail('TRAINING_APPROVAL_MISMATCH', 'APPROVAL_TOKEN_INVALID');
  }
  return canonicalAuthoritySha256(token, APPROVAL_TOKEN_DOMAIN);
};

/** The same operator identity the approval store and the rig lease agree on. Pure. */
const operatorWalletSha256 = (wallet) => {
  if (typeof wallet !== 'string' || !wallet.trim()
    || Buffer.byteLength(wallet, 'utf8') > 1024) {
    throw fail('TRAINING_APPROVAL_MISMATCH', 'OPERATOR_WALLET_REQUIRED');
  }
  return refinementAuthoritySha256(wallet, 'neuma.refinement.operator-wallet');
};

/** Read the server-owned training operation configuration. impure. */
const currentOperationConfig = () => trainingOperationConfig({
  env: process.env,
  provider: getConfig().provider,
  launchConfig: activeLaunchConfig(process.env),
});

/**
 * The forge seed is the server's own. It is read from the exact operation
 * configuration the plan resolver will bind into its training budget, so the
 * execution envelope can be sealed around it before the plan exists.
 */
const trainingSeedFor = (operationConfig) => {
  const configured = operationConfig.environment.NEUMA_REFINEMENT_SEED;
  const seed = configured == null || configured === '' ? 1 : Number(configured);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_TRAINING_SEED) {
    throw fail('INVALID_TRAINING_CONFIG', 'TRAINING_SEED_INVALID');
  }
  return seed;
};

const closeExecutionAuthority = async (authority, operation) => {
  const closed = await closeRefinementExecutionAuthority(authority, operation);
  if (closed.ok) return;
  const retried = await retryRefinementExecutionAuthorityCleanup(
    closed.cleanupAuthority,
    operation,
  );
  if (!retried.ok) {
    throw fail('TRAINING_EXECUTION_CLEANUP_REQUIRED', 'EXECUTION_CLEANUP_INCOMPLETE');
  }
};

const afterExecutionCleanup = async (primary, executionAuthority, operation) => {
  try { await closeExecutionAuthority(executionAuthority, operation); }
  catch (cleanup) { return combine(primary, cleanup, 'training plan resolution'); }
  return primary;
};

/** Own the seed, source, runtime, plan, and target snapshot under one operation. impure. */
const resolveOwnedTrainingPlan = async (start, operation) => {
  const operationConfig = currentOperationConfig();
  const trainingSeed = trainingSeedFor(operationConfig);
  const sourceAuthority = await openRefinementSourceAuthority({ operation });
  const opened = await openRefinementExecutionAuthority({
    operation,
    sourceAuthority,
    trainingSeed,
  });
  if (!opened.ok) {
    throw fail(opened.errorCode ?? 'TRAINING_SOURCE_UNAVAILABLE', 'EXECUTION_UNAVAILABLE');
  }
  const executionAuthority = opened.authority;
  let resolved;
  try {
    resolved = await resolveTrainingPlan({
      neumaId: start.neumaId,
      ceremonyId: start.ceremonyId,
      servingModel: start.servingModel,
      approvedScales: start.approvedScales,
      operation,
      operationConfig,
      sourceAuthority,
      executionAuthority,
    });
  } catch (error) {
    throw await afterExecutionCleanup(error, executionAuthority, operation);
  }
  // The resolver answers a cleanup-owning refusal instead of throwing when the
  // snapshot owner could not be acquired or released; it is still a refusal.
  if (resolved?.ok === false) {
    throw await afterExecutionCleanup(
      fail(resolved.errorCode ?? 'TRAINING_BASE_UNAVAILABLE', 'PLAN_ACQUISITION_INCOMPLETE'),
      executionAuthority,
      operation,
    );
  }
  return resolved;
};

/**
 * Resolve, own, and bind one exact plan to a single-use operator approval.
 * The reservation keeps every resolved owner alive for the approval's TTL, so
 * launch never re-resolves and never re-reserves what the operator approved.
 */
export const prepareRefinementTrainingApproval = async (start) => {
  const walletSha256 = operatorWalletSha256(start.operatorWallet);
  const controller = new AbortController();
  const operation = createRefinementProcessOperation({
    signal: controller.signal,
    timeoutMs: FORGE_MAX_DURATION_MS,
  });
  let lease;
  try {
    lease = await refinementTrainingAuthority.reservePlan({
      neumaId: start.neumaId,
      ceremonyId: start.ceremonyId,
      operatorWalletSha256: walletSha256,
      controller,
    });
  } catch (error) {
    // The rig is already owned: this turn's operation never becomes anyone's
    // authority, so its deadline is retired here rather than left running.
    controller.abort();
    throw error;
  }
  let reservation = null;
  let retained = false;
  let result;
  let primary = null;
  try {
    const plan = await resolveOwnedTrainingPlan(start, operation);
    reservation = prepareTrainingResourceReservation({ plan, operation });
    const planAuthority = await verifyPreparedTrainingResourceReservation(
      reservation,
      operation,
    );
    const issued = await issueRefinementTrainingApproval({
      planAuthority,
      operatorWallet: start.operatorWallet,
      operation,
    });
    await refinementTrainingAuthority.retainPlan(lease, {
      reservation,
      approvalTokenSha256: approvalTokenSha256(issued.approvalToken),
      expiresAt: issued.expiresAt,
    });
    retained = true;
    result = Object.freeze({
      plan: plan.public,
      approvalToken: issued.approvalToken,
      expiresAt: issued.expiresAt,
    });
  } catch (error) {
    primary = error;
  }
  if (!retained) {
    try { await refinementTrainingAuthority.releasePlan(lease, reservation); }
    catch (cleanup) {
      primary = primary ? combine(primary, cleanup, 'training approval') : cleanup;
    }
  }
  if (primary) throw primary;
  return result;
};

/** Journal and consume the decision, then read and close its launch authority. impure. */
const consumeOperatorDecision = async (start, operation) => {
  const authority = await consumeRefinementTrainingApproval({
    neumaId: start.neumaId,
    ceremonyId: start.ceremonyId,
    trainingPlanSha256: start.trainingPlanSha256,
    approvalToken: start.approvalToken,
    operatorWallet: start.operatorWallet,
    operation,
  });
  let projection;
  let primary = null;
  try { projection = assertRefinementTrainingLaunchAuthority(authority, operation); }
  catch (error) { primary = error; }
  try { closeRefinementTrainingLaunchAuthority(authority, operation); }
  catch (cleanup) {
    primary = primary ? combine(primary, cleanup, 'training launch authority') : cleanup;
  }
  if (primary) throw primary;
  return projection;
};

/** Recompute the whole approval plan against the journalled decision record. Pure. */
const bindingFor = (plan, decision) => {
  const base = plan.targetTrainingBase;
  try {
    return adapterBindingContext({
      ceremony: decision.record,
      corpus: plan.corpus,
      config: plan.config,
      targetServingModel: base.targetServingModel,
      targetServingArtifactSha256: base.targetServingArtifactSha256,
      baseModelIdentitySha256: base.baseModelIdentitySha256,
      servingLineageSha256: base.servingLineageSha256,
      snapshotManifestSha256: plan.targetTrainingSnapshot.snapshot.manifestSha256,
      targetTrainingBaseAuthoritySha256:
        plan.targetTrainingSnapshot.targetTrainingBaseAuthoritySha256,
      lineageConfigSha256: base.lineageConfigSha256,
      lineageConfigSourceIdentitySha256: base.lineageConfigSourceIdentitySha256,
      lineageConfigSourceCommit: base.lineageConfigSourceCommit,
      lineageConfigSourceMode: base.lineageConfigSourceMode,
      lineageConfigObjectId: base.lineageConfigObjectId,
      approvedScales: plan.approvedScales,
      adapterId: plan.adapterId,
      trainingPlanSha256: decision.trainingPlanSha256,
      operatorDecisionSha256: decision.operatorDecisionSha256,
      ...plan.sourceIdentity,
    });
  } catch (error) {
    throw Object.assign(
      fail('TRAINING_APPROVAL_MISMATCH', 'ADAPTER_BINDING_CONTEXT_INVALID'),
      { cause: error },
    );
  }
};

const activeMetadata = (plan, decision, operation) => Object.freeze({
  ceremonyApprovalSha256: decision.record.consent?.ceremonyApprovalSha256,
  ceremonyId: decision.ceremonyId,
  neumaId: decision.neumaId,
  operatorDecisionSha256: decision.operatorDecisionSha256,
  signal: operation.signal,
  targetTrainingSnapshotAuthoritySha256: plan.targetTrainingSnapshotAuthority.sha256,
  trainingPlanSha256: plan.approval.trainingPlanSha256,
});

/** Release a partial acquisition in reverse order, reporting every cleanup failure. */
const releaseAcquired = async (acquired, primary) => {
  const failures = [];
  for (const entry of acquired) {
    try { await entry.close(); }
    catch (error) { failures.push(error); }
  }
  if (!failures.length) return primary;
  return combine(
    primary,
    new AggregateError(failures, 'forge resource cleanup failed'),
    'forge resource acquisition',
  );
};

/**
 * The GPU lease is taken first because its jobSha256 is the identity the disk
 * quota binds to. The transfer adopts the corpus, the lease, and the quota into
 * the active token atomically; a partial acquisition never reaches it.
 */
const adoptForgeResources = async ({
  reservation,
  tokenSha256,
  plan,
  decision,
  operation,
}) => {
  const trainingPlanSha256 = plan.approval.trainingPlanSha256;
  const acquired = [];
  let gpuReservation;
  let diskReservation;
  let corpusAuthority;
  try {
    const gpu = await acquireRefinementGpuReservation({ trainingPlanSha256, operation });
    if (!gpu.ok) {
      acquired.unshift({ close: () => gpu.cleanup.close() });
      throw fail(gpu.errorCode ?? 'TRAINING_GPU_BUSY', 'GPU_RESERVATION_UNAVAILABLE');
    }
    gpuReservation = gpu.reservation;
    acquired.unshift({ close: () => gpuReservation.close() });
    const disk = await reserveRefinementTrainingDisk({
      trainingPlanSha256,
      jobSha256: gpuReservation.gpuLease.jobSha256,
      reservationBytes: plan.config.executionEnvelope.resources.maxWorktreeBytes,
      operation,
    });
    if (!disk.ok) {
      acquired.unshift({ close: () => disk.cleanup.close() });
      throw fail(disk.errorCode ?? 'INSUFFICIENT_DISK', 'DISK_RESERVATION_UNAVAILABLE');
    }
    diskReservation = disk.reservation;
    acquired.unshift({ close: () => diskReservation.close() });
    const corpus = await openRefinementTrainingCorpusAuthority({
      renderedCorpus: plan.renderedCorpus,
      operation,
    });
    if (!corpus.ok) {
      if (corpus.cleanupAuthority) {
        acquired.unshift({
          close: async () => {
            const retried = await retryRefinementTrainingCorpusCleanup(
              corpus.cleanupAuthority,
              operation,
            );
            if (!retried.ok) throw fail(retried.errorCode, 'CORPUS_CLEANUP_INCOMPLETE');
          },
        });
      }
      throw fail(corpus.errorCode ?? 'TRAINING_SOURCE_CHANGED', 'CORPUS_UNAVAILABLE');
    }
    corpusAuthority = corpus.authority;
  } catch (error) {
    throw await releaseAcquired(acquired, error);
  }
  return transferTrainingResourceReservation(reservation, {
    approvalTokenSha256: tokenSha256,
    corpusAuthority,
    gpuReservation,
    diskReservation,
    metadata: activeMetadata(plan, decision, operation),
  });
};

const afterActiveCleanup = async (primary, token) => {
  try { await finishActiveTraining(token); }
  catch (cleanup) { return combine(primary, cleanup, 'active forge activation'); }
  return primary;
};

const adoptApprovedForge = async (start, claim, tokenSha256) => {
  const { reservation } = refinementTrainingAuthority.claimedPlan(claim);
  const operation = trainingResourceReservationOperation(reservation);
  // Nothing above this line touches source, model, or process state: the rig
  // claim is in-memory bookkeeping the failed claim gives straight back.
  const decision = await consumeOperatorDecision(start, operation);
  const plan = await verifyTrainingResourceReservation(reservation, tokenSha256);
  if (decision.trainingPlanSha256 !== plan.approval.trainingPlanSha256
    || decision.executionEnvelopeSha256 !== plan.config.executionEnvelopeSha256) {
    throw fail('TRAINING_APPROVAL_MISMATCH', 'DECISION_PLAN_MISMATCH');
  }
  const bindingContext = bindingFor(plan, decision);
  const token = await adoptForgeResources({
    reservation, tokenSha256, plan, decision, operation,
  });
  try {
    await refinementTrainingAuthority.activate(claim, token);
  } catch (error) {
    throw await afterActiveCleanup(error, token);
  }
  return Object.freeze({
    token, plan, decision, bindingContext, operation,
  });
};

/**
 * Validate the caller's token and plan digest, consume that approval exactly
 * once, and hand back one activated forge whose resources are already adopted.
 */
export const openRefinementTrainingLaunch = async (start) => {
  const tokenSha256 = approvalTokenSha256(start.approvalToken);
  const claim = await refinementTrainingAuthority.claimPlan({
    neumaId: start.neumaId,
    ceremonyId: start.ceremonyId,
    approvalTokenSha256: tokenSha256,
  });
  let launched;
  let primary = null;
  try { launched = await adoptApprovedForge(start, claim, tokenSha256); }
  catch (error) { primary = error; }
  if (primary) {
    try { await refinementTrainingAuthority.failClaim(claim); }
    catch (cleanup) { primary = combine(primary, cleanup, 'training launch'); }
    throw primary;
  }
  return launched;
};
