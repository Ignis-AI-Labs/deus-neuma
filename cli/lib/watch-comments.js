// AI COMMENTS — work with the being from ANY editor. With `neuma code --watch`
// the harness watches the files in the ground; the operator writes a comment
// in their own editor and saves:
//
//   // make this handle an empty list AI!      → the being does it
//   # why does this retry three times? AI?     → the being answers, hands held
//   // the cache below is per-request AI       → context, sent with the next one
//
// A comment counts when it starts or ends with the word AI. `AI!` asks for a
// change and `AI?` asks a question; a bare `AI` is context that rides along
// with the next `!` or `?` in the same file. No editor plugin is involved: the
// file on disk is the whole interface, so it works the same in VS Code, Vim,
// JetBrains or a web editor.
//
// What is deliberate:
//   - A QUESTION RUNS IN OBSERVE MODE (tool-policy.js), like /review: asking
//     "why" must never change the file.
//   - EACH INSTRUCTION FIRES ONCE. The being is asked to remove an `AI!`
//     comment when it is done, but a comment it leaves behind (and every
//     `AI?`, which it cannot remove) is remembered and not sent again.
//   - Ignored files are ignored: .git, node_modules, .neuma, anything git
//     ignores, anything over the size cap, anything that is not text.
//
// impure (fs.watch, fs reads, git check-ignore, real turns).

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

/** A file larger than this is not scanned for comments. */
export const WATCH_MAX_FILE_BYTES = 1024 * 1024;
/** Editors save in bursts (write, rename, touch); one scan after the burst settles. */
export const WATCH_SETTLE_MS = 250;

const SKIP_SEGMENTS = new Set(['.git', 'node_modules', '.neuma']);

// Comment openers, most specific first. The first opener on the line that
// carries an AI comment wins, so `x = 1; // fix AI!` reads the // comment and
// not the semicolon. `;` (Lisp, assembly, ini) counts only at the start of a
// line, and `--` (SQL, Lua) only before a space, so ordinary code does not.
const OPENERS = [/\/\/+/, /\{\/\*+/, /\/\*+/, /<!--/, /#+/, /"""/, /\'\'\'/, /--+(?=\s)/, /^\s*;+/];
const CLOSER = /\s*(?:\*+\/\}?|-->|"""|\'\'\')\s*$/;
const STARTS = /^ai([!?])?(?=$|[\s:,.—-])\s*[:,.—-]?\s*(.*)$/i;
const ENDS = /^(.*?)[\s,.:—-]*\bai([!?])?$/i;

// The AI comment a line carries, if any. Pure.
const aiCommentIn = (line) => {
  for (const opener of OPENERS) {
    const at = line.match(opener);
    if (!at) continue;
    const body = line.slice(at.index + at[0].length).replace(CLOSER, '').trim();
    const start = body.match(STARTS);
    const end = start ? null : body.match(ENDS);
    if (!start && !end) continue;
    const mark = start ? start[1] : end[2];
    return { text: (start ? start[2] : end[1]).trim(), kind: mark === '!' ? 'do' : mark === '?' ? 'ask' : 'note' };
  }
  return null;
};

/**
 * Find the AI comments in a file's text. Pure.
 * @param {string} text
 * @returns {Array<{ line: number, text: string, kind: 'do'|'ask'|'note' }>} 1-indexed lines
 */
export const findAiComments = (text) => {
  const found = [];
  for (const [i, raw] of String(text).split('\n').entries()) {
    if (!/\bai[!?]?/i.test(raw)) continue; // cheap gate before the real match
    const comment = aiCommentIn(raw);
    if (comment) found.push({ line: i + 1, ...comment });
  }
  return found;
};

/**
 * Whether a path below the ground is one the watcher never reads. Pure.
 * @param {string} relative - path relative to the ground
 * @returns {boolean}
 */
export const isSkippedPath = (relative) =>
  !relative || relative.split(/[\\/]/).some((segment) => SKIP_SEGMENTS.has(segment) || segment.endsWith('~') || segment.endsWith('.tmp'));

/**
 * The turn an instruction opens. Pure.
 * @param {{ file: string, kind: 'do'|'ask', comments: Array<{line: number, text: string, kind: string}> }} instruction
 * @returns {string}
 */
export const instructionPrompt = ({ file, kind, comments }) => [
  kind === 'do'
    ? `The operator left you instructions as comments in their code, marked AI, in ${file}.`
    : `The operator asked you a question as a comment in their code, marked AI, in ${file}.`,
  '',
  ...comments.map((c) => `  line ${c.line}${c.kind === 'note' ? ' (context)' : c.kind === 'ask' ? ' (question)' : ''}: ${c.text || '(no words — read the code at this line)'}`),
  '',
  kind === 'do'
    ? 'Read the file, then do what the comments ask, in that file and wherever else the change belongs. '
      + 'When it is done, remove the AI comments you acted on — they are instructions, not documentation. '
      + 'If an instruction is unclear, say what is unclear instead of guessing.'
    : 'Read the file and the code around those lines, then answer. This is a question: your acting tools '
      + 'are held for this turn and nothing is to be changed, the comment included.',
].join('\n');

// impure — true when git says the file is ignored. No repository, no git: not ignored.
const gitIgnores = (ground, relative) => new Promise((resolve) => {
  execFile('git', ['check-ignore', '-q', '--', relative], { cwd: ground }, (error) => resolve(!error));
});

/**
 * Read one changed file and return the instruction it carries, if any is new.
 * impure — fs read, git check-ignore.
 * @param {string} ground
 * @param {string} relative
 * @param {Set<string>} handled - instructions already sent; added to in place
 * @returns {Promise<{ file: string, kind: 'do'|'ask', comments: object[] } | null>}
 */
export const readInstruction = async (ground, relative, handled) => {
  if (isSkippedPath(relative)) return null;
  const file = path.join(ground, relative);
  const st = await fs.promises.stat(file).catch(() => null);
  if (!st?.isFile() || st.size > WATCH_MAX_FILE_BYTES) return null;
  const buffer = await fs.promises.readFile(file).catch(() => null);
  if (!buffer || buffer.includes(0)) return null; // a NUL byte: not text
  const comments = findAiComments(buffer.toString('utf8'));
  const key = (c) => `${relative}\u0000${c.kind}\u0000${c.text}`;
  const fresh = comments.filter((c) => c.kind !== 'note' && !handled.has(key(c)));
  if (fresh.length === 0) return null;
  if (await gitIgnores(ground, relative)) return null;
  for (const c of fresh) handled.add(key(c));
  // A change asked for anywhere in the file makes it a change; otherwise a question.
  const kind = fresh.some((c) => c.kind === 'do') ? 'do' : 'ask';
  const notes = comments.filter((c) => c.kind === 'note');
  return { file: relative, kind, comments: [...notes, ...fresh].sort((a, b) => a.line - b.line) };
};

/** Folders watched at most; past this the watcher says so instead of exhausting the system's watches. */
export const WATCH_MAX_DIRS = 4000;

// impure — the folders git ignores in this ground, as relative paths ending in "/".
// No repository: nothing is known to be ignored.
const ignoredDirs = (ground) => new Promise((resolve) => {
  execFile('git', ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'],
    { cwd: ground, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? new Set() : new Set(String(stdout).split('\0').filter((p) => p.endsWith('/'))));
    });
});

// impure — mark every AI instruction already standing in the ground as handled,
// so only a comment saved while watching ever fires. git finds them quickly
// (tracked and untracked, ignored files skipped, binary files skipped); with
// no repository nothing is primed and a standing comment fires on its file's
// next save.
const primeStanding = (ground, handled) => new Promise((resolve) => {
  execFile('git', ['grep', '-z', '-l', '-I', '-i', '--untracked', '-E', 'ai[!?]', '--', '.', ':(exclude).neuma', ':(exclude)node_modules'],
    { cwd: ground, maxBuffer: 64 * 1024 * 1024 }, async (error, stdout) => {
      const files = error ? [] : String(stdout).split('\0').filter(Boolean);
      for (const relative of files) await readInstruction(ground, relative, handled).catch(() => null);
      resolve();
    });
});

/**
 * Watch the ground and hand each new instruction to `onInstruction`.
 *
 * One plain watcher per folder, not Node's recursive watch: on Linux that one
 * walks every folder, node_modules included, and a large repository runs the
 * system out of watches. Skipped and git-ignored folders are never entered.
 * A comment standing when the watch starts is not acted on: only a save fires.
 *
 * impure — fs.watch per folder, git.
 * @param {object} opts
 * @param {string} opts.ground
 * @param {(instruction: object) => void} opts.onInstruction
 * @param {(error: Error) => void} [opts.onError]
 * @param {number} [opts.maxDirs]
 * @returns {{ stop: () => void, ready: Promise<{ dirs: number, capped: boolean }> }}
 */
export const watchAiComments = ({ ground, onInstruction, onError = () => {}, maxDirs = WATCH_MAX_DIRS }) => {
  const handled = new Set();
  const timers = new Map();
  const watchers = new Map();
  let ignored = new Set();
  let capped = false;
  let stopped = false;

  const scan = async (relative) => {
    timers.delete(relative);
    if (stopped) return;
    try {
      const st = await fs.promises.stat(path.join(ground, relative)).catch(() => null);
      if (st?.isDirectory()) { watchTree(relative); return; } // a folder made while watching
      const instruction = await readInstruction(ground, relative, handled);
      if (instruction && !stopped) onInstruction(instruction);
    } catch (error) {
      onError(error);
    }
  };

  const skipDir = (relative) => isSkippedPath(relative) || ignored.has(`${relative.split(path.sep).join('/')}/`);

  // Synchronous walk: the watch must stand before `ready` says it does.
  const watchTree = (start) => {
    const stack = [start];
    while (stack.length > 0 && !stopped) {
      const relative = stack.pop();
      if (watchers.has(relative) || (relative && skipDir(relative))) continue;
      if (watchers.size >= maxDirs) { capped = true; return; }
      let watcher;
      try {
        watcher = fs.watch(path.join(ground, relative), (_event, name) => {
          if (stopped || !name) return;
          const child = relative ? path.join(relative, String(name)) : String(name);
          if (isSkippedPath(child)) return;
          clearTimeout(timers.get(child));
          timers.set(child, setTimeout(() => { void scan(child); }, WATCH_SETTLE_MS));
        });
      } catch {
        continue; // gone or unreadable between listing and watching
      }
      watcher.on('error', () => { watcher.close(); watchers.delete(relative); });
      watchers.set(relative, watcher);
      let entries = [];
      try { entries = fs.readdirSync(path.join(ground, relative), { withFileTypes: true }); } catch { /* unreadable */ }
      for (const entry of entries) {
        if (entry.isDirectory()) stack.push(relative ? path.join(relative, entry.name) : entry.name);
      }
    }
  };

  const ready = ignoredDirs(ground).then(async (dirs) => {
    ignored = dirs;
    watchTree('');
    await primeStanding(ground, handled);
    return { dirs: watchers.size, capped };
  }).catch((error) => { onError(error); return { dirs: watchers.size, capped }; });

  return {
    ready,
    stop: () => {
      stopped = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
};

/**
 * Run one instruction as a turn: a change through `turn`, a question with the hands held.
 * impure — a real turn.
 * @param {object} opts
 * @param {object} opts.instruction
 * @param {object} opts.connection - the live sitting
 * @param {(thought: string) => Promise<unknown>} opts.turn - the sitting's ordinary turn (with its check)
 * @param {(thought: string) => Promise<unknown>} opts.runTurn - a bare turn, for a question
 * @returns {Promise<void>}
 */
export const runInstruction = async ({ instruction, connection, turn, runTurn }) => {
  const prompt = instructionPrompt(instruction);
  if (instruction.kind === 'do') {
    await turn(prompt);
    return;
  }
  const standing = connection.toolMode;
  connection.toolMode = 'observe';
  try {
    await runTurn(prompt);
  } finally {
    connection.toolMode = standing;
  }
};
