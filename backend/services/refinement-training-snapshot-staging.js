import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { REFINEMENT_RESOURCE_LIMITS } from '../../core/refinement/training-authority-contract.js';
import {
  assertRefinementProcessOperation,
  assertRefinementProcessOperationIdentity,
} from './refinement-process-operation.js';
import {
  retryRefinementImmutableFileSetCleanup,
  stageImmutableFileSet,
} from './refinement-immutable-staging-internal/file-set.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const READ = constants.O_RDONLY
  | (typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0);
const SNAPSHOT_PATH_BYTES_MAX = 1024;
const CLEANUP_OWNERS = new WeakMap();

const sameState = (left, right) => left.dev === right.dev
  && left.ino === right.ino && left.size === right.size && left.mode === right.mode
  && left.uid === right.uid && left.gid === right.gid && left.nlink === right.nlink
  && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
const readOnlyEntry = async (source, operation, entries, relativePath = null) => {
  const handle = await fs.open(`/proc/self/fd/${source.fd}`, READ);
  let closed = false;
  const close = async () => {
    if (closed) return false;
    await handle.close();
    closed = true;
    return true;
  };
  const entry = { authority: null, close, closed: false };
  entries.push(entry);
  const initial = await handle.stat({ bigint: true });
  if (!initial.isFile() || initial.nlink !== 0n || (initial.mode & 0o777n) !== 0o400n
    || initial.size !== BigInt(source.bytes)) {
    throw new Error('anonymous training snapshot descriptor is not read-only and unlinked');
  }
  const verify = async (suppliedOperation) => {
    if (assertRefinementProcessOperation(suppliedOperation) !== operation) {
      throw new Error('training snapshot descriptor operation changed');
    }
    if (closed || !sameState(initial, await handle.stat({ bigint: true }))) {
      throw new Error('anonymous training snapshot descriptor changed');
    }
    return true;
  };
  entry.authority = Object.freeze({
    ...(relativePath === null ? {} : { relativePath }),
    handle,
    fd: handle.fd,
    sha256: source.sha256,
    bytes: source.bytes,
    mode: 0o400,
    verify,
  });
  return entry;
};

const closeEntries = async (entries) => {
  const failures = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.closed) continue;
    try {
      await entry.close();
      entry.closed = true;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, 'training snapshot descriptor close failed');
};

const validateStaged = (authority, snapshot) => {
  const expected = new Map(snapshot.files.map((file) => [file.relativePath, file]));
  if (authority?.schemaVersion !== 2 || authority.kind !== 'immutable-file-set'
    || authority.format !== 'neuma-file-set-v1'
    || authority.manifestKind !== 'neuma-snapshot-manifest'
    || !SHA256.test(String(authority.manifestSha256 || ''))
    || authority.manifest?.sha256 !== authority.manifestSha256
    || authority.manifest?.mode !== 0o400
    || authority.fileCount !== snapshot.files.length
    || authority.totalBytes !== snapshot.totalBytes
    || !Array.isArray(authority.files) || authority.files.length !== snapshot.files.length
    || authority.files.some((file) => {
      const declared = expected.get(file.relativePath);
      return !declared || file.sha256 !== declared.sha256 || file.bytes !== declared.bytes
        || file.mode !== 0o400;
    })) {
    throw new Error('staged training snapshot differs from its exact file authority');
  }
  return authority;
};

const cleanupAuthority = (state) => {
  const authority = Object.freeze({
    kind: 'refinement-training-snapshot-staging-cleanup-v1',
  });
  CLEANUP_OWNERS.set(authority, state);
  return authority;
};

/** Retry one incomplete staging cleanup under its exact originating operation. */
export const retryTrainingSnapshotStagingCleanup = async (
  authority,
  suppliedOperation,
) => {
  const operation = assertRefinementProcessOperationIdentity(suppliedOperation);
  const state = CLEANUP_OWNERS.get(authority);
  if (!state || state.operation !== operation) {
    throw new Error('training snapshot staging cleanup authority is unavailable');
  }
  const result = await state.close();
  CLEANUP_OWNERS.delete(authority);
  return result;
};

/** Copy one exact snapshot into unlinked descriptors, then discard every writer. */
export const stageReadOnlyTrainingSnapshot = async ({ snapshot, sources, operation }) => {
  const activeOperation = assertRefinementProcessOperation(operation);
  if (!snapshot || !Array.isArray(snapshot.files) || !(sources instanceof Map)
    || sources.size !== snapshot.files.length) {
    throw new Error('training snapshot staging input is incomplete');
  }
  const state = {
    entries: [],
    writer: null,
    writerCleanupAuthority: null,
    writerClosed: false,
    phase: 'acquiring',
    closePromise: null,
    cleanupError: null,
    operation: activeOperation,
  };
  state.close = () => {
    if (state.phase === 'closed') return Promise.resolve(false);
    if (state.closePromise) return state.closePromise;
    state.phase = 'closing';
    state.closePromise = (async () => {
      const failures = [];
      if (!state.writerClosed && state.writerCleanupAuthority) {
        const result = await retryRefinementImmutableFileSetCleanup(
          state.writerCleanupAuthority,
          activeOperation,
        );
        if (result.ok) {
          state.writerCleanupAuthority = null;
          state.writerClosed = true;
        } else {
          state.writerCleanupAuthority = result.cleanupAuthority;
          failures.push(new Error('immutable snapshot staging cleanup is incomplete'));
        }
      } else if (!state.writerClosed && state.writer) {
        try { await state.writer.close(activeOperation); state.writerClosed = true; }
        catch (error) { failures.push(error); }
      }
      try { await closeEntries(state.entries); } catch (error) { failures.push(error); }
      if (failures.length) {
        state.phase = 'cleanup-failed';
        state.cleanupError = new AggregateError(failures, 'training snapshot staging cleanup failed');
        throw state.cleanupError;
      }
      state.phase = 'closed';
      state.cleanupError = null;
      return true;
    })().finally(() => { state.closePromise = null; });
    return state.closePromise;
  };
  try {
    activeOperation.assertActive();
    const staged = await stageImmutableFileSet({
      label: 'training snapshot',
      files: snapshot.files.map((file) => Object.freeze({
        relativePath: file.relativePath,
        handle: sources.get(file.relativePath),
        sha256: file.sha256,
        maximumBytes: Math.max(1, file.bytes),
        mode: 0o400,
      })),
      maximumFiles: REFINEMENT_RESOURCE_LIMITS.maxSnapshotFiles,
      maximumBytes: REFINEMENT_RESOURCE_LIMITS.trainingSnapshotMaxBytes,
      maximumDepth: 32,
      maximumPathBytes: SNAPSHOT_PATH_BYTES_MAX,
      manifestKind: 'neuma-snapshot-manifest',
      operation: activeOperation,
    });
    if (!staged.ok) {
      state.writerCleanupAuthority = staged.cleanupAuthority ?? null;
      throw new Error(staged.errorCode);
    }
    state.writer = validateStaged(staged.authority, snapshot);
    await readOnlyEntry(state.writer.manifest, activeOperation, state.entries);
    for (const source of state.writer.files) {
      await readOnlyEntry(
        source,
        activeOperation,
        state.entries,
        source.relativePath,
      );
    }
    await state.writer.close(activeOperation);
    state.writerClosed = true;
    activeOperation.assertActive();
    state.phase = 'open';
    const verify = async (suppliedOperation) => {
      const operation = assertRefinementProcessOperation(suppliedOperation);
      if (operation !== activeOperation || state.phase !== 'open') {
        throw new Error(`training snapshot descriptor set is ${state.phase}`);
      }
      for (const entry of state.entries) await entry.authority.verify(operation);
      operation.assertActive();
      return true;
    };
    const close = () => state.close();
    const result = Object.freeze({
      manifestSha256: state.writer.manifestSha256,
      manifest: state.entries[0].authority,
      files: Object.freeze(state.entries.slice(1).map(({ authority }) => authority)),
      fileCount: state.writer.fileCount,
      totalBytes: state.writer.totalBytes,
      verify,
      close,
    });
    await verify(activeOperation);
    return Object.freeze({ ok: true, authority: result });
  } catch (error) {
    try { await state.close(); } catch {
      return Object.freeze({
        ok: false,
        errorCode: 'TRAINING_EXECUTION_CLEANUP_REQUIRED',
        cleanupAuthority: cleanupAuthority(state),
      });
    }
    throw error;
  }
};
