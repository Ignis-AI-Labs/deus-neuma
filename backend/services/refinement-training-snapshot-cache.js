import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { REFINEMENT_RESOURCE_LIMITS } from '../../core/refinement/training-authority-contract.js';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { sha256HandleStable } from './file-digest.js';
import { checkedByteSum, safeByteNumber } from './refinement-checked-arithmetic.js';
import {
  assertRefinementProcessOperation,
  assertRefinementProcessOperationIdentity,
} from './refinement-process-operation.js';
import {
  retryTrainingSnapshotStagingCleanup,
  stageReadOnlyTrainingSnapshot,
} from './refinement-training-snapshot-staging.js';
import {
  isAllowedRefinementSnapshotFile,
  validateRefinementSnapshotLayout,
} from './refinement-snapshot-layout.js';

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REVISION = /^[0-9a-f]{7,64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SNAPSHOT_PATH_BYTES_MAX = 1024;
const SERVER_HF_HUB_ROOT = path.resolve(
  process.env.HF_HOME || path.join(os.homedir(), '.cache', 'huggingface'),
  'hub',
);
const SOURCE_READ_FLAGS = constants.O_RDONLY
  | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0)
  | (typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0);
const HARD_SNAPSHOT_LIMITS = Object.freeze({
  depth: 32,
  nodes: REFINEMENT_RESOURCE_LIMITS.maxSnapshotFiles * 2 + 64,
  files: REFINEMENT_RESOURCE_LIMITS.maxSnapshotFiles,
  bytes: REFINEMENT_RESOURCE_LIMITS.trainingSnapshotMaxBytes,
});
const CLOSED_SOURCES = new WeakSet();
const CLEANUP_OWNERS = new WeakMap();

const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const sameState = (left, right) => left.dev === right.dev
  && left.ino === right.ino
  && left.size === right.size
  && left.mode === right.mode
  && left.uid === right.uid
  && left.gid === right.gid
  && left.nlink === right.nlink
  && left.mtimeNs === right.mtimeNs
  && left.ctimeNs === right.ctimeNs;

const snapshotSignal = (operation) => {
  const authority = assertRefinementProcessOperation(operation);
  authority.assertActive();
  return authority.signal;
};

const newBudget = (limits, signal) => ({
  limits, signal, nodes: 0, files: 0, bytes: 0n,
});

const assertSnapshotActive = (signal) => {
  if (signal.aborted) {
    throw Object.assign(new Error('training snapshot resolution exceeded its deadline'), {
      code: 'DIGEST_DEADLINE',
    });
  }
};

const snapshotOperation = async (signal, operation) => {
  assertSnapshotActive(signal);
  const value = await operation();
  assertSnapshotActive(signal);
  return value;
};
const utf8Compare = (left, right) =>
  Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));


const boundedRelativePath = (relative) => {
  const normalized = relative.split(path.sep).join('/');
  if (!normalized || normalized !== normalized.normalize('NFC')
    || Buffer.byteLength(normalized, 'utf8') > SNAPSHOT_PATH_BYTES_MAX
    || normalized.includes('\\') || /[\u0000-\u001f\u007f]/.test(normalized)
    || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('training snapshot contains an invalid logical path');
  }
  return normalized;
};

const directoryEntries = async (directory, budget) => {
  assertSnapshotActive(budget.signal);
  const entries = [];
  const stream = await snapshotOperation(budget.signal, () => fs.opendir(directory));
  for await (const entry of stream) {
    assertSnapshotActive(budget.signal);
    budget.nodes += 1;
    if (budget.nodes > budget.limits.nodes) {
      throw new Error('training snapshot exceeds the node limit');
    }
    entries.push(entry);
  }
  assertSnapshotActive(budget.signal);
  return entries.sort((left, right) => utf8Compare(left.name, right.name));
};

// A model with no blob tree can hold no symlink target, so its absence IS the
// escape and must be answered by the escape refusal — not by an ENOENT from
// realpath, which denies for a reason the caller never stated and cannot tell
// apart from a genuine infrastructure fault.
const verifiedBlobRoot = async (modelRoot, signal) => {
  const declared = path.join(modelRoot, 'blobs');
  let real;
  let stat;
  try {
    [real, stat] = await Promise.all([
      snapshotOperation(signal, () => fs.realpath(declared)),
      snapshotOperation(signal, () => fs.lstat(declared, { bigint: true })),
    ]);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
  if (real !== declared || !stat.isDirectory()) {
    throw new Error('training snapshot blob tree is not a direct directory');
  }
  return declared;
};

const closeDiscovered = async (discovered) => {
  const failures = [];
  for (let index = discovered.length - 1; index >= 0; index -= 1) {
    const source = discovered[index];
    if (CLOSED_SOURCES.has(source)) continue;
    try {
      await source.sourceHandle.close();
      CLOSED_SOURCES.add(source);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, 'pinned snapshot handles did not close');
};


const discoverSnapshot = async (snapshotRoot, modelRoot, budget, discovered) => {
  const pending = [{ relative: '', depth: 0 }];
  let blobs = null;
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    assertSnapshotActive(budget.signal);
    const { relative, depth } = pending[cursor];
    const directory = path.join(snapshotRoot, relative);
    for (const entry of await directoryEntries(directory, budget)) {
      const childDepth = depth + 1;
      if (childDepth > budget.limits.depth) {
        throw new Error('training snapshot exceeds the depth limit');
      }
      const childRelative = path.join(relative, entry.name);
      const relativePath = boundedRelativePath(childRelative);
      const logicalPath = path.join(snapshotRoot, childRelative);
      const logicalState = await snapshotOperation(
        budget.signal,
        () => fs.lstat(logicalPath, { bigint: true }),
      );
      if (entry.isDirectory() && logicalState.isDirectory()) {
        pending.push({ relative: childRelative, depth: childDepth });
        continue;
      }
      if (!isAllowedRefinementSnapshotFile(relativePath)) {
        throw new Error('training snapshot contains an unapproved file');
      }
      budget.files += 1;
      if (budget.files > budget.limits.files) {
        throw new Error('training snapshot exceeds the file limit');
      }
      let sourcePath = logicalPath;
      let sourceState = logicalState;
      if (entry.isSymbolicLink() && logicalState.isSymbolicLink()) {
        blobs ??= await verifiedBlobRoot(modelRoot, budget.signal);
        // No blob tree, or a link that resolves nowhere, is inside no tree at
        // all: that IS the escape, and it must be refused by name.
        const resolved = blobs === null ? null : await snapshotOperation(
          budget.signal,
          () => fs.realpath(logicalPath).then((value) => value, () => null),
        );
        const resolvedState = resolved === null ? null : await snapshotOperation(
          budget.signal,
          () => fs.lstat(resolved, { bigint: true }),
        );
        if (resolved === null || !inside(blobs, resolved) || resolved === blobs
          || !resolvedState.isFile()) {
          throw new Error('training snapshot symlink escapes its model blob tree');
        }
        sourcePath = resolved;
        sourceState = resolvedState;
      } else {
        const real = await snapshotOperation(
          budget.signal,
          () => fs.realpath(logicalPath),
        );
        if (!entry.isFile() || !logicalState.isFile() || real !== logicalPath) {
          throw new Error('training snapshot contains a symlink or non-file entry');
        }
      }
      const bytes = safeByteNumber(
        sourceState.size,
        'training snapshot file bytes',
        budget.limits.bytes,
      );
      const totalBytes = checkedByteSum(
        budget.bytes,
        sourceState.size,
        budget.limits.bytes,
        'training snapshot aggregate bytes',
      );
      assertSnapshotActive(budget.signal);
      const sourceHandle = await fs.open(sourcePath, SOURCE_READ_FLAGS);
      try {
        assertSnapshotActive(budget.signal);
        const opened = await sourceHandle.stat({ bigint: true });
        assertSnapshotActive(budget.signal);
        if (!sameState(sourceState, opened) || !opened.isFile()) {
          throw new Error('training snapshot file changed while being pinned');
        }
        budget.bytes = totalBytes;
        discovered.push(Object.freeze({
          relativePath,
          logicalPath,
          sourcePath,
          logicalState,
          sourceState: opened,
          sourceHandle,
          bytes,
        }));
      } catch (error) {
        await sourceHandle.close();
        throw error;
      }
    }
  }
  return discovered.sort((left, right) =>
    utf8Compare(left.relativePath, right.relativePath));
};

const assertPinnedSourceState = async (source, signal) => {
  const [logicalAfter, sourceAfter, realAfter] = await Promise.all([
    snapshotOperation(signal, () => fs.lstat(source.logicalPath, { bigint: true })),
    snapshotOperation(signal, () => fs.lstat(source.sourcePath, { bigint: true })),
    snapshotOperation(signal, () => fs.realpath(source.logicalPath)),
  ]);
  if (!sameState(source.logicalState, logicalAfter)
    || !sameState(source.sourceState, sourceAfter) || realAfter !== source.sourcePath) {
    throw new Error('training snapshot changed while being inspected');
  }
};

const readPinnedSource = async (source, maximumBytes, signal) => {
  if (!source || source.bytes < 1 || source.bytes > maximumBytes) {
    throw new Error('training snapshot metadata exceeds its byte ceiling');
  }
  await assertPinnedSourceState(source, signal);
  const bytes = Buffer.alloc(source.bytes);
  for (let offset = 0; offset < bytes.length;) {
    assertSnapshotActive(signal);
    const { bytesRead } = await source.sourceHandle.read(
      bytes,
      offset,
      bytes.length - offset,
      offset,
    );
    if (bytesRead === 0) throw new Error('training snapshot metadata ended before its declared size');
    offset += bytesRead;
  }
  const trailing = Buffer.allocUnsafe(1);
  if ((await source.sourceHandle.read(trailing, 0, 1, source.bytes)).bytesRead !== 0) {
    throw new Error('training snapshot metadata grew while being inspected');
  }
  await assertPinnedSourceState(source, signal);
  return bytes;
};

const hashPinnedSource = async (source, signal) => {
  const sha256 = await sha256HandleStable(source.sourceHandle, {
    maximumBytes: Math.max(1, source.bytes),
    signal,
  });
  await assertPinnedSourceState(source, signal);
  return sha256;
};

const hashSnapshot = async (discovered, signal) => {
  const files = [];
  const sources = new Map();
  for (const source of discovered) {
    assertSnapshotActive(signal);
    const sha256 = await hashPinnedSource(source, signal);
    files.push(Object.freeze({ relativePath: source.relativePath, sha256, bytes: source.bytes }));
    sources.set(source.relativePath, source.sourceHandle);
  }
  return { files: Object.freeze(files), sources };
};

const targetSnapshotRequest = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',')
      !== 'baseArtifactSha256,modelId,revision,tokenizerSha256'
    || !MODEL_ID.test(String(value.modelId || ''))
    || !REVISION.test(String(value.revision || ''))
    || !SHA256.test(String(value.baseArtifactSha256 || ''))
    || !SHA256.test(String(value.tokenizerSha256 || ''))) {
    throw new Error('target training snapshot request is invalid');
  }
  return Object.freeze({
    modelId: value.modelId,
    revision: value.revision,
    baseArtifactSha256: value.baseArtifactSha256,
    tokenizerSha256: value.tokenizerSha256,
  });
};

const cleanupAuthority = (state) => {
  const authority = Object.freeze({
    kind: 'refinement-training-snapshot-cache-cleanup-v1',
  });
  CLEANUP_OWNERS.set(authority, state);
  return authority;
};

/** Retry incomplete cache snapshot cleanup under the original operation. */
export const retryTargetTrainingSnapshotFileSetCleanup = async (
  authority,
  suppliedOperation,
) => {
  const operation = assertRefinementProcessOperationIdentity(suppliedOperation);
  const state = CLEANUP_OWNERS.get(authority);
  if (!state || state.operation !== operation) {
    throw new Error('target training snapshot cache cleanup authority is unavailable');
  }
  const result = await state.close();
  CLEANUP_OWNERS.delete(authority);
  return result;
};

/**
 * Resolve and stage only the exact target lineage revision from the server-private
 * cache. The returned held file set is module-private input to the combined owner.
 */
export const openTargetTrainingSnapshotFileSet = async (request, operation) => {
  const target = targetSnapshotRequest(request);
  const activeOperation = assertRefinementProcessOperation(operation);
  const signal = snapshotSignal(activeOperation);
  const budget = newBudget(HARD_SNAPSHOT_LIMITS, signal);
  const modelRoot = path.join(
    SERVER_HF_HUB_ROOT,
    `models--${target.modelId.replace('/', '--')}`,
  );
  const snapshotRoot = path.join(modelRoot, 'snapshots', target.revision);
  const state = {
    operation: activeOperation,
    discovered: [],
    fileSet: null,
    stagingCleanupAuthority: null,
  };
  state.close = async () => {
    const failures = [];
    if (state.stagingCleanupAuthority) {
      try {
        await retryTrainingSnapshotStagingCleanup(
          state.stagingCleanupAuthority,
          state.operation,
        );
        state.stagingCleanupAuthority = null;
      } catch (error) {
        failures.push(error);
      }
    }
    if (state.fileSet) {
      try {
        await state.fileSet.close();
        state.fileSet = null;
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await closeDiscovered(state.discovered);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length) {
      throw new AggregateError(failures, 'training snapshot cache cleanup failed');
    }
    return true;
  };
  try {
    const [resolvedModelRoot, resolvedSnapshotRoot] = await Promise.all([
      snapshotOperation(signal, () => fs.realpath(modelRoot)),
      snapshotOperation(signal, () => fs.realpath(snapshotRoot)),
    ]);
    if (resolvedModelRoot !== modelRoot || resolvedSnapshotRoot !== snapshotRoot
      || !inside(modelRoot, snapshotRoot)) {
      throw new Error('exact target training snapshot escapes the server cache');
    }
    await discoverSnapshot(snapshotRoot, modelRoot, budget, state.discovered);
    const { files, sources } = await hashSnapshot(state.discovered, signal);
    const discoveredByPath = new Map(state.discovered.map((source) =>
      [source.relativePath, source]));
    const layout = await validateRefinementSnapshotLayout({
      files,
      signal,
      readEntry: async (relativePath, maximumBytes) => {
        const source = discoveredByPath.get(relativePath);
        if (!source) throw new Error('training snapshot metadata is unavailable');
        return readPinnedSource(source, maximumBytes, signal);
      },
    });
    const tokenizerFiles = layout.tokenizerFiles;
    const baseArtifactSha256 = refinementSha256({
      modelId: target.modelId,
      revision: target.revision,
      files,
    });
    const tokenizerSha256 = refinementSha256({
      modelId: target.modelId,
      revision: target.revision,
      files: tokenizerFiles,
    });
    if (baseArtifactSha256 !== target.baseArtifactSha256
      || tokenizerSha256 !== target.tokenizerSha256) {
      throw new Error('cached snapshot differs from the exact target training lineage');
    }
    const snapshot = Object.freeze({
      modelId: target.modelId,
      revision: target.revision,
      baseArtifactSha256,
      tokenizerSha256,
      safetensorsIndexSha256:
        files.find(({ relativePath }) => relativePath === 'model.safetensors.index.json')
          ?.sha256 ?? null,
      files,
      totalBytes: safeByteNumber(
        budget.bytes,
        'training snapshot aggregate bytes',
        HARD_SNAPSHOT_LIMITS.bytes,
      ),
    });
    const staged = await stageReadOnlyTrainingSnapshot({
      snapshot,
      sources,
      operation: activeOperation,
    });
    if (!staged.ok) {
      state.stagingCleanupAuthority = staged.cleanupAuthority;
      throw Object.assign(new Error('training snapshot staging cleanup is required'), {
        code: staged.errorCode,
      });
    }
    state.fileSet = staged.authority;
    await closeDiscovered(state.discovered);
    activeOperation.assertActive();
    return Object.freeze({
      ok: true,
      authority: Object.freeze({ snapshot, fileSet: state.fileSet }),
    });
  } catch (error) {
    try {
      await state.close();
    } catch {
      return Object.freeze({
        ok: false,
        errorCode: 'TRAINING_EXECUTION_CLEANUP_REQUIRED',
        cleanupAuthority: cleanupAuthority(state),
      });
    }
    throw error;
  }
};
