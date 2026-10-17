import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  samePinnedDirectoryAnchor,
  samePinnedDirectoryState,
  verifyPinnedChain,
} from './refinement-directory-custody-identity.js';
import {
  createDirectoryCustodyOperations,
  replaceOwnedFile as replaceOwnedFileOperation,
} from './refinement-directory-custody-operations.js';

const NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
const DIRECTORY = constants.O_RDONLY | NOFOLLOW
  | (typeof constants.O_DIRECTORY === 'number' ? constants.O_DIRECTORY : 0);
const READ = constants.O_RDONLY | NOFOLLOW;
const CREATE_FILE = constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | NOFOLLOW;
const DIRECT_NAME_BYTES_MAX = 255;
const owners = new WeakMap();
const resources = new WeakMap();
let extendedOperations;
const uid = () => BigInt(typeof process.geteuid === 'function' ? process.geteuid() : 0);

export { samePinnedDirectoryState };

const directName = (value, label) => {
  if (typeof value !== 'string' || !value || value === '.' || value === '..'
    || value !== value.normalize('NFC') || value.includes('/') || value.includes('\\')
    || /[\u0000-\u001f\u007f]/u.test(value)
    || Buffer.byteLength(value) > DIRECT_NAME_BYTES_MAX) {
    throw new Error(`${label} is not a safe direct name`);
  }
  return value;
};
const directPath = (handle, name, label) => {
  if (process.platform !== 'linux' || !handle
    || !Number.isSafeInteger(handle.fd) || handle.fd < 0) {
    throw new Error(`${label} directory authority is unavailable`);
  }
  return `/proc/self/fd/${handle.fd}/${directName(name, label)}`;
};
const assertDirectory = (state, label, {
  stickyAncestor = false,
  leafMode = null,
  ownerOnly = false,
} = {}) => {
  const owner = uid();
  const acceptableOwner = state.uid === owner || (!ownerOnly && state.uid === 0n);
  const writable = (state.mode & 0o022n) !== 0n;
  const sticky = stickyAncestor && state.uid === 0n && (state.mode & 0o1000n) !== 0n;
  if (!state.isDirectory() || !acceptableOwner || (writable && !sticky)
    || (leafMode !== null && (state.mode & 0o777n) !== BigInt(leafMode))) {
    throw new Error(`${label} is not an owner-protected directory`);
  }
};
const assertOwner = (owner) => {
  const state = owners.get(owner);
  if (!state) throw new Error('directory custody owner is invalid');
  if (state.phase === 'closed') throw new Error(`${state.label} is closed`);
  if (state.phase === 'transferred') throw new Error(`${state.label} ownership was transferred`);
  return state;
};
const currentEntry = (state) => {
  const entry = state.held[state.current];
  if (!entry || entry.closed) throw new Error(`${state.label} current directory is unavailable`);
  return entry;
};
const aggregate = (primary, cleanup, message, recovery = null) => {
  const error = new AggregateError([primary, cleanup], message);
  if (recovery) Object.defineProperty(error, 'recovery', { value: recovery, enumerable: false });
  return error;
};
const fileView = (entry) => Object.freeze({
  fd: entry.handle.fd,
  write: (buffer, offset, length, position) => entry.handle.write(buffer, offset, length, position),
  read: (buffer, offset, length, position) => entry.handle.read(buffer, offset, length, position),
  truncate: (length) => entry.handle.truncate(length),
  sync: () => entry.handle.sync(),
  chmod: (mode) => entry.handle.chmod(mode),
  stat: () => entry.handle.stat({ bigint: true }),
});
const closeEntries = async (entries, label) => {
  const pending = entries.filter((entry) => !entry.closed).reverse();
  const settled = await Promise.allSettled(pending.map((entry) => entry.handle.close()));
  const failures = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') pending[index].closed = true;
    else failures.push(result.reason);
  });
  if (failures.length) throw new AggregateError(failures, `${label} release failed`);
};
const cleanupTransient = async (state) => {
  const transient = state.transient;
  if (!transient || transient.published) return;
  const directory = state.held[transient.directoryIndex];
  for (const entry of state.files.values()) {
    if (entry.parentIndex !== transient.directoryIndex) continue;
    if (!entry.closed) {
      await entry.handle.close();
      entry.closed = true;
    }
    if (!entry.removed) {
      await fs.unlink(directPath(directory.handle, entry.name, entry.label));
      entry.removed = true;
    }
  }
  if (!transient.directoryClosed) {
    await directory.handle.close();
    directory.closed = true;
    transient.directoryClosed = true;
  }
  const parent = state.held[transient.parentIndex];
  if (!transient.directoryRemoved) {
    await fs.rmdir(directPath(parent.handle, transient.name, `${state.label} transaction`));
    transient.directoryRemoved = true;
  }
  if (!transient.parentSynced) {
    await parent.handle.sync();
    transient.parentSynced = true;
  }
};
const releaseParentBorrow = (owner, state) => {
  const borrow = state.parentBorrow;
  if (!borrow?.active) return;
  if (borrow.parentState.borrows.get(owner) !== borrow) {
    throw new Error(`${state.label} parent borrow identity changed`);
  }
  borrow.parentState.borrows.delete(owner);
  borrow.active = false;
};
const closeOwner = async (owner, state) => {
  if (state.phase === 'closed') return false;
  if (state.closePromise) return state.closePromise;
  if (state.borrows.size) {
    throw new Error(`${state.label} still owns borrowed directories`);
  }
  state.phase = 'closing';
  state.closePromise = (async () => {
    try {
      await cleanupTransient(state);
      await closeEntries([...state.files.values()], `${state.label} file custody`);
      await closeEntries(state.held, state.label);
      state.phase = 'closed';
      releaseParentBorrow(owner, state);
      return true;
    } catch (error) {
      state.phase = 'cleanup-failed';
      throw error;
    }
  })();
  try {
    return await state.closePromise;
  } finally {
    state.closePromise = null;
  }
};
const closeOwnerPublic = (owner, state) => {
  if (state.phase === 'transferred') {
    throw new Error(`${state.label} cleanup belongs to the child process authority`);
  }
  return closeOwner(owner, state);
};
const makeOwner = (label, parentBorrow = null) => {
  const state = {
    label,
    held: [],
    current: -1,
    files: new Map(),
    borrows: new Map(),
    parentBorrow,
    transient: null,
    phase: 'open',
    closePromise: null,
  };
  const owner = Object.freeze({
    create: (request) => createOwned(owner, request),
    open: (request) => openOwned(owner, request),
    enter: (request = {}) => descendDirectory(owner, request, request.create === true),
    claim: (request) => extendedOperations.claim(owner, request),
    leave: () => extendedOperations.leave(owner),
    list: (request) => extendedOperations.list(owner, request),
    read: (request) => extendedOperations.read(owner, request),
    write: (request) => extendedOperations.write(owner, request),
    release: (resource) => extendedOperations.release(owner, resource),
    remove: (resource) => removeOwned(owner, resource),
    verify: (request) => extendedOperations.verify(owner, request),
    unlink: (request) => extendedOperations.unlink(owner, request),
    rename: (request) => extendedOperations.rename(owner, request),
    replace: (request) => replaceOwnedFileOperation({ ...request, owner, internals }),
    publishDirectory: (request) => extendedOperations.publishDirectory(owner, request),
    seal: (request) => extendedOperations.seal(owner, request),
    sync: (resource = null) => syncOwned(owner, resource),
    close: () => closeOwnerPublic(owner, state),
  });
  owners.set(owner, state);
  return owner;
};
const appendDirectory = async (owner, target, label, options) => {
  const state = assertOwner(owner);
  const before = await fs.lstat(target, { bigint: true });
  assertDirectory(before, label, options);
  const handle = await fs.open(target, DIRECTORY);
  const entry = { handle, identity: null, label, closed: false };
  state.held.push(entry);
  state.current = state.held.length - 1;
  const opened = await handle.stat({ bigint: true });
  entry.identity = opened;
  // A TOCTOU guard: prove the directory we OPENED is the one we lstat'd and
  // validated, so a swap or relink between the two syscalls is refused —
  // dev/ino/mode/uid/gid is exactly that proof. Comparing nlink/mtime/ctime too
  // let any unrelated write inside a SHARED ancestor refuse the pin.
  if (!samePinnedDirectoryAnchor(before, opened)) {
    throw new Error(`${label} changed while being pinned`);
  }
  return entry;
};
const descendDirectory = async (owner, request, create) => {
  const state = assertOwner(owner);
  const parentIndex = state.current;
  const parent = currentEntry(state);
  const name = directName(request?.name, request?.label || state.label);
  const mode = request?.mode ?? null;
  const createMode = request?.createMode ?? mode ?? 0o700;
  if ((mode !== null && ![0o500, 0o700, 0o755].includes(mode))
    || ![0o500, 0o700, 0o755].includes(createMode)) {
    throw new Error(`${state.label} mode is invalid`);
  }
  const target = directPath(parent.handle, name, request?.label || state.label);
  if (create) {
    try {
      await fs.mkdir(target, { mode: createMode });
      await extendedOperations.refreshDirectoryCustody(owner, parentIndex);
      await parent.handle.sync();
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  await appendDirectory(owner, target, request?.label || state.label, {
    leafMode: mode,
    ownerOnly: true,
  });
  return true;
};
const operateFile = async (state, entry, operation) => {
  if (typeof operation !== 'function') return entry.token;
  return operation(fileView(entry));
};
async function createOwned(owner, request = {}) {
  const state = assertOwner(owner);
  if (request.kind === 'directory') return descendDirectory(owner, request, true);
  if (request.kind !== 'file') throw new Error(`${state.label} create kind is invalid`);
  const parent = currentEntry(state);
  const label = request.label || state.label;
  const name = directName(request.name, label);
  const mode = request.mode ?? 0o600;
  if (![0o400, 0o500, 0o600, 0o700].includes(mode)) throw new Error(`${label} mode is invalid`);
  const handle = await fs.open(directPath(parent.handle, name, label), CREATE_FILE, mode);
  await extendedOperations.refreshDirectoryCustody(owner, state.current);
  await parent.handle.sync();
  const token = Object.freeze({});
  const entry = {
    token, handle, name, label, parentIndex: state.current,
    identity: await handle.stat({ bigint: true }), closed: false, removed: false,
  };
  state.files.set(token, entry);
  resources.set(token, { owner, entry });
  const result = await operateFile(state, entry, request.operation);
  entry.identity = await handle.stat({ bigint: true });
  return Object.freeze({ resource: token, result });
}
async function openOwned(owner, request = {}) {
  const state = assertOwner(owner);
  if (request.kind === 'directory') return descendDirectory(owner, request, false);
  if (request.resource) {
    const record = resources.get(request.resource);
    if (!record || record.owner !== owner || record.entry.closed) {
      throw new Error(`${state.label} file resource is invalid`);
    }
    const result = await operateFile(state, record.entry, request.operation);
    // The operation drives a fileView, whose write/truncate/chmod all move the
    // inode's identity. createOwned re-observes after its own operation for the
    // same reason; skipping it here left every later CAS — transferOwnedFile,
    // verify — comparing against a pre-operation stat that can no longer match.
    record.entry.identity = await record.entry.handle.stat({ bigint: true });
    return result;
  }
  if (request.kind !== 'file') throw new Error(`${state.label} open kind is invalid`);
  const parent = currentEntry(state);
  const label = request.label || state.label;
  const name = directName(request.name, label);
  const target = directPath(parent.handle, name, label);
  const before = await fs.lstat(target, { bigint: true });
  const handle = await fs.open(target, READ);
  const token = Object.freeze({});
  const entry = {
    token, handle, name, label, parentIndex: state.current,
    identity: await handle.stat({ bigint: true }), closed: false, removed: false,
  };
  state.files.set(token, entry);
  resources.set(token, { owner, entry });
  if (!samePinnedDirectoryState(before, entry.identity)) {
    throw new Error(`${label} changed while being opened`);
  }
  return Object.freeze({ resource: token, result: await operateFile(state, entry, request.operation) });
}
async function syncOwned(owner, resource) {
  const state = assertOwner(owner);
  if (resource === null) {
    await currentEntry(state).handle.sync();
    return true;
  }
  const record = resources.get(resource);
  if (!record || record.owner !== owner || record.entry.closed) {
    throw new Error(`${state.label} file resource is invalid`);
  }
  await record.entry.handle.sync();
  return true;
}
async function removeOwned(owner, resource) {
  const state = assertOwner(owner);
  const record = resources.get(resource);
  if (!record || record.owner !== owner) throw new Error(`${state.label} file resource is invalid`);
  const entry = record.entry;
  if (!entry.removed) {
    const parent = state.held[entry.parentIndex];
    await fs.unlink(directPath(parent.handle, entry.name, entry.label));
    entry.removed = true;
    entry.identity = await entry.handle.stat({ bigint: true });
    await extendedOperations.refreshDirectoryCustody(owner, entry.parentIndex);
    await parent.handle.sync();
  }
  return true;
}
const resourceEntry = (owner, resource) => {
  const state = assertOwner(owner);
  const record = resources.get(resource);
  if (!record || record.owner !== owner || record.entry.closed) {
    throw new Error(`${state.label} file resource is invalid`);
  }
  return record.entry;
};
const forgetResource = (owner, entry) => {
  const state = assertOwner(owner);
  state.files.delete(entry.token);
  resources.delete(entry.token);
};
const currentPath = (handle, label) => {
  if (process.platform !== 'linux' || !Number.isSafeInteger(handle?.fd) || handle.fd < 0) {
    throw new Error(`${label} directory authority is unavailable`);
  }
  return `/proc/self/fd/${handle.fd}`;
};
const internals = Object.freeze({
  assertOwner,
  verifyOwner: verifyPinnedChain,
  currentEntry,
  directName,
  appendDirectory,
  makeOwner,
  aggregate,
  descendDirectory,
  closeOwner,
  directPath,
  currentPath,
  openOwned,
  resourceEntry,
  forgetResource,
  refreshDirectoryCustody: (owner, index) =>
    extendedOperations.refreshDirectoryCustody(owner, index),
});
extendedOperations = createDirectoryCustodyOperations(internals);
const recoverOrThrow = async (owner, error, message) => {
  try {
    await owner.close();
  } catch (cleanupError) {
    throw aggregate(error, cleanupError, message, owner);
  }
  throw error;
};

/** Pin one exact directory chain and return its sole opaque owner. Impure. */
export const pinDirectoryCustody = async (
  root,
  label = 'directory custody',
  { allowRootStickyAncestors = false, leafMode = null } = {},
) => {
  if (typeof allowRootStickyAncestors !== 'boolean'
    || (leafMode !== null && ![0o500, 0o700, 0o755].includes(leafMode))) {
    throw new Error(`${label} policy is invalid`);
  }
  const owner = makeOwner(label);
  const lexical = path.resolve(root);
  try {
    if (await fs.realpath(lexical) !== lexical) throw new Error(`${label} root is indirect`);
    const parsed = path.parse(lexical);
    const components = lexical.slice(parsed.root.length).split(path.sep).filter(Boolean);
    await appendDirectory(owner, parsed.root, `${label} ancestor`, {});
    for (const [index, component] of components.entries()) {
      const state = assertOwner(owner);
      const leaf = index === components.length - 1;
      await appendDirectory(
        owner,
        directPath(currentEntry(state).handle, component, `${label} component`),
        `${label} component`,
        {
          stickyAncestor: allowRootStickyAncestors && !leaf,
          leafMode: leaf ? leafMode : null,
        },
      );
    }
    const state = assertOwner(owner);
    const current = currentEntry(state);
    const [heldReal, pathReal, pathState, heldState] = await Promise.all([
      fs.realpath(`/proc/self/fd/${current.handle.fd}`),
      fs.realpath(lexical),
      fs.lstat(lexical, { bigint: true }),
      current.handle.stat({ bigint: true }),
    ]);
    if (heldReal !== lexical || pathReal !== lexical
      || !samePinnedDirectoryState(current.identity, pathState)
      || !samePinnedDirectoryState(current.identity, heldState)) {
      throw new Error(`${label} root changed while being pinned`);
    }
    return owner;
  } catch (error) {
    return recoverOrThrow(owner, error, `${label} acquisition and recovery failed`);
  }
};

/** Pin one direct child as an independently closable opaque custody owner. */
export const openPinnedDirectoryChild = (parentOwner, request = {}) =>
  extendedOperations.openPinnedDirectoryChild(parentOwner, request);

/** Sync and reverify one opaque custody owner's current pinned directory. */
export const syncDirectoryCustody = (owner) =>
  extendedOperations.syncDirectoryCustody(owner);
export const withPinnedDirectoryView = (owner, consumer) =>
  extendedOperations.withPinnedDirectoryView(owner, consumer);

/** Create one opaque transient child directory whose close removes and syncs it. Impure. */
export const createAnonymousStagingDirectory = async ({
  root,
  leafName = '.refinement-authority-staging',
  prefix = 'set-',
  label = 'immutable authority staging',
}) => {
  let owner;
  try {
    owner = await pinDirectoryCustody(root, `${label} parent`, {
      allowRootStickyAncestors: true,
    });
    await owner.create({ kind: 'directory', name: leafName, mode: 0o700, label: `${label} root` });
    const state = assertOwner(owner);
    const parentIndex = state.current;
    const parent = currentEntry(state);
    const generated = await fs.mkdtemp(`${directPath(parent.handle, prefix, `${label} prefix`)}-`);
    await extendedOperations.refreshDirectoryCustody(owner, parentIndex);
    await parent.handle.sync();
    const name = path.basename(generated);
    await appendDirectory(owner, directPath(parent.handle, name, `${label} transaction`),
      `${label} transaction`, { leafMode: 0o700, ownerOnly: true });
    state.transient = {
      name,
      parentIndex,
      directoryIndex: state.current,
      directoryClosed: false,
      directoryRemoved: false,
      parentSynced: false,
      published: false,
    };
    return owner;
  } catch (error) {
    if (!owner) throw error;
    return recoverOrThrow(owner, error, `${label} creation and recovery failed`);
  }
};

/** Atomically publish a transient current directory beneath another owner. Impure. */
export const publishOwnedDirectory = (source, destination, name) =>
  extendedOperations.publishOwnedDirectory(source, destination, name);

/** Explicitly transfer one held file out of its directory owner. */
export const transferOwnedFile = (owner, resource) =>
  extendedOperations.transferOwnedFile(owner, resource);
