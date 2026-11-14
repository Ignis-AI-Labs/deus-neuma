// The work commands of `neuma code` — the ones that act on the folder rather
// than on the sitting: /review, /undo, /check, /commit. They live here, with the help
// text, so the REPL file stays a REPL (it stood at 498 of its 500 lines).
//
// impure (git, disk, real turns).

import { findProjectRoot } from './project-root.js';
import { runReview } from './review-turn.js';
import { parseCheckArg } from './check-after-turn.js';
import { watchAiComments, runInstruction } from './watch-comments.js';
import { restoreLatest, describeUndo } from '../../backend/services/edit-undo-restore.js';
import { isRepository, commitUndo } from './turn-commits.js';

export const HELP = Object.freeze(`
commands:
  /attach <paths...>   stage images (png/jpg/webp/gif) or text docs for the next turn
  /detach              drop every staged attachment
  /status              seat, session, substrate + vision, staged, usage
  /server              the machine + LLM serving status, live
  /model               this being's route — natal / override / effective
  /model set <p/m>     switch the route (sovereign doors only)
  /model natal         clear the override — ride the machine default
  /new                 end this session — the next turn opens a fresh one
  /being               seat another member of the house (picker)
  /being <name|lane>   seat directly
  /preset <name>       inference preset for the next turns (grounded/balanced/expansive)
  /review              review what is uncommitted — or: /review commit <ref> · /review base <branch>
  /undo                put back the last file change made here (edit, replace, delete, new file)
  /commit on|off       commit each request's file changes to git, with a message from your request;
                       /undo is then committed too (history is added to, never rewritten)
  /check <command>     run your lint or test command after every turn that changes files; a failure
                       goes back to the being to fix — /check shows it · /check off stops it
  /help                this list
  /quit                leave the harness (Ctrl+C twice at the prompt works too)

a trailing \\ continues the line; anything that is not a command is a turn.`);

/** What the operator is told the moment a check is switched on. Pure. */
export const checkOnNote = (command) =>
  `check on: ${command}\n`
  + '  runs after every turn that changes files here; a failure goes back to the being (3 fix turns at most).\n'
  + '  it runs as you, outside the being\'s sandbox — it runs what the files say, including what the being just wrote.';

const setCheck = (checks, argText) => {
  const asked = parseCheckArg(argText);
  if (asked.kind === 'show') return checks.command ? `check: ${checks.command}` : 'check: off — /check <command> turns it on';
  if (asked.kind === 'off') {
    checks.command = null;
    return 'check off';
  }
  checks.command = asked.command;
  return checkOnNote(asked.command);
};

/** What the operator is told when commits are switched on, or why they cannot be. Pure. */
export const commitOnNote = (root, repo) => (repo
  ? `commit on: each request's changes to files in ${root} are committed to git, with a message from your request.\n`
    + '  only the files the being changed go in; your other changes stay out.'
  : `commit: ${root} is not a git repository — nothing can be committed there`);

const setCommits = (commits, argText, root) => {
  const word = argText.trim().toLowerCase();
  if (!word) return commits.on ? `commit: on in ${root}` : 'commit: off — /commit on turns it on';
  if (word === 'off') {
    commits.on = false;
    return 'commit off';
  }
  if (word !== 'on') return 'commit is /commit on, /commit off, or /commit to see it';
  commits.on = isRepository(root);
  return commitOnNote(root, commits.on);
};

/**
 * Run one work command.
 * impure — see each command.
 * @param {object} opts
 * @param {string} opts.cmd - the word after the slash
 * @param {string} opts.argText
 * @param {object} opts.connection - the live sitting
 * @param {string} opts.ground
 * @param {(thought: string) => Promise<void>} opts.runTurn
 * @param {{ command: string|null }} opts.checks - the sitting's check, changed in place by /check
 * @param {{ on: boolean }} [opts.commits] - the sitting's commit switch, changed in place by /commit
 * @param {string} [opts.being] - the seated being's name, for commit messages
 * @returns {Promise<{ known: boolean, ran: boolean, said: string }>} `ran`: a turn ran and already
 *   prompted; `said`: the line for the terminal otherwise
 */
export const runWorkCommand = async ({ cmd, argText, connection, ground, runTurn, checks, commits = { on: false }, being = 'the being' }) => {
  if (cmd === 'review') return { known: true, ...(await runReview({ connection, ground, argText, runTurn })) };
  if (cmd === 'undo') {
    const root = findProjectRoot(ground);
    const undone = restoreLatest(root);
    if (!undone.ok) return { known: true, ran: false, said: `nothing to undo in ${undone.undoDir}` };
    const said = describeUndo(undone);
    const committed = commits.on ? commitUndo({ root, absPath: undone.path, being, said: said.split(' (snapshot')[0] }) : '';
    return { known: true, ran: false, said: committed ? `${said}\n${committed}` : said };
  }
  if (cmd === 'check') return { known: true, ran: false, said: setCheck(checks, argText) };
  if (cmd === 'commit') return { known: true, ran: false, said: setCommits(commits, argText, findProjectRoot(ground)) };
  return { known: false, ran: false, said: '' };
};

/**
 * Start watching the ground for AI comments; each instruction queues behind
 * whatever the sitting is doing, exactly like a typed line.
 * impure — fs watches, real turns.
 * @param {object} opts
 * @param {string} opts.ground
 * @param {object} opts.stderr
 * @param {(fn: () => Promise<void>) => void} opts.enqueue - the REPL's own queue
 * @param {() => boolean} opts.seated
 * @param {{ connection: object|null }} opts.live
 * @param {(thought: string) => Promise<void>} opts.workTurn - a turn with the check
 * @param {(thought: string) => Promise<void>} opts.runTurn - a bare turn
 * @returns {{ stop: () => void, ready: Promise<object> }}
 */
export const startCommentWatch = ({ ground, stderr, enqueue, seated, live, workTurn, runTurn }) => {
  const watch = watchAiComments({
    ground,
    onError: (error) => stderr.write(`  watch: ${error.message}\n`),
    onInstruction: (instruction) => {
      const what = instruction.kind === 'do' ? 'instruction' : 'question';
      if (!seated()) { stderr.write(`  watch: ${what} in ${instruction.file} — seat a being first\n`); return; }
      stderr.write(`  watch: ${what} in ${instruction.file}\n`);
      enqueue(() => runInstruction({ instruction, connection: live.connection, turn: workTurn, runTurn }));
    },
  });
  void watch.ready.then(({ dirs, capped }) => stderr.write(capped
    ? `watching ${dirs} folders for AI comments — the folder limit was reached; deeper folders are not watched\n`
    : `watching ${dirs} folder(s) for AI comments — end a comment with AI! to ask for a change, AI? to ask a question\n`));
  return watch;
};
