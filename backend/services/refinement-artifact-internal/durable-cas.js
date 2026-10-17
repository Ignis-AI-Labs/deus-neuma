import path from 'node:path';
import { sha256HandleStable } from '../file-digest.js';
import {
  createAnonymousStagingDirectory,
  openPinnedDirectoryChild,
  pinDirectoryCustody,
  publishOwnedDirectory,
  samePinnedDirectoryState,
  syncDirectoryCustody,
  transferOwnedFile,
} from '../refinement-directory-custody.js';

const SHA256 = /^[a-f0-9]{64}$/u;
const uid = () => BigInt(typeof process.geteuid === 'function' ? process.geteuid() : 0);

const exactFile = (state, maximumBytes, label) => {
  if (!state.isFile() || state.uid !== uid() || state.nlink !== 1n
    || (state.mode & 0o777n) !== 0o400n || state.size < 1n
    || state.size > BigInt(maximumBytes)) {
    throw new Error(`${label} is not an exact immutable private file`);
  }
};

const enterDirectory = async (owner, name, label, mode) => {
  try {
    await owner.claim({ name, label, mode });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    await owner.enter({ name, label, mode });
  }
};

const openObjects = async (root) => {
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root) throw new Error('artifact store root is invalid');
  const owner = await pinDirectoryCustody(
    path.dirname(resolved),
    'artifact store parent custody',
    { allowRootStickyAncestors: true },
  );
  try {
    await enterDirectory(owner, path.basename(resolved), 'artifact store root', 0o700);
    // `temporary` MUST exist before the staging owner pins this same store
    // root. Creating it later mutates a directory THIS owner already holds,
    // and a refresh only ever repairs the one owner that performed the
    // mutation — the other's pinned identity is silently stale from then on.
    await enterDirectory(owner, 'temporary', 'artifact staging root', 0o700);
    await owner.leave();
    await enterDirectory(owner, 'objects', 'artifact object root', 0o700);
    return owner;
  } catch (error) {
    try { await owner.close(); } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'artifact store open and cleanup failed', { cause: cleanup });
    }
    throw error;
  }
};

const verifyHeld = async (handle, expectedSha256, expectedBytes, maximumBytes, label) => {
  const before = await handle.stat({ bigint: true });
  exactFile(before, maximumBytes, label);
  if (expectedBytes !== null && before.size !== BigInt(expectedBytes)) {
    throw new Error(`${label} size differs from its content authority`);
  }
  const sha256 = await sha256HandleStable(handle, { maximumBytes });
  const after = await handle.stat({ bigint: true });
  if (!samePinnedDirectoryState(before, after) || sha256 !== expectedSha256) {
    throw new Error(`${label} changed or differs from its content authority`);
  }
  return Object.freeze({ sha256, bytes: Number(after.size), state: after });
};

const openExisting = async (objects, sha256, expectedBytes, maximumBytes) => {
  let object;
  try {
    object = await openPinnedDirectoryChild(objects, {
      name: sha256,
      label: 'artifact object',
      mode: 0o500,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let resource = null;
  let handle = null;
  try {
    const opened = await object.open({ kind: 'file', name: 'bytes', label: 'artifact bytes' });
    resource = opened.resource;
    const transferred = await transferOwnedFile(object, resource);
    resource = null;
    handle = transferred.handle;
    const verified = await verifyHeld(
      handle,
      sha256,
      expectedBytes,
      maximumBytes,
      'artifact bytes',
    );
    await object.close();
    return Object.freeze({ handle, ...verified, existed: true });
  } catch (error) {
    const failures = [error];
    if (resource) await object.release(resource).catch((failure) => failures.push(failure));
    if (handle) await handle.close().catch((failure) => failures.push(failure));
    await object.close().catch((failure) => failures.push(failure));
    if (failures.length > 1) {
      throw new AggregateError(failures, 'existing artifact verification and cleanup failed', { cause: error });
    }
    throw error;
  }
};

const cleanupOwners = async (primary, owners, label) => {
  const settled = await Promise.allSettled(owners.filter(Boolean).map((owner) => owner.close()));
  const failures = settled.filter(({ status }) => status === 'rejected').map(({ reason }) => reason);
  if (failures.length) throw new AggregateError([primary, ...failures], `${label} cleanup failed`);
  throw primary;
};

/** Private content-addressed publication through opaque held-directory owners. */
export const publishDurableArtifact = async ({
  root,
  expectedSha256 = null,
  maximumBytes,
  write,
}) => {
  if (typeof root !== 'string' || !path.isAbsolute(root)
    || (expectedSha256 !== null && !SHA256.test(String(expectedSha256)))
    || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || typeof write !== 'function') {
    throw new Error('durable artifact publication request is invalid');
  }
  let objects = await openObjects(root);
  if (expectedSha256 !== null) {
    const existing = await openExisting(objects, expectedSha256, null, maximumBytes);
    if (existing) {
      await objects.close();
      return existing;
    }
  }
  let staging = null;
  let transferred = null;
  try {
    staging = await createAnonymousStagingDirectory({
      root,
      leafName: 'temporary',
      prefix: '.stage',
      label: 'artifact publication',
    });
    const created = await staging.create({
      kind: 'file',
      name: 'bytes',
      mode: 0o600,
      label: 'artifact output',
      operation: write,
    });
    const resource = created.resource;
    const written = created.result;
    if (!written || !SHA256.test(String(written.sha256 || ''))
      || (expectedSha256 !== null && written.sha256 !== expectedSha256)
      || !Number.isSafeInteger(written.bytes) || written.bytes < 1
      || written.bytes > maximumBytes) {
      throw new Error('artifact writer did not produce its declared content authority');
    }
    await staging.open({
      resource,
      operation: async (output) => {
        await output.sync();
        await output.chmod(0o400);
        await output.sync();
        const state = await output.stat();
        exactFile(state, maximumBytes, 'artifact output');
        if (state.size !== BigInt(written.bytes)) throw new Error('artifact output size changed');
      },
    });
    // The seal comes AFTER the publication, not before: rename(2) rewrites the
    // moved directory's own `..` entry, so a cross-parent publication needs
    // write permission ON the directory being moved. A 0o500 seal here makes
    // the publication EACCES — and leaves a staging directory whose own owner
    // can no longer unlink the bytes inside it to clean up.
    const published = await publishOwnedDirectory(staging, objects, written.sha256);
    if (published) await staging.seal({ mode: 0o500 });
    await syncDirectoryCustody(objects);
    if (!published) {
      await staging.close();
      staging = null;
      const existing = await openExisting(
        objects,
        written.sha256,
        written.bytes,
        maximumBytes,
      );
      if (!existing) throw new Error('artifact CAS collision disappeared before verification');
      await objects.close();
      objects = null;
      return existing;
    }
    transferred = await transferOwnedFile(staging, resource);
    const verified = await verifyHeld(
      transferred.handle,
      written.sha256,
      written.bytes,
      maximumBytes,
      'published artifact',
    );
    await Promise.all([staging.close(), objects.close()]);
    staging = null;
    objects = null;
    return Object.freeze({
      handle: transferred.handle,
      sha256: verified.sha256,
      bytes: verified.bytes,
      state: verified.state,
      existed: false,
    });
  } catch (error) {
    // NEVER release the staged file here: release drops it from the owner's
    // custody, and cleanupTransient is the only thing that unlinks it. Releasing
    // first left `bytes` orphaned inside the staging directory, so close() hit
    // ENOTEMPTY — leaking a .stage-* directory into the data root on every
    // failed publication AND burying the real cause under a cleanup AggregateError.
    if (transferred?.handle) await transferred.handle.close().catch(() => {});
    return cleanupOwners(error, [staging, objects], 'artifact publication');
  }
};
