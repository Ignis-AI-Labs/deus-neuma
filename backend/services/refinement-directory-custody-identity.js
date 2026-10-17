import fs from 'node:fs/promises';

/**
 * What identity MEANS for a held directory or file, in one place.
 *
 * These two predicates and the rename re-observation had drifted into four
 * separate copies (custody, custody-operations, custody-children, the artifact
 * held-authority) with the same field list and no shared name, which is how the
 * same defect could be fixed at one site and left standing at three others.
 */

/**
 * Exact identity: nothing about this inode moved. The right check for a CAS
 * across one operation the caller performed itself.
 */
export const samePinnedDirectoryState = (left, right) => left.dev === right.dev
  && left.ino === right.ino && left.size === right.size && left.mode === right.mode
  && left.uid === right.uid && left.gid === right.gid && left.nlink === right.nlink
  && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;

/**
 * Custody identity: same inode on the same device, same permissions, same
 * owner. Deliberately excludes size/nlink/mtime/ctime — those move whenever
 * anything is created or removed inside a directory, which for a shared
 * ancestor is other processes' normal business, not a custody violation.
 */
export const samePinnedDirectoryAnchor = (left, right) => left.dev === right.dev
  && left.ino === right.ino && left.mode === right.mode
  && left.uid === right.uid && left.gid === right.gid;

/**
 * rename(2) bumps the moved inode's ctime — that IS what renaming means.
 * Measured on a real fs: rename moves ctimeNs alone, preserving dev/ino/size/
 * mode/uid/gid/nlink/mtimeNs. A pre-rename stat is therefore never comparable
 * to a post-rename one, so a rename CAS re-observes the descriptor it held
 * AFTER the rename, keeping the full ctime-bearing check instead of blinding a
 * field. Returns the published state, or null if the held descriptor is not the
 * thing now at `target`.
 */
export const renamedIdentity = async (handle, target) => {
  const [held, published] = await Promise.all([
    handle.stat({ bigint: true }),
    fs.lstat(target, { bigint: true }),
  ]);
  return samePinnedDirectoryState(held, published) ? published : null;
};

/**
 * Verify every directory an owner still holds.
 *
 * ANCESTORS hold by custody anchor, not by exact identity: a pinned chain
 * deliberately spans shared sticky directories — /tmp for a temp store, $HOME
 * and ~/.neuma for the packaged app, which is what `allowRootStickyAncestors`
 * exists to permit — and any unrelated process creating one temp file in one of
 * them moves that directory's nlink/mtime/ctime. Requiring those to hold made a
 * pinned chain self-invalidating: measured, ONE unrelated mkdtemp in /tmp
 * permanently refused every later operation on a store pinned beneath it, and
 * removing the intruder did not restore it because ctime only moves forward.
 * The directory being operated IN keeps its exact identity — that is the check
 * with a meaning, and every mutating primitive refreshes it.
 */
export const verifyPinnedChain = async (state) => {
  if (!['open', 'cleanup-failed'].includes(state.phase)) {
    throw new Error(`${state.label} is ${state.phase}`);
  }
  for (const [index, entry] of state.held.entries()) {
    if (entry.closed) continue;
    const current = await entry.handle.stat({ bigint: true });
    const holds = index === state.current
      ? samePinnedDirectoryState(entry.identity, current)
      : samePinnedDirectoryAnchor(entry.identity, current);
    if (!holds) throw new Error(`${entry.label} held directory identity changed`);
  }
  return true;
};
