import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import {
  assertRefinementProcessOperation,
  assertRefinementProcessOperationIdentity,
  hashRefinementHandle,
} from './refinement-process-operation.js';
import { codedTrainingError } from './refinement-training-errors.js';

const FLAGS = constants.O_RDONLY
  | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0)
  | (typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0);
const SETS = new WeakMap();
const CLEANUPS = new WeakMap();
const DECLARATIONS = Object.freeze({
  wrapper: Object.freeze({
    filePath: '/usr/bin/systemd-run', label: 'systemd-run', maximumBytes: 16 * 1024 ** 2,
    errorCode: 'TRAINING_CGROUP_UNAVAILABLE',
  }),
  controller: Object.freeze({
    filePath: '/usr/bin/systemctl', label: 'systemctl', maximumBytes: 16 * 1024 ** 2,
    errorCode: 'TRAINING_CGROUP_UNAVAILABLE',
  }),
  limiter: Object.freeze({
    filePath: '/usr/bin/prlimit', label: 'prlimit', maximumBytes: 16 * 1024 ** 2,
    errorCode: 'TRAINING_CGROUP_UNAVAILABLE',
  }),
  sandbox: Object.freeze({
    filePath: '/usr/bin/bwrap', label: 'bubblewrap', maximumBytes: 16 * 1024 ** 2,
    errorCode: 'TRAINING_SANDBOX_UNAVAILABLE',
  }),
  consumerPython: Object.freeze({
    filePath: '/usr/bin/python3', label: 'authority consumer Python',
    maximumBytes: 256 * 1024 ** 2, resolveFinalLink: true,
    errorCode: 'TRAINING_RUNTIME_AUTHORITY_UNAVAILABLE',
  }),
});
const fail = (declaration, diagnostic) => codedTrainingError(
  declaration.errorCode,
  diagnostic,
);
const sameState = (left, right) => left.dev === right.dev && left.ino === right.ino
  && left.size === right.size && left.mode === right.mode && left.uid === right.uid
  && left.gid === right.gid && left.nlink === right.nlink
  && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
const ownerFor = (handle, declaration, operation) => {
  let identity = null;
  let phase = 'open';
  let closePromise = null;
  const assertOpen = (suppliedOperation, active) => {
    const checked = active
      ? assertRefinementProcessOperation(suppliedOperation)
      : assertRefinementProcessOperationIdentity(suppliedOperation);
    if (checked !== operation || phase !== 'open' || !identity) {
      throw fail(declaration, 'EXECUTABLE_AUTHORITY_UNAVAILABLE');
    }
    return checked;
  };
  const initialize = async () => {
    const observed = await hashRefinementHandle({
      handle,
      maximumBytes: declaration.maximumBytes,
      label: declaration.label,
      operation,
    });
    if (observed.state.uid !== 0n || (observed.state.mode & 0o022n) !== 0n
      || (observed.state.mode & 0o111n) === 0n) {
      throw fail(declaration, 'EXECUTABLE_MODE_INVALID');
    }
    identity = observed;
  };
  const verify = async (suppliedOperation) => {
    const checked = assertOpen(suppliedOperation, true);
    const observed = await hashRefinementHandle({
      handle,
      maximumBytes: declaration.maximumBytes,
      label: declaration.label,
      operation: checked,
    });
    if (observed.sha256 !== identity.sha256 || !sameState(observed.state, identity.state)) {
      throw fail(declaration, 'EXECUTABLE_AUTHORITY_CHANGED');
    }
    return true;
  };
  const verifyAfterAbort = async (suppliedOperation) => {
    assertOpen(suppliedOperation, false);
    if (!sameState(identity.state, await handle.stat({ bigint: true }))) {
      throw fail(declaration, 'EXECUTABLE_AUTHORITY_CHANGED');
    }
    return true;
  };
  const descriptor = () => Object.freeze({
    fd: handle.fd,
    sha256: identity.sha256,
    bytes: identity.bytes,
  });
  const close = () => {
    if (phase === 'closed') return Promise.resolve(false);
    if (closePromise) return closePromise;
    if (!['open', 'cleanup-failed'].includes(phase)) {
      throw fail(declaration, 'EXECUTABLE_AUTHORITY_UNAVAILABLE');
    }
    phase = 'closing';
    closePromise = handle.close().then(
      () => { phase = 'closed'; return true; },
      (error) => { phase = 'cleanup-failed'; throw error; },
    ).finally(() => { closePromise = null; });
    return closePromise;
  };
  return Object.freeze({ initialize, verify, verifyAfterAbort, descriptor, close });
};
const closeOwners = async (owners) => {
  const failures = [];
  for (const owner of [...owners].reverse()) {
    try {
      await owner.close();
      owners.delete(owner);
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'fixed executable cleanup failed');
};
const cleanupAuthority = (operation, owners) => {
  const authority = Object.freeze({ kind: 'refinement-fixed-executable-cleanup-authority-v1' });
  CLEANUPS.set(authority, { operation, owners, phase: 'cleanup-failed', promise: null });
  return authority;
};
export const retryRefinementFixedExecutableCleanup = (authority, operation) => {
  const state = CLEANUPS.get(authority);
  if (!state || state.operation !== operation) {
    throw new Error('fixed executable cleanup authority is invalid');
  }
  if (state.phase === 'closed') return Promise.resolve(false);
  if (state.promise) return state.promise;
  state.phase = 'closing';
  state.promise = closeOwners(state.owners).then(
    () => { state.phase = 'closed'; return true; },
    (error) => { state.phase = 'cleanup-failed'; throw error; },
  ).finally(() => { state.promise = null; });
  return state.promise;
};
const openOwner = async (declaration, operation, retained) => {
  let resolved = declaration.filePath;
  try {
    if (declaration.resolveFinalLink) resolved = await fs.realpath(resolved);
    const handle = await fs.open(resolved, FLAGS);
    const owner = ownerFor(handle, declaration, operation);
    retained.add(owner);
    await owner.initialize();
    return owner;
  } catch (error) {
    if (/^TRAINING_[A-Z0-9_]+$/u.test(String(error?.code || ''))) throw error;
    throw fail(declaration, 'EXECUTABLE_OPEN_FAILED');
  }
};
const stateFor = (authority, operation, active = true) => {
  const state = SETS.get(authority);
  const checked = active
    ? assertRefinementProcessOperation(operation)
    : assertRefinementProcessOperationIdentity(operation);
  if (!state || state.operation !== checked || state.phase !== 'open') {
    throw new Error('fixed executable authority is unavailable');
  }
  return state;
};
/** Open and retain every exact fixed executable used by the process chain. Impure. */
export const openRefinementFixedExecutableAuthority = async (suppliedOperation) => {
  const operation = assertRefinementProcessOperation(suppliedOperation);
  const retained = new Set();
  const owners = {};
  try {
    for (const [id, declaration] of Object.entries(DECLARATIONS)) {
      owners[id] = await openOwner(declaration, operation, retained);
    }
  } catch (error) {
    try { await closeOwners(retained); }
    catch {
      return Object.freeze({
        ok: false,
        errorCode: 'TRAINING_EXECUTION_CLEANUP_REQUIRED',
        cleanupAuthority: cleanupAuthority(operation, retained),
      });
    }
    throw error;
  }
  const authority = Object.freeze({ kind: 'refinement-fixed-executable-authority-v1' });
  SETS.set(authority, {
    operation, owners: Object.freeze(owners), retained, phase: 'open', promise: null,
  });
  return Object.freeze({ ok: true, authority });
};
export const verifyRefinementFixedExecutableAuthority = async (authority, operation) => {
  const state = stateFor(authority, operation);
  for (const owner of Object.values(state.owners)) await owner.verify(operation);
  return authority;
};
export const refinementFixedExecutableDigests = async (authority, operation) => {
  const state = stateFor(authority, operation);
  const digests = {};
  for (const [id, owner] of Object.entries(state.owners)) {
    await owner.verify(operation);
    const descriptor = owner.descriptor();
    digests[id] = Object.freeze({ sha256: descriptor.sha256, bytes: descriptor.bytes });
  }
  return Object.freeze(digests);
};
export const withRefinementFixedExecutableDescriptors = async (
  authority,
  operation,
  consume,
) => {
  const state = stateFor(authority, operation);
  if (typeof consume !== 'function') throw new Error('fixed executable consumer is required');
  await verifyRefinementFixedExecutableAuthority(authority, operation);
  const active = { value: true };
  const descriptors = Object.freeze(Object.fromEntries(
    Object.entries(state.owners).map(([id, owner]) => {
      const descriptor = owner.descriptor();
      return [id, Object.freeze({
        kind: 'refinement-executable-descriptor-borrow',
        id,
        ...descriptor,
        async verify(suppliedOperation) {
          if (!active.value) throw new Error('fixed executable descriptor borrow expired');
          await owner.verify(suppliedOperation);
          return true;
        },
        ...(id === 'controller' && {
          async verifyAfterAbort(suppliedOperation) {
            if (!active.value) throw new Error('fixed executable descriptor borrow expired');
            await owner.verifyAfterAbort(suppliedOperation);
            return true;
          },
        }),
      })];
    }),
  ));
  try { return await consume(descriptors); }
  finally { active.value = false; }
};
export const closeRefinementFixedExecutableAuthority = (authority, operation) => {
  const state = SETS.get(authority);
  if (!state || state.operation !== operation) throw new Error('fixed executable authority is invalid');
  if (state.phase === 'closed') return Promise.resolve(false);
  if (state.promise) return state.promise;
  if (!['open', 'cleanup-failed'].includes(state.phase)) {
    throw new Error('fixed executable authority is unavailable');
  }
  state.phase = 'closing';
  state.promise = closeOwners(state.retained).then(
    () => { state.phase = 'closed'; return true; },
    (error) => { state.phase = 'cleanup-failed'; throw error; },
  ).finally(() => { state.promise = null; });
  return state.promise;
};
