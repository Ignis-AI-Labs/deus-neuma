import fs from 'node:fs/promises';
import { samePinnedDirectoryAnchor } from './refinement-directory-custody-identity.js';

/** Child-directory borrows and mutation-safe parent identity refreshes. */
export const createDirectoryCustodyChildOperations = (internals) => {
  const refreshDirectoryCustody = async (owner, index = null) => {
    const state = internals.assertOwner(owner);
    const entry = index === null ? internals.currentEntry(state) : state.held[index];
    if (!entry || entry.closed) throw new Error(`${state.label} directory is unavailable`);
    const observed = await entry.handle.stat({ bigint: true });
    if (!observed.isDirectory() || !samePinnedDirectoryAnchor(entry.identity, observed)) {
      throw new Error(`${entry.label} pinned directory anchor changed`);
    }
    entry.identity = observed;
    return observed;
  };

  const openPinnedDirectoryChild = async (parentOwner, request = {}) => {
    const parentState = internals.assertOwner(parentOwner);
    const allowed = ['name', 'label', 'mode', 'create', 'createMode'];
    const keys = Reflect.ownKeys(request || {});
    if (!request || typeof request !== 'object' || Array.isArray(request)
      || keys.some((field) => typeof field !== 'string' || !allowed.includes(field))) {
      throw new Error(`${parentState.label} child request is invalid`);
    }
    const label = request.label || `${parentState.label} child`;
    const mode = request.mode ?? 0o700;
    const createMode = request.createMode ?? mode;
    if (![0o500, 0o700, 0o755].includes(mode)
      || ![0o500, 0o700, 0o755].includes(createMode)
      || (request.create !== undefined && typeof request.create !== 'boolean')) {
      throw new Error(`${label} policy is invalid`);
    }
    const parentIndex = parentState.current;
    const parent = internals.currentEntry(parentState);
    const target = internals.directPath(parent.handle, request.name, label);
    let created = false;
    let child = null;
    try {
      await internals.verifyOwner(parentState);
      if (request.create === true) {
        try {
          await fs.mkdir(target, { mode: createMode });
          created = true;
          await refreshDirectoryCustody(parentOwner, parentIndex);
          await parent.handle.sync();
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error;
        }
      }
      const borrow = { parentState, parentIndex, active: false };
      child = internals.makeOwner(label, borrow);
      await internals.appendDirectory(child, target, label, { leafMode: mode, ownerOnly: true });
      parentState.borrows.set(child, borrow);
      borrow.active = true;
      await Promise.all([internals.verifyOwner(parentState), internals.verifyOwner(
        internals.assertOwner(child),
      )]);
      return child;
    } catch (error) {
      let primary = error;
      try {
        await child?.close();
      } catch (cleanup) {
        primary = internals.aggregate(primary, cleanup, `${label} open and child release failed`);
      }
      if (created) {
        try {
          await fs.rmdir(target);
          await refreshDirectoryCustody(parentOwner, parentIndex);
          await parent.handle.sync();
        } catch (cleanup) {
          primary = internals.aggregate(primary, cleanup, `${label} open and rollback failed`);
        }
      }
      throw primary;
    }
  };

  const syncDirectoryCustody = async (owner) => {
    const state = internals.assertOwner(owner);
    const current = internals.currentEntry(state);
    await internals.verifyOwner(state);
    await current.handle.sync();
    await internals.verifyOwner(state);
    return true;
  };
  const withPinnedDirectoryView = async (owner, consumer) => {
    const state = internals.assertOwner(owner);
    if (typeof consumer !== 'function') {
      throw new Error(`${state.label} directory view consumer is invalid`);
    }
    await internals.verifyOwner(state);
    const entry = internals.currentEntry(state);
    let active = true;
    const refresh = async () => {
      if (!active) throw new Error(`${entry.label} directory view expired`);
      const observed = await entry.handle.stat({ bigint: true });
      const mode = observed.mode & 0o777n;
      if (!observed.isDirectory() || observed.dev !== entry.identity.dev
        || observed.ino !== entry.identity.ino || observed.uid !== entry.identity.uid
        || observed.gid !== entry.identity.gid || ![0o500n, 0o700n].includes(mode)) {
        throw new Error(`${entry.label} borrowed directory identity changed`);
      }
      entry.identity = observed;
      return observed;
    };
    const view = Object.freeze({
      fd: entry.handle.fd,
      stat: refresh,
      sync: async () => {
        await refresh();
        await entry.handle.sync();
        return refresh();
      },
      chmod: async (mode) => {
        if (![0o500, 0o700].includes(mode)) {
          throw new Error(`${entry.label} borrowed directory mode is invalid`);
        }
        await refresh();
        await entry.handle.chmod(mode);
        return refresh();
      },
    });
    try {
      return await consumer(view);
    } finally {
      active = false;
    }
  };

  return Object.freeze({
    openPinnedDirectoryChild,
    refreshDirectoryCustody,
    syncDirectoryCustody,
    withPinnedDirectoryView,
  });
};
