import path from 'node:path';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { resolveRefinementSourceImportClosure } from './refinement-source-import-closure.js';
import { stagePackedRefinementAuthority } from './refinement-packed-authority.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import { projectRefinementSourceResolver } from './refinement-source-authority.js';
import {
  REFINEMENT_RUNTIME_AUTHORITY_LIMITS,
  refinementRuntimeUnavailable as runtimeUnavailable,
  resolveRefinementRuntimeAuthorityInputs,
} from './refinement-training-runtime-authority.js';

const RUNTIME_LOCK_RELATIVE = 'scripts/refinement/runtime-authority-lock.json';
const TRAINER_RELATIVE = 'scripts/refinement/train-adapter.py';
const CONSUMER_RELATIVE = 'scripts/refinement/consume-packed-authority.py';
const SNAPSHOT_HELPER_RELATIVE = 'scripts/refinement/trainer_snapshot_authority.py';
const TRAINER_CHANNEL_HELPER_RELATIVE = 'scripts/refinement/trainer_channel_authority.py';
const REQUIREMENTS_RELATIVE = 'scripts/refinement/requirements.txt';
const CONVERTER_RUNTIME_RELATIVE = 'bin/convert-lora';
const MAX_RUNTIME_FILES = REFINEMENT_RUNTIME_AUTHORITY_LIMITS.maximumFiles;
const MAX_RUNTIME_BYTES = REFINEMENT_RUNTIME_AUTHORITY_LIMITS.maximumBytes;
const MAX_SOURCE_BYTES = 128 * 1024 ** 2;
const MAX_SOURCE_FILE_BYTES = 4 * 1024 ** 2;
const MAX_RUNTIME_LOCK_BYTES = 256 * 1024;
const RUNTIME_CLEANUPS = new WeakMap();

const exactKeys = (value, fields) => {
  const keys = Reflect.ownKeys(value);
  return keys.every((key) => typeof key === 'string')
    && keys.sort().join(',') === fields;
};


const closePackedAuthorities = async (authorities) => {
  const failures = [];
  for (const authority of [...authorities].reverse()) {
    if (authority == null) continue;
    if (authority.kind !== 'packed-refinement-authority-v2'
      || typeof authority.close !== 'function') {
      failures.push(new Error('packed refinement authority owner is invalid'));
      continue;
    }
    try {
      await authority.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, 'packed training inputs did not close cleanly');
  }
};
const runtimeCleanupAuthority = (operation, authorities, diagnostics) => {
  const authority = Object.freeze({ kind: 'refinement-runtime-cleanup-authority-v1' });
  RUNTIME_CLEANUPS.set(authority, {
    operation,
    authorities,
    diagnostics,
    phase: 'cleanup-failed',
    promise: null,
  });
  return authority;
};
/** Retry one incomplete runtime acquisition rollback under its original operation. */
export const retryServerRefinementRuntimeAuthorityCleanup = (
  cleanupAuthority,
  suppliedOperation,
) => {
  const state = RUNTIME_CLEANUPS.get(cleanupAuthority);
  if (!state || suppliedOperation !== state.operation) {
    throw new Error('refinement runtime cleanup authority is invalid');
  }
  if (state.phase === 'closed') return Promise.resolve(false);
  if (state.promise) return state.promise;
  state.phase = 'closing';
  state.promise = closePackedAuthorities(state.authorities).then(
    () => {
      state.phase = 'closed';
      state.diagnostics = null;
      return true;
    },
    (error) => {
      state.phase = 'cleanup-failed';
      state.diagnostics = [error];
      throw error;
    },
  ).finally(() => { state.promise = null; });
  return state.promise;
};


const sourceInputs = async (sourceAuthority, operation) => {
  const resolver = projectRefinementSourceResolver(sourceAuthority, operation);
  let closure;
  try {
    closure = await resolveRefinementSourceImportClosure({
      sourceResolver: resolver,
      roots: [TRAINER_RELATIVE, CONSUMER_RELATIVE],
      explicitPaths: [
        SNAPSHOT_HELPER_RELATIVE,
        TRAINER_CHANNEL_HELPER_RELATIVE,
        REQUIREMENTS_RELATIVE,
        RUNTIME_LOCK_RELATIVE,
      ],
      operation,
    });
  } catch (error) {
    throw runtimeUnavailable(error);
  }
  const byPath = new Map(closure.files.map((file) => [file.relativePath, file]));
  const requiredLimits = new Map([
    [TRAINER_RELATIVE, MAX_SOURCE_FILE_BYTES],
    [CONSUMER_RELATIVE, 1024 * 1024],
    [SNAPSHOT_HELPER_RELATIVE, 1024 * 1024],
    [TRAINER_CHANNEL_HELPER_RELATIVE, MAX_SOURCE_FILE_BYTES],
    [REQUIREMENTS_RELATIVE, 1024 * 1024],
    [RUNTIME_LOCK_RELATIVE, MAX_RUNTIME_LOCK_BYTES],
  ]);
  for (const [required, maximumBytes] of requiredLimits) {
    const file = byPath.get(required);
    if (!file || file.bytes < 1 || file.bytes > maximumBytes) throw runtimeUnavailable();
  }
  if (closure.files.length > 1024
    || closure.files.some((file) => file.bytes > MAX_SOURCE_FILE_BYTES)) {
    throw runtimeUnavailable();
  }
  return Object.freeze({ resolver, closure, byPath });
};

/** Resolve exact committed source and server runtime into two held packed authorities. Impure. */
export const openServerRefinementRuntimeAuthority = async (options = {}) => {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || !exactKeys(options, 'operation,sourceAuthority')) {
    throw runtimeUnavailable();
  }
  const operation = assertRefinementProcessOperation(options.operation);
  const source = await sourceInputs(options.sourceAuthority, operation);
  let parsedLock;
  try {
    parsedLock = JSON.parse(source.byPath.get(RUNTIME_LOCK_RELATIVE).content.toString('utf8'));
  } catch (error) {
    throw runtimeUnavailable(error);
  }
  const runtimeInputs = await resolveRefinementRuntimeAuthorityInputs({
    lock: parsedLock,
    resolver: source.resolver,
    operation,
  });
  const {
    runtime,
    siteRoot,
    packages,
    converter,
  } = runtimeInputs;
  let runtimeAuthority = null;
  let toolAuthority = null;
  try {
    const pythonVersionRoot = path.relative(runtime.venvRoot, siteRoot)
      .split(path.sep).slice(0, -1).join('/');
    const runtimeFiles = [
      {
        relativePath: 'bin/python',
        sourcePath: runtime.resolvedPath,
        sha256: runtime.executableSha256,
        maximumBytes: 256 * 1024 ** 2,
        mode: 0o500,
      },
      {
        relativePath: 'pyvenv.cfg',
        sourcePath: runtime.markerPath,
        sha256: runtime.markerSha256,
        maximumBytes: 1024 ** 2,
        mode: 0o400,
      },
      {
        relativePath: converter.relativePath,
        sourcePath: converter.sourcePath,
        sha256: converter.sha256,
        maximumBytes: converter.bytes,
        mode: 0o500,
      },
      ...packages.map((file) => ({
        relativePath: `${pythonVersionRoot}/site-packages/${file.relativePath}`,
        sourcePath: file.sourcePath,
        sha256: file.sha256,
        maximumBytes: Math.max(1, file.bytes),
        mode: 0o400,
      })),
    ];
    runtimeAuthority = await stagePackedRefinementAuthority({
      label: 'refinement Python runtime',
      manifestKind: 'neuma-runtime-manifest',
      files: runtimeFiles,
      maximumFiles: MAX_RUNTIME_FILES + 3,
      maximumBytes: MAX_RUNTIME_BYTES,
      operation,
    });
    const executablePaths = new Set([TRAINER_RELATIVE, CONSUMER_RELATIVE]);
    toolAuthority = await stagePackedRefinementAuthority({
      label: 'refinement source tools',
      manifestKind: 'neuma-source-manifest',
      files: source.closure.files.map((file) => ({
        relativePath: file.relativePath,
        content: file.content,
        sha256: file.sha256,
        maximumBytes: Math.max(1, file.bytes),
        mode: executablePaths.has(file.relativePath) ? 0o500 : 0o400,
      })),
      maximumFiles: 1024,
      maximumBytes: MAX_SOURCE_BYTES,
      operation,
    });
    const trainer = source.byPath.get(TRAINER_RELATIVE);
    const consumer = source.byPath.get(CONSUMER_RELATIVE);
    const requirements = source.byPath.get(REQUIREMENTS_RELATIVE);
    const environmentIdentity = Object.freeze({
      pythonExecutableSha256: runtime.executableSha256,
      pyvenvSha256: runtime.markerSha256,
      converterScriptSha256: converter.sha256,
      files: packages.map(({ relativePath, bytes, sha256 }) => ({
        relativePath, bytes, sha256,
      })),
    });
    return Object.freeze({
      ok: true,
      authority: Object.freeze({
        runtimeAuthority,
        toolAuthority,
        sourceIdentity: Object.freeze({
          sourceCommit: source.resolver.sourceCommit,
          sourceRootTreeId: source.resolver.rootTreeId,
          sourceIdentitySha256: source.resolver.sourceIdentitySha256,
          trainerExecutableSha256: trainer.sha256,
          converterScriptSha256: converter.sha256,
          pythonExecutableSha256: runtime.executableSha256,
          trainerEnvironmentSha256: refinementSha256(environmentIdentity),
          trainerRequirementsSha256: requirements.sha256,
        }),
        authorityConsumer: Object.freeze({
          content: consumer.content,
          sha256: consumer.sha256,
        }),
        guest: Object.freeze({
          python: '/runtime/bin/python',
          trainer: `/tool/${TRAINER_RELATIVE}`,
          converter: `/runtime/${CONVERTER_RUNTIME_RELATIVE}`,
        }),
      }),
    });
  } catch (error) {
    try {
      await closePackedAuthorities([runtimeAuthority, toolAuthority]);
    } catch (cleanupError) {
      return Object.freeze({
        ok: false,
        errorCode: 'TRAINING_EXECUTION_CLEANUP_REQUIRED',
        cleanupAuthority: runtimeCleanupAuthority(
          operation,
          [runtimeAuthority, toolAuthority],
          [error, cleanupError],
        ),
      });
    }
    throw error;
  }
};
