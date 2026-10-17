import {
  REFINEMENT_RESOURCE_LIMITS,
  refinementExecutionEnvelope,
  validateRefinementExecutionEnvelope,
} from '../../core/refinement/training-authority-contract.js';
import {
  retryRefinementImmutableFileSetCleanup,
  stageVerifiedBootstrapHandle,
} from './refinement-immutable-staging-internal/file-set.js';
import {
  closeRefinementFixedExecutableAuthority,
  openRefinementFixedExecutableAuthority,
  refinementFixedExecutableDigests,
  retryRefinementFixedExecutableCleanup,
  verifyRefinementFixedExecutableAuthority,
  withRefinementFixedExecutableDescriptors,
} from './refinement-fixed-executable-authority.js';
import {
  closeRefinementHostRuntimeAuthority,
  openRefinementHostRuntimeAuthority,
  retryRefinementHostRuntimeCleanup,
  verifyRefinementHostRuntimeAuthority,
  withRefinementHostRuntimeDescriptors,
} from './refinement-host-runtime-authority.js';
import {
  assertRefinementProcessOperation,
  assertRefinementProcessOperationIdentity,
} from './refinement-process-operation.js';
import {
  openServerRefinementRuntimeAuthority,
  retryServerRefinementRuntimeAuthorityCleanup,
} from './refinement-runtime-acquisition.js';
import { codedTrainingError } from './refinement-training-errors.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const CONSUMER_SCRIPT_MAX_BYTES = 1024 * 1024;
const MAX_TRAINING_SEED = 0xffff_ffff;
const GUEST = Object.freeze({
  python: '/runtime/bin/python',
  trainer: '/tool/scripts/refinement/train-adapter.py',
  converter: '/runtime/bin/convert-lora',
});
const OWNERS = new WeakMap();
const SPAWN_BORROWS = new WeakMap();
const CLEANUPS = new WeakMap();
const success = (closed = true) => Object.freeze({ ok: true, closed });
const fail = (diagnostic) => codedTrainingError('TRAINING_EXECUTION_CHANGED', diagnostic);

/** Return only the immutable allowlisted environment committed by the envelope. Pure. */
export const refinementChildEnvironment = (executionEnvelope) =>
  validateRefinementExecutionEnvelope(executionEnvelope).environment;

const exactKeys = (value, fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  return keys.every((key) => typeof key === 'string' && Object.hasOwn(descriptors[key], 'value'))
    && keys.sort().join(',') === fields;
};

const sourceIdentityFor = (value) => {
  const fields = [
    'converterScriptSha256', 'pythonExecutableSha256', 'sourceCommit',
    'sourceIdentitySha256', 'sourceRootTreeId', 'trainerEnvironmentSha256',
    'trainerExecutableSha256', 'trainerRequirementsSha256',
  ];
  if (!exactKeys(value, fields.slice().sort().join(','))
    || !OID.test(String(value.sourceCommit || ''))
    || !OID.test(String(value.sourceRootTreeId || ''))
    || fields.filter((field) => field.endsWith('Sha256'))
      .some((field) => !SHA256.test(String(value[field] || '')))) {
    throw fail('SOURCE_IDENTITY_INVALID');
  }
  return Object.freeze(Object.fromEntries(fields.map((field) => [field, value[field]])));
};

const assertGuest = (value) => {
  if (!exactKeys(value, 'converter,python,trainer')
    || value.python !== GUEST.python || value.trainer !== GUEST.trainer
    || value.converter !== GUEST.converter) throw fail('GUEST_EXECUTABLES_INVALID');
  return GUEST;
};

const closePacked = async (packed) => {
  const failures = [];
  for (const authority of [packed.toolAuthority, packed.runtimeAuthority]) {
    try { await authority.close(); }
    catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'packed execution inputs did not close');
};

const closeTasks = async (tasks) => {
  const failures = [];
  for (const task of [...tasks].reverse()) {
    if (task.closed) continue;
    try {
      await task.close();
      task.closed = true;
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'execution authority cleanup failed');
};

const cleanupFailure = (operation, tasks) => {
  const authority = Object.freeze({ kind: 'refinement-execution-cleanup-authority-v1' });
  CLEANUPS.set(authority, { operation, tasks, phase: 'cleanup-failed', promise: null });
  return Object.freeze({
    ok: false,
    errorCode: 'TRAINING_EXECUTION_CLEANUP_REQUIRED',
    cleanupAuthority: authority,
  });
};

/** Retry one incomplete execution acquisition/owner cleanup without reviving its owner. Impure. */
export const retryRefinementExecutionAuthorityCleanup = (authority, suppliedOperation) => {
  const operation = assertRefinementProcessOperationIdentity(suppliedOperation);
  const state = CLEANUPS.get(authority);
  if (!state || state.operation !== operation) throw fail('EXECUTION_CLEANUP_AUTHORITY_INVALID');
  if (state.phase === 'closed') return Promise.resolve(Object.freeze({ ok: true }));
  if (state.promise) return state.promise;
  state.phase = 'closing';
  state.promise = closeTasks(state.tasks).then(
    () => { state.phase = 'closed'; return Object.freeze({ ok: true }); },
    () => {
      state.phase = 'cleanup-failed';
      return Object.freeze({
        ok: false,
        errorCode: 'TRAINING_EXECUTION_CLEANUP_REQUIRED',
        cleanupAuthority: authority,
      });
    },
  ).finally(() => { state.promise = null; });
  return state.promise;
};

const rollbackOrThrow = async (operation, tasks, error) => {
  try { await closeTasks(tasks); }
  catch { return cleanupFailure(operation, tasks); }
  throw error;
};

const foreignCleanup = (operation, retry) => cleanupFailure(operation, [{
  closed: false,
  close: retry,
}]);

const stageConsumer = async (consumer, operation) => {
  if (!consumer || !Buffer.isBuffer(consumer.content)
    || consumer.content.length < 1 || consumer.content.length > CONSUMER_SCRIPT_MAX_BYTES
    || !SHA256.test(String(consumer.sha256 || ''))) throw fail('CONSUMER_SCRIPT_INVALID');
  return stageVerifiedBootstrapHandle({
    content: consumer.content,
    sha256: consumer.sha256,
    maximumBytes: CONSUMER_SCRIPT_MAX_BYTES,
    label: 'refinement authority consumer',
    mode: 0o500,
    operation,
  });
};

const envelopeFor = ({ executables, consumer, host, packed, trainingSeed }) =>
  refinementExecutionEnvelope({
    wrapperExecutableSha256: executables.wrapper.sha256,
    controllerExecutableSha256: executables.controller.sha256,
    resourceLimiterExecutableSha256: executables.limiter.sha256,
    sandboxExecutableSha256: executables.sandbox.sha256,
    authorityConsumerPythonSha256: executables.consumerPython.sha256,
    authorityConsumerScriptSha256: consumer.sha256,
    hostRuntimeIdentitySha256: host.hostRuntimeIdentitySha256,
    runtimeAuthoritySha256: packed.runtimeAuthority.sha256,
    runtimeManifestSha256: packed.runtimeAuthority.manifestSha256,
    toolAuthoritySha256: packed.toolAuthority.sha256,
    toolManifestSha256: packed.toolAuthority.manifestSha256,
    resources: REFINEMENT_RESOURCE_LIMITS,
    trainingSeed,
  });

const assertOwner = (authority, suppliedOperation, active = true) => {
  const operation = active
    ? assertRefinementProcessOperation(suppliedOperation)
    : assertRefinementProcessOperationIdentity(suppliedOperation);
  const state = OWNERS.get(authority);
  if (!state || state.operation !== operation || state.phase !== 'open') {
    throw fail('EXECUTION_AUTHORITY_INVALID');
  }
  return state;
};

const verifyHeld = async (state, operation) => {
  validateRefinementExecutionEnvelope(state.executionEnvelope);
  await verifyRefinementFixedExecutableAuthority(state.fixed, operation);
  await verifyRefinementHostRuntimeAuthority(state.host, operation);
  await state.consumer.verify(operation);
  await state.packed.runtimeAuthority.verify(operation);
  await state.packed.toolAuthority.verify(operation);
};

const consumerDescriptor = (state, active) => Object.freeze({
  kind: 'refinement-consumer-descriptor-borrow-v1',
  id: 'consumerScript',
  fd: state.consumer.fd,
  sha256: state.consumer.sha256,
  bytes: state.consumer.bytes,
  async verify(operation) {
    if (!active.value) throw fail('EXECUTION_DESCRIPTOR_EXPIRED');
    await state.consumer.verify(operation);
    return true;
  },
});

const packedDescriptor = (id, authority, active) => Object.freeze({
  kind: 'borrowed-packed-refinement-authority-v2',
  id,
  fd: authority.fd,
  sha256: authority.sha256,
  bytes: authority.bytes,
  fileCount: authority.fileCount,
  manifestSha256: authority.manifestSha256,
  manifestKind: authority.manifestKind,
  totalBytes: authority.totalBytes,
  files: authority.files,
  async verify(operation) {
    if (!active.value) throw fail('EXECUTION_DESCRIPTOR_EXPIRED');
    await authority.verify(operation);
    return true;
  },
});

/** Resolve and own every exact source/runtime/process input under one operation and seed. Impure. */
export const openRefinementExecutionAuthority = async (options = {}) => {
  if (!exactKeys(options, 'operation,sourceAuthority,trainingSeed')
    || !Number.isSafeInteger(options.trainingSeed) || options.trainingSeed < 0
    || options.trainingSeed > MAX_TRAINING_SEED) throw fail('EXECUTION_INPUT_INVALID');
  const operation = assertRefinementProcessOperation(options.operation);
  const tasks = [];
  const runtimeResult = await openServerRefinementRuntimeAuthority({
    sourceAuthority: options.sourceAuthority,
    operation,
  });
  if (!runtimeResult.ok) {
    return foreignCleanup(operation, () => retryServerRefinementRuntimeAuthorityCleanup(
      runtimeResult.cleanupAuthority,
      operation,
    ));
  }
  const packed = runtimeResult.authority;
  tasks.push({ closed: false, close: () => closePacked(packed) });
  let fixedResult;
  try { fixedResult = await openRefinementFixedExecutableAuthority(operation); }
  catch (error) { return rollbackOrThrow(operation, tasks, error); }
  if (!fixedResult.ok) {
    try { await closeTasks(tasks); } catch { /* retained in tasks */ }
    tasks.push({
      closed: false,
      close: () => retryRefinementFixedExecutableCleanup(fixedResult.cleanupAuthority, operation),
    });
    return cleanupFailure(operation, tasks);
  }
  const fixed = fixedResult.authority;
  tasks.push({ closed: false, close: () => closeRefinementFixedExecutableAuthority(fixed, operation) });
  let stagedConsumer;
  try { stagedConsumer = await stageConsumer(packed.authorityConsumer, operation); }
  catch { return rollbackOrThrow(operation, tasks, fail('CONSUMER_SCRIPT_ACQUISITION_FAILED')); }
  if (!stagedConsumer.ok) {
    try { await closeTasks(tasks); } catch { /* retained in tasks */ }
    if (stagedConsumer.cleanupAuthority) {
      tasks.push({
        closed: false,
        close: async () => {
          const retried = await retryRefinementImmutableFileSetCleanup(
            stagedConsumer.cleanupAuthority,
            operation,
          );
          if (!retried.ok) throw fail('CONSUMER_SCRIPT_CLEANUP_INCOMPLETE');
        },
      });
      return cleanupFailure(operation, tasks);
    }
    return rollbackOrThrow(operation, tasks, fail('CONSUMER_SCRIPT_ACQUISITION_FAILED'));
  }
  const consumer = stagedConsumer.authority;
  tasks.push({ closed: false, close: () => consumer.close(operation) });
  const sourceIdentity = sourceIdentityFor(packed.sourceIdentity);
  const executables = await refinementFixedExecutableDigests(fixed, operation);
  let hostResult;
  try {
    hostResult = await openRefinementHostRuntimeAuthority({
      operation,
      authorityConsumerPythonSha256: executables.consumerPython.sha256,
      sourceIdentity,
    });
  } catch (error) { return rollbackOrThrow(operation, tasks, error); }
  if (!hostResult.ok) {
    try { await closeTasks(tasks); } catch { /* retained in tasks */ }
    tasks.push({
      closed: false,
      close: () => retryRefinementHostRuntimeCleanup(hostResult.cleanupAuthority, operation),
    });
    return cleanupFailure(operation, tasks);
  }
  const host = hostResult.authority;
  tasks.push({ closed: false, close: () => closeRefinementHostRuntimeAuthority(host, operation) });
  let executionEnvelope;
  try {
    executionEnvelope = envelopeFor({
      executables, consumer, host, packed, trainingSeed: options.trainingSeed,
    });
    const state = {
      operation,
      tasks,
      packed,
      fixed,
      consumer,
      host,
      executionEnvelope,
      phase: 'open',
      closePromise: null,
      cleanupAuthority: null,
    };
    await verifyHeld(state, operation);
    const authority = Object.freeze({
      kind: 'refinement-execution-authority-v3',
      executionEnvelope,
      sourceIdentity,
      guest: assertGuest(packed.guest),
    });
    OWNERS.set(authority, state);
    return Object.freeze({ ok: true, authority });
  } catch (error) {
    return rollbackOrThrow(operation, tasks, error);
  }
};

/** Assert one open same-operation execution owner without exposing its handles. Impure. */
export const assertRefinementExecutionAuthority = async (authority, operation) => {
  const state = assertOwner(authority, operation);
  await verifyHeld(state, operation);
  return authority;
};

/** Borrow every fixed, host-runtime, packed, and consumer descriptor for one callback. Impure. */
export const withRefinementExecutionSpawnAuthority = async (
  authority,
  suppliedOperation,
  consume,
) => {
  const operation = assertRefinementProcessOperation(suppliedOperation);
  const state = assertOwner(authority, operation);
  if (typeof consume !== 'function') throw fail('EXECUTION_DESCRIPTOR_CONSUMER_INVALID');
  await verifyHeld(state, operation);
  const active = { value: true };
  try {
    return await withRefinementFixedExecutableDescriptors(state.fixed, operation, (fixed) =>
      withRefinementHostRuntimeDescriptors(state.host, operation, (host) => {
        const borrowed = Object.freeze({
          ...fixed,
          ...host,
          consumerScript: consumerDescriptor(state, active),
          runtime: packedDescriptor('runtime', state.packed.runtimeAuthority, active),
          tool: packedDescriptor('tool', state.packed.toolAuthority, active),
        });
        SPAWN_BORROWS.set(borrowed, { state, operation, active });
        return consume(borrowed);
      }));
  } finally { active.value = false; }
};

/** Assert one still-active same-operation spawn descriptor borrow. Pure. */
export const assertRefinementExecutionSpawnAuthority = (value, suppliedOperation) => {
  const operation = assertRefinementProcessOperation(suppliedOperation);
  const record = SPAWN_BORROWS.get(value);
  if (!record || record.operation !== operation || !record.active.value
    || record.state.phase !== 'open') throw fail('EXECUTION_DESCRIPTOR_BORROW_INVALID');
  return value;
};

/** Refuse a held owner that differs from one exact approved envelope. Impure. */
export const verifyRefinementExecutionAuthority = async (
  authority,
  executionEnvelope,
  operation,
) => {
  const expected = validateRefinementExecutionEnvelope(executionEnvelope);
  const state = assertOwner(authority, operation);
  if (state.executionEnvelope.sha256 !== expected.sha256) throw fail('EXECUTION_ENVELOPE_MISMATCH');
  await verifyHeld(state, operation);
  return authority;
};

/** Close or demote one execution owner to an opaque retry-only cleanup authority. Impure. */
export const closeRefinementExecutionAuthority = (authority, suppliedOperation) => {
  const operation = assertRefinementProcessOperationIdentity(suppliedOperation);
  const state = OWNERS.get(authority);
  if (!state || state.operation !== operation) throw fail('EXECUTION_AUTHORITY_INVALID');
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
  state.closePromise = closeTasks(state.tasks).then(
    () => { state.phase = 'closed'; return success(true); },
    () => {
      state.phase = 'cleanup-failed';
      const failure = cleanupFailure(operation, state.tasks);
      state.cleanupAuthority = failure.cleanupAuthority;
      return failure;
    },
  ).finally(() => { state.closePromise = null; });
  return state.closePromise;
};
