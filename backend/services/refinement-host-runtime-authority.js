import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import { codedTrainingError } from './refinement-training-errors.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const FLAGS = constants.O_RDONLY
  | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0)
  | (typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0);
const POLICY = 'fixed-minimal-read-only-allowlist-v1';
const CHUNK_BYTES = 64 * 1024;
const AUTHORITIES = new WeakMap();
const CLEANUPS = new WeakMap();
const DECLARATIONS = Object.freeze([
  Object.freeze({
    id: 'osRelease', kind: 'file', requestedPath: '/etc/os-release',
    maximumBytes: 128 * 1024, identityKey: 'osRelease',
    allowResolved: (value) => ['/etc/os-release', '/usr/lib/os-release'].includes(value),
  }),
  Object.freeze({
    id: 'nvidiaDriverVersion', kind: 'file', requestedPath: '/sys/module/nvidia/version',
    maximumBytes: 4 * 1024, identityKey: 'nvidiaDriverVersion',
    allowResolved: (value) => value === '/sys/module/nvidia/version',
  }),
  Object.freeze({
    id: 'cudaVersionManifest', kind: 'file', requestedPath: '/usr/local/cuda/version.json',
    maximumBytes: 1024 * 1024, identityKey: 'cudaVersionManifest',
    allowResolved: (value) => value === '/usr/local/cuda/version.json'
      || /^\/usr\/local\/cuda-\d+(?:\.\d+){0,2}\/version\.json$/u.test(value),
  }),
  Object.freeze({
    id: 'hostLdCache', kind: 'file', requestedPath: '/etc/ld.so.cache',
    maximumBytes: 16 * 1024 * 1024, identityKey: 'ldCache', spawn: true,
    allowResolved: (value) => value === '/etc/ld.so.cache',
  }),
  Object.freeze({
    id: 'hostUsrLib', kind: 'directory', requestedPath: '/usr/lib',
    identityKey: 'hostUsrLib', spawn: true,
    allowResolved: (value) => value === '/usr/lib',
  }),
  Object.freeze({
    id: 'hostUsrLib64', kind: 'directory', requestedPath: '/usr/lib64',
    identityKey: 'hostUsrLib64', spawn: true,
    allowResolved: (value) => ['/usr/lib64', '/usr/lib'].includes(value),
  }),
  Object.freeze({
    id: 'hostCuda', kind: 'directory', requestedPath: '/usr/local/cuda',
    identityKey: 'hostCuda', spawn: true,
    allowResolved: (value) => /^\/usr\/local\/cuda-\d+(?:\.\d+){0,2}$/u.test(value),
  }),
]);
const fail = (diagnostic) => codedTrainingError(
  'TRAINING_RUNTIME_AUTHORITY_UNAVAILABLE', diagnostic,
);
const sameState = (left, right) => left.dev === right.dev && left.ino === right.ino
  && left.size === right.size && left.mode === right.mode && left.uid === right.uid
  && left.gid === right.gid && left.nlink === right.nlink
  && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
const readBoundedHandle = async (handle, declaration, operation) => {
  const controls = assertRefinementProcessOperation(operation);
  const before = await handle.stat({ bigint: true });
  if (!before.isFile() || before.uid !== 0n || (before.mode & 0o022n) !== 0n) {
    throw fail('HOST_RUNTIME_FILE_INVALID');
  }
  if (before.size < 1n || before.size > BigInt(declaration.maximumBytes)) {
    throw fail(before.size < 1n ? 'HOST_RUNTIME_FILE_EMPTY' : 'HOST_RUNTIME_FILE_LIMIT');
  }
  const digest = createHash('sha256');
  const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, declaration.maximumBytes + 1));
  let offset = 0;
  while (offset <= declaration.maximumBytes) {
    controls.assertActive();
    const length = Math.min(buffer.length, declaration.maximumBytes + 1 - offset);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    if (!bytesRead) break;
    digest.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  if (offset > declaration.maximumBytes) throw fail('HOST_RUNTIME_FILE_LIMIT');
  controls.assertActive();
  const after = await handle.stat({ bigint: true });
  if (!sameState(before, after)) throw fail('HOST_RUNTIME_FILE_CHANGED');
  if (!offset) throw fail('HOST_RUNTIME_FILE_EMPTY');
  return Object.freeze({
    sha256: digest.digest('hex'),
    bytes: offset,
    state: before,
  });
};
const inspectHandle = async (handle, declaration, operation) => {
  if (declaration.kind === 'file') {
    return readBoundedHandle(handle, declaration, operation);
  }
  const controls = assertRefinementProcessOperation(operation);
  const state = await handle.stat({ bigint: true });
  controls.assertActive();
  if (!state.isDirectory() || state.uid !== 0n || (state.mode & 0o022n) !== 0n) {
    throw fail('HOST_RUNTIME_DIRECTORY_INVALID');
  }
  return Object.freeze({ state });
};
const stateSha256 = (state) => refinementSha256(Object.freeze({
  dev: String(state.dev),
  ino: String(state.ino),
  mode: String(state.mode),
  uid: String(state.uid),
  gid: String(state.gid),
  nlink: String(state.nlink),
  size: String(state.size),
  mtimeNs: String(state.mtimeNs),
  ctimeNs: String(state.ctimeNs),
}));
const closeHandles = async (handles) => {
  const failures = [];
  for (const entry of [...handles].reverse()) {
    try {
      await entry.handle.close();
      handles.delete(entry);
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'host runtime authority cleanup failed');
};
const cleanupAuthority = (operation, handles) => {
  const authority = Object.freeze({ kind: 'refinement-host-runtime-cleanup-authority-v1' });
  CLEANUPS.set(authority, { operation, handles, phase: 'cleanup-failed', promise: null });
  return authority;
};
export const retryRefinementHostRuntimeCleanup = (authority, operation) => {
  const state = CLEANUPS.get(authority);
  if (!state || state.operation !== operation) throw new Error('host runtime cleanup authority is invalid');
  if (state.phase === 'closed') return Promise.resolve(false);
  if (state.promise) return state.promise;
  state.phase = 'closing';
  state.promise = closeHandles(state.handles).then(
    () => { state.phase = 'closed'; return true; },
    (error) => { state.phase = 'cleanup-failed'; throw error; },
  ).finally(() => { state.promise = null; });
  return state.promise;
};
const identityPayload = (input, observed) => Object.freeze({
  schemaVersion: 1,
  policy: POLICY,
  authorityConsumerPythonSha256: input.authorityConsumerPythonSha256,
  pythonExecutableSha256: input.sourceIdentity.pythonExecutableSha256,
  ldCacheSha256: observed.ldCache.sha256,
  trainerEnvironmentSha256: input.sourceIdentity.trainerEnvironmentSha256,
  trainerRequirementsSha256: input.sourceIdentity.trainerRequirementsSha256,
  osReleaseSha256: observed.osRelease.sha256,
  nvidiaDriverVersionSha256: observed.nvidiaDriverVersion.sha256,
  cudaVersionManifestSha256: observed.cudaVersionManifest.sha256,
  hostUsrLibStateSha256: stateSha256(observed.hostUsrLib.state),
  hostUsrLib64StateSha256: stateSha256(observed.hostUsrLib64.state),
  hostCudaStateSha256: stateSha256(observed.hostCuda.state),
});
const assertInputs = (input) => {
  const source = input?.sourceIdentity;
  if (!SHA256.test(String(input?.authorityConsumerPythonSha256 || ''))
    || !source || ['pythonExecutableSha256', 'trainerEnvironmentSha256',
      'trainerRequirementsSha256'].some((field) => !SHA256.test(String(source[field] || '')))) {
    throw fail('HOST_RUNTIME_INPUT_INVALID');
  }
};
/** Hold and hash the fixed coarse host-runtime identity for one execution operation. Impure. */
export const openRefinementHostRuntimeAuthority = async (input) => {
  assertInputs(input);
  const operation = assertRefinementProcessOperation(input.operation);
  const handles = new Set();
  const observed = {};
  try {
    for (const declaration of DECLARATIONS) {
      operation.assertActive();
      const resolved = await fs.realpath(declaration.requestedPath);
      if (!declaration.allowResolved(resolved)) throw fail('HOST_RUNTIME_PATH_INVALID');
      const handle = await fs.open(resolved, FLAGS);
      const entry = { declaration, handle, identity: null };
      handles.add(entry);
      entry.identity = await inspectHandle(handle, declaration, operation);
      if (declaration.identityKey) observed[declaration.identityKey] = entry.identity;
    }
  } catch (error) {
    try { await closeHandles(handles); }
    catch {
      return Object.freeze({
        ok: false,
        errorCode: 'TRAINING_EXECUTION_CLEANUP_REQUIRED',
        cleanupAuthority: cleanupAuthority(operation, handles),
      });
    }
    if (/^TRAINING_[A-Z0-9_]+$/u.test(String(error?.code || ''))) throw error;
    throw fail('HOST_RUNTIME_ACQUISITION_FAILED');
  }
  const payload = identityPayload(input, observed);
  const authority = Object.freeze({
    kind: 'refinement-host-runtime-authority-v1',
    hostRuntimeIdentitySha256: refinementSha256(payload),
  });
  AUTHORITIES.set(authority, {
    operation, handles, payload, phase: 'open', promise: null,
  });
  return Object.freeze({ ok: true, authority });
};
const stateFor = (authority, operation, active = true) => {
  const state = AUTHORITIES.get(authority);
  if (!state || state.operation !== operation || state.phase !== 'open') {
    throw fail('HOST_RUNTIME_AUTHORITY_INVALID');
  }
  if (active) assertRefinementProcessOperation(operation);
  return state;
};
const verifyEntry = async (entry, operation) => {
  const identity = await inspectHandle(entry.handle, entry.declaration, operation);
  if (!sameState(identity.state, entry.identity.state)
    || (entry.declaration.kind === 'file' && identity.sha256 !== entry.identity.sha256)) {
    throw fail('HOST_RUNTIME_IDENTITY_CHANGED');
  }
  return identity;
};
export const verifyRefinementHostRuntimeAuthority = async (authority, operation) => {
  const state = stateFor(authority, operation);
  const observed = {};
  for (const entry of state.handles) {
    const identity = await verifyEntry(entry, operation);
    if (entry.declaration.identityKey) observed[entry.declaration.identityKey] = identity;
  }
  if (refinementSha256(identityPayload({
    authorityConsumerPythonSha256: state.payload.authorityConsumerPythonSha256,
    sourceIdentity: state.payload,
  }, observed)) !== authority.hostRuntimeIdentitySha256) {
    throw fail('HOST_RUNTIME_IDENTITY_CHANGED');
  }
  return authority;
};
export const withRefinementHostRuntimeDescriptors = async (
  authority,
  operation,
  consume,
) => {
  const state = stateFor(authority, operation);
  if (typeof consume !== 'function') throw fail('HOST_RUNTIME_CONSUMER_INVALID');
  await verifyRefinementHostRuntimeAuthority(authority, operation);
  const active = { value: true };
  const descriptors = Object.freeze(Object.fromEntries(
    [...state.handles].filter(({ declaration }) => declaration.spawn).map((entry) => [
      entry.declaration.id,
      Object.freeze({
        kind: 'refinement-host-runtime-descriptor-borrow-v1',
        id: entry.declaration.id,
        fd: entry.handle.fd,
        async verify(suppliedOperation) {
          if (!active.value) throw fail('HOST_RUNTIME_DESCRIPTOR_EXPIRED');
          if (suppliedOperation !== operation) throw fail('HOST_RUNTIME_OPERATION_CHANGED');
          await verifyEntry(entry, assertRefinementProcessOperation(suppliedOperation));
          return true;
        },
      }),
    ]),
  ));
  try { return await consume(descriptors); }
  finally { active.value = false; }
};
export const closeRefinementHostRuntimeAuthority = (authority, operation) => {
  const state = AUTHORITIES.get(authority);
  if (!state || state.operation !== operation) throw fail('HOST_RUNTIME_AUTHORITY_INVALID');
  if (state.phase === 'closed') return Promise.resolve(false);
  if (state.promise) return state.promise;
  if (!['open', 'cleanup-failed'].includes(state.phase)) {
    throw fail('HOST_RUNTIME_AUTHORITY_INVALID');
  }
  state.phase = 'closing';
  state.promise = closeHandles(state.handles).then(
    () => { state.phase = 'closed'; return true; },
    (error) => { state.phase = 'cleanup-failed'; throw error; },
  ).finally(() => { state.promise = null; });
  return state.promise;
};
