import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { assertBoundedPlainData } from '../../core/shared/plain-data-canonical.js';
import {
  assertRefinementProcessOperation,
  assertRefinementProcessOperationIdentity,
} from './refinement-process-operation.js';
import {
  closeTargetTrainingBaseAuthority,
  openTargetTrainingBaseAuthority,
  retryTargetTrainingBaseAuthorityCleanup,
  targetTrainingBaseAuthority,
  targetTrainingBaseAuthoritySha256,
  transferTargetTrainingBaseAuthority,
  verifyTargetTrainingBaseAuthority,
} from './refinement-target-training-authority.js';
import {
  openTargetTrainingSnapshotFileSet,
  retryTargetTrainingSnapshotFileSetCleanup,
} from './refinement-training-snapshot-cache.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const OWNERS = new WeakMap();
const CLEANUP_OWNERS = new WeakMap();
const PROJECTION_FIELDS = Object.freeze([
  'kind', 'schemaVersion', 'snapshot', 'target', 'targetTrainingBaseAuthoritySha256',
]);
const SNAPSHOT_FIELDS = Object.freeze([
  'baseArtifactSha256', 'fileCount', 'manifestSha256', 'modelId', 'revision',
  'safetensorsIndexSha256', 'tokenizerSha256', 'totalBytes',
]);

/** Validate the path-free public target+snapshot projection. Pure. */
export const targetTrainingSnapshotProjection = (value) => {
  assertBoundedPlainData(value, {
    field: 'target training snapshot projection',
    maxDepth: 4,
    maxNodes: 96,
    maxStringBytes: 1024,
    maxKeyBytes: 64,
    maxOutputBytes: 32 * 1024,
  });
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== PROJECTION_FIELDS.join('\0')
    || value.schemaVersion !== 1
    || value.kind !== 'refinement-target-training-snapshot-projection-v1'
    || !SHA256.test(String(value.targetTrainingBaseAuthoritySha256 || ''))
    || !value.snapshot || typeof value.snapshot !== 'object'
    || Array.isArray(value.snapshot)
    || Object.keys(value.snapshot).sort().join('\0') !== SNAPSHOT_FIELDS.join('\0')) {
    throw new Error('target training snapshot projection shape is invalid');
  }
  const target = targetTrainingBaseAuthority(value.target);
  const snapshot = value.snapshot;
  if (targetTrainingBaseAuthoritySha256(target) !== value.targetTrainingBaseAuthoritySha256
    || snapshot.modelId !== target.trainerModelId
    || snapshot.revision !== target.trainerRevision
    || snapshot.baseArtifactSha256 !== target.baseArtifactSha256
    || snapshot.tokenizerSha256 !== target.tokenizerSha256
    || !SHA256.test(String(snapshot.manifestSha256 || ''))
    || (snapshot.safetensorsIndexSha256 !== null
      && !SHA256.test(String(snapshot.safetensorsIndexSha256 || '')))
    || !Number.isSafeInteger(snapshot.fileCount) || snapshot.fileCount < 1
    || !Number.isSafeInteger(snapshot.totalBytes) || snapshot.totalBytes < 1) {
    throw new Error('target training snapshot identities are inconsistent');
  }
  return Object.freeze({
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    snapshot: Object.freeze(Object.fromEntries(
      SNAPSHOT_FIELDS.map((field) => [field, snapshot[field]]),
    )),
    target,
    targetTrainingBaseAuthoritySha256: value.targetTrainingBaseAuthoritySha256,
  });
};

/** Digest the exact combined target+snapshot projection. Pure. */
const targetTrainingSnapshotAuthoritySha256 = (value) =>
  refinementSha256(targetTrainingSnapshotProjection(value));

const closeResources = async (state) => {
  const failures = [];
  for (let index = state.resources.length - 1; index >= 0; index -= 1) {
    const entry = state.resources[index];
    if (entry.closed) continue;
    try {
      await entry.close();
      entry.closed = true;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, 'target training snapshot authority cleanup failed');
  }
};

const closeState = (state) => {
  if (state.phase === 'closed') return Promise.resolve(false);
  if (state.closePromise) return state.closePromise;
  if (!['open', 'cleanup-failed'].includes(state.phase)) {
    return Promise.reject(new Error(`target training snapshot authority cleanup is ${state.phase}`));
  }
  state.acceptBorrow = false;
  state.closePromise = (async () => {
    await Promise.all([...state.borrows]);
    state.phase = 'closing';
    try {
      await closeResources(state);
      state.phase = 'closed';
      state.cleanupError = null;
      return true;
    } catch (error) {
      state.phase = 'cleanup-failed';
      state.cleanupError = error;
      throw error;
    }
  })().finally(() => { state.closePromise = null; });
  return state.closePromise;
};

const stateFor = (view, operation, active = true) => {
  const bound = OWNERS.get(view);
  if (!bound) throw new Error('target training snapshot authority is not process-authentic');
  const supplied = active
    ? assertRefinementProcessOperation(operation)
    : assertRefinementProcessOperationIdentity(operation);
  if (bound.state.operation !== supplied) {
    throw new Error('target training snapshot authority belongs to another operation');
  }
  return bound;
};

const verifyState = async (state, role) => {
  if (state.owner !== role || state.phase !== 'open') {
    throw new Error(`target training snapshot ${role} owner is ${state.owner}/${state.phase}`);
  }
  state.operation.assertActive();
  await verifyTargetTrainingBaseAuthority(state.targetAuthority, state.operation);
  await state.fileSet.verify(state.operation);
  state.operation.assertActive();
  if (targetTrainingSnapshotAuthoritySha256(state.projection) !== state.sha256) {
    throw new Error('target training snapshot projection changed');
  }
  return state.projection;
};

const authorityView = (state, role) => {
  const view = Object.freeze({
    kind: 'refinement-target-training-snapshot-authority-v1',
    projection: state.projection,
    sha256: state.sha256,
  });
  OWNERS.set(view, { state, role });
  return view;
};

const cleanupAuthority = (state) => {
  const authority = Object.freeze({
    kind: 'refinement-target-training-snapshot-cleanup-v1',
  });
  CLEANUP_OWNERS.set(authority, state);
  return authority;
};

const sanitizedError = (error) => Object.assign(
  new Error('target training snapshot acquisition failed'),
  typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(error.code)
    ? { code: error.code }
    : {},
);

const acquisitionFailure = async (state, error) => {
  try {
    await closeState(state);
  } catch {
    return Object.freeze({
      ok: false,
      errorCode: 'TRAINING_EXECUTION_CLEANUP_REQUIRED',
      cleanupAuthority: cleanupAuthority(state),
    });
  }
  throw sanitizedError(error);
};

/** Retry incomplete combined snapshot cleanup under the originating operation. */
export const retryTargetTrainingSnapshotCleanup = async (
  authority,
  suppliedOperation,
) => {
  const operation = assertRefinementProcessOperationIdentity(suppliedOperation);
  const state = CLEANUP_OWNERS.get(authority);
  if (!state || state.operation !== operation) {
    throw new Error('target training snapshot cleanup authority is unavailable');
  }
  try {
    await closeState(state);
    CLEANUP_OWNERS.delete(authority);
    return Object.freeze({ ok: true });
  } catch {
    return Object.freeze({
      ok: false,
      errorCode: 'TRAINING_EXECUTION_CLEANUP_REQUIRED',
      cleanupAuthority: authority,
    });
  }
};

const targetBaseResource = (state, operation, cleanupAuthority = null) => {
  const resource = {
    closed: false,
    cleanupAuthority,
    close: async () => {
      const result = resource.cleanupAuthority
        ? await retryTargetTrainingBaseAuthorityCleanup(resource.cleanupAuthority, operation)
        : await closeTargetTrainingBaseAuthority(state.targetAuthority, operation);
      if (!result.ok) {
        resource.cleanupAuthority = result.cleanupAuthority;
        throw new Error('target training base cleanup is incomplete');
      }
    },
  };
  return resource;
};
/** Open one exact target lineage and its exact server-cached snapshot as one owner. */
export const openTargetTrainingSnapshotAuthority = async (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'operation,sourceAuthority,targetRequest') {
    throw new Error('target training snapshot request shape is invalid');
  }
  const operation = assertRefinementProcessOperation(input.operation);
  const state = {
    operation,
    resources: [],
    targetAuthority: null,
    fileSet: null,
    projection: null,
    sha256: null,
    owner: 'acquiring',
    phase: 'open',
    acceptBorrow: true,
    borrows: new Set(),
    closePromise: null,
    cleanupError: null,
  };
  try {
    const openedTarget = await openTargetTrainingBaseAuthority(input);
    if (!openedTarget.ok) {
      state.resources.push(targetBaseResource(
        state,
        operation,
        openedTarget.cleanupAuthority,
      ));
      throw Object.assign(
        new Error(openedTarget.reason ?? 'target training base is unavailable'),
        { code: openedTarget.errorCode },
      );
    }
    state.targetAuthority = openedTarget.authority;
    state.resources.push(targetBaseResource(state, operation));
    const target = await verifyTargetTrainingBaseAuthority(
      state.targetAuthority,
      operation,
    );
    const opened = await openTargetTrainingSnapshotFileSet({
      modelId: target.trainerModelId,
      revision: target.trainerRevision,
      baseArtifactSha256: target.baseArtifactSha256,
      tokenizerSha256: target.tokenizerSha256,
    }, operation);
    if (!opened.ok) {
      state.resources.push({
        close: () => retryTargetTrainingSnapshotFileSetCleanup(
          opened.cleanupAuthority,
          operation,
        ),
        closed: false,
      });
      throw Object.assign(new Error('target training snapshot cache cleanup is required'), {
        code: opened.errorCode,
      });
    }
    const cached = opened.authority;
    state.fileSet = cached.fileSet;
    state.resources.push({ close: () => state.fileSet.close(), closed: false });
    state.projection = targetTrainingSnapshotProjection({
      kind: 'refinement-target-training-snapshot-projection-v1',
      schemaVersion: 1,
      target,
      targetTrainingBaseAuthoritySha256: state.targetAuthority.sha256,
      snapshot: {
        modelId: cached.snapshot.modelId,
        revision: cached.snapshot.revision,
        baseArtifactSha256: cached.snapshot.baseArtifactSha256,
        tokenizerSha256: cached.snapshot.tokenizerSha256,
        manifestSha256: state.fileSet.manifestSha256,
        safetensorsIndexSha256: cached.snapshot.safetensorsIndexSha256,
        fileCount: state.fileSet.fileCount,
        totalBytes: state.fileSet.totalBytes,
      },
    });
    state.sha256 = targetTrainingSnapshotAuthoritySha256(state.projection);
    state.owner = 'prepared';
    const authority = authorityView(state, 'prepared');
    await verifyState(state, 'prepared');
    return Object.freeze({ ok: true, authority });
  } catch (error) {
    return acquisitionFailure(state, error);
  }
};

/** Assert one process-authentic owner bound to the exact active operation. Pure. */
export const assertTargetTrainingSnapshotAuthority = (authority, operation) => {
  const { state, role } = stateFor(authority, operation);
  if (state.owner !== role || state.phase !== 'open') {
    throw new Error(`target training snapshot owner is ${state.owner}/${state.phase}`);
  }
  state.operation.assertActive();
  return state.projection;
};

/** Verify one process-authentic combined owner and every held snapshot byte. */
export const verifyTargetTrainingSnapshotAuthority = async (
  authority,
  operation,
) => {
  const { state, role } = stateFor(authority, operation);
  return verifyState(state, role);
};

/** Transfer one prepared combined owner exactly once. */
export const transferTargetTrainingSnapshotAuthority = (authority, operation) => {
  const { state, role } = stateFor(authority, operation);
  if (role !== 'prepared' || state.owner !== role || state.phase !== 'open'
    || !state.acceptBorrow || state.borrows.size) {
    throw new Error('target training snapshot authority cannot be transferred');
  }
  state.targetAuthority = transferTargetTrainingBaseAuthority(
    state.targetAuthority,
    operation,
  );
  state.owner = 'transferred';
  return authorityView(state, 'transferred');
};

export const closeTargetTrainingSnapshotAuthority = async (authority, operation) => {
  const { state, role } = stateFor(authority, operation, false);
  if (state.owner !== role) return Object.freeze({ ok: true, closed: false });
  try {
    const closed = await closeState(state);
    OWNERS.delete(authority);
    return Object.freeze({ ok: true, closed });
  } catch {
    OWNERS.delete(authority);
    state.owner = 'cleanup';
    return Object.freeze({
      ok: false,
      errorCode: 'TRAINING_EXECUTION_CLEANUP_REQUIRED',
      cleanupAuthority: cleanupAuthority(state),
    });
  }
};

/** Verify and borrow path-free held snapshot descriptors only for one awaited use. */
export const withTargetTrainingSnapshotFiles = async (
  authority,
  operation,
  consumer,
) => {
  const { state, role } = stateFor(authority, operation);
  if (typeof consumer !== 'function' || !state.acceptBorrow) {
    throw new Error('target training snapshot descriptor borrow is invalid');
  }
  await verifyState(state, role);
  let release;
  const settled = new Promise((resolve) => { release = resolve; });
  state.borrows.add(settled);
  const borrowed = Object.freeze({
    manifestSha256: state.fileSet.manifestSha256,
    manifest: state.fileSet.manifest,
    files: state.fileSet.files,
    fileCount: state.fileSet.fileCount,
    totalBytes: state.fileSet.totalBytes,
  });
  try {
    const result = await consumer(borrowed);
    await verifyState(state, role);
    return result;
  } finally {
    state.borrows.delete(settled);
    release();
  }
};
