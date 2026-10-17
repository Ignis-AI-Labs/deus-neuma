import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { refinementCustodyMatches } from '../../core/refinement/training-authority-contract.js';
import { createLogger } from './logger.js';
import {
  finishActiveTraining,
  verifyActiveTrainingResources,
} from './refinement-active-training-token.js';
import {
  releaseTrainingResourceReservation,
  retainTrainingResourceReservation,
} from './refinement-training-resource-reservation.js';
import {
  commitRefinementScaleSelection,
  publishCommittedRefinementAdapter,
  reconcilePreparedRefinementPublication,
} from './refinement-publication-transaction.js';
import { openCurrentRefinementRegistryAuthority } from './refinement-registry-authority.js';
import { issueRefinementScaleAuthority } from './refinement-scale-authority.js';
import { assertRefinementSubjectTransaction } from './refinement-subject-transaction-lock.js';
import {
  acquireRefinementTrainedArtifactAuthority,
  retryRefinementTrainedArtifactCleanup,
  transferRefinementTrainedArtifactToPublication,
} from './refinement-trained-artifact-authority.js';

const log = createLogger('RefinementTrainingAuthority');

const codedError = (message, code) => Object.assign(new Error(message), { code });
const jobKey = (neumaId, ceremonyId) => `${neumaId}\u0000${ceremonyId}`;
const exactJob = (value, neumaId, ceremonyId) => value
  && value.neumaId === neumaId
  && value.ceremonyId === ceremonyId;

/**
 * Serialize prepared approval, active forge, cancellation, and publication ownership.
 * All filesystem/GPU owners live in the branded reservation/active-token modules. impure.
 */
export const createTrainingAuthority = () => {
  let tail = Promise.resolve();
  let planning = null;
  let pending = null;
  let active = null;
  let publishedKey = null;
  const blocked = new Set();
  const planStates = new WeakMap();
  const claimStates = new WeakMap();
  const activeStates = new WeakMap();

  const exclusive = (work) => {
    const result = tail.then(work, work);
    tail = result.catch(() => {});
    return result;
  };
  const sweepPending = () => {
    if (pending?.reservation.state === 'reserved') return;
    pending?.controller.abort();
    pending = null;
  };
  const cancelReason = (neumaId, ceremonyId) => Object.freeze({
    code: 'TRAINING_CANCELLED',
    message: 'The operator abandoned this exact refinement ceremony.',
    neumaId,
    ceremonyId,
  });
  const closePending = async (state) => {
    state.controller.abort();
    await releaseTrainingResourceReservation(state.reservation);
  };

  return Object.freeze({
    reservePlan: ({
      neumaId,
      ceremonyId,
      operatorWalletSha256,
      controller,
    }) => exclusive(async () => {
      sweepPending();
      const key = jobKey(neumaId, ceremonyId);
      if (!(controller instanceof AbortController)) {
        throw codedError(
          'Training operation configuration is unavailable.',
          'TRAINING_OPERATION_CHANGED',
        );
      }
      if (planning || active) {
        throw codedError('A refinement plan or forge already owns this rig.', 'TRAINING_INFLIGHT');
      }
      if (blocked.has(key)) {
        throw codedError('The refinement ceremony is closing and cannot plan training.', 'WRONG_PHASE');
      }
      if (pending) {
        if (!exactJob(pending, neumaId, ceremonyId)
          || pending.operatorWalletSha256 !== operatorWalletSha256) {
          throw codedError('A refinement approval already owns this rig.', 'TRAINING_INFLIGHT');
        }
        const superseded = pending;
        pending = null;
        await closePending(superseded);
      }
      const lease = Object.freeze({ kind: 'refinement-training-planning-lease-v1' });
      planStates.set(lease, {
        neumaId,
        ceremonyId,
        operatorWalletSha256,
        controller,
        reservation: null,
        phase: 'planning',
      });
      planning = lease;
      return lease;
    }),

    retainPlan: (lease, {
      reservation,
      approvalTokenSha256,
      expiresAt,
    }) => exclusive(() => {
      const state = planStates.get(lease);
      if (!state || state.phase !== 'planning' || planning !== lease) {
        throw codedError('The refinement plan no longer owns this rig.', 'TRAINING_INFLIGHT');
      }
      retainTrainingResourceReservation(
        reservation,
        { approvalTokenSha256, expiresAt },
      );
      state.reservation = reservation;
      state.approvalTokenSha256 = approvalTokenSha256;
      state.expiresAt = expiresAt;
      state.phase = 'pending';
      pending = state;
      planning = null;
      return true;
    }),

    releasePlan: (lease, reservation = null) => exclusive(async () => {
      const state = planStates.get(lease);
      if (!state || state.phase === 'released' || state.phase === 'active') return false;
      const held = state.reservation ?? reservation;
      if (planning === lease) planning = null;
      if (pending === state) pending = null;
      state.phase = 'released';
      state.controller.abort();
      if (held) await releaseTrainingResourceReservation(held);
      return true;
    }),

    claimPlan: ({ neumaId, ceremonyId, approvalTokenSha256 }) => exclusive(() => {
      sweepPending();
      const key = jobKey(neumaId, ceremonyId);
      if (blocked.has(key)) {
        throw codedError('The refinement ceremony is closing and cannot start training.', 'WRONG_PHASE');
      }
      if (active || planning || !pending
        || !exactJob(pending, neumaId, ceremonyId)
        || pending.approvalTokenSha256 !== approvalTokenSha256
        || pending.phase !== 'pending') {
        throw codedError('The training approval is stale or mismatched.', 'TRAINING_APPROVAL_MISMATCH');
      }
      pending.phase = 'launching';
      const claim = Object.freeze({ kind: 'refinement-training-launch-claim-v1' });
      claimStates.set(claim, pending);
      return claim;
    }),

    claimedPlan: (claim) => {
      const state = claimStates.get(claim);
      if (!state || state.phase !== 'launching') {
        throw codedError('The training approval is stale or mismatched.', 'TRAINING_APPROVAL_MISMATCH');
      }
      return Object.freeze({
        reservation: state.reservation,
        controller: state.controller,
        operatorWalletSha256: state.operatorWalletSha256,
      });
    },

    activate: (claim, activeToken) => exclusive(() => {
      const state = claimStates.get(claim);
      if (!state || state.phase !== 'launching' || pending !== state
        || active || activeToken?.state !== 'active') {
        throw codedError('The training approval is stale or mismatched.', 'TRAINING_APPROVAL_MISMATCH');
      }
      state.phase = 'active';
      state.token = activeToken;
      state.attached = false;
      state.finished = false;
      state.cancelRequested = false;
      state.completion = null;
      pending = null;
      active = activeToken;
      activeStates.set(activeToken, state);
      return activeToken;
    }),

    failClaim: (claim) => exclusive(async () => {
      const state = claimStates.get(claim);
      if (!state || !['launching', 'pending'].includes(state.phase)) return false;
      if (pending === state) pending = null;
      state.phase = 'released';
      await closePending(state);
      return true;
    }),

    attach: (token, jobPromise) => {
      const state = activeStates.get(token);
      if (!state || state.attached) throw new Error('active training token cannot be attached');
      state.attached = true;
      const settle = async (primary = null, value) => {
        let cleanup = null;
        try { await finishActiveTraining(token); } catch (error) { cleanup = error; }
        await exclusive(() => {
          state.finished = true;
          state.phase = 'finished';
          if (active === token) active = null;
        });
        if (primary && cleanup) {
          throw new AggregateError([primary, cleanup], 'training job and cleanup failed');
        }
        if (primary) throw primary;
        if (cleanup) throw cleanup;
        return value;
      };
      state.completion = Promise.resolve(jobPromise).then(
        (value) => settle(null, value),
        (error) => settle(error),
      );
      return state.completion;
    },

    publish: (token, work) => exclusive(async () => {
      const state = activeStates.get(token);
      if (!state || active !== token || state.finished || state.cancelRequested) {
        throw codedError('Training was cancelled before adapter publication.', 'TRAINING_CANCELLED');
      }
      await verifyActiveTrainingResources(token);
      const result = await work();
      publishedKey = jobKey(token.neumaId, token.ceremonyId);
      return result;
    }),

    cancelAndRun: async (neumaId, ceremonyId, work) => {
      const key = jobKey(neumaId, ceremonyId);
      const cancellation = await exclusive(() => {
        sweepPending();
        if (blocked.has(key)) return { closing: true };
        if (publishedKey === key) return { published: true };
        blocked.add(key);
        const activeState = active && activeStates.get(active);
        if (exactJob(activeState, neumaId, ceremonyId) && !activeState.finished) {
          activeState.cancelRequested = true;
          activeState.controller.abort(cancelReason(neumaId, ceremonyId));
          return { completion: activeState.completion };
        }
        if (exactJob(pending, neumaId, ceremonyId)) {
          const state = pending;
          pending = null;
          state.phase = 'released';
          state.controller.abort(cancelReason(neumaId, ceremonyId));
          return { completion: releaseTrainingResourceReservation(state.reservation) };
        }
        const planState = planning && planStates.get(planning);
        if (exactJob(planState, neumaId, ceremonyId)) {
          planState.controller.abort(cancelReason(neumaId, ceremonyId));
        }
        return { completion: null };
      });
      if (cancellation.closing) {
        throw codedError('This refinement ceremony is already closing.', 'WRONG_PHASE');
      }
      if (cancellation.published) {
        throw codedError(
          'Training publication already committed; verify or neutralize the recorded adapter instead of abandoning it.',
          'TRAINING_ALREADY_PUBLISHED',
        );
      }
      try {
        await cancellation.completion;
        return await work();
      } finally {
        await exclusive(() => blocked.delete(key));
      }
    },
  });
};

export const refinementTrainingAuthority = createTrainingAuthority();

/** Adopt the forge's staged output into the publication transaction's own owner. impure. */
const adoptPublicationArtifact = async (artifactAuthority, operation) => {
  const acquired = await acquireRefinementTrainedArtifactAuthority({
    artifactAuthority,
    operation,
  });
  if (!acquired.ok) {
    if (acquired.cleanupAuthority) {
      await retryRefinementTrainedArtifactCleanup(acquired.cleanupAuthority, operation);
    }
    throw codedError(
      'The trained adapter artifact could not be adopted for publication.',
      acquired.errorCode,
    );
  }
  return transferRefinementTrainedArtifactToPublication(acquired.authority, operation);
};

/** Drive one published-but-unattested adapter to the bare base under the held lock. impure. */
const neutralizePublishedAdapter = async ({ transactionOwner, adapterId, operation }) => {
  const subjectAuthority = assertRefinementSubjectTransaction(transactionOwner, operation);
  const registryAuthority = await openCurrentRefinementRegistryAuthority({
    operation,
    subjectAuthority,
  });
  const issued = await issueRefinementScaleAuthority({
    registryAuthority,
    adapterId,
    operatorWalletSha256: null,
    operation,
  });
  return commitRefinementScaleSelection({
    registryAuthority,
    adapterId,
    scale: 0,
    authorityToken: issued.authorityToken,
    operatorWalletSha256: null,
    operation,
  });
};

/**
 * Commit the matching ceremony record before making its adapter launch-eligible.
 * Cancellation and publication share one authority lock, which defines their order. impure.
 */
export const publishTrainingAdapter = ({
  token,
  neumaId,
  ceremonyId,
  adapter,
  training,
  transactionOwner,
  artifactAuthority,
  lineageConfigAuthority,
  operation,
}) => refinementTrainingAuthority.publish(token, async () => {
  const current = await neumaWorkspace.readCeremony(neumaId, ceremonyId);
  if (!current || current.id !== ceremonyId || current.neumaId !== neumaId || current.phase !== 'training') {
    throw codedError('The exact ceremony is no longer in training; adapter publication was refused.', 'WRONG_PHASE');
  }
  const custody = await neumaWorkspace.readRefinementCustodyIdentity(neumaId);
  if (!refinementCustodyMatches(current.custody, custody)) {
    throw codedError(
      'The ceremony subject no longer matches current sovereign DNA; adapter publication was refused.',
      'REFINEMENT_CUSTODY_MISMATCH',
    );
  }
  // Adopted last, and only once every refusal above is behind us: from here
  // the publication transaction owns the artifact and settles it on every
  // path it can take, so nothing earlier may strand a held descriptor.
  const publicationArtifactAuthority = await adoptPublicationArtifact(
    artifactAuthority,
    operation,
  );
  // Ordering is load-bearing, and the transaction is now its sole owner: one
  // PREPARED→COMMITTED journal advances the ceremony to training-published and
  // then appends the registry entry, so an active registry entry never
  // precedes its matching training record even if the process stops between
  // the two writes. Writing that record here first — as the deleted workspace
  // registry required — would both strand a record no registry entry
  // justifies and leave the transaction no ceremony still in training.
  let published;
  try {
    published = await publishCommittedRefinementAdapter({
      transactionOwner,
      ceremonyId,
      adapter,
      training,
      publicationArtifactAuthority,
      lineageConfigAuthority,
      operation,
    });
  } catch (error) {
    // Idempotency read, not a fallback: did this publication already reach its
    // committed journal? An unreadable journal cannot answer that, so it
    // refuses rather than claiming "not published" over a publication that may
    // in fact be durable. There is no ceremony to withdraw on a genuine
    // non-publication — the record only ever advances inside the same journal.
    const recovered = await reconcilePreparedRefinementPublication({
      transactionOwner,
      ceremonyId,
      lineageConfigAuthority,
      operation,
    });
    if (recovered.state !== 'COMMITTED') throw error;
    // Committed, and then refused: the adapter is live carrying an artifact
    // this transaction could no longer attest, so it is driven to the bare
    // base before the original refusal surfaces.
    await neutralizePublishedAdapter({
      transactionOwner,
      adapterId: adapter.id,
      operation,
    }).catch((neutralizeError) =>
      log.error('Could not neutralize changed adapter after publication', {
        neumaId,
        ceremonyId,
        adapterId: adapter.id,
        error: neutralizeError.message,
      }));
    throw error;
  }
  return Object.freeze({ adapter: published.adapter });
});
