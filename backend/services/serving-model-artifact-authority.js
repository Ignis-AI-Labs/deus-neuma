import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { sha256HandleStable } from './file-digest.js';
import {
  assertCommittedRefinementLineageEvidence,
  projectCommittedRefinementLineageConfigAuthority,
  resolveRefinementLineageAuthority,
  verifyCommittedRefinementLineageConfigAuthority,
} from './refinement-lineage-authority.js';
import {
  holdExistingArtifactHandle,
} from './refinement-artifact-internal/held-authority.js';
import {
  assertRefinementProcessOperation,
} from './refinement-process-operation.js';

const SIDECAR_BYTES_MAX = 16 * 1024;
const SERVING_MODEL_BYTES_MAX = 64 * 1024 ** 3;
const SHA256 = /^[0-9a-f]{64}$/;
const READ_FLAGS = constants.O_RDONLY
  | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0)
  | (typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0);
const servingModelAuthorities = new WeakMap();

const sameState = (left, right) => left.dev === right.dev
  && left.ino === right.ino
  && left.size === right.size
  && left.mode === right.mode
  && left.uid === right.uid
  && left.gid === right.gid
  && left.nlink === right.nlink
  && left.mtimeNs === right.mtimeNs
  && left.ctimeNs === right.ctimeNs;

const assertStableRegular = (snapshots, label) => {
  if (snapshots.some((snapshot) => !snapshot.isFile())
    || snapshots.some((snapshot) => !sameState(snapshots[0], snapshot))) {
    throw new Error(`${label} is not a stable regular file`);
  }
};

const assertActive = (signal) => {
  if (signal.aborted) {
    throw Object.assign(new Error('serving artifact verification exceeded its deadline'), {
      code: 'SERVING_ARTIFACT_DEADLINE',
    });
  }
};

const stateSha256 = (stat) => refinementSha256({
  dev: String(stat.dev),
  ino: String(stat.ino),
  size: String(stat.size),
  mode: String(stat.mode),
  uid: String(stat.uid),
  gid: String(stat.gid),
  nlink: String(stat.nlink),
  mtimeNs: String(stat.mtimeNs),
  ctimeNs: String(stat.ctimeNs),
});

const openPinnedFile = async (filePath, maximumBytes, label, signal) => {
  assertActive(signal);
  const pathBefore = await fs.lstat(filePath, { bigint: true });
  assertActive(signal);
  if (!pathBefore.isFile() || pathBefore.size <= 0n
    || pathBefore.size > BigInt(maximumBytes)) {
    throw new Error(`${label} is outside the supported envelope`);
  }
  const handle = await fs.open(filePath, READ_FLAGS);
  try {
    const opened = await handle.stat({ bigint: true });
    assertActive(signal);
    assertStableRegular([pathBefore, opened], label);
    return Object.freeze({ filePath, handle, state: opened });
  } catch (error) {
    await handle.close();
    throw error;
  }
};

const assertPinnedState = async (pinned, label, signal) => {
  assertActive(signal);
  const [descriptor, pathState] = await Promise.all([
    pinned.handle.stat({ bigint: true }),
    fs.lstat(pinned.filePath, { bigint: true }),
  ]);
  assertActive(signal);
  assertStableRegular([pinned.state, descriptor, pathState], label);
};

const readPinnedJson = async (filePath, label, signal) => {
  const pinned = await openPinnedFile(filePath, SIDECAR_BYTES_MAX, label, signal);
  try {
    const bytes = Buffer.alloc(Number(pinned.state.size));
    for (let offset = 0; offset < bytes.length;) {
      assertActive(signal);
      const { bytesRead } = await pinned.handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (bytesRead === 0) throw new Error(`${label} ended before its declared size`);
      offset += bytesRead;
    }
    const trailing = Buffer.allocUnsafe(1);
    if ((await pinned.handle.read(trailing, 0, 1, bytes.length)).bytesRead !== 0) {
      throw new Error(`${label} grew while being read`);
    }
    await assertPinnedState(pinned, label, signal);
    return JSON.parse(bytes.toString('utf8'));
  } finally {
    await pinned.handle.close();
  }
};


const boundedServingKey = (value) => typeof value === 'string'
  && value.length > 0
  && value.length <= 512
  && value.trim() === value
  && !/[\u0000-\u001f\u007f]/.test(value);

/**
 * Open and bind one serving GGUF to an already validated lineage authority.
 * The returned descriptor is the exact inode hashed here and must remain held
 * until its staging/consumer boundary completes. impure.
 */
export const openServingModelTrainingLineageFromAuthority = async ({
  modelPath,
  servingModel,
  lineageConfigAuthority,
  operation,
}) => {
  const activeOperation = assertRefinementProcessOperation(operation);
  const lineageConfig = projectCommittedRefinementLineageConfigAuthority(
    lineageConfigAuthority,
    activeOperation,
  );
  if (typeof modelPath !== 'string' || !modelPath || !boundedServingKey(servingModel)
    || !SHA256.test(String(lineageConfig.lineageConfigSha256 || ''))) {
    throw new Error('serving model training lineage authority is invalid');
  }
  const operationSignal = activeOperation.signal;
  let pinned = null;
  try {
    await verifyCommittedRefinementLineageConfigAuthority(
      lineageConfigAuthority,
      activeOperation,
    );
    pinned = await openPinnedFile(
      modelPath,
      SERVING_MODEL_BYTES_MAX,
      'serving model',
      operationSignal,
    );
    const identity = stateSha256(pinned.state);
    const servingArtifactSha256 = await sha256HandleStable(pinned.handle, {
      maximumBytes: SERVING_MODEL_BYTES_MAX,
      signal: operationSignal,
    });
    const lineage = await resolveRefinementLineageAuthority({
      lineageConfigAuthority,
      operation: activeOperation,
      servingModel,
      servingArtifactSha256,
    });
    await assertCommittedRefinementLineageEvidence({
      evidence: await readPinnedJson(
        `${modelPath}.training.json`,
        'serving model training lineage evidence',
        operationSignal,
      ),
      lineageConfigAuthority,
      operation: activeOperation,
      servingModel,
      servingArtifactSha256,
    });
    await verifyCommittedRefinementLineageConfigAuthority(
      lineageConfigAuthority,
      activeOperation,
    );
    await assertPinnedState(pinned, 'serving model', operationSignal);
    let phase = 'open';
    let closing = null;
    let handleOwnedHere = true;
    const assertSameOperation = (suppliedOperation, requireActive = true) => {
      if (suppliedOperation !== activeOperation) {
        throw new Error('serving model authority operation changed');
      }
      if (requireActive) activeOperation.assertActive();
    };
    const active = () => {
      if (phase !== 'open') throw new Error(`serving model authority is ${phase}`);
    };
    const verifyState = async (suppliedOperation) => {
      active();
      assertSameOperation(suppliedOperation);
      await assertPinnedState(pinned, 'serving model', activeOperation.signal);
      return true;
    };
    const verify = async (suppliedOperation) => {
      active();
      assertSameOperation(suppliedOperation);
      await verifyCommittedRefinementLineageConfigAuthority(
        lineageConfigAuthority,
        activeOperation,
      );
      await assertPinnedState(pinned, 'serving model', activeOperation.signal);
      const digest = await sha256HandleStable(pinned.handle, {
        maximumBytes: SERVING_MODEL_BYTES_MAX,
        signal: activeOperation.signal,
      });
      await assertPinnedState(pinned, 'serving model', activeOperation.signal);
      if (digest !== servingArtifactSha256) {
        throw new Error('serving model bytes differ from their committed authority');
      }
      return true;
    };
    const close = async (suppliedOperation) => {
      assertSameOperation(suppliedOperation, false);
      if (phase === 'closed') return false;
      if (closing) return closing;
      phase = 'closing';
      closing = (async () => {
        try {
          if (handleOwnedHere) await pinned.handle.close();
          phase = 'closed';
          return true;
        } catch (error) {
          phase = 'cleanup-failed';
          throw error;
        } finally {
          closing = null;
        }
      })();
      return closing;
    };
    const servingArtifact = Object.freeze({
      kind: 'borrowed-pinned-serving-artifact-v3',
      sha256: servingArtifactSha256,
      bytes: Number(pinned.state.size),
      mode: Number(pinned.state.mode & 0o777n),
      identity,
      verifyState,
      verify,
    });
    const authority = Object.freeze({
      kind: 'serving-model-lineage-authority-v3',
      lineage,
      lineageConfig,
      servingArtifact,
      verifyState,
      verify,
      close,
    });
    servingModelAuthorities.set(authority, {
      pinned,
      operation: activeOperation,
      phase: () => phase,
      transferHandle: () => { handleOwnedHere = false; },
    });
    return authority;
  } catch (error) {
    if (!pinned) {
      if (error?.code === 'SERVING_ARTIFACT_DEADLINE') throw error;
      throw new Error('serving model training lineage is not authorized', { cause: error });
    }
    try {
      await pinned.handle.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'serving model lineage authorization and cleanup failed', { cause: cleanupError },
      );
    }
    if (error?.code === 'SERVING_ARTIFACT_DEADLINE') throw error;
    throw new Error('serving model training lineage is not authorized', { cause: error });
  }
};

/** Hold the authorized serving model in place — no 30GB copy into the CAS. */
export const stageServingModelArtifactAuthority = async (
  authority,
  {
    label = 'serving model',
    operation,
  } = {},
) => {
  const state = servingModelAuthorities.get(authority);
  if (!state || state.phase() !== 'open' || operation !== state.operation
    || authority?.servingArtifact?.sha256 !== authority?.lineage?.servingArtifactSha256) {
    throw new Error('serving model staging authority is invalid');
  }
  const held = holdExistingArtifactHandle({
    handle: state.pinned.handle,
    sha256: authority.lineage.servingArtifactSha256,
    bytes: Number(state.pinned.state.size),
    state: state.pinned.state,
    label,
    operation,
  });
  state.transferHandle();
  return held;
};
