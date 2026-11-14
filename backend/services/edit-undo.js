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
// edit-undo-restore.js. It is deliberately the whole pre-edit file and not a
// diff: restoring must never depend on re-deriving anything.
//
// Two more acts leave a record (2026-11-12), because an undo that skips them
// is not an undo: a DELETE keeps the whole file (`kind: 'delete'`, bytes as
// base64 when they are not text), and a file CREATED inside a repository keeps
// its fingerprint (`kind: 'create'`) so undo can take it away again — only
// while it is still exactly what was created.
//
// impure (fs mkdir/write/stat)

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

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
export const undoRootFor = (filePath) =>
  repositoryRootFor(filePath) || dirname(resolve(filePath));

/**
 * The repository a file sits in, or null when it sits in none.
 * @param {string} filePath - absolute path of a file
 * @returns {string|null}
 */
export const repositoryRootFor = (filePath) => {
  let dir = dirname(resolve(filePath));
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

/** A deleted file larger than this leaves no record — the hand says so. */
export const DELETE_SNAPSHOT_MAX_BYTES = 32 * 1024 * 1024;

/** The fingerprint a create record carries. Pure. */
export const contentSha256 = (data) => createHash('sha256').update(data).digest('hex');

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

const writeRecord = (projectRoot, record) => {
  const dir = ensureUndoDir(projectRoot);
  const ts = Date.now();
  const snapshotPath = allocateUniquePath(dir, ts);
  writeFileSync(snapshotPath, JSON.stringify({ ...record, appliedAt: ts }, null, 2));
  return snapshotPath;
};

/**
 * Write one pre-edit snapshot.
 * @param {string} projectRoot - root holding the .neuma/edit-undo directory
 * @param {string} absPath - absolute path of the file about to change
 * @param {string} preEditContent - the file's content BEFORE the edit
 * @returns {string} absolute path of the snapshot written
 */
export const writeEditSnapshot = (projectRoot, absPath, preEditContent) =>
  writeRecord(projectRoot, { path: absPath, preEditContent });

/**
 * Keep a file that is about to be deleted. Text is kept as text; anything
 * else as base64, so the bytes come back exactly.
 * @param {string} projectRoot
 * @param {string} absPath - absolute path of the file about to be deleted
 * @param {Buffer} bytes - the file's bytes BEFORE the delete
 * @returns {string|null} the snapshot path, or null when the file is over the cap
 */
export const writeDeleteSnapshot = (projectRoot, absPath, bytes) => {
  if (bytes.length > DELETE_SNAPSHOT_MAX_BYTES) return null;
  const text = bytes.toString('utf8');
  const isText = Buffer.from(text, 'utf8').equals(bytes);
  return writeRecord(projectRoot, isText
    ? { path: absPath, preEditContent: text, kind: 'delete' }
    : { path: absPath, preEditContent: null, preEditBase64: bytes.toString('base64'), kind: 'delete' });
};

/**
 * Record that a file was just created, so undo can remove it again.
 * @param {string} projectRoot
 * @param {string} absPath - absolute path of the file that was created
 * @param {string} content - exactly what was written
 * @returns {string} absolute path of the record written
 */
export const writeCreateSnapshot = (projectRoot, absPath, content) =>
  writeRecord(projectRoot, {
    path: absPath, preEditContent: null, kind: 'create', createdSha256: contentSha256(content),
  });
