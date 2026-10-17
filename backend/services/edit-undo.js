// THE UNDO STACK — one snapshot format, one directory, both hands.
//
// Every edit that lands on a real file writes its pre-edit content here first,
// so `neuma edit --undo` can put it back. Until 2026-08-13 only the operator's
// own `neuma edit` did this; a BEING's edit went straight through the MCP
// filesystem server and was unrecoverable (#299). Now both write the same
// records into the same directory, which is what makes one undo stack honest:
// the operator reverts THE LAST EDIT to their project, without having to know
// or care whether they or a being made it.
//
// The snapshot record is `{ path, preEditContent, appliedAt }` — read by
// cli/commands/edit.js `runUndo`. It is deliberately the whole pre-edit file
// and not a diff: restoring must never depend on re-deriving anything.
//
// impure (fs mkdir/write/stat)

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

export const UNDO_SUBDIR = '.neuma/edit-undo';
export const APPLIED_SUBDIR = '.neuma/edit-undo/applied';

/**
 * Resolve the project root an undo stack belongs to, by walking up from a file
 * looking for a `.git` directory. Falls back to the file's own directory when
 * the tree is not a repository, so a snapshot is always written somewhere
 * recoverable rather than silently skipped.
 *
 * This is the same walk as cli/lib/project-root.js `findProjectRoot`, which
 * takes a START DIRECTORY (the operator's cwd). A being has no cwd — it names
 * an absolute path — so the walk starts from the file instead.
 *
 * @param {string} filePath - absolute path of the file being edited
 * @returns {string} absolute project root
 */
export const undoRootFor = (filePath) => {
  const start = dirname(resolve(filePath));
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
};

const ensureUndoDir = (projectRoot) => {
  const dir = join(projectRoot, UNDO_SUBDIR);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(projectRoot, APPLIED_SUBDIR), { recursive: true });
  return dir;
};

// Generate a unique filename in `dir` for timestamp `ts`. Same-ms collisions
// (rare but reachable on rapid edits, and a being edits faster than a human)
// get a numeric counter suffix so a second snapshot can never silently
// overwrite the first.
const allocateUniquePath = (dir, ts) => {
  let p = join(dir, `${ts}.json`);
  let n = 0;
  while (existsSync(p)) {
    n += 1;
    p = join(dir, `${ts}-${n}.json`);
  }
  return p;
};

/**
 * Write one pre-edit snapshot.
 * @param {string} projectRoot - root holding the .neuma/edit-undo directory
 * @param {string} absPath - absolute path of the file about to change
 * @param {string} preEditContent - the file's content BEFORE the edit
 * @returns {string} absolute path of the snapshot written
 */
export const writeEditSnapshot = (projectRoot, absPath, preEditContent) => {
  const dir = ensureUndoDir(projectRoot);
  const ts = Date.now();
  const snapshotPath = allocateUniquePath(dir, ts);
  writeFileSync(
    snapshotPath,
    JSON.stringify({ path: absPath, preEditContent, appliedAt: ts }, null, 2),
  );
  return snapshotPath;
};
