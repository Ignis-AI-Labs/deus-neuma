// THE PLATFORM'S OWN HAND — tools NEUMA executes itself instead of forwarding
// to the MCP filesystem server, strictly behind every check in
// createSandboxedCallTool (denied paths, write confinement, realpath, the
// encoding wall, the write budget) and behind the approval policy in front of
// the sandbox. A hand runs only after all of that has passed.
//
// There are exactly three, and each is here for a stated reason:
//
//   write_file — create-only by default. Replacing an existing file requires
//     explicit overwrite intent and its current modification stamp; small edits
//     belong to edit_file, never to a whole-file write.
//
//   delete_file — the MCP server has no delete at all, so the unlink has
//     always happened here. Files only: a directory refusal is honest, never
//     a recursive wipe.
//
//   edit_file — the pinned server's `applyFileEdits` replaces the FIRST
//     occurrence of the anchor and says nothing about the rest
//     (node_modules/@modelcontextprotocol/server-filesystem/dist/lib.js:154,
//     a bare `String.replace` with a string pattern). Measured on 400 real
//     commits of this repository: 4,855 hunks, 218 with an anchor that appears
//     more than once (4.49%), and in 149 of those the first occurrence was
//     provably the WRONG SITE — 3.07% of all edits, reported as success
//     (#299, benchmarks/analysis/2026-08-11-edit-primitive-evidence.md).
//     One-line anchors carry it at 5.99%; anchors of four lines or more are
//     0%. So the refusal below names the count AND teaches the fix, because
//     the fix is a property of the anchor, not of the being's intent.
//
//     Three further footguns of the upstream path close with it: the fuzzy
//     whitespace fallback (also first-match, so it can land somewhere the
//     being never named), an empty `oldText` inserting at byte 0, and
//     `normalizeLineEndings` rewriting a CRLF file to LF on every edit.
//
// impure (fs read/write/rename/unlink/stat)

import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';

import { applyEdit } from './edit-primitive.js';
import { writeEditSnapshot, writeDeleteSnapshot, undoRootFor } from './edit-undo.js';
import { guardedWriteFile } from './write-file-guard.js';

/** Tool names the platform executes itself. */
export const PLATFORM_HANDS = Object.freeze(new Set(['write_file', 'delete_file', 'edit_file']));

/** MCP-shaped success payload, so a hand is indistinguishable on the wire. */
const said = (text) => ({ content: [{ type: 'text', text }], structuredContent: { content: text } });

/** A refusal the caller logs and throws — never a silent no-op. */
const refuse = (reason) => ({ ok: false, reason });

// Atomic write: content lands via a sibling temp file and a rename, so a
// crash mid-write cannot leave a half-written source file where a whole one
// stood. Same discipline as the upstream server and as writeJsonAtomic.
const writeAtomic = async (filePath, content) => {
  const tmp = `${filePath}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, content, 'utf-8');
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
};

// The line an anchor lands on, 1-indexed — the one number that tells a being
// (and the operator reading the chip) WHERE the edit actually went.
const lineOf = (content, index) => content.slice(0, index).split('\n').length;

/**
 * Report an anchor the file does not carry exactly once. The message is the
 * whole teaching surface: it states what was found, and what to do about it.
 */
const anchorRefusal = (filePath, oldText, occurrences) => {
  const where = path.basename(filePath);
  const anchor = oldText.length > 120 ? `${oldText.slice(0, 120)}…` : oldText;
  if (occurrences === 0) {
    return `No match in ${where} for:\n${anchor}\n\n`
      + 'Nothing was written. The anchor must match the file EXACTLY, including '
      + 'indentation and line breaks — read the file and copy the lines you mean to replace.';
  }
  return `Refusing to edit ${where}: that anchor appears ${occurrences} times, `
    + 'so replacing it would be a guess about which one you meant.\n\n'
    + `${anchor}\n\n`
    + 'Nothing was written. Widen the anchor until it is unique — include the '
    + 'lines above and below it. Four or more lines of context is reliably unique; '
    + 'a single short line usually is not.';
};

/**
 * The safe edit_file: every anchor must match exactly once, or nothing is
 * written at all. Edits apply in order against the running content, which is
 * the upstream contract; each step is now checked instead of guessed.
 *
 * @param {{ path: string, edits: Array<{oldText: string, newText: string}>, dryRun?: boolean }} args
 * @returns {Promise<{ ok: true, result: object } | { ok: false, reason: string }>}
 */
const editFileHand = async (args) => {
  const filePath = path.resolve(String(args?.path || ''));
  const edits = Array.isArray(args?.edits) ? args.edits : null;
  if (!edits || edits.length === 0) {
    return refuse('an edit needs an `edits` array of { oldText, newText } — nothing was written.');
  }

  let before;
  try {
    before = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    return refuse(err.code === 'ENOENT'
      ? `Nothing stands at ${filePath} — an edit changes an existing file. Write it first (fs/write), then edit.`
      : `Could not read ${filePath}: ${err.message}`);
  }

  // Apply every edit before writing anything. A file is edited whole or not at
  // all: a partial application would leave the being's own account of the file
  // wrong for every remaining anchor.
  let content = before;
  const landed = [];
  for (const [i, edit] of edits.entries()) {
    const oldText = typeof edit?.oldText === 'string' ? edit.oldText : '';
    const newText = typeof edit?.newText === 'string' ? edit.newText : '';
    if (oldText === '') {
      return refuse(`Edit ${i + 1} has an empty oldText. An empty anchor matches the start of the `
        + 'file, so it would insert at the top rather than where you meant — nothing was written. '
        + 'Name the exact lines you are replacing.');
    }
    const at = content.indexOf(oldText);
    let next;
    try {
      next = applyEdit({ content, oldString: oldText, newString: newText });
    } catch {
      // applyEdit refuses zero and multi matches. Recount here so the message
      // carries the real number rather than re-parsing its prose.
      const occurrences = oldText === '' ? 0 : content.split(oldText).length - 1;
      return refuse(anchorRefusal(filePath, oldText, occurrences));
    }
    landed.push({ line: lineOf(content, at), replaced: oldText.split('\n').length });
    content = next.nextContent;
  }

  if (content === before) {
    return refuse('Every edit matched text identical to its replacement — the file is already in '
      + 'that state and nothing was written.');
  }

  const report = landed
    .map((l, i) => `edit ${i + 1}: ${l.replaced} line(s) at line ${l.line}`)
    .join('; ');

  if (args?.dryRun) {
    return { ok: true, result: said(`Dry run — ${path.basename(filePath)} unchanged. Would apply ${report}.`) };
  }

  // Stale check: the file must still be what we read. A write landing between
  // the read above and this line would be silently reverted by our content.
  const nowOnDisk = await fs.readFile(filePath, 'utf-8').catch(() => null);
  if (nowOnDisk !== before) {
    return refuse(`${path.basename(filePath)} changed on disk while this edit was being prepared. `
      + 'Nothing was written — read it again and redo the edit against the current content.');
  }

  const snapshot = writeEditSnapshot(undoRootFor(filePath), filePath, before);
  await writeAtomic(filePath, content);
  return { ok: true, result: said(`Edited ${path.basename(filePath)} — ${report}. Reverts with 'neuma edit --undo' (${path.basename(snapshot)}).`) };
};

/**
 * delete_file: one file, never a directory.
 * @param {{ path: string }} args
 */
const deleteFileHand = async (args) => {
  const target = path.resolve(String(args?.path || ''));
  const st = await fs.lstat(target).catch(() => null);
  if (!st) return refuse(`Nothing stands at ${target} — nothing was deleted`);
  if (st.isDirectory()) {
    return refuse('a delete removes a single FILE — directories are not deletable');
  }
  // Keep the file before it goes: a delete is undoable like any other act. A
  // link or special file is not a file's content, so it leaves no record.
  if (!st.isFile()) {
    await fs.unlink(target);
    return { ok: true, result: said(`Deleted ${target}`) };
  }
  const snapshot = writeDeleteSnapshot(undoRootFor(target), target, await fs.readFile(target));
  await fs.unlink(target);
  return {
    ok: true,
    result: said(snapshot
      ? `Deleted ${target}. Reverts with 'neuma edit --undo' (${path.basename(snapshot)}).`
      : `Deleted ${target}. Too large to keep a copy — this one cannot be undone.`),
  };
};

/**
 * Run the platform hand for a tool name. Caller has already run every gate.
 * @param {string} toolName
 * @param {object} args
 * @returns {Promise<{ ok: true, result: object } | { ok: false, reason: string }>}
 */
export const runPlatformHand = async (toolName, args) => {
  if (toolName === 'write_file') return guardedWriteFile(args);
  if (toolName === 'edit_file') return editFileHand(args);
  return deleteFileHand(args);
};
