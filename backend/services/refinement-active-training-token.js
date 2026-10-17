import {
  closeRefinementExecutionAuthority,
  retryRefinementExecutionAuthorityCleanup,
  verifyRefinementExecutionAuthority,
} from './refinement-execution-authority.js';
import {
  closeTargetTrainingSnapshotAuthority,
  retryTargetTrainingSnapshotCleanup,
  verifyTargetTrainingSnapshotAuthority,
} from './refinement-target-snapshot-authority.js';
import {
  closeRefinementTrainingCorpusAuthority,
  retryRefinementTrainingCorpusCleanup,
  verifyRefinementTrainingCorpusAuthority,
} from './refinement-training-corpus-authority.js';
import {
  trainingResourceReservationPlan,
  transferTrainingResourceReservationOwnership,
  verifyTrainingResourceReservation,
} from './refinement-training-resource-reservation.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const METADATA_FIELDS = Object.freeze([
  'ceremonyApprovalSha256',
  'ceremonyId',
  'neumaId',
  'operatorDecisionSha256',
  'signal',
  'targetTrainingSnapshotAuthoritySha256',
  'trainingPlanSha256',
]);
const ACTIVE = new WeakMap();

const unionEntry = (authority, label, { verify, close, retry }) => {
  let cleanupAuthority = null;
  const entry = {
    authority,
    label,
    closed: false,
    verify: (operation) => verify(entry.authority, operation),
    close: async (operation) => {
      const result = cleanupAuthority
        ? await retry(cleanupAuthority, operation)
        : await close(entry.authority, operation);
      if (result?.ok !== true) {
        cleanupAuthority = result?.cleanupAuthority ?? cleanupAuthority;
        throw Object.assign(new Error(`${label} cleanup requires retry`), {
          code: result?.errorCode ?? 'TRAINING_EXECUTION_CLEANUP_REQUIRED',
        });
      }
      cleanupAuthority = null;
      return result.closed !== false;
    },
  };
  return entry;
};

const methodEntry = (authority, label) => {
  if (!authority || typeof authority.verify !== 'function' || typeof authority.close !== 'function') {
    throw new Error(`${label} is not a held authority`);
  }
  return {
    authority,
    label,
    closed: false,
    verify: (operation) => authority.verify(operation),
    close: () => authority.close(),
  };
};

const exactMetadata = (value, operation) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== METADATA_FIELDS.join('\0')
    || !ID.test(String(value.neumaId || '')) || !ID.test(String(value.ceremonyId || ''))
    || value.signal !== operation.signal) {
    throw new Error('active training metadata is invalid');
  }
  for (const field of [
    'ceremonyApprovalSha256', 'operatorDecisionSha256',
    'targetTrainingSnapshotAuthoritySha256', 'trainingPlanSha256',
  ]) {
    if (!SHA256.test(String(value[field] || ''))) throw new Error(`${field} must be sha256`);
  }
  return Object.freeze(Object.fromEntries(METADATA_FIELDS.map((field) => [field, value[field]])));
};

const cleanupEntries = async (entries, operation, label) => {
  const failures = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.closed) continue;
    try {
      await entry.close(operation);
      entry.closed = true;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, `${label} cleanup failed`);
};

const verifyEntries = async (entries, operation) => {
  for (const entry of entries) {
    if (entry.closed) throw new Error(`${entry.label} is already closed`);
    await entry.verify(operation);
  }
};

const planEntries = (owner) => [
  unionEntry(owner.executionAuthority, 'executionAuthority', {
    verify: (authority, operation) => verifyRefinementExecutionAuthority(
      authority,
      owner.plan.config.executionEnvelope,
      operation,
    ),
    close: closeRefinementExecutionAuthority,
    retry: retryRefinementExecutionAuthorityCleanup,
  }),
  unionEntry(owner.targetTrainingSnapshotAuthority, 'targetTrainingSnapshotAuthority', {
    verify: verifyTargetTrainingSnapshotAuthority,
    close: closeTargetTrainingSnapshotAuthority,
    retry: retryTargetTrainingSnapshotCleanup,
  }),
];

const corpusEntry = (authority) => unionEntry(authority, 'corpusAuthority', {
  verify: verifyRefinementTrainingCorpusAuthority,
  close: closeRefinementTrainingCorpusAuthority,
  retry: retryRefinementTrainingCorpusCleanup,
});

const closePrepared = async (authorities, operation, primary) => {
  const entries = authorities.filter(({ authority }) => Boolean(authority)).map(({ authority, label }) =>
    (label === 'corpusAuthority' ? corpusEntry(authority) : methodEntry(authority, label)));
  try {
    await cleanupEntries(entries, operation, 'failed active training acquisition');
  } catch (cleanupError) {
    throw new AggregateError([primary, cleanupError], 'active training acquisition and cleanup failed', { cause: cleanupError });
  }
  throw primary;
};

/** Atomically adopt one approved plan plus its corpus, GPU, and disk owners. */
export const transferTrainingResourceReservation = async (
  reservation,
  {
    approvalTokenSha256,
    corpusAuthority,
    gpuReservation,
    diskReservation,
    metadata,
  },
) => {
  const plan = trainingResourceReservationPlan(reservation, approvalTokenSha256);
  const operation = plan.operation;
  let gpuOwned = null;
  let diskOwned = null;
  let owner = null;
  try {
    const normalized = exactMetadata(metadata, operation);
    if (normalized.trainingPlanSha256 !== plan.approval.trainingPlanSha256
      || normalized.targetTrainingSnapshotAuthoritySha256
        !== plan.targetTrainingSnapshotAuthority.sha256
      || corpusAuthority?.sha256 !== plan.renderedCorpus.sha256
      || corpusAuthority?.sampleCount !== plan.renderedCorpus.sampleCount
      || gpuReservation?.gpuLease?.trainingPlanSha256 !== normalized.trainingPlanSha256
      || diskReservation?.trainingPlanSha256 !== normalized.trainingPlanSha256
      || diskReservation?.jobSha256 !== gpuReservation?.gpuLease?.jobSha256) {
      throw new Error('active training resource identities do not match');
    }
    await verifyTrainingResourceReservation(reservation, approvalTokenSha256);
    await verifyRefinementTrainingCorpusAuthority(corpusAuthority, operation);
    await gpuReservation.verify(operation);
    await diskReservation.verify(operation);
    owner = await transferTrainingResourceReservationOwnership(
      reservation,
      approvalTokenSha256,
    );
    gpuOwned = gpuReservation.transfer();
    diskOwned = diskReservation.transfer();
    const entries = [
      ...planEntries(owner),
      corpusEntry(corpusAuthority),
      methodEntry(gpuOwned, 'gpuReservation'),
      methodEntry(diskOwned, 'diskReservation'),
    ];
    const resources = Object.freeze({
      operation,
      executionAuthority: owner.executionAuthority,
      targetTrainingSnapshotAuthority: owner.targetTrainingSnapshotAuthority,
      corpusAuthority,
      gpuReservation: gpuOwned,
      diskReservation: diskOwned,
    });
    const state = {
      phase: 'active',
      operation,
      entries,
      resources,
      cleanupPromise: null,
    };
    const token = Object.freeze({
      kind: 'refinement-active-training-token-v1',
      ...normalized,
      get state() { return state.phase; },
    });
    ACTIVE.set(token, state);
    return token;
  } catch (error) {
    const prepared = [
      { authority: corpusAuthority, label: 'corpusAuthority' },
      { authority: gpuOwned ?? gpuReservation, label: 'gpuReservation' },
      { authority: diskOwned ?? diskReservation, label: 'diskReservation' },
    ];
    if (!owner) return closePrepared(prepared, operation, error);
    const all = [...planEntries(owner), ...prepared.map(({ authority, label }) =>
      (label === 'corpusAuthority' ? corpusEntry(authority) : methodEntry(authority, label)))];
    try {
      await cleanupEntries(all, operation, 'failed active training transfer');
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'active training transfer and cleanup failed', { cause: cleanupError });
    }
    throw error;
  }
};

export const activeTrainingResources = (token) => {
  const state = ACTIVE.get(token);
  if (!state || state.phase !== 'active') throw new Error('active training resources are unavailable');
  return state.resources;
};

export const verifyActiveTrainingResources = async (token) => {
  const state = ACTIVE.get(token);
  if (!state || state.phase !== 'active') throw new Error('active training resources are unavailable');
  await verifyEntries(state.entries, state.operation);
  return state.resources;
};

export const finishActiveTraining = (token) => {
  const state = ACTIVE.get(token);
  if (!state) return Promise.reject(new Error('active training token is unknown'));
  if (state.phase === 'closed') return Promise.resolve(false);
  if (state.cleanupPromise) return state.cleanupPromise;
  if (!['active', 'cleanup-failed'].includes(state.phase)) {
    return Promise.reject(new Error(`active training cleanup is ${state.phase}`));
  }
  state.phase = 'closing';
  state.cleanupPromise = cleanupEntries(
    state.entries,
    state.operation,
    'active training resources',
  ).then(
    () => {
      state.entries = null;
      state.resources = null;
      state.operation = null;
      state.phase = 'closed';
      state.cleanupPromise = null;
      return true;
    },
    (error) => {
      state.phase = 'cleanup-failed';
      state.cleanupPromise = null;
      throw error;
    },
  );
  return state.cleanupPromise;
};
