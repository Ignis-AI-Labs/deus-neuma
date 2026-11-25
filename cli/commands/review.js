// `neuma review` — the code review as one scripted command, for a terminal
// one-liner, a git hook or a CI step:
//
//   neuma review                  everything uncommitted
//   neuma review commit <ref>     one commit
//   neuma review base <branch>    this branch against where it left <branch>
//
// It is `/review` (review-turn.js) without the session: the operator's own git
// gathers the change, and the being reads it in a sitting whose acting tools
// are all held (`neuma agent --read-only`), so a review can never change the
// tree it is reviewing. The findings are the being's speech on stdout; the
// exit code is the sitting's.
//
// impure (git, a real sitting through runAgent).

import { runAgent, resolveTaskGround, DEFAULT_TIMEOUT_S } from './agent.js';
import { parseReviewTarget, collectReviewDiff, fitReviewDiff, reviewPrompt } from '../lib/review-turn.js';

/**
 * Run one scripted review and return the process exit code.
 * impure — git in the ground, then one real read-only sitting.
 * @param {{ cwd: string, stdout: object, stderr: object, argv: object }} opts
 * @returns {Promise<number>} 0 reviewed or nothing to review · 1 refused · the sitting's code otherwise
 */
export const runReviewCommand = async ({ cwd, stdout, stderr, argv }) => {
  const parsed = parseReviewTarget([argv.kind, argv.ref, ...(argv._ || []).slice(1)].filter(Boolean).join(' '));
  if (!parsed.ok) {
    stderr.write(`neuma review: ${parsed.reason.replaceAll('/review', 'neuma review')}\n`);
    return 1;
  }
  let diff;
  try {
    diff = await collectReviewDiff(resolveTaskGround(cwd, argv.ground), parsed.target);
  } catch (error) {
    stderr.write(`neuma review: git could not read that — ${String(error.stderr || error.message).trim()}\n`);
    return 1;
  }
  if (!diff.trim()) {
    stdout.write('nothing has changed — there is nothing to review\n');
    return 0;
  }
  return runAgent({
    cwd, stdout, stderr,
    argv: {
      task: reviewPrompt(parsed.target, fitReviewDiff(diff)),
      readOnly: true,
      workspace: argv.workspace,
      ground: argv.ground,
      timeout: argv.timeout,
      receipt: argv.receipt,
    },
  });
};

// impure — drain terminal pipes before the explicit exit (same law as `neuma agent`).
const flushProcessStreams = () => Promise.all([
  new Promise((resolve) => process.stdout.write('', resolve)),
  new Promise((resolve) => process.stderr.write('', resolve)),
]);

export const registerReviewCommand = (cli, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  cli.command(
    'review [kind] [ref]',
    'have a being review a change with its hands held: everything uncommitted, `commit <ref>`, or `base <branch>`',
    (y) => y
      .positional('kind', { describe: 'commit | base (omit to review everything uncommitted)', type: 'string' })
      .positional('ref', { describe: 'the commit, or the branch to compare against', type: 'string' })
      .option('workspace', { describe: 'neuma lane id or chosen name (default: the only local neuma)', type: 'string' })
      .option('ground', { describe: 'the repository to review (default: current directory)', type: 'string' })
      .option('receipt', { describe: 'write a machine-readable run receipt (automation)', type: 'string' })
      .option('timeout', { describe: `wall-clock budget in seconds (default ${DEFAULT_TIMEOUT_S})`, type: 'number' }),
    async (argv) => {
      const terminalProcess = stdout === process.stdout && stderr === process.stderr;
      const previousLogLevel = process.env.LOG_LEVEL;
      if (terminalProcess) process.env.LOG_LEVEL = 'error';
      let exitCode;
      try {
        exitCode = await runReviewCommand({ cwd: process.cwd(), stdout, stderr, argv });
      } finally {
        if (previousLogLevel === undefined) delete process.env.LOG_LEVEL;
        else process.env.LOG_LEVEL = previousLogLevel;
      }
      if (terminalProcess) {
        await flushProcessStreams();
        process.exit(exitCode);
      }
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );
