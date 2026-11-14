// Whole-file writes stay explicit: create by default, replace only against the
// exact file the caller inspected. Every landing is atomic; replacements get
// the same whole-file undo snapshot as surgical edits.

import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { writeEditSnapshot, writeCreateSnapshot, undoRootFor, repositoryRootFor } from './edit-undo.js';

const said = (text) => ({ content: [{ type: 'text', text }], structuredContent: { content: text } });
const refuse = (reason) => ({ ok: false, reason });
const landed = (text) => ({ ok: true, result: said(text) });

const writeAtomic = async (filePath, content) => {
  const tmp = `${filePath}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, filePath);
  } catch (error) {
    await fs.unlink(tmp).catch(() => {});
    throw error;
  }
};

const readIfExists = async (filePath) => {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

// Inside a repository a new file is undoable too. Elsewhere (a being's own
// notes) no record is left: undo is for work on a project. The file has
// already landed when this runs, so a record that cannot be written is said,
// never raised as a failed write.
const recordCreation = (filePath, content) => {
  const repository = repositoryRootFor(filePath);
  if (!repository) return '';
  try {
    writeCreateSnapshot(repository, filePath, content);
    return '';
  } catch (error) {
    return ` It could not be recorded for undo (${error.message}).`;
  }
};

/**
 * Create a new text file, or deliberately replace an existing one.
 * impure — the caller has already cleared path containment and encoding.
 */
export const guardedWriteFile = async (args) => {
  const filePath = path.resolve(String(args?.path || ''));
  if (typeof args?.content !== 'string') {
    return refuse('fs/write needs string content — nothing was written.');
  }

  let before;
  try {
    before = await readIfExists(filePath);
  } catch (error) {
    return refuse(`Could not read ${filePath}: ${error.message}. Nothing was written.`);
  }

  if (before === null) {
    let created = true;
    try {
      await fs.writeFile(filePath, args.content, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') return refuse(`Could not create ${filePath}: ${error.message}. Nothing was written.`);
      created = false;
      before = await readIfExists(filePath);
    }
    if (created) return landed(`Created ${path.basename(filePath)}.${recordCreation(filePath, args.content)}`);
  }

  const name = path.basename(filePath);
  if (args?.overwrite !== true) {
    return refuse(`${name} already exists — fs/write creates NEW files; it does not make small edits. `
      + 'Nothing was written. Use fs/edit with exact oldText/newText anchors. '
      + 'For a deliberate WHOLE-file replacement, read the current file info and call fs/write with '
      + 'overwrite: true and its expectedMtimeMs.');
  }
  if (!Number.isFinite(args?.expectedMtimeMs)) {
    return refuse(`Refusing to replace ${name} without expectedMtimeMs from fs/read {"path", "info": true}. `
      + 'Nothing was written — this proves the whole-file replacement is aimed at the file you inspected.');
  }

  let current;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return refuse(`${name} is not a regular file — nothing was written.`);
    current = { mtimeMs: stat.mtimeMs, content: await fs.readFile(filePath, 'utf8') };
  } catch (error) {
    return refuse(`Could not re-read ${name}: ${error.message}. Nothing was written.`);
  }
  if (current.mtimeMs !== args.expectedMtimeMs || current.content !== before) {
    return refuse(`${name} changed on disk while the replacement was being prepared. `
      + 'Nothing was written — read it again before replacing the whole file.');
  }

  const snapshot = writeEditSnapshot(undoRootFor(filePath), filePath, before);
  try {
    await writeAtomic(filePath, args.content);
  } catch (error) {
    return refuse(`Could not replace ${name}: ${error.message}. The original remains in place.`);
  }
  return landed(`Replaced ${name} as a WHOLE file. Reverts with 'neuma edit --undo' (${path.basename(snapshot)}).`);
};
