import path from 'node:path';
import { getDataRoot } from '../data-root.js';
import { sha256HandleStable } from '../file-digest.js';
import {
  assertStableArtifactSource,
  copyArtifactHandle,
  openStableArtifactSource,
} from './source-copy.js';
import { publishDurableArtifact } from './durable-cas.js';
import {
  samePinnedDirectoryState,
} from '../refinement-directory-custody-identity.js';
import { assertRefinementProcessOperation } from '../refinement-process-operation.js';

const SHA256 = /^[a-f0-9]{64}$/;
const heldAuthorities = new WeakMap();
const artifactRoot = () => path.join(getDataRoot(), 'refinement-artifacts');

const operationFor = (operation, label) => {
  try {
    return assertRefinementProcessOperation(operation);
  } catch (error) {
    throw new Error(`${label} operation is invalid`, { cause: error });
  }
};
const sameOperation = (state, supplied) => {
  if (supplied !== state.operation) throw new Error(`${state.label} operation changed`);
  return state.operation;
};

const makeHeldAuthority = ({
  handle, sha256, bytes, state, label, operation,
}) => {
  let phase = 'open';
  let closePromise = null;
  let authority;
  const verify = async (suppliedOperation) => {
    const held = heldAuthorities.get(authority);
    if (!held || phase !== 'open') throw new Error(`${label} authority is ${phase}`);
    const active = operationFor(sameOperation(held, suppliedOperation), label);
    const before = await handle.stat({ bigint: true });
    if (!samePinnedDirectoryState(state, before)) throw new Error(`${label} inode identity changed`);
    const digest = await sha256HandleStable(handle, {
      maximumBytes: bytes,
      signal: active.signal,
      deadline: active.epochDeadline,
    });
    const after = await handle.stat({ bigint: true });
    if (!samePinnedDirectoryState(state, after) || digest !== sha256) {
      throw new Error(`${label} content identity changed`);
    }
    active.assertActive();
    return true;
  };
  const close = (suppliedOperation) => {
    const held = heldAuthorities.get(authority);
    if (!held) throw new Error(`${label} authority is invalid`);
    sameOperation(held, suppliedOperation);
    if (phase === 'closed') return Promise.resolve(false);
    if (closePromise) return closePromise;
    phase = 'closing';
    closePromise = handle.close().then(
      () => { phase = 'closed'; return true; },
      (error) => { phase = 'cleanup-failed'; throw error; },
    ).finally(() => { closePromise = null; });
    return closePromise;
  };
  authority = Object.freeze({
    kind: 'durable-artifact-authority-v2',
    sha256,
    bytes,
    verify,
    close,
  });
  heldAuthorities.set(authority, {
    handle,
    state,
    label,
    operation,
    phase: () => phase,
  });
  return authority;
};

/** Hold an already-open descriptor as a serving artifact — no copy. */
export const holdExistingArtifactHandle = ({
  handle, sha256, bytes, state, label, operation,
}) => makeHeldAuthority({ handle, sha256, bytes, state, label, operation });

const ensureTrustedDeclaration = (sha256, maximumBytes, label) => {
  if (!SHA256.test(String(sha256 || ''))
    || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error(`${label} requires a trusted sha256 and positive byte ceiling`);
  }
};

const closeSource = async (source, error, label) => {
  try {
    await source.handle.close();
  } catch (closeError) {
    throw new AggregateError([error, closeError], `${label} operation and source release failed`, { cause: closeError });
  }
  throw error;
};

/** Open and retain one exact direct source without publishing it. Impure. */
export const openVerifiedArtifactFile = async ({
  sourcePath,
  sha256,
  maximumBytes,
  label = 'artifact',
  operation,
}) => {
  if (typeof sourcePath !== 'string' || !sourcePath) {
    throw new Error(`${label} authority requires a source path`);
  }
  ensureTrustedDeclaration(sha256, maximumBytes, label);
  const active = operationFor(operation, label);
  const controls = { signal: active.signal, deadline: active.epochDeadline };
  const source = await openStableArtifactSource(sourcePath, maximumBytes, label);
  try {
    const digest = await sha256HandleStable(source.handle, { maximumBytes, ...controls });
    await assertStableArtifactSource(source, label);
    active.assertActive();
    if (digest !== sha256) throw new Error(`${label} differs from its trusted digest`);
    return makeHeldAuthority({
      handle: source.handle,
      sha256,
      bytes: Number(source.before.size),
      state: source.before,
      label,
      operation: active,
    });
  } catch (error) {
    return closeSource(source, error, label);
  }
};

const publishFromHeldSource = async ({
  sourceHandle,
  expectedSha256,
  maximumBytes,
  label,
  root,
  sourceState,
  operation,
}) => {
  const active = operationFor(operation, label);
  const durable = await publishDurableArtifact({
    root,
    expectedSha256,
    maximumBytes,
    write: async (output) => {
      const copied = await copyArtifactHandle({
        sourceHandle,
        output,
        maximumBytes,
        label,
        signal: active.signal,
      });
      if (sourceState && !samePinnedDirectoryState(sourceState, await sourceHandle.stat({ bigint: true }))) {
        throw new Error(`${label} held source changed while being published`);
      }
      active.assertActive();
      return copied;
    },
  });
  return makeHeldAuthority({
    handle: durable.handle,
    sha256: durable.sha256,
    bytes: durable.bytes,
    state: durable.state,
    label,
    operation: active,
  });
};

/** Publish a direct source whose digest has already been trusted. Impure. */
export const stageArtifactFile = async ({
  sourcePath,
  sha256,
  maximumBytes,
  label = 'artifact',
  root = artifactRoot(),
  operation,
}) => {
  if (typeof sourcePath !== 'string' || !sourcePath) {
    throw new Error(`${label} staging requires a source path`);
  }
  ensureTrustedDeclaration(sha256, maximumBytes, label);
  const active = operationFor(operation, label);
  const source = await openStableArtifactSource(sourcePath, maximumBytes, label);
  try {
    const authority = await publishFromHeldSource({
      sourceHandle: source.handle,
      sourceState: source.before,
      expectedSha256: sha256,
      maximumBytes,
      label,
      root,
      operation: active,
    });
    await assertStableArtifactSource(source, label);
    try {
      await source.handle.close();
    } catch (closeError) {
      try { await authority.close(active); } catch (authorityCloseError) {
        throw new AggregateError(
          [closeError, authorityCloseError],
          `${label} source and authority release failed`, { cause: authorityCloseError },
        );
      }
      throw closeError;
    }
    return authority;
  } catch (error) {
    return closeSource(source, error, label);
  }
};

/** Publish one already-held trusted descriptor without reopening a mutable path. Impure. */
export const stageArtifactHandle = async ({
  sourceHandle,
  sha256,
  maximumBytes,
  label = 'artifact',
  root = artifactRoot(),
  operation,
}) => {
  if (!sourceHandle || typeof sourceHandle.stat !== 'function') {
    throw new Error(`${label} staging requires a held descriptor`);
  }
  ensureTrustedDeclaration(sha256, maximumBytes, label);
  const active = operationFor(operation, label);
  const before = await sourceHandle.stat({ bigint: true });
  if (!before.isFile() || before.size < 1n || before.size > BigInt(maximumBytes)
    || (before.mode & 0o022n) !== 0n) {
    throw new Error(`${label} held descriptor exceeds its byte authority`);
  }
  return publishFromHeldSource({
    sourceHandle,
    sourceState: before,
    expectedSha256: sha256,
    maximumBytes,
    label,
    root,
    operation: active,
  });
};

/** Publish another live branded artifact authority without exposing its descriptor. */
export const stageArtifactAuthority = async ({
  sourceAuthority,
  sha256 = sourceAuthority?.sha256,
  maximumBytes,
  label = 'artifact',
  root = artifactRoot(),
  operation,
}) => {
  const source = heldAuthorities.get(sourceAuthority);
  if (!source || source.phase() !== 'open' || sha256 !== sourceAuthority.sha256) {
    throw new Error(`${label} source authority is invalid`);
  }
  const active = operationFor(operation, label);
  await sourceAuthority.verify(active);
  return publishFromHeldSource({
    sourceHandle: source.handle,
    sourceState: source.state,
    expectedSha256: sha256,
    maximumBytes,
    label,
    root,
    operation: active,
  });
};

/** Publish one newly generated direct source and derive its digest during the copy. Impure. */
export const stageGeneratedArtifactFile = async ({
  sourcePath,
  maximumBytes,
  label = 'generated artifact',
  root = artifactRoot(),
  operation,
}) => {
  if (typeof sourcePath !== 'string' || !sourcePath
    || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error(`${label} staging requires a source path and positive byte ceiling`);
  }
  const active = operationFor(operation, label);
  const source = await openStableArtifactSource(sourcePath, maximumBytes, label);
  try {
    const authority = await publishFromHeldSource({
      sourceHandle: source.handle,
      sourceState: source.before,
      expectedSha256: null,
      maximumBytes,
      label,
      root,
      operation: active,
    });
    await assertStableArtifactSource(source, label);
    try {
      await source.handle.close();
    } catch (closeError) {
      try { await authority.close(active); } catch (authorityCloseError) {
        throw new AggregateError(
          [closeError, authorityCloseError],
          `${label} source and authority release failed`, { cause: authorityCloseError },
        );
      }
      throw closeError;
    }
    return authority;
  } catch (error) {
    return closeSource(source, error, label);
  }
};

/** Rehash through the retained exact descriptor. */
export const verifyStagedArtifactHandle = async (authority, operation) => {
  if (!heldAuthorities.has(authority) || typeof authority?.verify !== 'function') {
    throw new Error('staged artifact authority is invalid');
  }
  await authority.verify(operation);
  return Object.freeze({ sha256: authority.sha256, bytes: authority.bytes });
};

/** Release the sole retained owner; failed closes remain retryable. */
export const releaseStagedArtifactHandle = async (authority, operation) => {
  if (!heldAuthorities.has(authority) || typeof authority?.close !== 'function') return false;
  return authority.close(operation);
};

/** Borrow one descriptor only for immediate inherited-child stdio assembly. */
export const borrowStagedArtifactForSpawn = async (authority, operation) => {
  const held = heldAuthorities.get(authority);
  if (!held || held.phase() !== 'open') {
    throw new Error('staged artifact authority is invalid');
  }
  await authority.verify(operation);
  return Object.freeze({ fd: held.handle.fd });
};

/** Resolve digest-only registry storage fields from one live server-minted authority. */
export const stagedArtifactRegistryFields = async (authority, operation) => {
  const held = heldAuthorities.get(authority);
  if (!held || held.phase() !== 'open') {
    throw new Error('staged artifact registry authority is invalid');
  }
  await authority.verify(operation);
  return Object.freeze({ sha256: authority.sha256 });
};