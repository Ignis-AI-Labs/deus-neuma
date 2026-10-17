import { createHash } from 'node:crypto';
import { canonicalAuthoritySha256 } from '../../core/shared/plain-data-canonical.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCleanTrackedSource } from './tracked-source-freshness.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import { resolveTrackedLocalImportClosure } from './local-static-import-closure.js';
import {
  retryRefinementImmutableFileSetCleanup,
  stageVerifiedBootstrapHandle,
} from './refinement-immutable-staging-internal/file-set.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const AUTHORITY_OPERATIONS = new WeakMap();
const RESOLVER_OPERATIONS = new WeakMap();
const PROJECTIONS = new WeakMap();
const FIXED_BLOB_AUTHORITIES = new WeakMap();
const FIXED_BLOB_KINDS = Object.freeze({
  'lineage-config': Object.freeze({
    relativePath: 'backend/config/refinement-lineages.json',
    maximumBytes: 256 * 1024,
    mode: '100644',
  }),
});

const fail = (message) => Object.assign(new Error(`refinement source authority: ${message}`), {
  code: 'REFINEMENT_SOURCE_AUTHORITY_UNAVAILABLE',
});

const operationFor = (value) => {
  try {
    return assertRefinementProcessOperation(value);
  } catch (error) {
    throw Object.assign(fail('one active caller operation is required'), { cause: error });
  }
};

const rootIdentity = async (operation) => {
  operation.assertActive();
  const canonicalPath = await fs.realpath(PROJECT_ROOT).catch((error) => {
    throw Object.assign(fail('server project root is unavailable'), { cause: error });
  });
  if (canonicalPath !== PROJECT_ROOT) throw fail('server project root is indirect');
  const state = await fs.stat(canonicalPath, { bigint: true }).catch((error) => {
    throw Object.assign(fail('server project root is unavailable'), { cause: error });
  });
  operation.assertActive();
  if (!state.isDirectory()) throw fail('server project root is not a directory');
  return Object.freeze({
    path: canonicalPath,
    device: state.dev.toString(10),
    inode: state.ino.toString(10),
  });
};

const sameRoot = (left, right) => left.path === right.path
  && left.device === right.device
  && left.inode === right.inode;

const digest = (domain, value) => createHash('sha256')
  .update(`${domain}\0`, 'utf8')
  .update(JSON.stringify(value), 'utf8')
  .digest('hex');

/**
 * Open one point-in-time clean source proof for this server's own project root.
 * The proof is borrowed process-local data: it owns no descriptor or lifecycle.
 */
export const openRefinementSourceAuthority = async (input = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw fail('request must contain only one operation');
  }
  const fields = Reflect.ownKeys(input);
  if (fields.length !== 1 || fields[0] !== 'operation') {
    throw fail('request must contain only one operation');
  }
  const operation = operationFor(input.operation);
  const before = await rootIdentity(operation);
  const observed = await resolveCleanTrackedSource({
    sourceRoot: PROJECT_ROOT,
    signal: operation.signal,
    deadline: operation.epochDeadline,
  });
  const after = await rootIdentity(operation);
  operation.assertActive();
  if (!sameRoot(before, after)
    || !OID.test(observed.sourceCommit) || !OID.test(observed.rootTreeId)) {
    throw fail('server source identity changed during verification');
  }
  const sourceIdentitySha256 = digest('neuma.refinement.source-identity.v1', {
    sourceCommit: observed.sourceCommit,
    rootTreeId: observed.rootTreeId,
  });
  const sourceCustodySha256 = digest('neuma.refinement.source-custody.v1', {
    root: after,
    sourceCommit: observed.sourceCommit,
    rootTreeId: observed.rootTreeId,
  });
  const authority = Object.freeze({
    kind: 'refinement-source-authority',
    root: after,
    sourceCommit: observed.sourceCommit,
    rootTreeId: observed.rootTreeId,
    sourceIdentitySha256,
    sourceCustodySha256,
  });
  operation.assertActive();
  AUTHORITY_OPERATIONS.set(authority, operation);
  return authority;
};

export const assertRefinementSourceAuthority = (value, suppliedOperation) => {
  const operation = operationFor(suppliedOperation);
  if (!value || typeof value !== 'object' || AUTHORITY_OPERATIONS.get(value) !== operation) {
    throw fail('source proof is not bound to this operation');
  }
  operation.assertActive();
  return value;
};

/** Project a branded proof into the exact fields committed Git-object readers need. */
export const projectRefinementSourceResolver = (sourceAuthority, suppliedOperation) => {
  const operation = operationFor(suppliedOperation);
  const authority = assertRefinementSourceAuthority(sourceAuthority, operation);
  const existing = PROJECTIONS.get(authority);
  if (existing) return assertRefinementSourceResolver(existing, operation);
  const resolver = Object.freeze({
    kind: 'refinement-source-resolver',
    root: authority.root,
    sourceRoot: authority.root.path,
    authorityRoot: authority.root.path,
    sourceCommit: authority.sourceCommit,
    rootTreeId: authority.rootTreeId,
    sourceIdentitySha256: authority.sourceIdentitySha256,
    sourceCustodySha256: authority.sourceCustodySha256,
  });
  RESOLVER_OPERATIONS.set(resolver, operation);
  PROJECTIONS.set(authority, resolver);
  return assertRefinementSourceResolver(resolver, operation);
};

export const assertRefinementSourceResolver = (value, suppliedOperation) => {
  const operation = operationFor(suppliedOperation);
  if (!value || typeof value !== 'object' || RESOLVER_OPERATIONS.get(value) !== operation) {
    throw fail('source resolver is not bound to this operation');
  }
  operation.assertActive();
  return value;
};

const exactBlobOpenInput = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw fail('fixed source blob request is invalid');
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const fields = ['kind', 'operation', 'sourceAuthority'];
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length
    || keys.some((key) => typeof key !== 'string' || !fields.includes(key))
    || fields.some((field) => !Object.hasOwn(descriptors[field], 'value'))) {
    throw fail('fixed source blob request is invalid');
  }
  return Object.freeze(Object.fromEntries(fields.map((field) => [
    field, descriptors[field].value,
  ])));
};

const resolveFixedBlob = async (source, operation, blobKind) => {
  const declaration = FIXED_BLOB_KINDS[blobKind];
  if (!declaration) throw fail('fixed source blob kind is unsupported');
  operation.assertActive();
  const closure = await resolveTrackedLocalImportClosure({
    sourceRoot: source.root.path,
    sourceCommit: source.sourceCommit,
    authorityRoot: source.root.path,
    roots: [],
    explicitPaths: [declaration.relativePath],
    signal: operation.signal,
    deadline: operation.epochDeadline,
    limits: {
      maxFiles: 1,
      maxTreeEntries: 100_000,
      maxTreeBytes: 32 * 1024 * 1024,
      maxFileBytes: declaration.maximumBytes,
      maxTotalBytes: declaration.maximumBytes,
      maxDepth: 1,
      maxPathBytes: 512,
      maxRoots: 1,
      maxExplicitPaths: 1,
      deadlineMs: 30_000,
    },
  });
  const matches = closure.files.filter(({ relativePath }) =>
    relativePath === declaration.relativePath);
  if (closure.sourceCommit !== source.sourceCommit
    || closure.rootTreeId !== source.rootTreeId
    || closure.files.length !== 1
    || matches.length !== 1
    || matches[0].mode !== declaration.mode
    || matches[0].bytes < 1
    || matches[0].bytes > declaration.maximumBytes
    || !OID.test(matches[0].objectId)
    || !/^[0-9a-f]{64}$/u.test(matches[0].sha256)) {
    throw fail('fixed source blob does not match its committed tree object');
  }
  return Object.freeze({ declaration, blob: matches[0] });
};

const fixedBlobProjection = (source, blobKind, resolved) => {
  const identity = Object.freeze({
    blobKind,
    bytes: resolved.blob.bytes,
    mode: resolved.blob.mode,
    objectId: resolved.blob.objectId,
    rootTreeId: source.rootTreeId,
    sha256: resolved.blob.sha256,
    sourceCommit: source.sourceCommit,
    sourceIdentitySha256: source.sourceIdentitySha256,
  });
  return Object.freeze({
    ...identity,
    sourceBlobIdentitySha256: canonicalAuthoritySha256(identity, {
      domain: 'neuma.refinement.fixed-source-blob',
      schemaVersion: 1,
      maxDepth: 8,
      maxNodes: 32,
      maxOutputBytes: 8 * 1024,
    }),
  });
};

const fixedBlobState = (authority, suppliedOperation, active = true) => {
  const state = FIXED_BLOB_AUTHORITIES.get(authority);
  if (!state || state.operation !== suppliedOperation) {
    throw fail('fixed source blob authority is invalid');
  }
  if (active) {
    assertRefinementSourceAuthority(state.sourceAuthority, suppliedOperation);
    if (state.phase !== 'open') throw fail(`fixed source blob authority is ${state.phase}`);
  }
  return state;
};

/** Hold one server-declared blob from the exact committed source tree. */
export const openFixedRefinementSourceBlob = async (input) => {
  const exact = exactBlobOpenInput(input);
  const operation = operationFor(exact.operation);
  const source = assertRefinementSourceAuthority(exact.sourceAuthority, operation);
  const resolved = await resolveFixedBlob(source, operation, exact.kind);
  const projection = fixedBlobProjection(source, exact.kind, resolved);
  let held = null;
  try {
    const staged = await stageVerifiedBootstrapHandle({
      content: resolved.blob.content,
      sha256: projection.sha256,
      maximumBytes: resolved.declaration.maximumBytes,
      label: `committed ${exact.kind} source blob`,
      mode: 0o400,
      operation,
    });
    if (!staged.ok) {
      if (staged.cleanupAuthority) {
        const retried = await retryRefinementImmutableFileSetCleanup(
          staged.cleanupAuthority,
          operation,
        );
        if (!retried.ok) {
          const cleanupError = fail('fixed source blob staging cleanup requires recovery');
          Object.defineProperty(cleanupError, 'cleanupAuthority', {
            value: retried.cleanupAuthority,
          });
          throw cleanupError;
        }
      }
      throw fail(`fixed source blob staging failed: ${staged.errorCode}`);
    }
    held = staged.authority;
    const authority = Object.freeze({ kind: 'held-fixed-refinement-source-blob-v1' });
    FIXED_BLOB_AUTHORITIES.set(authority, {
      sourceAuthority: exact.sourceAuthority,
      operation,
      blobKind: exact.kind,
      maximumBytes: resolved.declaration.maximumBytes,
      content: resolved.blob.content,
      held,
      projection,
      phase: 'open',
      closePromise: null,
    });
    return authority;
  } catch (error) {
    if (!held) throw error;
    try { await held.close(operation); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'fixed source blob staging cleanup failed', { cause: cleanupError });
    }
    throw error;
  }
};

export const projectFixedRefinementSourceBlob = (authority, operation) =>
  fixedBlobState(authority, operation).projection;

export const verifyFixedRefinementSourceBlob = async (authority, operation) => {
  const state = fixedBlobState(authority, operation);
  await state.held.verify(operation);
  const source = assertRefinementSourceAuthority(state.sourceAuthority, operation);
  const repeated = await resolveFixedBlob(source, operation, state.blobKind);
  const projection = fixedBlobProjection(source, state.blobKind, repeated);
  if (projection.sourceBlobIdentitySha256 !== state.projection.sourceBlobIdentitySha256) {
    throw fail('fixed source blob changed after acquisition');
  }
  return state.projection;
};

export const readFixedRefinementSourceBlob = async (authority, operation) => {
  const state = fixedBlobState(authority, operation);
  await verifyFixedRefinementSourceBlob(authority, operation);
  operation.assertActive();
  return Object.freeze({
    ...state.projection,
    content: Buffer.from(state.content),
  });
};

/** Retryable close; cleanup checks the exact owning operation identity without requiring it active. */
export const closeFixedRefinementSourceBlob = (authority, operation) => {
  const state = fixedBlobState(authority, operation, false);
  if (state.phase === 'closed') return Promise.resolve(false);
  if (state.closePromise) return state.closePromise;
  state.phase = 'closing';
  state.closePromise = state.held.close(operation).then(
    () => {
      state.content.fill(0);
      state.phase = 'closed';
      return true;
    },
    (error) => {
      state.phase = 'cleanup-failed';
      throw error;
    },
  ).finally(() => { state.closePromise = null; });
  return state.closePromise;
};
