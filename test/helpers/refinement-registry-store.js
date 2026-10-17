import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  projectRefinementRegistryAdapters,
  validateRefinementRegistryV2,
} from '../../core/refinement/registry-contract.js';
import {
  openRefinementRegistryEncryptedSource,
  readRefinementAdaptersBounded,
} from '../../core/workspace/refinement-registry-reader.js';
import { encryptEnvelope, parseAndDecrypt } from '../../core/workspace/workspace-crypto.js';

const REGISTRY_BYTES_MAX = 8 * 1024 * 1024;
const DIR_FLAGS = constants.O_RDONLY
  | (typeof constants.O_DIRECTORY === 'number' ? constants.O_DIRECTORY : 0)
  | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0);
const WRITE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
  | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0);
let sequence = 0;

const refusal = (code, message) => Object.assign(new Error(message), { code });
const registryPath = (workspace, neumaId) =>
  path.join(workspace.pathFor(neumaId), 'refinement', 'adapters.json');
const controls = (options = {}) => {
  if (!options.signal || typeof options.signal.aborted !== 'boolean') {
    throw refusal('REFINEMENT_REGISTRY_INVALID_INPUT', 'registry signal authority is required');
  }
  if (!Number.isFinite(options.deadline)) {
    throw refusal('REFINEMENT_REGISTRY_INVALID_INPUT', 'registry monotonic deadline is required');
  }
  return Object.freeze({ signal: options.signal, deadline: options.deadline });
};
const check = ({ signal, deadline }) => {
  if (signal.aborted) throw refusal('REFINEMENT_REGISTRY_INTERRUPTED', 'registry operation was interrupted');
  if (performance.now() > deadline) {
    throw refusal('REFINEMENT_REGISTRY_DEADLINE', 'registry operation exceeded its monotonic deadline');
  }
};
const exactEnvelope = (text) => {
  let outer;
  try { outer = JSON.parse(text); } catch {
    throw refusal('REFINEMENT_REGISTRY_CORRUPT', 'registry ciphertext is not JSON');
  }
  if (!outer || outer._enc !== 1 || Array.isArray(outer)
    || Object.keys(outer).sort().join('\0') !== '_enc\0ct\0iv\0tag'
    || !['ct', 'iv', 'tag'].every((field) => typeof outer[field] === 'string')) {
    throw refusal('REFINEMENT_REGISTRY_CORRUPT', 'registry is not an exact encrypted envelope');
  }
};
const decrypt = async (workspace, filePath, text) => {
  exactEnvelope(text);
  const dek = await workspace._resolveDEK(filePath);
  try { return dek ? parseAndDecrypt(text, { key: dek }) : parseAndDecrypt(text); }
  catch { throw refusal('REFINEMENT_REGISTRY_CORRUPT', 'registry authentication failed'); }
};
const encrypt = async (workspace, filePath, value) => {
  const dek = await workspace._resolveDEK(filePath);
  const envelope = dek ? encryptEnvelope(value, { key: dek }) : encryptEnvelope(value);
  return JSON.stringify(envelope);
};
const owner = () => BigInt(typeof process.geteuid === 'function' ? process.geteuid() : 0);
const assertDirectory = async (directory) => {
  const resolved = path.resolve(directory);
  const [real, state] = await Promise.all([
    fs.realpath(resolved),
    fs.lstat(resolved, { bigint: true }),
  ]);
  if (real !== resolved || !state.isDirectory() || state.uid !== owner()
    || (state.mode & 0o077n) !== 0n) {
    throw refusal('REFINEMENT_REGISTRY_UNSAFE', 'registry directory is not direct and private');
  }
  return resolved;
};
const writeAll = async (handle, payload) => {
  let offset = 0;
  while (offset < payload.length) {
    const written = await handle.write(payload, offset, payload.length - offset, offset);
    if (!written.bytesWritten) throw refusal('REFINEMENT_REGISTRY_UNWRITABLE', 'registry write stopped early');
    offset += written.bytesWritten;
  }
};

// A first revision has no prior inode to pin, so its publish must itself BE the
// atomic create. link(2) fails EEXIST when the target exists; rename(2) clobbers
// by contract, so an lstat guard in front of it is a TOCTOU by construction —
// two first-writers both see ENOENT and the second silently destroys the first
// while both report success (measured: 2-3 of 50 lost per storm round, #311).
// Both names sit in the one /proc/self/fd/<dirfd> directory, so link(2)'s
// same-filesystem requirement holds by construction.
const linkFirstRevision = async (temporary, target) => {
  try {
    await fs.link(temporary, target);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    throw refusal('REFINEMENT_REGISTRY_CHANGED', 'registry appeared before its first revision');
  }
};

/** Open and validate one encrypted registry while retaining its exact current inode. */
export const openRefinementRegistryAuthority = async (
  workspace,
  neumaId,
  options = {},
) => {
  const control = controls(options);
  const filePath = registryPath(workspace, neumaId);
  const maximumBytes = options.maximumBytes ?? REGISTRY_BYTES_MAX;
  const source = await openRefinementRegistryEncryptedSource({
    filePath,
    maximumBytes,
    deadline: control.deadline,
    signal: control.signal,
    absent: true,
  });
  if (!source) return Object.freeze({ state: 'absent', registry: null, source: null, filePath });
  try {
    check(control);
    const registry = validateRefinementRegistryV2(
      await decrypt(workspace, filePath, source.text),
    );
    await source.verify(control);
    return Object.freeze({ state: 'present', registry, source, filePath });
  } catch (error) {
    await source.close().catch(() => {});
    throw error;
  }
};

/**
 * Replace one registry revision through its held prior-inode CAS, fsync the
 * ciphertext and directory, then return a same-FD authority for the new bytes.
 */
export const commitRefinementRegistryRevision = async ({
  workspace,
  neumaId,
  registry,
  expectedSource,
  options = {},
}) => {
  const control = controls(options);
  const validated = validateRefinementRegistryV2(registry);
  const filePath = registryPath(workspace, neumaId);
  const payload = Buffer.from(await encrypt(workspace, filePath, validated), 'utf8');
  if (!payload.length || payload.length > (options.maximumBytes ?? REGISTRY_BYTES_MAX)) {
    throw refusal('REFINEMENT_REGISTRY_OVERFLOW', 'encrypted registry exceeds its byte envelope');
  }
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  await assertDirectory(directory);
  const directoryHandle = await fs.open(directory, DIR_FLAGS);
  const anchored = process.platform === 'linux' ? `/proc/self/fd/${directoryHandle.fd}` : directory;
  const target = path.join(anchored, path.basename(filePath));
  const temporary = path.join(
    anchored,
    `.registry-${process.pid}-${++sequence}.tmp`,
  );
  let output = null;
  let operationError = null;
  try {
    check(control);
    if (expectedSource) await expectedSource.verify(control);
    output = await fs.open(temporary, WRITE_FLAGS, 0o600);
    await writeAll(output, payload);
    await output.sync();
    await output.close();
    output = null;
    check(control);
    if (expectedSource) {
      await expectedSource.verify(control);
      await fs.rename(temporary, target);
    } else {
      await linkFirstRevision(temporary, target);
    }
    await directoryHandle.sync();
  } catch (error) {
    operationError = error;
  } finally {
    // `temporary` is anchored at /proc/self/fd/<dirfd>, so it stops resolving
    // the instant the directory handle closes. Racing the unlink against that
    // close in one allSettled loses roughly half the time: the unlink fails,
    // the temp file survives, and a CAS conflict throws a cleanup AggregateError
    // on top of its real refusal. Measured at 40-90 leaked `.registry-*.tmp`
    // files per 50-way write storm. Sequence it: the write handle's own
    // descriptor, then the anchored temp name, then the anchor itself. link(2)
    // does not consume the temp name the way rename(2) does, so on a first
    // revision this unlink is the success path's only cleanup.
    const failures = [];
    const release = async (task) => {
      try { await task(); } catch (error) { failures.push(error); }
    };
    if (output) await release(() => output.close());
    await release(() => fs.unlink(temporary).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    }));
    await release(() => directoryHandle.close());
    if (failures.length) {
      throw new AggregateError(
        [...(operationError ? [operationError] : []), ...failures],
        'registry revision and descriptor cleanup failed',
      );
    }
  }
  if (operationError) throw operationError;
  const committed = await openRefinementRegistryAuthority(workspace, neumaId, {
    ...control,
    maximumBytes: options.maximumBytes ?? REGISTRY_BYTES_MAX,
  });
  if (committed.state !== 'present'
    || committed.registry.registrySha256 !== validated.registrySha256
    || committed.registry.generation !== validated.generation) {
    await committed.source?.close().catch(() => {});
    throw refusal('REFINEMENT_REGISTRY_DURABILITY', 'registry revision did not become durable');
  }
  return committed;
};

/** Strict serving read; every visible append must match a committed journal tuple. */
export const readCommittedRefinementAdapters = async (
  workspace,
  neumaId,
  options = {},
) => {
  const control = controls(options);
  const filePath = registryPath(workspace, neumaId);
  return readRefinementAdaptersBounded({
    filePath,
    decrypt: (text) => decrypt(workspace, filePath, text),
    readCustody: async () =>
      (await workspace.readRefinementCustodyAuthorityBounded(neumaId, control)).custody,
    verifyCommit: options.verifyCommit,
    maximumBytes: options.maximumBytes ?? REGISTRY_BYTES_MAX,
    maximumAdapters: options.maximumAdapters ?? 64,
    maximumRevisions: options.maximumRevisions ?? 1024,
    maximumStringBytes: options.maximumStringBytes ?? REGISTRY_BYTES_MAX,
    ...control,
  });
};
const exactHistoricalEntry = (adapter, expected) =>
  adapter.adapterIdSha256 === expected.adapterIdSha256
  && adapter.sha256 === expected.artifactSha256
  && adapter.publicationTransactionSha256 === expected.publicationTransactionSha256
  && adapter.registrationRegistryGeneration === expected.registrationRegistryGeneration
  && adapter.registrationRegistryAppendRevision === expected.registrationRegistryAppendRevision
  && adapter.registrationRegistrySha256 === expected.registrationRegistrySha256
  && adapter.registrationRegistryCurrentSelectionSha256
    === expected.registrationRegistryCurrentSelectionSha256;

/**
 * Hold one encrypted current registry inode while authenticating exact
 * historical registration appends. The caller composes artifact/ceremony
 * owners without ever receiving a forgeable path snapshot.
 */
export const openHeldRefinementRegistryEntriesAuthority = async (
  workspace,
  neumaId,
  expectedEntries,
  options = {},
) => {
  const control = controls(options);
  if (!Array.isArray(expectedEntries) || !expectedEntries.length
    || new Set(expectedEntries.map(({ adapterIdSha256 }) => adapterIdSha256)).size
      !== expectedEntries.length
    || typeof options.verifyCommit !== 'function') {
    throw refusal('REFINEMENT_REGISTRY_INVALID_INPUT', 'held registry entries request is invalid');
  }
  const opened = await openRefinementRegistryAuthority(workspace, neumaId, {
    ...control,
    maximumBytes: options.maximumBytes ?? REGISTRY_BYTES_MAX,
  });
  if (opened.state !== 'present') {
    throw refusal('REFINEMENT_REGISTRY_UNAVAILABLE', 'committed registry is unavailable');
  }
  let closed = false;
  let closing = null;
  try {
    const adapters = projectRefinementRegistryAdapters(opened.registry);
    const entries = Object.freeze(expectedEntries.map((expected) => {
      const matches = adapters.filter((adapter) => exactHistoricalEntry(adapter, expected));
      if (matches.length !== 1) {
        throw refusal('REFINEMENT_REGISTRY_CHANGED', 'historical registration authority is unavailable');
      }
      return matches[0];
    }));
    const custodyRead = await workspace.readRefinementCustodyAuthorityBounded(neumaId, control);
    if (custodyRead.state !== 'present' || !custodyRead.custody
      || entries.some(({ custody }) =>
        JSON.stringify(custody) !== JSON.stringify(custodyRead.custody))) {
      throw refusal('REFINEMENT_REGISTRY_CHANGED', 'historical registry custody is not current');
    }
    const verify = async () => {
      if (closed || closing) throw refusal('REFINEMENT_REGISTRY_CHANGED', 'held registry authority is closing');
      check(control);
      await opened.source.verify(control);
      const currentCustody = await workspace.readRefinementCustodyAuthorityBounded(neumaId, control);
      if (currentCustody.state !== 'present'
        || JSON.stringify(currentCustody.custody) !== JSON.stringify(custodyRead.custody)) {
        throw refusal('REFINEMENT_REGISTRY_CHANGED', 'held registry custody changed');
      }
      for (const entry of entries) {
        const committed = await options.verifyCommit(Object.freeze({
          transactionSha256: entry.publicationTransactionSha256,
          registryGeneration: entry.registrationRegistryGeneration,
          registryAppendRevision: entry.registrationRegistryAppendRevision,
          registrySha256: entry.registrationRegistrySha256,
          registryCurrentSelectionSha256: entry.registrationRegistryCurrentSelectionSha256,
        }), control);
        if (committed !== true
          && committed?.transactionSha256 !== entry.publicationTransactionSha256) {
          throw refusal('REFINEMENT_REGISTRY_UNCOMMITTED', 'historical registry append is uncommitted');
        }
      }
      await opened.source.verify(control);
      return true;
    };
    await verify();
    const close = async () => {
      if (closed) return false;
      if (closing) return closing;
      closing = (async () => {
        try {
          await opened.source.close();
          closed = true;
          return true;
        } finally { closing = null; }
      })();
      return closing;
    };
    return Object.freeze({
      kind: 'held-refinement-registry-entries-authority-v2',
      entries,
      currentRegistry: Object.freeze({
        generation: opened.registry.generation,
        appendRevision: opened.registry.appendRevision,
        registrySha256: opened.registry.registrySha256,
        currentSelection: opened.registry.currentSelection,
        currentSelectionSha256: opened.registry.currentSelectionSha256,
        selectedScale: opened.registry.selectedScale,
      }),
      custody: custodyRead.custody,
      verify,
      close,
    });
  } catch (error) {
    try {
      await opened.source.close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'held registry authority cleanup failed');
    }
    throw error;
  }
};

export const projectCurrentRefinementAdapter = (registry, adapterId = null) => {
  const adapters = projectRefinementRegistryAdapters(registry);
  const matches = adapters.filter(({ isCurrent, id }) => isCurrent && (adapterId == null || id === adapterId));
  if (matches.length !== 1) {
    throw refusal('REFINEMENT_ADAPTER_UNAVAILABLE', 'current registry selection is unavailable or ambiguous');
  }
  return matches[0];
};

export const refinementRegistryFilePath = registryPath;
