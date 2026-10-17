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
  assertRefinementProcessOperation,
  assertRefinementProcessOperationIdentity,
} from './refinement-process-operation.js';
import {
  assertResolvedTrainingPlan,
  projectResolvedTrainingPlan,
} from './refinement-training-plan.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const STATES = new WeakMap();

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

const planEntries = (plan) => [
  unionEntry(plan.executionAuthority, 'executionAuthority', {
    verify: (authority, operation) => verifyRefinementExecutionAuthority(
      authority,
      plan.config.executionEnvelope,
      operation,
    ),
    close: closeRefinementExecutionAuthority,
    retry: retryRefinementExecutionAuthorityCleanup,
  }),
  unionEntry(plan.targetTrainingSnapshotAuthority, 'targetTrainingSnapshotAuthority', {
    verify: verifyTargetTrainingSnapshotAuthority,
    close: closeTargetTrainingSnapshotAuthority,
    retry: retryTargetTrainingSnapshotCleanup,
  }),
];

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

const stateFor = (reservation, operation, phases) => {
  const state = STATES.get(reservation);
  if (!state || state.operation !== operation || !phases.includes(state.phase)) {
    throw new Error('training resource reservation is unavailable');
  }
  return state;
};

const clearExpiry = (state) => {
  clearTimeout(state.timer);
  state.timer = null;
};

const releaseState = (state) => {
  if (state.phase === 'released' || state.phase === 'transferred') return Promise.resolve(false);
  if (state.cleanupPromise) return state.cleanupPromise;
  if (!['prepared', 'reserved', 'cleanup-failed'].includes(state.phase)) {
    return Promise.reject(new Error(`training resource reservation is ${state.phase}`));
  }
  clearExpiry(state);
  state.phase = 'releasing';
  state.cleanupPromise = cleanupEntries(
    state.entries,
    state.operation,
    'training resource reservation',
  ).then(
    () => {
      state.entries = null;
      state.operation = null;
      state.plan = null;
      state.phase = 'released';
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

/** Own the exact execution and target-snapshot authorities resolved for one private plan. */
export const prepareTrainingResourceReservation = ({
  plan,
  operation: suppliedOperation,
}) => {
  const operation = assertRefinementProcessOperation(suppliedOperation);
  const resolved = assertResolvedTrainingPlan(plan, operation);
  const reservation = Object.freeze({
    kind: 'refinement-training-resource-reservation-v1',
    get state() { return STATES.get(reservation)?.phase ?? 'unknown'; },
  });
  STATES.set(reservation, {
    phase: 'prepared',
    plan: resolved,
    operation,
    entries: planEntries(resolved),
    approvalTokenSha256: null,
    expiresAtMs: null,
    timer: null,
    cleanupPromise: null,
  });
  return reservation;
};

/** Verify and project the only plan authority accepted by the approval transaction. */
export const verifyPreparedTrainingResourceReservation = async (
  reservation,
  suppliedOperation,
) => {
  const operation = assertRefinementProcessOperation(suppliedOperation);
  const state = stateFor(reservation, operation, ['prepared']);
  const projection = projectResolvedTrainingPlan(state.plan, operation);
  await verifyEntries(state.entries, operation);
  stateFor(reservation, operation, ['prepared']);
  return projection;
};

/** Bind a prepared reservation to one server-issued approval digest and expiry. */
export const retainTrainingResourceReservation = (
  reservation,
  { approvalTokenSha256, expiresAt },
) => {
  const state = STATES.get(reservation);
  const expiresAtMs = typeof expiresAt === 'string' ? Date.parse(expiresAt) : Number.NaN;
  if (!state || state.phase !== 'prepared'
    || !SHA256.test(String(approvalTokenSha256 || ''))
    || !Number.isFinite(expiresAtMs) || new Date(expiresAtMs).toISOString() !== expiresAt
    || expiresAtMs <= Date.now()) {
    throw new Error('training resource reservation cannot be retained');
  }
  state.approvalTokenSha256 = approvalTokenSha256;
  state.expiresAtMs = expiresAtMs;
  state.phase = 'reserved';
  state.timer = setTimeout(() => {
    releaseState(state).catch(() => {});
  }, expiresAtMs - Date.now());
  state.timer.unref?.();
  return reservation;
};

const retainedState = (reservation, approvalTokenSha256, nowMs = Date.now()) => {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error('training reservation clock is invalid');
  }
  const state = STATES.get(reservation);
  if (!state || state.phase !== 'reserved'
    || state.approvalTokenSha256 !== approvalTokenSha256
    || state.expiresAtMs <= nowMs) {
    throw new Error('training resource reservation is stale or mismatched');
  }
  return state;
};

export const trainingResourceReservationPlan = (
  reservation,
  approvalTokenSha256,
  nowMs = Date.now(),
) => retainedState(reservation, approvalTokenSha256, nowMs).plan;

export const verifyTrainingResourceReservation = async (
  reservation,
  approvalTokenSha256,
  nowMs = Date.now(),
) => {
  const state = retainedState(reservation, approvalTokenSha256, nowMs);
  await verifyEntries(state.entries, state.operation);
  retainedState(reservation, approvalTokenSha256, Date.now());
  return state.plan;
};

export const releaseTrainingResourceReservation = (reservation) => {
  const state = STATES.get(reservation);
  if (!state) return Promise.reject(new Error('training resource reservation is unknown'));
  return releaseState(state);
};

/** Irreversibly move a retained plan's owners into the active-forge assembler. */
export const transferTrainingResourceReservationOwnership = async (
  reservation,
  approvalTokenSha256,
) => {
  const state = retainedState(reservation, approvalTokenSha256);
  await verifyEntries(state.entries, state.operation);
  retainedState(reservation, approvalTokenSha256, Date.now());
  clearExpiry(state);
  state.phase = 'transferred';
  const owner = Object.freeze({
    plan: state.plan,
    operation: state.operation,
    executionAuthority: state.entries[0].authority,
    targetTrainingSnapshotAuthority: state.entries[1].authority,
  });
  state.entries = null;
  state.plan = null;
  state.operation = null;
  return owner;
};

export const trainingResourceReservationOperation = (reservation) => {
  const state = STATES.get(reservation);
  if (!state?.operation) throw new Error('training resource reservation operation is unavailable');
  return assertRefinementProcessOperationIdentity(state.operation);
};
