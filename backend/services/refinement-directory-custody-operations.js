import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createDirectoryCustodyChildOperations } from './refinement-directory-custody-children.js';
import {
  renamedIdentity,
  samePinnedDirectoryState,
} from './refinement-directory-custody-identity.js';

const MAX_DIRECT_ENTRIES = 100_000;
const MAX_DIRECT_NAME_BYTES = 16 * 1024 * 1024;
const CHILD_WORK_DIRECTORIES = new WeakMap();
const NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
const DIRECTORY = constants.O_RDONLY | NOFOLLOW
  | (typeof constants.O_DIRECTORY === 'number' ? constants.O_DIRECTORY : 0);
const checkControl = ({ deadline = Number.POSITIVE_INFINITY, signal = null } = {}) => {
  if (signal !== null && (!(signal instanceof AbortSignal) || signal.aborted)) {
    throw Object.assign(new Error('directory operation was interrupted'), { code: 'ABORT_ERR' });
  }
  if (typeof deadline !== 'number' || Number.isNaN(deadline) || performance.now() >= deadline) {
    throw Object.assign(new Error('directory operation exceeded its deadline'), { code: 'DIRECTORY_DEADLINE' });
  }
};
const positiveBound = (value, label, maximum) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be a positive bounded integer`);
  }
  return value;
};
const aggregate = (primary, cleanup, label) => new AggregateError(
  [primary, cleanup], `${label} and cleanup failed`,
);
const closeResource = async (internals, owner, entry, primary = null) => {
  let cleanup = null;
  try {
    if (!entry.closed) await entry.handle.close();
    entry.closed = true;
    internals.forgetResource(owner, entry);
  } catch (error) { cleanup = error; }
  if (primary && cleanup) throw aggregate(primary, cleanup, entry.label);
  if (primary) throw primary;
  if (cleanup) throw cleanup;
};
const readEntry = async (entry, maximumBytes, control) => {
  checkControl(control);
  const before = await entry.handle.stat({ bigint: true });
  if (!before.isFile() || before.size < 0n || before.size > BigInt(maximumBytes)) {
    throw new Error(`${entry.label} is not a bounded regular file`);
  }
  const bytes = Buffer.alloc(Number(before.size));
  let offset = 0;
  while (offset < bytes.length) {
    checkControl(control);
    const result = await entry.handle.read(bytes, offset, bytes.length - offset, offset);
    if (result.bytesRead === 0) throw new Error(`${entry.label} ended before its declared size`);
    offset += result.bytesRead;
  }
  const trailing = Buffer.allocUnsafe(1);
  if ((await entry.handle.read(trailing, 0, 1, bytes.length)).bytesRead !== 0) {
    throw new Error(`${entry.label} grew during its bounded read`);
  }
  const after = await entry.handle.stat({ bigint: true });
  if (!samePinnedDirectoryState(before, after)) throw new Error(`${entry.label} changed during its bounded read`);
  return Object.freeze({ bytes, fileState: after });
};

const assertExecution = async (authority, operation) => {
  const { assertRefinementExecutionAuthority } = await import('./refinement-execution-authority.js');
  await assertRefinementExecutionAuthority(authority, operation);
};
/** Add bounded direct-child operations without exposing a descriptor or filesystem path. */
export const createDirectoryCustodyOperations = (internals) => {
  const childOperations = createDirectoryCustodyChildOperations(internals);
  const list = async (owner, request = {}) => {
    const state = internals.assertOwner(owner);
    await internals.verifyOwner(state);
    const maximumEntries = positiveBound(
      request.maximumEntries, 'directory entry ceiling', MAX_DIRECT_ENTRIES,
    );
    const maximumNameBytes = positiveBound(
      request.maximumNameBytes, 'directory name byte ceiling', MAX_DIRECT_NAME_BYTES,
    );
    checkControl(request);
    const current = internals.currentEntry(state);
    let stream;
    let primary;
    try {
      stream = await fs.opendir(internals.currentPath(current.handle, `${state.label} listing`));
      const entries = [];
      let nameBytes = 0;
      while (true) {
        const entry = await stream.read();
        if (entry === null) break;
        checkControl(request);
        nameBytes += Buffer.byteLength(entry.name, 'utf8');
        if (entries.length >= maximumEntries || nameBytes > maximumNameBytes) {
          throw new Error(`${state.label} exceeds its bounded directory envelope`);
        }
        internals.directName(entry.name, `${state.label} entry`);
        const kind = entry.isFile() ? 'file' : entry.isDirectory() ? 'directory'
          : entry.isSymbolicLink() ? 'symbolic-link' : 'other';
        entries.push(Object.freeze({ name: entry.name, kind }));
      }
      await stream.close();
      stream = null;
      await internals.verifyOwner(state);
      return Object.freeze({ entries: Object.freeze(entries), nameBytes });
    } catch (error) { primary = error; }
    let cleanup = null;
    try { await stream?.close(); } catch (error) { cleanup = error; }
    if (primary && cleanup) throw aggregate(primary, cleanup, `${state.label} listing`);
    throw primary || cleanup;
  };

  const read = async (owner, request = {}) => {
    const maximumBytes = positiveBound(request.maximumBytes, 'file byte ceiling', 1024 ** 3);
    let entry;
    let transient = false;
    try {
      if (request.resource) entry = internals.resourceEntry(owner, request.resource);
      else {
        const opened = await internals.openOwned(owner, {
          kind: 'file', name: request.name, label: request.label,
        });
        entry = internals.resourceEntry(owner, opened.resource);
        transient = true;
      }
      const result = await readEntry(entry, maximumBytes, request);
      if (transient) await closeResource(internals, owner, entry);
      return Object.freeze({ state: 'present', ...result });
    } catch (error) {
      if (!entry && request.absent === true && error?.code === 'ENOENT') {
        return Object.freeze({ state: 'absent', bytes: null, fileState: null });
      }
      if (transient && entry) return closeResource(internals, owner, entry, error);
      throw error;
    }
  };

  const write = async (owner, { resource, bytes, maximumBytes = 1024 ** 3 } = {}) => {
    const entry = internals.resourceEntry(owner, resource);
    const ceiling = positiveBound(maximumBytes, 'file byte ceiling', 1024 ** 3);
    if (!Buffer.isBuffer(bytes) || bytes.length > ceiling) {
      throw new Error(`${entry.label} write is not bounded bytes`);
    }
    await entry.handle.truncate(0);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await entry.handle.write(bytes, offset, bytes.length - offset, offset);
      if (result.bytesWritten === 0) throw new Error(`${entry.label} write made no progress`);
      offset += result.bytesWritten;
    }
    await entry.handle.sync();
    entry.identity = await entry.handle.stat({ bigint: true });
    return Object.freeze({ bytes: Number(entry.identity.size), state: entry.identity });
  };
  const release = async (owner, resource) => {
    const entry = internals.resourceEntry(owner, resource);
    await closeResource(internals, owner, entry);
    return true;
  };
  const assertChildWorkDirectoryProjection = async (
    projection, executionAuthority, operation,
  ) => {
    const record = CHILD_WORK_DIRECTORIES.get(projection);
    if (!record || !record.active || record.executionAuthority !== executionAuthority
      || record.operation !== operation || record.state.phase !== 'transferred') {
      throw new Error('refinement child work directory projection is unavailable');
    }
    await assertExecution(executionAuthority, operation);
    const observed = await record.entry.handle.stat({ bigint: true });
    if (!samePinnedDirectoryState(record.entry.identity, observed)) {
      throw new Error('refinement child work directory changed');
    }
    record.verifications += 1;
    return projection;
  };
  const verifyChildWorkDirectoryProjection = (
    projection, executionAuthority, operation,
  ) => assertChildWorkDirectoryProjection(projection, executionAuthority, operation);
  const withChildWorkDirectory = async (
    owner, executionAuthority, operation, run,
  ) => {
    if (typeof run !== 'function') throw new Error('child work directory consumer is required');
    const state = internals.assertOwner(owner);
    if (state.transient || state.files.size) {
      throw new Error(`${state.label} cannot become a child work directory with owned resources`);
    }
    await assertExecution(executionAuthority, operation);
    await internals.verifyOwner(state);
    const entry = internals.currentEntry(state);
    const projection = Object.freeze({
      kind: 'refinement-child-work-directory',
      fd: entry.handle.fd,
      bindToken: randomBytes(32).toString('base64url'),
    });
    const record = {
      owner, state, entry, executionAuthority, operation, active: true, verifications: 0,
    };
    CHILD_WORK_DIRECTORIES.set(projection, record);
    state.phase = 'transferred';
    let result;
    let primary = null;
    try {
      await assertChildWorkDirectoryProjection(projection, executionAuthority, operation);
      result = await run(projection);
      await assertChildWorkDirectoryProjection(projection, executionAuthority, operation);
    } catch (error) { primary = error; }
    record.active = false;
    let cleanup = null;
    try { await internals.closeOwner(owner, state); } catch (error) { cleanup = error; }
    if (cleanup) {
      const failure = new AggregateError(
        primary ? [primary, cleanup] : [cleanup],
        'refinement child work directory cleanup is incomplete',
      );
      Object.defineProperty(failure, 'recovery', {
        enumerable: false,
        value: Object.freeze({ close: () => internals.closeOwner(owner, state) }),
      });
      throw failure;
    }
    if (primary) throw primary;
    return result;
  };

  const seal = async (owner, { mode } = {}) => {
    if (![0o500, 0o700].includes(mode)) throw new Error('directory seal mode is invalid');
    const state = internals.assertOwner(owner);
    const entry = internals.currentEntry(state);
    const before = await entry.handle.stat({ bigint: true });
    await entry.handle.chmod(mode);
    await entry.handle.sync();
    const after = await entry.handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino
      || (after.mode & 0o777n) !== BigInt(mode)) {
      throw new Error(`${entry.label} changed while being sealed`);
    }
    entry.identity = after;
    return true;
  };



  const verify = async (owner, { name, resource } = {}) => {
    const state = internals.assertOwner(owner);
    const parent = internals.currentEntry(state);
    const expected = internals.resourceEntry(owner, resource);
    if (expected.parentIndex !== state.current || expected.removed) {
      throw new Error(`${expected.label} path custody is unavailable`);
    }
    const target = internals.directPath(parent.handle, name, `${state.label} verified child`);
    const [pathState, heldState, parentState] = await Promise.all([
      fs.lstat(target, { bigint: true }),
      expected.handle.stat({ bigint: true }),
      parent.handle.stat({ bigint: true }),
    ]);
    if (!samePinnedDirectoryState(pathState, heldState) || !samePinnedDirectoryState(expected.identity, heldState)
      || !samePinnedDirectoryState(parent.identity, parentState)) {
      throw new Error(`${expected.label} path custody changed`);
    }
    return true;
  };

  const claim = async (owner, { name, mode = 0o700, label } = {}) => {
    if (![0o500, 0o700].includes(mode)) throw new Error('directory claim mode is invalid');
    const state = internals.assertOwner(owner);
    const parentIndex = state.current;
    const parent = internals.currentEntry(state);
    const target = internals.directPath(parent.handle, name, label || `${state.label} claim`);
    await fs.mkdir(target, { mode });
    await childOperations.refreshDirectoryCustody(owner, parentIndex);
    await parent.handle.sync();
    try {
      await internals.descendDirectory(owner, { name, mode, label }, false);
    } catch (error) {
      let cleanup = null;
      try {
        await fs.rmdir(target);
        await childOperations.refreshDirectoryCustody(owner, parentIndex);
        await parent.handle.sync();
      } catch (cleanupError) { cleanup = cleanupError; }
      if (cleanup) throw new AggregateError([error, cleanup], 'directory claim and rollback failed', { cause: error });
      throw error;
    }
    return true;
  };

  const leave = async (owner) => {
    const state = internals.assertOwner(owner);
    if (state.current < 1) throw new Error(`${state.label} cannot leave its pinned root`);
    const entry = internals.currentEntry(state);
    if ([...state.files.values()].some((file) => file.parentIndex === state.current && !file.closed)) {
      throw new Error(`${entry.label} still owns open files`);
    }
    if ([...state.borrows.values()].some((borrow) => borrow.parentIndex === state.current)) {
      throw new Error(`${entry.label} still owns borrowed directories`);
    }
    await entry.handle.close();
    entry.closed = true;
    // `held` is a stack, and `held.length === current + 1` is load-bearing:
    // appendDirectory pushes and sets current to the new top. Decrementing
    // without dropping the closed entry left the next leave pointing at it,
    // so the third enter on one owner failed. The entry is provably
    // unreferenced here — the guards above refuse while any file or borrow
    // still names state.current.
    state.held.length = state.current;
    state.current -= 1;
    return true;
  };
  const publishDirectory = async (owner, { sourceName, targetName } = {}) => {
    const state = internals.assertOwner(owner);
    const parent = internals.currentEntry(state);
    const source = internals.directPath(parent.handle, sourceName, `${state.label} staged directory`);
    const target = internals.directPath(parent.handle, targetName, `${state.label} published directory`);
    const staged = await fs.open(source, DIRECTORY);
    let published;
    let primary = null;
    try {
      const sealed = await staged.stat({ bigint: true });
      if (!sealed.isDirectory() || sealed.uid !== BigInt(process.geteuid?.() ?? sealed.uid)
        || (sealed.mode & 0o777n) !== 0o500n) {
        throw new Error(`${state.label} staged directory is not sealed`);
      }
      await fs.rename(source, target);
      published = await renamedIdentity(staged, target);
      if (!published) throw new Error(`${state.label} published directory changed identity`);
    } catch (error) { primary = error; }
    try { await staged.close(); } catch (error) {
      primary = primary ? aggregate(primary, error, `${state.label} staged directory`) : error;
    }
    if (['EEXIST', 'ENOTEMPTY'].includes(primary?.code)) return false;
    if (primary) throw primary;
    await childOperations.refreshDirectoryCustody(owner, state.current);
    await parent.handle.sync();
    return true;
  };
  const rename = async (owner, {
    sourceName, targetName, expectedSourceResource, absentTarget = false,
  } = {}) => {
    const state = internals.assertOwner(owner);
    const parent = internals.currentEntry(state);
    const expected = internals.resourceEntry(owner, expectedSourceResource);
    if (expected.parentIndex !== state.current || expected.removed) {
      throw new Error(`${expected.label} rename source is unavailable`);
    }
    const source = internals.directPath(parent.handle, sourceName, `${state.label} rename source`);
    const target = internals.directPath(parent.handle, targetName, `${state.label} rename target`);
    const [sourceState, heldState, parentBefore] = await Promise.all([
      fs.lstat(source, { bigint: true }),
      expected.handle.stat({ bigint: true }),
      parent.handle.stat({ bigint: true }),
    ]);
    if (!samePinnedDirectoryState(sourceState, heldState) || !samePinnedDirectoryState(expected.identity, heldState)
      || !samePinnedDirectoryState(parent.identity, parentBefore)) {
      throw new Error(`${expected.label} rename CAS is stale`);
    }
    if (absentTarget) {
      try {
        await fs.lstat(target, { bigint: true });
        throw Object.assign(new Error(`${state.label} rename target exists`), { code: 'EEXIST' });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    await fs.rename(source, target);
    const [published, parentAfter] = await Promise.all([
      renamedIdentity(expected.handle, target),
      parent.handle.stat({ bigint: true }),
    ]);
    if (!published
      || parentBefore.dev !== parentAfter.dev || parentBefore.ino !== parentAfter.ino) {
      throw new Error(`${expected.label} rename changed custody`);
    }
    expected.name = internals.directName(targetName, `${state.label} rename target`);
    expected.identity = published;
    parent.identity = parentAfter;
    await parent.handle.sync();
    return true;
  };

  const publishOwnedDirectory = async (source, destination, name) => {
    const sourceState = internals.assertOwner(source);
    const destinationState = internals.assertOwner(destination);
    const transient = sourceState.transient;
    if (!transient || transient.published) throw new Error('source directory is not publishable');
    await Promise.all([internals.verifyOwner(sourceState), internals.verifyOwner(destinationState)]);
    const sourceParent = sourceState.held[transient.parentIndex];
    const destinationParent = internals.currentEntry(destinationState);
    const moved = sourceState.held[transient.directoryIndex];
    const publishedPath = internals.directPath(
      destinationParent.handle, name, 'published directory',
    );
    try {
      await fs.rename(
        internals.directPath(sourceParent.handle, transient.name, 'source transaction'),
        publishedPath,
      );
    } catch (error) {
      if (['EEXIST', 'ENOTEMPTY'].includes(error?.code)) return false;
      throw error;
    }
    transient.published = true;
    // The MOVED directory is itself a held chain entry, and rename(2) bumps the
    // moved inode's ctime — so its pre-rename identity is never comparable to a
    // post-rename one. Re-observe the descriptor we still hold and confirm it IS
    // the published path, exactly as publishDirectory and replaceOwnedFile do;
    // refreshing only the two parents left this entry permanently stale, and the
    // verifyOwner below walks the whole chain.
    const publishedIdentity = await renamedIdentity(moved.handle, publishedPath);
    if (!publishedIdentity) throw new Error(`${moved.label} publication changed identity`);
    moved.identity = publishedIdentity;
    await Promise.all([
      childOperations.refreshDirectoryCustody(source, transient.parentIndex),
      childOperations.refreshDirectoryCustody(destination, destinationState.current),
    ]);
    await Promise.all([sourceParent.handle.sync(), destinationParent.handle.sync()]);
    await Promise.all([internals.verifyOwner(sourceState), internals.verifyOwner(destinationState)]);
    return true;
  };

  const unlink = async (owner, { name, expectedResource = null, directory = false } = {}) => {
    const state = internals.assertOwner(owner);
    const parent = internals.currentEntry(state);
    const target = internals.directPath(parent.handle, name, `${state.label} removal`);
    if (expectedResource) {
      const expected = internals.resourceEntry(owner, expectedResource);
      const pathState = await fs.lstat(target, { bigint: true });
      const heldState = await expected.handle.stat({ bigint: true });
      if (!samePinnedDirectoryState(pathState, heldState)) throw new Error(`${expected.label} removal CAS is stale`);
    }
    if (directory) await fs.rmdir(target); else await fs.unlink(target);
    if (expectedResource) internals.resourceEntry(owner, expectedResource).removed = true;
    await childOperations.refreshDirectoryCustody(owner, state.current);
    await parent.handle.sync();
    return true;
  };
  const transferOwnedFile = async (owner, resource) => {
    const state = internals.assertOwner(owner);
    const entry = internals.resourceEntry(owner, resource);
    const current = await entry.handle.stat({ bigint: true });
    if (!samePinnedDirectoryState(entry.identity, current)) {
      throw new Error(`${entry.label} changed before ownership transfer`);
    }
    state.files.delete(resource);
    internals.forgetResource(owner, entry);
    return Object.freeze({ handle: entry.handle, state: current });
  };

  return Object.freeze({
    list, read, write, release, verify, seal, claim, leave, unlink, rename, publishDirectory,
    publishOwnedDirectory, transferOwnedFile, withChildWorkDirectory,
    assertChildWorkDirectoryProjection, verifyChildWorkDirectoryProjection, ...childOperations,
  });
};

/** Replace one direct child by held-inode CAS and sync its pinned parent. */
export const replaceOwnedFile = async ({
  owner, sourceResource, targetName, expectedTargetResource = null, internals,
}) => {
  const state = internals.assertOwner(owner);
  const source = internals.resourceEntry(owner, sourceResource);
  const parent = internals.currentEntry(state);
  if (source.parentIndex !== state.current || source.removed) {
    throw new Error(`${source.label} is not held in the current directory`);
  }
  const sourcePath = internals.directPath(parent.handle, source.name, source.label);
  const targetPath = internals.directPath(parent.handle, targetName, `${state.label} target`);
  const sourceState = await source.handle.stat({ bigint: true });
  if (!samePinnedDirectoryState(source.identity, sourceState)) throw new Error(`${source.label} changed before publication`);
  if (expectedTargetResource === null) {
    await fs.link(sourcePath, targetPath);
    await fs.unlink(sourcePath);
  } else {
    const target = internals.resourceEntry(owner, expectedTargetResource);
    if (target.parentIndex !== state.current || target.removed) {
      throw new Error(`${target.label} is not the current replacement target`);
    }
    const [pathState, heldState] = await Promise.all([
      fs.lstat(targetPath, { bigint: true }), target.handle.stat({ bigint: true }),
    ]);
    if (!samePinnedDirectoryState(pathState, heldState) || !samePinnedDirectoryState(target.identity, heldState)) {
      throw new Error(`${target.label} replacement CAS is stale`);
    }
    await fs.rename(sourcePath, targetPath);
    target.removed = true;
  }
  source.name = internals.directName(targetName, `${state.label} target`);
  source.identity = await source.handle.stat({ bigint: true });
  const published = await fs.lstat(targetPath, { bigint: true });
  if (!samePinnedDirectoryState(source.identity, published)) throw new Error(`${source.label} publication changed identity`);
  await internals.refreshDirectoryCustody(owner, state.current);
  await parent.handle.sync();
  return Object.freeze({ resource: sourceResource, state: source.identity });
};
