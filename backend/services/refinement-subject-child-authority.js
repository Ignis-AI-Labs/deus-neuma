import { openPinnedDirectoryChild } from './refinement-directory-custody.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import {
  assertRefinementSubjectAuthority,
  openRefinementSubjectPinnedChild,
  refinementSubjectAuthorityOperations,
} from './refinement-subject-authority.js';

const AUTHORITIES = new WeakMap();
const CHILDREN = new Set(['dna', 'identity', 'soul', 'attunement']);
const combine = (primary, cleanup, label) => primary
  ? new AggregateError([primary, cleanup], `${label} and cleanup failed`)
  : cleanup;
const stateFor = (authority, operation, allowCleanup = false) => {
  const activeOperation = assertRefinementProcessOperation(operation);
  const state = AUTHORITIES.get(authority);
  if (!state || state.operation !== activeOperation
    || (!allowCleanup && state.phase !== 'open')
    || (allowCleanup && state.phase === 'closed')) {
    throw new Error('refinement assent fact child authority is invalid');
  }
  assertRefinementSubjectAuthority(state.subjectAuthority, activeOperation);
  if (!allowCleanup) activeOperation.assertActive();
  return state;
};
const closeOpened = async (opened, label) => {
  let primary = null;
  for (const entry of opened.toReversed()) {
    if (entry.closed) continue;
    try {
      await entry.owner.close();
      entry.closed = true;
    } catch (error) {
      primary = combine(primary, error, label);
    }
  }
  if (primary) throw primary;
};
const childOps = (owner, neumaId) => Object.freeze({
  neumaId,
  list: (request) => owner.list(request),
  open: (request) => owner.open(request),
  read: (request) => owner.read(request),
  verify: (request) => owner.verify(request),
  release: (resource) => owner.release(resource),
});

/**
 * Hold the exact DNA, name, soul, and attunement directories for one assent operation.
 * No caller can add a fifth child or receive a path or descriptor.
 */
export const openRefinementAssentFactChildAuthority = async (subjectAuthority, operation) => {
  const activeOperation = assertRefinementProcessOperation(operation);
  assertRefinementSubjectAuthority(subjectAuthority, activeOperation);
  const opened = [];
  const children = new Map();
  let primary;
  try {
    for (const [name, label] of [
      ['dna', 'refinement assent DNA custody'],
      ['identity', 'refinement assent name custody'],
      ['soul', 'refinement assent soul custody'],
    ]) {
      const owner = await openRefinementSubjectPinnedChild(subjectAuthority, {
        name, label, mode: 0o700,
      }, activeOperation);
      opened.push({ owner, closed: false });
      children.set(name, owner);
    }
    const attunement = await openRefinementSubjectPinnedChild(subjectAuthority, {
      name: 'attunement', label: 'refinement assent attunement root custody', mode: 0o700,
    }, activeOperation);
    opened.push({ owner: attunement, closed: false });
    const records = await openPinnedDirectoryChild(attunement, {
      name: 'records', label: 'refinement assent attunement custody', mode: 0o700,
    });
    opened.push({ owner: records, closed: false });
    children.set('attunement', records);
    const subject = refinementSubjectAuthorityOperations(subjectAuthority, activeOperation);
    const authority = Object.freeze({ kind: 'refinement-assent-fact-child-authority-v1' });
    AUTHORITIES.set(authority, {
      operation: activeOperation,
      subjectAuthority,
      neumaId: subject.neumaId,
      children,
      opened,
      phase: 'open',
    });
    return authority;
  } catch (error) {
    primary = error;
  }
  try {
    await closeOpened(opened, 'refinement assent fact child acquisition');
  } catch (cleanup) {
    primary = combine(primary, cleanup, 'refinement assent fact child acquisition');
  }
  throw primary;
};

/** Return read-only operations for one of the four fixed held fact directories. */
export const refinementAssentFactChildOperations = (authority, child, operation) => {
  const state = stateFor(authority, operation);
  if (!CHILDREN.has(child)) {
    throw new Error('refinement assent fact child is invalid');
  }
  const owner = state.children.get(child);
  if (!owner) throw new Error('refinement assent fact child is unavailable');
  return childOps(owner, state.neumaId);
};

/** Decrypt one held fact through the same subject authority without exposing its key. */
export const decryptRefinementAssentFact = (authority, bytes, operation) => {
  const state = stateFor(authority, operation);
  if (!Buffer.isBuffer(bytes)) throw new Error('refinement assent fact ciphertext is invalid');
  return refinementSubjectAuthorityOperations(
    state.subjectAuthority, state.operation,
  ).decrypt(bytes);
};

/** Reassert the fixed subject and every child owner before a response is accepted. */
export const assertRefinementAssentFactChildAuthority = async (authority, operation) => {
  const state = stateFor(authority, operation);
  for (const child of CHILDREN) {
    const ops = refinementAssentFactChildOperations(authority, child, operation);
    await ops.list({
      maximumEntries: child === 'attunement' ? 256 : 64,
      maximumNameBytes: 64 * 1024,
      signal: state.operation.signal,
      deadline: state.operation.monotonicDeadline,
    });
    state.operation.assertActive();
  }
  return authority;
};

/** Retryably release all four fixed children and their retained descriptors. */
export const closeRefinementAssentFactChildAuthority = async (authority, operation) => {
  const state = stateFor(authority, operation, true);
  state.phase = 'closing';
  try {
    await closeOpened(state.opened, 'refinement assent fact child release');
    state.phase = 'closed';
    return true;
  } catch (error) {
    state.phase = 'cleanup-failed';
    throw error;
  }
};
