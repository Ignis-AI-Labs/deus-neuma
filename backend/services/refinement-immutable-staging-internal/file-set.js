import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { checkedByteSum, safeByteNumber } from '../refinement-checked-arithmetic.js';
import { sha256HandleStable } from '../file-digest.js';
import { getDataRoot } from '../data-root.js';
import {
  createAnonymousStagingDirectory,
  transferOwnedFile,
} from '../refinement-directory-custody.js';
import {
  assertImmutableFileState as assertFile,
  assertImmutableOperation as checkControl,
  boundedImmutableRelativePath as safePath,
  boundedInteger as limit,
  closeImmutablePathInputs as closePathInputs,
  copyImmutableInput as copyInput,
  openImmutableInput as inputFor,
  sameImmutableFileState as same,
} from './file-io.js';
import { assertRefinementProcessOperation } from '../refinement-process-operation.js';
import {
  acquiredImmutableStaging as acquired,
  createImmutableStagingCleanupAuthority as cleanupAuthorityFor,
  failedImmutableStaging as failedAcquisition,
  retryImmutableStagingCleanup as retryCleanup,
} from './result.js';
const SHA = /^[a-f0-9]{64}$/;
const FORMAT = 'neuma-file-set-v1';
const MANIFEST_BYTES_MAX = 4 * 1024 * 1024;
const MANIFEST_KINDS = new Set([
  'neuma-file-set-manifest',
  'neuma-runtime-manifest',
  'neuma-snapshot-manifest',
  'neuma-source-manifest',
  'neuma-tool-manifest',
]);
const heldResources = new WeakMap();
const flattenFailure = (error) => error instanceof AggregateError
  ? error.errors.flatMap(flattenFailure)
  : [error];
const sameOperation = (state, supplied) => {
  if (supplied !== state.operation) throw new Error(`${state.label} operation changed`);
  return state.operation;
};
const operationControls = (state, supplied) => {
  const operation = assertRefinementProcessOperation(sameOperation(state, supplied));
  return { signal: operation.signal, deadline: operation.epochDeadline };
};
const stagingControls = (operation) => {
  const active = assertRefinementProcessOperation(operation);
  return {
    operation: active,
    controls: { signal: active.signal, deadline: active.epochDeadline },
  };
};
/** Retry one failed acquisition rollback without exposing its cleanup closures. */
export const retryRefinementImmutableFileSetCleanup = (
  cleanupAuthority,
  operation,
) => retryCleanup(cleanupAuthority, operation);
const stateFor = (authority) => {
  const state = heldResources.get(authority);
  if (!state) throw new Error('immutable held-file authority is invalid');
  return state;
};
const makeHeldAuthority = ({
  handle, sha256, bytes, mode, relativePath = null, label, initial, operation,
}) => {
  let authority;
  const verify = async (supplied) => {
    const state = stateFor(authority);
    if (state.phase !== 'open') throw new Error(`${state.label} is ${state.phase}`);
    const controls = operationControls(state, supplied);
    const before = await state.handle.stat({ bigint: true });
    if (!same(state.initial, before) || (before.mode & 0o777n) !== BigInt(state.mode)) {
      throw new Error(`${state.label} identity changed`);
    }
    const repeated = await sha256HandleStable(state.handle, {
      maximumBytes: Math.max(1, state.bytes),
      signal: controls.signal,
      deadline: controls.deadline,
    });
    const after = await state.handle.stat({ bigint: true });
    checkControl(controls);
    if (repeated !== state.sha256 || !same(state.initial, after)) {
      throw new Error(`${state.label} content changed`);
    }
    return true;
  };
  const close = (supplied) => {
    const state = stateFor(authority);
    sameOperation(state, supplied);
    if (state.phase === 'closed') return Promise.resolve(false);
    if (state.closePromise) return state.closePromise;
    state.phase = 'closing';
    state.closePromise = state.handle.close().then(
      () => { state.phase = 'closed'; return true; },
      (error) => { state.phase = 'cleanup-failed'; throw error; },
    ).finally(() => { state.closePromise = null; });
    return state.closePromise;
  };
  authority = Object.freeze({
    kind: 'immutable-held-file-v1',
    ...(relativePath === null ? {} : { relativePath }),
    fd: handle.fd,
    sha256,
    bytes,
    mode,
    verify,
    close,
  });
  heldResources.set(authority, {
    handle,
    sha256,
    bytes,
    mode,
    label,
    initial,
    operation,
    phase: 'open',
    closePromise: null,
  });
  return authority;
};
const stagingDirectory = () => createAnonymousStagingDirectory({
  root: getDataRoot(),
  label: 'immutable authority staging',
});
const stageDeclared = async ({
  input, sha256, bytes, mode, relativePath = null, label, owner, index, controls,
  operation,
}) => {
  let writer = null;
  let reader = null;
  let writerClosed = false;
  let readerClosed = false;
  const cleanup = async () => {
    const pending = [
      ...(!reader || readerClosed ? [] : [{ name: 'reader', handle: reader }]),
      ...(!writer || writerClosed ? [] : [{ name: 'writer', handle: writer }]),
    ];
    const settled = await Promise.allSettled(pending.map(({ handle }) => handle.close()));
    const failures = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (pending[index].name === 'reader') readerClosed = true;
        else writerClosed = true;
      } else {
        failures.push(result.reason);
      }
    });
    if (failures.length) throw new AggregateError(failures, `${label} descriptor release failed`);
    return true;
  };
  try {
    const { resource } = await owner.create({
      kind: 'file',
      name: `inode-${index}`,
      mode: 0o600,
      label,
      operation: async (output) => {
        checkControl(controls);
        await copyInput(input, output, sha256, label, controls);
        await output.sync();
        await output.chmod(mode);
        await output.sync();
      },
    });
    await owner.remove(resource);
    const transferred = await transferOwnedFile(owner, resource);
    writer = transferred.handle;
    const initial = transferred.state;
    assertFile(initial, Math.max(1, bytes), label);
    if (process.platform !== 'linux' || initial.size !== BigInt(bytes) || initial.nlink !== 0n
      || (initial.mode & 0o777n) !== BigInt(mode)) {
      throw new Error(`${label} staged identity is invalid`);
    }
    const repeated = await sha256HandleStable(writer, {
      maximumBytes: Math.max(1, bytes),
      signal: controls.signal,
      deadline: controls.deadline,
    });
    if (repeated !== sha256 || !same(initial, await writer.stat({ bigint: true }))) {
      throw new Error(`${label} staged bytes changed`);
    }
    reader = await fs.open(`/proc/self/fd/${writer.fd}`, constants.O_RDONLY);
    if (!same(initial, await reader.stat({ bigint: true }))) {
      throw new Error(`${label} read-only descriptor identity changed`);
    }
    await writer.close();
    writerClosed = true;
    if (!same(initial, await reader.stat({ bigint: true }))) {
      throw new Error(`${label} changed while dropping its writer descriptor`);
    }
    checkControl(controls);
    const held = makeHeldAuthority({
      handle: reader,
      sha256,
      bytes,
      mode,
      relativePath,
      label,
      initial,
      operation,
    });
    reader = null;
    return acquired(held);
  } catch (error) {
    try {
      await cleanup();
    } catch {
      return failedAcquisition(
        'REFINEMENT_IMMUTABLE_STAGING_CLEANUP_FAILED',
        cleanupAuthorityFor(operation, cleanup),
      );
    }
    return failedAcquisition(error?.code === 'ABORT_ERR'
      ? 'REFINEMENT_IMMUTABLE_STAGING_ABORTED'
      : 'REFINEMENT_IMMUTABLE_STAGING_FAILED');
  }
};
/** Stage bounded files and their canonical manifest as anonymous held descriptors. Impure. */
export const stageImmutableFileSet = async ({
  label = 'immutable file set',
  files,
  maximumFiles,
  maximumBytes,
  maximumDepth = 32,
  maximumPathBytes = 512,
  manifestKind = 'neuma-file-set-manifest',
  operation,
}) => {
  limit(maximumFiles, 'maximumFiles', 1);
  limit(maximumBytes, 'maximumBytes', 1);
  limit(maximumDepth, 'maximumDepth', 1);
  limit(maximumPathBytes, 'maximumPathBytes', 1);
  if (!MANIFEST_KINDS.has(manifestKind)) throw new Error(`${label} manifest kind is invalid`);
  if (!Array.isArray(files) || !files.length || files.length > maximumFiles) {
    throw new Error(`${label} exceeds its file-count contract`);
  }
  const declarations = files.map((file) => {
    if (!file || !SHA.test(String(file.sha256 || '')) || ![0o400, 0o500].includes(file.mode)) {
      throw new Error(`${label} has an invalid declaration`);
    }
    limit(file.maximumBytes, 'file maximumBytes', 1);
    return { ...file, relativePath: safePath(file.relativePath, maximumDepth, maximumPathBytes) };
  }).sort((left, right) =>
    Buffer.compare(Buffer.from(left.relativePath), Buffer.from(right.relativePath)));
  if (new Set(declarations.map(({ relativePath }) => relativePath)).size !== declarations.length) {
    throw new Error(`${label} has duplicate paths`);
  }
  const { controls, operation: exactOperation } = stagingControls(operation);
  const inputs = [];
  const staged = [];
  let location = null;
  let acquisitionFailure = null;
  const unwrap = (result) => {
    if (!result.ok) {
      acquisitionFailure = result;
      throw new Error(result.errorCode);
    }
    staged.push(result.authority);
    return result.authority;
  };
  const rollback = async () => {
    const tasks = [
      ...staged.map((authority) => () => authority.close(exactOperation)),
      ...(acquisitionFailure?.cleanupAuthority ? [async () => {
        const retried = await retryCleanup(acquisitionFailure.cleanupAuthority, exactOperation);
        if (!retried.ok) throw new Error(retried.errorCode);
      }] : []),
      ...(location ? [() => location.close()] : []),
      () => closePathInputs(inputs, label),
    ];
    const settled = await Promise.allSettled(tasks.map((task) => task()));
    const failures = settled.filter(({ status }) => status === 'rejected')
      .flatMap(({ reason }) => flattenFailure(reason));
    if (failures.length) throw new AggregateError(failures, `${label} rollback failed`);
  };
  try {
    for (const file of declarations) {
      inputs.push(await inputFor(file, `${label} ${file.relativePath}`, controls));
    }
    let total = 0n;
    const metadata = declarations.map((file, index) => {
      total = checkedByteSum(total, inputs[index].bytes, maximumBytes, `${label} bytes`);
      return Object.freeze({
        relativePath: file.relativePath,
        sha256: file.sha256,
        bytes: inputs[index].bytes,
        mode: file.mode,
      });
    });
    const totalBytes = safeByteNumber(total, `${label} bytes`, maximumBytes);
    const manifestBytes = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      kind: manifestKind,
      format: FORMAT,
      files: metadata,
    }));
    if (!manifestBytes.length || manifestBytes.length > MANIFEST_BYTES_MAX) {
      throw new Error(`${label} manifest exceeds its byte ceiling`);
    }
    const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
    location = await stagingDirectory();
    for (let index = 0; index < declarations.length; index += 1) {
      unwrap(await stageDeclared({
        input: inputs[index],
        ...metadata[index],
        label: `${label} ${metadata[index].relativePath}`,
        owner: location,
        index,
        controls,
        operation: exactOperation,
      }));
    }
    const manifest = unwrap(await stageDeclared({
      input: { kind: 'buffer', handle: manifestBytes, bytes: manifestBytes.length },
      sha256: manifestSha256,
      bytes: manifestBytes.length,
      mode: 0o400,
      label: `${label} manifest`,
      owner: location,
      index: declarations.length,
      controls,
      operation: exactOperation,
    }));
    await location.close();
    location = null;
    await closePathInputs(inputs, label);
    let phase = 'open';
    let closePromise = null;
    const verify = async (verifyOperation) => {
      if (phase !== 'open') throw new Error(`${label} is ${phase}`);
      if (verifyOperation !== exactOperation) throw new Error(`${label} operation changed`);
      for (const authority of staged) await authority.verify(verifyOperation);
      return true;
    };
    const close = (closeOperation) => {
      if (closeOperation !== exactOperation) throw new Error(`${label} operation changed`);
      if (phase === 'closed') return Promise.resolve(false);
      if (closePromise) return closePromise;
      phase = 'closing';
      closePromise = Promise.allSettled(staged.map((entry) => entry.close(closeOperation)))
        .then((results) => {
          const failures = results.filter(({ status }) => status === 'rejected')
            .flatMap(({ reason }) => flattenFailure(reason));
          if (failures.length) {
            phase = 'cleanup-failed';
            throw new AggregateError(failures, `${label} close failed`);
          }
          phase = 'closed';
          return true;
        }).finally(() => { closePromise = null; });
      return closePromise;
    };
    return acquired(Object.freeze({
      schemaVersion: 2,
      kind: 'immutable-file-set',
      format: FORMAT,
      manifestKind,
      manifestSha256,
      manifest,
      files: Object.freeze(staged.slice(0, -1)),
      fileCount: metadata.length,
      totalBytes,
      verify,
      close,
    }));
  } catch {
    try {
      await rollback();
      return failedAcquisition(acquisitionFailure?.errorCode
        ?? (controls.signal?.aborted
          ? 'REFINEMENT_IMMUTABLE_STAGING_ABORTED'
          : 'REFINEMENT_IMMUTABLE_STAGING_FAILED'));
    } catch {
      return failedAcquisition(
        'REFINEMENT_IMMUTABLE_STAGING_CLEANUP_FAILED',
        cleanupAuthorityFor(exactOperation, rollback),
      );
    }
  }
};
/** Copy one bootstrap script to one anonymous held read-only descriptor. Impure. */
export const stageVerifiedBootstrapHandle = async ({
  content,
  handle,
  sha256,
  maximumBytes,
  label = 'bootstrap script',
  mode = 0o500,
  operation,
}) => {
  if (!SHA.test(String(sha256 || '')) || ![0o400, 0o500].includes(mode)) {
    throw new Error(`${label} declaration is invalid`);
  }
  limit(maximumBytes, 'maximumBytes', 1);
  const { controls, operation: exactOperation } = stagingControls(operation);
  let input = null;
  let location = null;
  let staged = null;
  let acquisitionFailure = null;
  const rollback = async () => {
    const tasks = [
      ...(staged ? [() => staged.close(exactOperation)] : []),
      ...(acquisitionFailure?.cleanupAuthority ? [async () => {
        const retried = await retryCleanup(acquisitionFailure.cleanupAuthority, exactOperation);
        if (!retried.ok) throw new Error(retried.errorCode);
      }] : []),
      ...(location ? [() => location.close()] : []),
      ...(input ? [() => closePathInputs([input], label)] : []),
    ];
    const settled = await Promise.allSettled(tasks.map((task) => task()));
    const failures = settled.filter(({ status }) => status === 'rejected')
      .flatMap(({ reason }) => flattenFailure(reason));
    if (failures.length) throw new AggregateError(failures, `${label} rollback failed`);
  };
  try {
    input = await inputFor({ content, handle, maximumBytes }, label, controls);
    location = await stagingDirectory();
    const result = await stageDeclared({
      input,
      sha256,
      bytes: input.bytes,
      mode,
      label,
      owner: location,
      index: 0,
      controls,
      operation: exactOperation,
    });
    if (!result.ok) {
      acquisitionFailure = result;
      throw new Error(result.errorCode);
    }
    staged = result.authority;
    await location.close();
    location = null;
    await closePathInputs([input], label);
    return acquired(Object.freeze({
      ...staged,
      kind: 'verified-bootstrap-handle',
    }));
  } catch {
    try {
      await rollback();
      return failedAcquisition(acquisitionFailure?.errorCode
        ?? (controls.signal?.aborted
          ? 'REFINEMENT_IMMUTABLE_STAGING_ABORTED'
          : 'REFINEMENT_IMMUTABLE_STAGING_FAILED'));
    } catch {
      return failedAcquisition(
        'REFINEMENT_IMMUTABLE_STAGING_CLEANUP_FAILED',
        cleanupAuthorityFor(exactOperation, rollback),
      );
    }
  }
};
