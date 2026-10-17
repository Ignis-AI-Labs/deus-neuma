import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataRoot } from './data-root.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import {
  openVerifiedArtifactFile,
  releaseStagedArtifactHandle,
  stageArtifactAuthority,
  verifyStagedArtifactHandle,
} from './refinement-artifact-internal/held-authority.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const trainedStates = new WeakMap();
const publicationStates = new WeakMap();
const committedStates = new WeakMap();
const cleanupStates = new WeakMap();

const assertOperationIdentity = (state, operation, active = true) => {
  if (!state || state.operation !== operation) {
    throw new Error('trained artifact operation changed');
  }
  if (active) assertRefinementProcessOperation(operation);
  return operation;
};
const projectionFor = (artifact) => Object.freeze({
  sha256: artifact.sha256,
  bytes: artifact.bytes,
  objectId: artifact.sha256,
});
const cleanupAuthorityFor = (operation, artifacts) => {
  const authority = Object.freeze({ kind: 'refinement-trained-artifact-cleanup-authority-v1' });
  cleanupStates.set(authority, { operation, artifacts: new Set(artifacts) });
  return authority;
};
const failed = (errorCode, cleanupAuthority = null) => Object.freeze({
  ok: false,
  errorCode,
  ...(cleanupAuthority ? { cleanupAuthority } : {}),
});
const closeArtifacts = async (artifacts, operation) => {
  const remaining = [];
  for (const artifact of artifacts) {
    try {
      await releaseStagedArtifactHandle(artifact, operation);
    } catch {
      remaining.push(artifact);
    }
  }
  return remaining;
};

/**
 * Adopt one converter output into an independently held durable CAS authority.
 * The source authority is always consumed; callers receive no path or descriptor.
 */
export const acquireRefinementTrainedArtifactAuthority = async ({
  artifactAuthority,
  operation,
}) => {
  const active = assertRefinementProcessOperation(operation);
  if (!artifactAuthority || !SHA256.test(String(artifactAuthority.sha256 || ''))
    || !Number.isSafeInteger(artifactAuthority.bytes) || artifactAuthority.bytes < 1) {
    throw new Error('trained artifact source authority is invalid');
  }
  let adopted = null;
  try {
    await verifyStagedArtifactHandle(artifactAuthority, active);
    adopted = await stageArtifactAuthority({
      sourceAuthority: artifactAuthority,
      sha256: artifactAuthority.sha256,
      maximumBytes: artifactAuthority.bytes,
      label: 'trained adapter artifact',
      operation: active,
    });
    await verifyStagedArtifactHandle(adopted, active);
    await releaseStagedArtifactHandle(artifactAuthority, active);
    const authority = Object.freeze({ kind: 'refinement-trained-artifact-authority-v1' });
    trainedStates.set(authority, {
      artifact: adopted,
      operation: active,
      projection: projectionFor(adopted),
    });
    return Object.freeze({ ok: true, authority });
  } catch {
    const remaining = await closeArtifacts(
      [...(adopted ? [adopted] : []), artifactAuthority],
      active,
    );
    return failed(
      remaining.length
        ? 'REFINEMENT_TRAINED_ARTIFACT_CLEANUP_FAILED'
        : 'REFINEMENT_TRAINED_ARTIFACT_ACQUISITION_FAILED',
      remaining.length ? cleanupAuthorityFor(active, remaining) : null,
    );
  }
};

const verifyRefinementTrainedArtifactAuthority = async (authority, operation) => {
  const state = trainedStates.get(authority);
  assertOperationIdentity(state, operation);
  const verified = await verifyStagedArtifactHandle(state.artifact, operation);
  if (verified.sha256 !== state.projection.sha256
    || verified.bytes !== state.projection.bytes) {
    throw new Error('trained artifact content authority changed');
  }
  return authority;
};

/** Transfer sole lifecycle ownership into the publication transaction exactly once. */
export const transferRefinementTrainedArtifactToPublication = async (
  authority,
  operation,
) => {
  const state = trainedStates.get(authority);
  assertOperationIdentity(state, operation);
  await verifyRefinementTrainedArtifactAuthority(authority, operation);
  const publicationAuthority = Object.freeze({
    kind: 'refinement-publication-artifact-authority-v1',
  });
  publicationStates.set(publicationAuthority, state);
  trainedStates.delete(authority);
  return publicationAuthority;
};

export const verifyRefinementPublicationArtifactAuthority = async (authority, operation) => {
  const state = publicationStates.get(authority);
  assertOperationIdentity(state, operation);
  const verified = await verifyStagedArtifactHandle(state.artifact, operation);
  if (verified.sha256 !== state.projection.sha256
    || verified.bytes !== state.projection.bytes) {
    throw new Error('publication artifact content authority changed');
  }
  return authority;
};

export const projectRefinementPublicationArtifactAuthority = (authority, operation) => {
  const state = publicationStates.get(authority);
  assertOperationIdentity(state, operation);
  return state.projection;
};

const settleArtifact = async (states, authority, operation, verify) => {
  const state = states.get(authority);
  assertOperationIdentity(state, operation, false);
  if (verify) await verify(authority, operation);
  try {
    await releaseStagedArtifactHandle(state.artifact, operation);
    states.delete(authority);
    return Object.freeze({ ok: true });
  } catch {
    states.delete(authority);
    return failed(
      'REFINEMENT_TRAINED_ARTIFACT_CLEANUP_FAILED',
      cleanupAuthorityFor(operation, [state.artifact]),
    );
  }
};

/** Complete publication ownership after commit or refusal; commit re-verifies exact bytes. */
export const settleRefinementArtifactPublication = ({
  publicationArtifactAuthority,
  operation,
  outcome,
}) => {
  if (!['committed', 'refused'].includes(outcome)) {
    throw new Error('publication artifact outcome is invalid');
  }
  return settleArtifact(
    publicationStates,
    publicationArtifactAuthority,
    operation,
    outcome === 'committed' ? verifyRefinementPublicationArtifactAuthority : null,
  );
};
const committedArtifactInput = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Reflect.ownKeys(input).some((key) => typeof key !== 'string')
    || Object.keys(input).sort().join(',') !== 'bytes,operation,sha256'
    || !SHA256.test(String(input.sha256 || ''))
    || !Number.isSafeInteger(input.bytes) || input.bytes < 1) {
    throw new Error('committed trained artifact verification request is invalid');
  }
  return Object.freeze({
    sha256: input.sha256,
    bytes: input.bytes,
    operation: assertRefinementProcessOperation(input.operation),
  });
};

/** Open one exact private CAS object as an opaque same-operation held authority. */
export const openCommittedRefinementArtifactAuthority = async (input) => {
  const exact = committedArtifactInput(input);
  const sourcePath = path.join(
    getDataRoot(),
    'refinement-artifacts',
    'objects',
    exact.sha256,
    'bytes',
  );
  let artifact = null;
  try {
    const state = await fs.lstat(sourcePath, { bigint: true });
    const owner = BigInt(typeof process.geteuid === 'function' ? process.geteuid() : 0);
    if (!state.isFile() || state.uid !== owner || state.nlink !== 1n
      || (state.mode & 0o777n) !== 0o400n || state.size !== BigInt(exact.bytes)) {
      throw new Error('committed CAS object state is invalid');
    }
    artifact = await openVerifiedArtifactFile({
      sourcePath,
      sha256: exact.sha256,
      maximumBytes: exact.bytes,
      label: 'committed trained artifact',
      operation: exact.operation,
    });
    const verified = await verifyStagedArtifactHandle(artifact, exact.operation);
    if (verified.bytes !== exact.bytes || verified.sha256 !== exact.sha256) {
      throw new Error('committed CAS object identity is invalid');
    }
    const authority = Object.freeze({
      kind: 'committed-refinement-artifact-authority-v1',
    });
    committedStates.set(authority, {
      artifact,
      operation: exact.operation,
      projection: projectionFor(artifact),
    });
    return Object.freeze({ ok: true, authority });
  } catch {
    const remaining = artifact
      ? await closeArtifacts([artifact], exact.operation)
      : [];
    return failed(
      remaining.length
        ? 'REFINEMENT_COMMITTED_ARTIFACT_CLEANUP_FAILED'
        : 'REFINEMENT_COMMITTED_ARTIFACT_INVALID',
      remaining.length ? cleanupAuthorityFor(exact.operation, remaining) : null,
    );
  }
};

export const verifyCommittedRefinementArtifactAuthority = async (authority, operation) => {
  const state = committedStates.get(authority);
  assertOperationIdentity(state, operation);
  const verified = await verifyStagedArtifactHandle(state.artifact, operation);
  if (verified.sha256 !== state.projection.sha256
    || verified.bytes !== state.projection.bytes) {
    throw new Error('committed trained artifact content authority changed');
  }
  return authority;
};

export const projectCommittedRefinementArtifactAuthority = (authority, operation) => {
  const state = committedStates.get(authority);
  assertOperationIdentity(state, operation);
  return state.projection;
};
export const closeCommittedRefinementArtifactAuthority = (authority, operation) =>
  settleArtifact(committedStates, authority, operation, null);

/** Re-open, re-attest, and deterministically close one journal-committed CAS object. */
export const verifyCommittedRefinementArtifact = async (input) => {
  const opened = await openCommittedRefinementArtifactAuthority(input);
  if (!opened.ok) throw new Error(opened.errorCode);
  let projection = null;
  let primary = null;
  try {
    await verifyCommittedRefinementArtifactAuthority(opened.authority, input.operation);
    projection = projectCommittedRefinementArtifactAuthority(opened.authority, input.operation);
  } catch {
    primary = new Error('committed trained artifact verification failed');
  }
  const settled = await closeCommittedRefinementArtifactAuthority(
    opened.authority,
    input.operation,
  );
  if (!settled.ok) {
    const cleanup = new Error(settled.errorCode);
    if (primary) {
      throw new AggregateError(
        [primary, cleanup],
        'committed trained artifact verification and cleanup failed',
      );
    }
    throw cleanup;
  }
  if (primary) throw primary;
  return projection;
};

/** Retry one surfaced acquisition/publication close without exposing its resources. */
export const retryRefinementTrainedArtifactCleanup = async (
  cleanupAuthority,
  operation,
) => {
  const state = cleanupStates.get(cleanupAuthority);
  assertOperationIdentity(state, operation, false);
  const remaining = await closeArtifacts(state.artifacts, operation);
  if (remaining.length) {
    state.artifacts = new Set(remaining);
    return failed('REFINEMENT_TRAINED_ARTIFACT_CLEANUP_FAILED', cleanupAuthority);
  }
  cleanupStates.delete(cleanupAuthority);
  return Object.freeze({ ok: true });
};
