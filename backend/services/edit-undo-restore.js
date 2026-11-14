// THE ONE RESTORE — every undo surface puts the last act back through here.
//
// `neuma edit --undo` carried this inline until 2026-11-12. The coding
// session's `/undo` needed the same routine, and two copies of […] would have drifted.
//
// What undoing means, by the record's kind (edit-undo.js):
//   an edit / whole replacement → the pre-edit content is written back
//   a delete                    → the file is written back, bytes exact
//   a create                    → the file is removed, but ONLY while it is
//                                 still exactly what was created; a file
//                                 someone has worked on since is left alone
//
// A record is consumed (moved to applied/) whatever the outcome, so the stack
// always moves and the trail of what stood before is kept.
//
// impure (fs read/write/mkdir/rename/unlink)

import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync, unlinkSync,
} from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { UNDO_SUBDIR, APPLIED_SUBDIR, contentSha256 } from './edit-undo.js';

// Halt-on-corrupt is intentional: silently stepping past a corrupt newest
// snapshot would restore an OLDER (possibly unrelated) edit, clobbering a
// different file with stale content. The operator asked to undo the LAST act;
// if its record cannot be read, refuse and let them inspect it.
export class CorruptSnapshotError extends Error {
  constructor(snapshotPath, cause) {
    super(`newest snapshot ${snapshotPath} is corrupt: ${cause.message}`);
    this.snapshotPath = snapshotPath;
  }
}

const readLatestSnapshot = (projectRoot) => {
  const dir = join(projectRoot, UNDO_SUBDIR);
  if (!existsSync(dir)) return null;
  // Pending snapshots only: top-level numeric .json files. applied/ is a
  // directory, so the filter leaves it out.
  const files = readdirSync(dir).filter((f) => /^\d+(-\d+)?\.json$/.test(f));
  if (!files.length) return null;
  // Newest first by leading timestamp; the counter suffix breaks ties.
  files.sort((a, b) => {
    const [aTs, aN = '0'] = a.replace('.json', '').split('-');
    const [bTs, bN = '0'] = b.replace('.json', '').split('-');
    return Number(bTs) - Number(aTs) || Number(bN) - Number(aN);
  });
  const fullPath = join(dir, files[0]);
  try {
    return { ...JSON.parse(readFileSync(fullPath, 'utf8')), snapshotPath: fullPath };
  } catch (err) {
    throw new CorruptSnapshotError(fullPath, err);
  }
};

// Move to applied/ instead of unlink: the record of what the file looked like
// is kept (RULE 7). A basename already there gets a fresh suffix, so the
// archive never overwrites an earlier entry.
const archiveSnapshot = (projectRoot, snapshotPath) => {
  const appliedDir = join(projectRoot, APPLIED_SUBDIR);
  mkdirSync(appliedDir, { recursive: true });
  const name = basename(snapshotPath);
  const appliedPath = existsSync(join(appliedDir, name))
    ? join(appliedDir, `${name.replace(/\.json$/, '')}-archived-${Date.now()}.json`)
    : join(appliedDir, name);
  renameSync(snapshotPath, appliedPath);
  return appliedPath;
};

const undoCreate = (snapshot) => {
  if (!existsSync(snapshot.path)) return 'already-gone';
  if (contentSha256(readFileSync(snapshot.path)) !== snapshot.createdSha256) return 'kept-changed';
  unlinkSync(snapshot.path);
  return 'removed';
};

const undoToContent = (snapshot) => {
  const existed = existsSync(snapshot.path);
  mkdirSync(dirname(snapshot.path), { recursive: true });
  writeFileSync(snapshot.path, typeof snapshot.preEditBase64 === 'string'
    ? Buffer.from(snapshot.preEditBase64, 'base64')
    : snapshot.preEditContent);
  return existed ? 'restored' : 'recreated';
};

/**
 * Undo the last recorded act in a project.
 * @param {string} projectRoot - root holding the .neuma/edit-undo directory
 * @returns {{ ok: false, undoDir: string }
 *   | { ok: true, action: 'restored'|'recreated'|'removed'|'kept-changed'|'already-gone',
 *       path: string, appliedAt: number, appliedPath: string }}
 * @throws {CorruptSnapshotError} when the newest record cannot be read
 */
export const restoreLatest = (projectRoot) => {
  const snapshot = readLatestSnapshot(projectRoot);
  if (!snapshot) return { ok: false, undoDir: join(projectRoot, UNDO_SUBDIR) };
  const action = snapshot.kind === 'create' ? undoCreate(snapshot) : undoToContent(snapshot);
  const appliedPath = archiveSnapshot(projectRoot, snapshot.snapshotPath);
  return { ok: true, action, path: snapshot.path, appliedAt: snapshot.appliedAt, appliedPath };
};

const SAID = Object.freeze({
  restored: (r) => `restored ${r.path}`,
  recreated: (r) => `restored ${r.path} (it was gone; it is back)`,
  removed: (r) => `removed ${r.path} (undoing its creation)`,
  'kept-changed': (r) => `left ${r.path} in place — it changed since it was created, so it was not removed`,
  'already-gone': (r) => `nothing to remove — ${r.path} was already gone`,
});

/** One sentence for a landed undo. Pure. */
export const describeUndo = (result) =>
  `${SAID[result.action](result)} `
  + `(snapshot from ${new Date(result.appliedAt).toISOString()}; archived to ${result.appliedPath})`;
