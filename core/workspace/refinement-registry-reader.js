import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { readRefinementEncryptedJsonBounded } from './refinement-history-reader.js';
import { refinementCustodyMatches } from '../refinement/training-authority-contract.js';
import {
  projectRefinementRegistryAdapters,
  validateRefinementRegistryV2,
} from '../refinement/registry-contract.js';

const FILE_FLAGS = constants.O_RDONLY
  | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0)
  | (typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0);

const refusal = (code, message) => Object.assign(new Error(message), { code });
const checkControl = ({ deadline, signal }) => {
  if (!signal || typeof signal.aborted !== 'boolean' || signal.aborted) {
    throw refusal('REFINEMENT_REGISTRY_INTERRUPTED', 'refinement registry read was interrupted');
  }
  if (!Number.isFinite(deadline) || performance.now() > deadline) {
    throw refusal('REFINEMENT_REGISTRY_DEADLINE', 'refinement registry read exceeded its monotonic deadline');
  }
};
const natural = (value, field) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw refusal('REFINEMENT_REGISTRY_INVALID_LIMIT', `${field} must be a non-negative safe integer`);
  }
  return value;
};
const sameState = (left, right) => left.dev === right.dev
  && left.ino === right.ino
  && left.size === right.size
  && left.mode === right.mode
  && left.uid === right.uid
  && left.mtimeNs === right.mtimeNs
  && left.ctimeNs === right.ctimeNs;
const assertDirect = async (resolved, stat, kind) => {
  const real = await fs.realpath(resolved);
  if (real !== resolved || (kind === 'file' ? !stat.isFile() : !stat.isDirectory())) {
    throw refusal('REFINEMENT_REGISTRY_UNSAFE', 'refinement registry storage is not a direct regular object');
  }
};
const assertOwnedFile = (stat) => {
  const owner = BigInt(typeof process.geteuid === 'function' ? process.geteuid() : Number(stat.uid));
  if ((stat.uid !== owner && stat.uid !== 0n) || (stat.mode & 0o022n) !== 0n) {
    throw refusal('REFINEMENT_REGISTRY_UNSAFE', 'refinement registry file has unsafe ownership or permissions');
  }
};

const readStableText = async (
  filePath,
  maximumBytes,
  control,
  { absent = false, retain = false } = {},
) => {
  const resolved = path.resolve(filePath);
  let before;
  try {
    before = await fs.lstat(resolved, { bigint: true });
  } catch (error) {
    if (absent && error?.code === 'ENOENT') return null;
    throw refusal('REFINEMENT_REGISTRY_UNREADABLE', 'refinement registry storage is unreadable');
  }
  checkControl(control);
  assertOwnedFile(before);
  if (!before.isFile() || before.size <= 0n || before.size > BigInt(maximumBytes)) {
    throw refusal('REFINEMENT_REGISTRY_OVERFLOW', 'refinement registry file exceeds its byte envelope');
  }
  await assertDirect(resolved, before, 'file');
  let handle;
  let retained = false;
  try {
    handle = await fs.open(resolved, FILE_FLAGS);
    const opened = await handle.stat({ bigint: true });
    if (!sameState(before, opened)) {
      throw refusal('REFINEMENT_REGISTRY_CHANGED', 'refinement registry changed before stable open');
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      checkControl(control);
      const read = await handle.read(bytes, offset, bytes.length - offset, null);
      if (read.bytesRead === 0) {
        throw refusal('REFINEMENT_REGISTRY_CORRUPT', 'refinement registry ended before its declared size');
      }
      offset += read.bytesRead;
    }
    const trailing = Buffer.allocUnsafe(1);
    if ((await handle.read(trailing, 0, 1, null)).bytesRead !== 0) {
      throw refusal('REFINEMENT_REGISTRY_CHANGED', 'refinement registry grew during stable read');
    }
    const [after, pathAfter] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.lstat(resolved, { bigint: true }),
    ]);
    if (!sameState(before, after) || !sameState(before, pathAfter)) {
      throw refusal('REFINEMENT_REGISTRY_CHANGED', 'refinement registry changed during stable read');
    }
    const ciphertextSha256 = createHash('sha256').update(bytes).digest('hex');
    if (!retain) return Object.freeze({
      text: bytes.toString('utf8'),
      bytes: bytes.length,
      ciphertextSha256,
    });
    let closed = false;
    const verify = async (nextControl = control) => {
      if (closed) {
        throw refusal('REFINEMENT_REGISTRY_CHANGED', 'refinement registry authority is closed');
      }
      checkControl(nextControl);
      const [held, current, real] = await Promise.all([
        handle.stat({ bigint: true }),
        fs.lstat(resolved, { bigint: true }),
        fs.realpath(resolved),
      ]);
      if (real !== resolved || !sameState(before, held) || !sameState(before, current)) {
        throw refusal('REFINEMENT_REGISTRY_CHANGED', 'refinement registry authority is no longer current');
      }
      const repeated = createHash('sha256');
      const chunk = Buffer.allocUnsafe(1024 * 1024);
      let position = 0;
      while (position < bytes.length) {
        checkControl(nextControl);
        const result = await handle.read(
          chunk,
          0,
          Math.min(chunk.length, bytes.length - position),
          position,
        );
        if (result.bytesRead === 0) {
          throw refusal('REFINEMENT_REGISTRY_CHANGED', 'refinement registry authority ended during verification');
        }
        repeated.update(chunk.subarray(0, result.bytesRead));
        position += result.bytesRead;
      }
      if (repeated.digest('hex') !== ciphertextSha256) {
        throw refusal('REFINEMENT_REGISTRY_CHANGED', 'refinement registry authority bytes changed');
      }
      return true;
    };
    const close = async () => {
      if (closed) return false;
      closed = true;
      await handle.close();
      return true;
    };
    retained = true;
    return Object.freeze({
      text: bytes.toString('utf8'),
      bytes: bytes.length,
      ciphertextSha256,
      handle,
      fd: handle.fd,
      verify,
      close,
    });
  } catch (error) {
    if (error?.code?.startsWith?.('REFINEMENT_')) throw error;
    throw refusal('REFINEMENT_REGISTRY_UNREADABLE', 'refinement registry storage is unreadable');
  } finally {
    if (!retained) await handle?.close().catch(() => {});
  }
};

/** Open one bounded encrypted registry inode and retain its current-path CAS owner. */
export const openRefinementRegistryEncryptedSource = async ({
  filePath,
  maximumBytes,
  deadline,
  signal,
  absent = false,
}) => {
  natural(maximumBytes, 'maximumBytes');
  return readStableText(
    filePath,
    maximumBytes,
    { deadline, signal },
    { absent, retain: true },
  );
};

/**
 * Read one exact encrypted v2 registry, validate every append prefix, and
 * require a committed publication transaction for every visible adapter.
 */
export const readRefinementAdaptersBounded = async ({
  filePath,
  decrypt,
  readCustody,
  verifyCommit,
  maximumBytes,
  maximumAdapters,
  maximumRevisions = maximumAdapters,
  maximumStringBytes,
  deadline,
  signal,
}) => {
  natural(maximumBytes, 'maximumBytes');
  natural(maximumAdapters, 'maximumAdapters');
  natural(maximumRevisions, 'maximumRevisions');
  natural(maximumStringBytes, 'maximumStringBytes');
  if (maximumBytes === 0 || maximumStringBytes === 0) {
    throw refusal('REFINEMENT_REGISTRY_OVERFLOW', 'refinement registry has no remaining byte envelope');
  }
  if (typeof decrypt !== 'function' || typeof readCustody !== 'function'
    || typeof verifyCommit !== 'function') {
    throw refusal(
      'REFINEMENT_REGISTRY_INVALID_INPUT',
      'refinement registry reader requires decrypt, custody, and commit authorities',
    );
  }
  const control = { deadline, signal };
  checkControl(control);
  const custody = await readCustody(control);
  if (!custody) return Object.freeze({
    state: 'subject-absent', adapters: Object.freeze([]), decryptedBytes: 0, stringBytes: 0,
  });
  const source = await readRefinementEncryptedJsonBounded({
    filePath,
    decrypt: (_sourcePath, text) => decrypt(text),
    limits: {
      maximumCiphertextBytes: maximumBytes,
      maximumPlaintextBytes: maximumBytes,
      maximumStringBytes,
    },
    control,
    absent: true,
  });
  if (source.state === 'absent') return Object.freeze({
    state: 'registry-absent',
    adapters: Object.freeze([]),
    decryptedBytes: 0,
    stringBytes: 0,
    accounting: source.accounting,
  });
  checkControl(control);
  let registry;
  try {
    registry = validateRefinementRegistryV2(source.value);
  } catch {
    throw refusal(
      'REFINEMENT_REGISTRY_CORRUPT',
      'encrypted adapter registry is not a canonical monotonic v2 registry',
    );
  }
  const registrations = registry.entries.filter(
    ({ kind }) => kind === 'adapter-registration-v2',
  );
  if (registrations.length > maximumAdapters || registry.entries.length > maximumRevisions) {
    throw refusal('REFINEMENT_REGISTRY_OVERFLOW', 'encrypted adapter registry exceeds its revision envelope');
  }
  if (registrations.some(({ adapter }) =>
    !refinementCustodyMatches(adapter.custody, custody))) {
    throw refusal(
      'REFINEMENT_REGISTRY_CHANGED',
      'encrypted adapter registry custody is not current',
    );
  }
  for (const entry of registry.entries) {
    checkControl(control);
    const committed = await verifyCommit(Object.freeze({
      transactionSha256: entry.commit.transactionSha256,
      registryGeneration: entry.commit.generation,
      registryAppendRevision: entry.commit.appendRevision,
      registrySha256: entry.commit.registrySha256,
      registryCurrentSelectionSha256: entry.commit.currentSelectionSha256,
    }), control);
    if (committed !== true && committed?.transactionSha256 !== entry.commit.transactionSha256) {
      throw refusal(
        'REFINEMENT_REGISTRY_UNCOMMITTED',
        'encrypted adapter registry has no matching committed publication transaction',
      );
    }
  }
  const currentCustody = await readCustody(control);
  checkControl(control);
  if (!refinementCustodyMatches(custody, currentCustody)) {
    throw refusal('REFINEMENT_REGISTRY_CHANGED', 'sovereign refinement custody changed during registry read');
  }
  const adapters = projectRefinementRegistryAdapters(registry);
  return Object.freeze({
    state: 'present',
    adapters,
    generation: registry.generation,
    appendRevision: registry.appendRevision,
    priorRegistrySha256: registry.priorRegistrySha256,
    registrySha256: registry.registrySha256,
    currentSelection: registry.currentSelection,
    currentSelectionSha256: registry.currentSelectionSha256,
    selectedScale: registry.selectedScale,
    decryptedBytes: source.accounting.plaintextBytes,
    stringBytes: source.accounting.stringBytes,
    staleAdapters: 0,
    accounting: source.accounting,
  });
};
