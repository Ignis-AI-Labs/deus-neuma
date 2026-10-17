import { refinementTextSha256 } from '../../core/refinement/training-contract.js';
import {
  retryRefinementImmutableFileSetCleanup,
  stageVerifiedBootstrapHandle,
} from './refinement-immutable-staging-internal/file-set.js';
import {
  assertRefinementProcessOperation,
  assertRefinementProcessOperationIdentity,
} from './refinement-process-operation.js';
import {
  MAX_REFINEMENT_CORPUS_BYTES,
} from './refinement-trainer-facts.js';
import { codedTrainingError } from './refinement-training-errors.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const OWNERS = new WeakMap();
const CLEANUPS = new WeakMap();
const success = (closed = true) => Object.freeze({ ok: true, closed });
const fail = (diagnostic) => codedTrainingError('TRAINING_SOURCE_CHANGED', diagnostic);

const renderedCorpusProjection = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'bytes,sampleCount,sha256,text'
    || typeof value.text !== 'string'
    || !Number.isSafeInteger(value.bytes) || value.bytes < 1
    || value.bytes > MAX_REFINEMENT_CORPUS_BYTES
    || Buffer.byteLength(value.text, 'utf8') !== value.bytes
    || !Number.isSafeInteger(value.sampleCount) || value.sampleCount < 1
    || value.sampleCount > 10_000
    || !SHA256.test(String(value.sha256 || ''))
    || refinementTextSha256(value.text) !== value.sha256) {
    throw fail('CORPUS_AUTHORITY_INPUT_INVALID');
  }
  return Object.freeze({
    bytes: value.bytes,
    sampleCount: value.sampleCount,
    sha256: value.sha256,
  });
};

const cleanupFailure = (operation, retry) => {
  const authority = Object.freeze({ kind: 'refinement-training-corpus-cleanup-authority-v1' });
  CLEANUPS.set(authority, { operation, retry, phase: 'cleanup-failed', promise: null });
  return Object.freeze({
    ok: false,
    errorCode: 'TRAINING_EXECUTION_CLEANUP_REQUIRED',
    cleanupAuthority: authority,
  });
};

/** Retry one incomplete corpus acquisition/owner cleanup without reviving its owner. Impure. */
export const retryRefinementTrainingCorpusCleanup = (cleanupAuthority, suppliedOperation) => {
  const operation = assertRefinementProcessOperationIdentity(suppliedOperation);
  const state = CLEANUPS.get(cleanupAuthority);
  if (!state || state.operation !== operation) throw fail('CORPUS_CLEANUP_AUTHORITY_INVALID');
  if (state.phase === 'closed') return Promise.resolve(Object.freeze({ ok: true }));
  if (state.promise) return state.promise;
  state.phase = 'closing';
  state.promise = Promise.resolve().then(state.retry).then(
    () => {
      state.phase = 'closed';
      state.retry = null;
      return Object.freeze({ ok: true });
    },
    () => {
      state.phase = 'cleanup-failed';
      return Object.freeze({
        ok: false,
        errorCode: 'TRAINING_EXECUTION_CLEANUP_REQUIRED',
        cleanupAuthority,
      });
    },
  ).finally(() => { state.promise = null; });
  return state.promise;
};

/** Stage one exact rendered corpus as a path-free read-only operation owner. Impure. */
export const openRefinementTrainingCorpusAuthority = async ({ renderedCorpus, operation } = {}) => {
  const controls = assertRefinementProcessOperation(operation);
  const projection = renderedCorpusProjection(renderedCorpus);
  const staged = await stageVerifiedBootstrapHandle({
    content: Buffer.from(renderedCorpus.text, 'utf8'),
    sha256: projection.sha256,
    maximumBytes: MAX_REFINEMENT_CORPUS_BYTES,
    label: 'rendered refinement training corpus',
    mode: 0o400,
    operation: controls,
  });
  if (!staged.ok) {
    if (staged.cleanupAuthority) {
      return cleanupFailure(controls, async () => {
        const retried = await retryRefinementImmutableFileSetCleanup(
          staged.cleanupAuthority,
          controls,
        );
        if (!retried.ok) throw fail('CORPUS_CLEANUP_INCOMPLETE');
      });
    }
    throw fail('CORPUS_AUTHORITY_ACQUISITION_FAILED');
  }
  const held = staged.authority;
  const authority = Object.freeze({
    kind: 'refinement-training-corpus-authority-v1',
    ...projection,
  });
  OWNERS.set(authority, {
    operation: controls,
    held,
    phase: 'open',
    closePromise: null,
    cleanupAuthority: null,
  });
  return Object.freeze({ ok: true, authority });
};

const stateFor = (authority, suppliedOperation, active = true) => {
  const operation = active
    ? assertRefinementProcessOperation(suppliedOperation)
    : assertRefinementProcessOperationIdentity(suppliedOperation);
  const state = OWNERS.get(authority);
  if (!state || state.operation !== operation || state.phase !== 'open') {
    throw fail('CORPUS_AUTHORITY_INVALID');
  }
  return state;
};

/** Rehash the exact held corpus descriptor under its owning operation. Impure. */
export const verifyRefinementTrainingCorpusAuthority = async (
  authority,
  operation,
) => {
  const state = stateFor(authority, operation);
  await state.held.verify(operation);
  return authority;
};

/** Borrow the corpus descriptor for exactly one same-operation callback. Impure. */
export const withRefinementTrainingCorpusDescriptor = async (
  authority,
  operation,
  consume,
) => {
  const state = stateFor(authority, operation);
  if (typeof consume !== 'function') throw fail('CORPUS_DESCRIPTOR_CONSUMER_INVALID');
  await state.held.verify(operation);
  const active = { value: true };
  const descriptor = Object.freeze({
    kind: 'refinement-training-corpus-descriptor-borrow-v1',
    fd: state.held.fd,
    bytes: authority.bytes,
    sha256: authority.sha256,
    async verify(suppliedOperation) {
      if (!active.value) throw fail('CORPUS_DESCRIPTOR_EXPIRED');
      if (suppliedOperation !== operation) throw fail('CORPUS_OPERATION_CHANGED');
      await state.held.verify(assertRefinementProcessOperation(suppliedOperation));
      return true;
    },
  });
  try { return await consume(descriptor); }
  finally { active.value = false; }
};

/** Close or demote one corpus owner to an opaque retry-only cleanup authority. Impure. */
export const closeRefinementTrainingCorpusAuthority = (authority, suppliedOperation) => {
  const operation = assertRefinementProcessOperationIdentity(suppliedOperation);
  const state = OWNERS.get(authority);
  if (!state || state.operation !== operation) throw fail('CORPUS_AUTHORITY_INVALID');
  if (state.phase === 'closed') return Promise.resolve(success(false));
  if (state.phase === 'cleanup-failed') {
    return Promise.resolve(Object.freeze({
      ok: false,
      errorCode: 'TRAINING_EXECUTION_CLEANUP_REQUIRED',
      cleanupAuthority: state.cleanupAuthority,
    }));
  }
  if (state.closePromise) return state.closePromise;
  state.phase = 'closing';
  state.closePromise = state.held.close(operation).then(
    (closed) => { state.phase = 'closed'; return success(closed); },
    () => {
      state.phase = 'cleanup-failed';
      const failure = cleanupFailure(operation, () => state.held.close(operation));
      state.cleanupAuthority = failure.cleanupAuthority;
      return failure;
    },
  ).finally(() => { state.closePromise = null; });
  return state.closePromise;
};
