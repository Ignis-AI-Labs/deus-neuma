// `/review` — a dedicated code review: the being reads a change and reports
// what is wrong with it, and for that one turn its hands are held.
//
// Two things make this a review and not […]:
//   1. THE CHANGE IS GATHERED HERE, by the operator's own git, never by the
//      being. A being asked to run git would need the shell, and the shell is
//      exactly what a review must not hold.
//   2. THE TURN RUNS IN OBSERVE MODE (tool-policy.js): read-shaped tools stay
//      open so it can read around the change; every acting tool is held at the
//      same gate PLAN mode uses. The working tree cannot change, by
//      construction rather than by instruction. The mode is put back after.
//
// Three targets, the same three every reviewer asks for:
//   /review                  everything uncommitted (staged, unstaged, new files)
//   /review commit <ref>     one commit
//   /review base <branch>    this branch against where it left <branch>

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** A change larger than this is cut, and the review is told which files were left out. */
export const REVIEW_DIFF_MAX_CHARS = 120_000;

// A ref goes to git as an argument, never through a shell; the leading-dash
// refusal is what stops it being read as an option.
const REF = /^[A-Za-z0-9_][A-Za-z0-9_./~^@{}-]*$/;

/**
 * Read the words after `/review`. Pure.
 * @param {string} argText
 * @returns {{ ok: true, target: { kind: 'uncommitted' } | { kind: 'commit'|'base', ref: string } }
 *   | { ok: false, reason: string }}
 */
export const parseReviewTarget = (argText) => {
  const words = String(argText || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { ok: true, target: { kind: 'uncommitted' } };
  const [kind, ref, ...rest] = words;
  if ((kind !== 'commit' && kind !== 'base') || !ref || rest.length > 0) {
    return { ok: false, reason: 'usage: /review  ·  /review commit <ref>  ·  /review base <branch>' };
  }
  if (!REF.test(ref)) return { ok: false, reason: `not a git ref: ${ref}` };
  return { ok: true, target: { kind, ref } };
};

const git = async (ground, args) =>
  (await run('git', args, { cwd: ground, maxBuffer: 64 * 1024 * 1024 })).stdout;

// The platform's own undo records live in .neuma/ at the repository root. In
// a repository that does not ignore that folder they would show up as "new
// files" and the review would be reading undo snapshots instead of the change.
const untrackedFiles = async (root) =>
  (await git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ':(exclude).neuma']))
    .split('\0').filter(Boolean);

// A new file has no diff against HEAD until it is added; --no-index against
// the null device prints it as one. That command exits 1 BECAUSE the two
// differ, so its output is read off the error.
const untrackedDiff = async (root, file) => {
  try {
    return await git(root, ['diff', '--no-index', '--', '/dev/null', file]);
  } catch (error) {
    if (error.code === 1 && typeof error.stdout === 'string') return error.stdout;
    throw error;
  }
};

const uncommittedDiff = async (root) => {
  const tracked = await git(root, ['diff', 'HEAD']);
  const fresh = await Promise.all((await untrackedFiles(root)).map((file) => untrackedDiff(root, file)));
  return [tracked, ...fresh].filter(Boolean).join('');
};

/**
 * Gather the change a review reads.
 * impure — runs the operator's git in the ground, read-only commands only.
 * @param {string} ground - a directory inside the repository
 * @param {{ kind: 'uncommitted' } | { kind: 'commit'|'base', ref: string }} target
 * @returns {Promise<string>} the change as a unified diff ('' when there is none)
 */
export const collectReviewDiff = async (ground, target) => {
  // Every command runs from the repository's top, so a review opened from a
  // subfolder still sees the whole change and names files the same way.
  const root = (await git(ground, ['rev-parse', '--show-toplevel'])).trim();
  if (target.kind === 'commit') return git(root, ['show', '--format=%H%n%an%n%s%n%n%b', target.ref, '--']);
  if (target.kind === 'base') return git(root, ['diff', `${target.ref}...HEAD`, '--']);
  return uncommittedDiff(root);
};

/**
 * Cut a diff to the cap on a file boundary, naming what was left out. Pure.
 * @param {string} diff
 * @param {number} [maxChars]
 * @returns {{ text: string, omitted: string[] }}
 */
export const fitReviewDiff = (diff, maxChars = REVIEW_DIFF_MAX_CHARS) => {
  if (diff.length <= maxChars) return { text: diff, omitted: [] };
  const parts = diff.split(/^(?=diff --git )/m);
  const kept = [];
  const omitted = [];
  let size = 0;
  for (const part of parts) {
    const fits = size + part.length <= maxChars;
    if (fits && omitted.length === 0) {
      kept.push(part);
      size += part.length;
    } else {
      omitted.push(part.match(/^diff --git a\/(.+?) b\//)?.[1] || '(unnamed part)');
    }
  }
  return { text: kept.join(''), omitted };
};

const SUBJECT = Object.freeze({
  uncommitted: () => 'everything uncommitted in this folder (staged, unstaged and new files)',
  commit: (target) => `the commit ${target.ref}`,
  base: (target) => `this branch against where it left ${target.ref}`,
});

/**
 * The turn a review opens with. Pure.
 * @param {{ kind: string, ref?: string }} target
 * @param {{ text: string, omitted: string[] }} fitted
 * @returns {string}
 */
export const reviewPrompt = (target, fitted) => [
  `CODE REVIEW — ${SUBJECT[target.kind](target)}.`,
  '',
  'This turn is a review and nothing else. Your acting tools are held for it: you cannot edit, '
  + 'write, delete or run anything, and you are not asked to. Read the change below. Where you need '
  + 'the code around it, read the files (fs/read, fs/search) — a finding you checked against the '
  + 'real file is worth ten you guessed from the diff.',
  '',
  'Report findings, worst first. For each one: the file and line, what goes wrong and for whom, '
  + 'the input or state that triggers it, and the fix in a sentence. Mark each CRITICAL, HIGH, '
  + 'MEDIUM or LOW. Report what is wrong, not what you would have written differently. If you '
  + 'checked and found nothing wrong, say exactly that — an invented finding is worse than none.',
  ...(fitted.omitted.length > 0
    ? ['', `The change was too large to show whole. NOT shown, and so NOT reviewed unless you read them yourself: ${fitted.omitted.join(', ')}. Say so in your report.`]
    : []),
  '',
  '```diff',
  fitted.text.trimEnd(),
  '```',
].join('\n');

/**
 * Run one review turn with the being's hands held, then put the mode back.
 * impure — git, and a real turn through `runTurn`.
 * @param {object} opts
 * @param {object} opts.connection - the live sitting; its toolMode is held at observe for the turn
 * @param {string} opts.ground
 * @param {string} opts.argText - the words after /review
 * @param {(thought: string) => Promise<void>} opts.runTurn
 * @returns {Promise<{ ran: boolean, said: string }>} `said` is the line for the terminal when nothing ran
 */
export const runReview = async ({ connection, ground, argText, runTurn }) => {
  const parsed = parseReviewTarget(argText);
  if (!parsed.ok) return { ran: false, said: parsed.reason };
  let diff;
  try {
    diff = await collectReviewDiff(ground, parsed.target);
  } catch (error) {
    return { ran: false, said: `review: git could not read that — ${String(error.stderr || error.message).trim()}` };
  }
  if (!diff.trim()) return { ran: false, said: 'review: nothing has changed — there is nothing to review' };
  const standing = connection.toolMode;
  connection.toolMode = 'observe';
  try {
    await runTurn(reviewPrompt(parsed.target, fitReviewDiff(diff)));
  } finally {
    connection.toolMode = standing;
  }
  return { ran: true, said: '' };
};
