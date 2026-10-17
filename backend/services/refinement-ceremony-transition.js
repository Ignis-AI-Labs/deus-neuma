import {
  assertRefinementProcessOperation,
  assertRefinementProcessOperationIdentity,
} from './refinement-process-operation.js';
import {
  assertRefinementSubjectTransaction,
  closeRefinementSubjectTransaction,
  openRefinementSubjectTransaction,
} from './refinement-subject-transaction-lock.js';
import {
  assertRefinementCeremonyTransaction,
  closeRefinementCeremonyTransaction,
  commitPreparedRefinementCeremonyTransition,
  openRefinementCeremonyTransaction,
  prepareRefinementCeremonyTransition,
  projectPreparedRefinementCeremonyTransition,
} from './refinement-ceremony-transaction.js';

const PREPARATIONS = new WeakMap();
const refuse = (code, message) => Object.assign(new Error(message), { code });
const combine = (primary, cleanup, label) => primary
  ? new AggregateError([primary, cleanup], `${label} and cleanup failed`) : cleanup;
const sameSnapshot = (left, right) => left.revision === right.revision
  && left.recordSha256 === right.recordSha256
  && left.custodySha256 === right.custodySha256;
const activeState = (authority, operation) => {
  const state = PREPARATIONS.get(authority);
  if (!state || !state.active
    || state.operation !== assertRefinementProcessOperation(operation)) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'ceremony preparation authority is invalid');
  }
  return state;
};
const cleanupState = (authority, operation) => {
  const state = PREPARATIONS.get(authority);
  if (!state
    || state.operation !== assertRefinementProcessOperationIdentity(operation)) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'ceremony preparation authority is invalid');
  }
  return state;
};
const closeHeld = async ({ ceremonyAuthority, transactionOwner }, operation, primary = null) => {
  if (ceremonyAuthority) {
    try { closeRefinementCeremonyTransaction(ceremonyAuthority, operation); }
    catch (cleanup) { primary = combine(primary, cleanup, 'ceremony authority release'); }
  }
  if (transactionOwner) {
    try { await closeRefinementSubjectTransaction(transactionOwner, operation); }
    catch (cleanup) { primary = combine(primary, cleanup, 'subject transaction release'); }
  }
  return primary;
};
const openHeld = async (neumaId, ceremonyId, operation) => {
  const transactionOwner = await openRefinementSubjectTransaction({ neumaId, operation });
  let ceremonyAuthority = null;
  try {
    assertRefinementSubjectTransaction(transactionOwner, operation);
    ceremonyAuthority = await openRefinementCeremonyTransaction({
      transactionOwner, ceremonyId, operation,
    });
    return Object.freeze({ transactionOwner, ceremonyAuthority });
  } catch (error) {
    const primary = await closeHeld(
      { ceremonyAuthority, transactionOwner }, operation, error,
    );
    throw primary;
  }
};

/** Capture one exact ceremony authority, then release its mutation lock for preparation. */
export const openRefinementCeremonyPreparation = async ({
  neumaId, ceremonyId, operation,
}) => {
  const activeOperation = assertRefinementProcessOperation(operation);
  const held = await openHeld(neumaId, ceremonyId, activeOperation);
  let snapshot;
  let primary = null;
  try {
    const current = assertRefinementCeremonyTransaction(
      held.ceremonyAuthority, activeOperation,
    ).current;
    snapshot = Object.freeze({
      record: current.record,
      recordSha256: current.recordSha256,
      revision: current.revision,
      custodySha256: current.custodySha256,
    });
  } catch (error) { primary = error; }
  primary = await closeHeld(held, activeOperation, primary);
  if (primary) throw primary;
  const authority = Object.freeze({ kind: 'refinement-ceremony-preparation-v1' });
  PREPARATIONS.set(authority, {
    active: true, neumaId, ceremonyId, operation: activeOperation, snapshot,
  });
  return authority;
};

/** Reacquire the subject lock and commit only if the exact prepared-against record remains current. */
export const commitRefinementCeremonyPreparation = async ({
  preparationAuthority, nextRecord, transition, operation,
}) => {
  const state = activeState(preparationAuthority, operation);
  const held = await openHeld(state.neumaId, state.ceremonyId, state.operation);
  let committed;
  let primary = null;
  try {
    const current = assertRefinementCeremonyTransaction(
      held.ceremonyAuthority, state.operation,
    ).current;
    if (!sameSnapshot(current, state.snapshot)) {
      throw refuse('REFINEMENT_TRANSACTION_STALE', 'ceremony changed during preparation');
    }
    const prepared = prepareRefinementCeremonyTransition(
      held.ceremonyAuthority, nextRecord, transition, state.operation,
    );
    const projected = projectPreparedRefinementCeremonyTransition(
      prepared, held.ceremonyAuthority, state.operation,
    );
    committed = await commitPreparedRefinementCeremonyTransition(
      held.ceremonyAuthority, prepared, state.operation,
    );
    const durable = assertRefinementCeremonyTransaction(
      held.ceremonyAuthority, state.operation,
    ).current;
    if (durable.recordSha256 !== projected.recordSha256
      || durable.revision !== projected.revision
      || durable.custodySha256 !== projected.custodySha256) {
      throw refuse('REFINEMENT_TRANSACTION_DURABILITY', 'committed ceremony authority changed');
    }
  } catch (error) { primary = error; }
  primary = await closeHeld(held, state.operation, primary);
  if (primary) throw primary;
  state.active = false;
  return committed;
};

export const closeRefinementCeremonyPreparation = (authority, operation) => {
  const state = cleanupState(authority, operation);
  if (!state.active) return false;
  state.active = false;
  return true;
};
