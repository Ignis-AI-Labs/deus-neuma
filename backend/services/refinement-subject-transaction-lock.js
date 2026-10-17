import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { pinDirectoryCustody } from './refinement-directory-custody.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import {
  readRefinementProcessIdentity,
  sameRefinementProcessIdentity,
} from './refinement-process-identity.js';
import {
  closeRefinementSubjectAuthority,
  issueRefinementSubjectAuthority,
} from './refinement-subject-authority.js';

const SUBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const LOCK_NAME = '.refinement-subject-transaction.lock';
const LOCK_BYTES = 2 * 1024;
const MAX_TIMEOUT_MS = 60_000;
const RETRY_MS = 4;
const TRANSACTIONS = new WeakMap();
const uid = () => Number(typeof process.geteuid === 'function' ? process.geteuid() : 0);
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const refuse = (code, message) => Object.assign(new Error(message), { code });
const exactRequest = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Reflect.ownKeys(value).some((field) => typeof field !== 'string'
      || !['neumaId', 'operation', 'timeoutMs'].includes(field))) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'subject transaction options are invalid');
  }
  return value;
};
const parseIdentity = (bytes, label) => {
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch {
    throw refuse('REFINEMENT_TRANSACTION_LOCK_CORRUPT', `${label} is corrupt`);
  }
  const fields = 'bootId\0pid\0schemaVersion\0startTicks\0token\0uid';
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Reflect.ownKeys(value).sort().join('\0') !== fields || value.schemaVersion !== 1
    || !TOKEN.test(String(value.token || '')) || !Number.isSafeInteger(value.pid) || value.pid < 1
    || !Number.isSafeInteger(value.uid) || value.uid < 0
    || !/^[0-9a-f-]{36}$/.test(String(value.bootId || ''))
    || !/^[0-9]+$/.test(String(value.startTicks || ''))) {
    throw refuse('REFINEMENT_TRANSACTION_LOCK_CORRUPT', `${label} has an invalid shape`);
  }
  return Object.freeze(value);
};
const identityBytes = (identity, token) => Buffer.from(JSON.stringify({
  schemaVersion: 1, token, uid: uid(), pid: identity.pid,
  bootId: identity.bootId, startTicks: identity.startTicks,
}), 'utf8');
const sameOwner = (left, right) => sameRefinementProcessIdentity(left, right)
  && left.uid === right.uid && left.token === right.token;
const combine = (primary, cleanup, label) => primary
  ? new AggregateError([primary, cleanup], `${label} and cleanup failed`) : cleanup;
const releaseResource = async (owner, resource, primary = null, label = 'resource') => {
  try { await owner.release(resource); } catch (cleanup) { throw combine(primary, cleanup, label); }
  if (primary) throw primary;
};
const removeHeld = async (owner, name, resource, primary = null) => {
  try {
    await owner.unlink({ name, expectedResource: resource });
    await owner.release(resource);
  } catch (cleanup) { throw combine(primary, cleanup, 'subject lock cleanup'); }
  if (primary) throw primary;
};
const createExclusiveFile = async (owner, name, bytes, label) => {
  const created = await owner.create({ kind: 'file', name, mode: 0o600, label });
  try {
    await owner.write({ resource: created.resource, bytes, maximumBytes: LOCK_BYTES });
    return created.resource;
  } catch (error) { return removeHeld(owner, name, created.resource, error); }
};
const tryAcquire = async (owner, identity) => {
  const token = randomBytes(32).toString('base64url');
  const temporaryName = `.subject-lock-${token}.tmp`;
  const resource = await createExclusiveFile(
    owner, temporaryName, identityBytes(identity, token), 'subject lock candidate',
  );
  try {
    await owner.replace({ sourceResource: resource, targetName: LOCK_NAME });
    return Object.freeze({ resource, owner: Object.freeze({ ...identity, uid: uid(), token }) });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      await removeHeld(owner, temporaryName, resource);
      return null;
    }
    return removeHeld(owner, temporaryName, resource, error);
  }
};
const currentHolder = async (owner) => {
  let opened;
  try {
    opened = await owner.open({ kind: 'file', name: LOCK_NAME, label: 'subject lock' });
    const read = await owner.read({ resource: opened.resource, maximumBytes: LOCK_BYTES });
    return Object.freeze({ resource: opened.resource, owner: parseIdentity(read.bytes, 'subject lock') });
  } catch (error) {
    if (opened?.resource) return releaseResource(owner, opened.resource, error, 'lock inspection');
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};
const claimantAlive = async (claim) => {
  const current = await readRefinementProcessIdentity(claim.pid);
  return sameRefinementProcessIdentity(claim, current) && claim.uid === uid();
};
const acquireReaperClaim = async (owner, holder, identity) => {
  const name = `.subject-reaper-${holder.owner.token}.claim`;
  const token = randomBytes(32).toString('base64url');
  try {
    const resource = await createExclusiveFile(
      owner, name, identityBytes(identity, token), 'subject reaper claim',
    );
    return Object.freeze({ name, resource, owner: Object.freeze({ ...identity, uid: uid(), token }) });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  const opened = await owner.open({ kind: 'file', name, label: 'subject reaper claim' });
  try {
    const read = await owner.read({ resource: opened.resource, maximumBytes: LOCK_BYTES });
    const claim = parseIdentity(read.bytes, 'subject reaper claim');
    if (await claimantAlive(claim)) {
      await owner.release(opened.resource);
      return null;
    }
    await owner.unlink({ name, expectedResource: opened.resource });
    await owner.release(opened.resource);
    return acquireReaperClaim(owner, holder, identity);
  } catch (error) { return releaseResource(owner, opened.resource, error, 'reaper claim recovery'); }
};
const revalidateDeadHolder = async (owner, observed) => {
  const current = await currentHolder(owner);
  if (!current || !sameOwner(current.owner, observed.owner)) {
    if (current) await owner.release(current.resource);
    throw refuse('REFINEMENT_TRANSACTION_STALE', 'subject lock changed before dead-owner recovery');
  }
  if (await claimantAlive(current.owner)) {
    await owner.release(current.resource);
    throw refuse('REFINEMENT_TRANSACTION_STALE', 'subject lock owner revived before recovery');
  }
  return current;
};
const reapDeadHolder = async (owner, observed, identity) => {
  const claim = await acquireReaperClaim(owner, observed, identity);
  if (!claim) return false;
  let current;
  let tombstone;
  let primary = null;
  try {
    current = await revalidateDeadHolder(owner, observed);
    tombstone = `.subject-dead-${observed.owner.token}-${claim.owner.token}`;
    await owner.rename({
      sourceName: LOCK_NAME,
      targetName: tombstone,
      expectedSourceResource: current.resource,
      absentTarget: true,
    });
    await owner.verify({ name: tombstone, resource: current.resource });
    const holderNow = await readRefinementProcessIdentity(observed.owner.pid);
    if (holderNow !== null || !sameOwner(current.owner, observed.owner)) {
      throw refuse('REFINEMENT_TRANSACTION_STALE', 'dead lock authority changed before removal');
    }
    await owner.unlink({ name: tombstone, expectedResource: current.resource });
    await owner.release(current.resource);
    current = null;
  } catch (error) { primary = error; }
  if (current) {
    try { await owner.release(current.resource); } catch (cleanup) {
      primary = combine(primary, cleanup, 'dead lock release');
    }
  }
  try { await removeHeld(owner, claim.name, claim.resource); } catch (cleanup) {
    primary = combine(primary, cleanup, 'reaper claim release');
  }
  if (primary) throw primary;
  return true;
};
const acquire = async (owner, operation, timeoutMs) => {
  const identity = await readRefinementProcessIdentity();
  if (!identity) throw refuse('REFINEMENT_TRANSACTION_IDENTITY', 'process identity is unavailable');
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    operation.assertActive();
    const held = await tryAcquire(owner, identity);
    if (held) return held;
    const observed = await currentHolder(owner);
    if (!observed) continue;
    if (await claimantAlive(observed.owner)) {
      await owner.release(observed.resource);
      await sleep(RETRY_MS);
    } else {
      await reapDeadHolder(owner, observed, identity);
      await owner.release(observed.resource);
    }
  }
  throw refuse('ELOCKTIMEOUT', 'timed out acquiring subject transaction lock');
};
const releaseHeld = async (owner, held) => {
  const tombstone = `.subject-release-${held.owner.token}`;
  await owner.rename({
    sourceName: LOCK_NAME,
    targetName: tombstone,
    expectedSourceResource: held.resource,
    absentTarget: true,
  });
  await owner.verify({ name: tombstone, resource: held.resource });
  const current = await owner.read({ resource: held.resource, maximumBytes: LOCK_BYTES });
  if (!sameOwner(parseIdentity(current.bytes, 'subject release tombstone'), held.owner)) {
    throw refuse('REFINEMENT_TRANSACTION_STALE', 'subject release token changed');
  }
  await owner.unlink({ name: tombstone, expectedResource: held.resource });
  await owner.release(held.resource);
};
const closeState = async (state, primary = null) => {
  if (state.subjectAuthority) {
    closeRefinementSubjectAuthority(state.subjectAuthority);
    state.subjectAuthority = null;
  }
  if (state.held && !state.lockReleased) {
    try {
      await releaseHeld(state.owner, state.held);
      state.lockReleased = true;
      state.held = null;
    } catch (error) { primary = combine(primary, error, 'subject lock release'); }
  }
  if (!state.ownerClosed) {
    try {
      await state.owner.close();
      state.ownerClosed = true;
    } catch (error) { primary = combine(primary, error, 'subject custody release'); }
  }
  state.active = !(state.lockReleased && state.ownerClosed);
  if (primary) throw primary;
  return true;
};

/** Acquire one opaque subject transaction; only its exact operation may use it. */
export const openRefinementSubjectTransaction = async (request) => {
  exactRequest(request);
  const { neumaId, timeoutMs = 10_000 } = request;
  const operation = assertRefinementProcessOperation(request.operation);
  if (!SUBJECT_ID.test(String(neumaId || '')) || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'subject transaction request is invalid');
  }
  const state = {
    neumaId,
    operation,
    // A root-owned sticky ancestor (the classic /tmp) cannot be renamed or
    // removed out from under us by another user, which is exactly the swap
    // this chain defends against — so it is accepted, while the leaf and
    // every owned component below it stay strictly owner-protected.
    owner: await pinDirectoryCustody(
      neumaWorkspace.pathFor(neumaId), 'refinement subject transaction custody',
      { allowRootStickyAncestors: true },
    ),
    held: null,
    subjectAuthority: null,
    lockReleased: false,
    ownerClosed: false,
    active: true,
  };
  try {
    state.held = await acquire(state.owner, operation, timeoutMs);
    state.subjectAuthority = await issueRefinementSubjectAuthority({
      neumaId, directory: state.owner, operation,
    });
  } catch (error) {
    await closeState(state, error);
  }
  const transaction = Object.freeze({ kind: 'refinement-subject-transaction-v1' });
  TRANSACTIONS.set(transaction, state);
  return transaction;
};

export const assertRefinementSubjectTransaction = (transaction, operation) => {
  const state = TRANSACTIONS.get(transaction);
  if (!state || !state.active || state.operation !== assertRefinementProcessOperation(operation)
    || !state.subjectAuthority) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'subject transaction authority is unavailable');
  }
  return state.subjectAuthority;
};

/** Release the tokenized lock and pinned custody. Safe to retry after cleanup failure. */
export const closeRefinementSubjectTransaction = async (transaction, operation) => {
  const state = TRANSACTIONS.get(transaction);
  if (!state || state.operation !== operation) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'subject transaction authority is invalid');
  }
  if (!state.active) return false;
  return closeState(state);
};
