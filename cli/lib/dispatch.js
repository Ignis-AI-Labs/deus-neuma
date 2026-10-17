// yargs setup for the neuma CLI. Exported separately from cli/index.js so
// the dispatcher can be unit-tested with synthetic argv (and an injected
// stdout sink) without spawning a subprocess or invoking process.exit. The
// thin index.js binds real process.argv + lets yargs's default .fail() emit
// + exit on error.
//
// Subcommands attach via per-command register* calls; the default ($0)
// command writes the scaffold banner.
//
// impure (filesystem read for pkg version; writes to provided stdout sink
// from the default-command handler)

import yargs from 'yargs/yargs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerEditCommand } from '../commands/edit.js';
import { registerSummonCommand } from '../commands/summon.js';
import { registerTalkCommand } from '../commands/talk.js';
import { registerProofCommand } from '../commands/proof.js';
import { registerSealCommand } from '../commands/seal.js';
import { registerRecoverCommand } from '../commands/recover.js';
import { registerProviderCommand } from '../commands/provider.js';
import { registerModelCommand } from '../commands/model.js';
import { registerVaultCommand } from '../commands/vault.js';
import { registerAgentCommand } from '../commands/agent.js';
import { registerCodeCommand, runCode } from '../commands/code.js';
import { registerWitnessCommand } from '../commands/witness.js';
import { findProjectRoot } from './project-root.js';
import { peekActiveBeing } from './active-being.js';
import { getDaemonHealth } from './daemon-probe.js';

const cliDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(cliDir, '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

const DEFAULT_BACKEND = 'http://localhost:3333';

/**
 * Format the no-arg CLI snapshot from already-collected facts. PURE —
 * string composition only; no IO, no globals. Exported so renderSnapshot
 * and tests can both consume it.
 * @param {{
 *   version: string,
 *   backend: string,
 *   daemon: { alive: boolean, status?: number, error?: string },
 *   active: { source: 'env' | 'file', value: string } | null,
 * }} params
 * @returns {string} the operator-facing snapshot, newline-terminated
 */
export const formatSnapshot = ({ version, backend, daemon, active }) => {
  const lines = [`neuma v${version}`];

  if (daemon.alive) {
    lines.push(`daemon: alive (${backend})`);
  } else {
    const detail = daemon.error ? ` — ${daemon.error}` : '';
    lines.push(`daemon: dormant (${backend})${detail}`);
    lines.push('  start with: scripts/neuma-daemon.sh start');
  }

  if (active) {
    const fromTag = active.source === 'env' ? 'from NEUMA_BEING env' : 'from .neuma/active';
    lines.push(`active being: ${active.value} (${fromTag})`);
  } else {
    lines.push('active being: (none configured)');
    lines.push('  set with: neuma summon <being>');
  }

  lines.push('');
  lines.push('Subcommands: code, witness, agent, talk, summon, edit, provider, model, status, proof, seal, vault. Run `neuma --help` for full usage.');
  return lines.join('\n') + '\n';
};

/**
 * Compose + write the no-arg snapshot. Exported so tests can call it with
 * an injected stdout sink + a controlled backend (e.g. a dead port) without
 * spawning a subprocess.
 * impure (process.cwd, env, fs via project-root + active-being, network via daemon-probe)
 * @param {{
 *   stdout: { write(s: string): unknown },
 *   version: string,
 *   backend?: string,
 *   cwd?: string,
 * }} params
 */
export const renderSnapshot = async ({
  stdout, version, backend = DEFAULT_BACKEND, cwd = process.cwd(),
}) => {
  const projectRoot = findProjectRoot(cwd);
  const active = peekActiveBeing({ projectRoot });
  const daemon = await getDaemonHealth({ backend });
  stdout.write(formatSnapshot({ version, backend, daemon, active }));
};

/**
 * Build the yargs CLI instance. Accepts a de-binned argv array AND
 * optional { stdout, stderr } sinks so unit tests can capture command
 * output without touching the real process streams. The returned instance
 * is ready to .parseAsync(); callers control whether parsing exits the
 * process (production: yes via default .fail(); tests: no via
 * .exitProcess(false)).
 *
 * @param {string[]} argv - de-binned argv (use yargs/helpers.hideBin)
 * @param {{
 *   stdout?: { write(s: string): unknown },
 *   stderr?: { write(s: string): unknown },
 * }} [opts]
 */
const buildCli = (argv, { stdout = process.stdout, stderr = process.stderr } = {}) => {
  let cli = yargs(argv)
    .scriptName('neuma')
    .version(pkg.version)
    .alias('version', 'v')
    .help('help')
    .alias('help', 'h')
    .usage('$0 <command> [options]');

  // Register subcommands. Each command module exports a register* function
  // that takes the builder + the same {stdout, stderr} sink so output is
  // injectable for tests.
  cli = registerEditCommand(cli, { stdout, stderr });
  cli = registerSummonCommand(cli, { stdout, stderr });
  cli = registerTalkCommand(cli, { stdout, stderr });
  cli = registerProofCommand(cli, { stdout, stderr });
  cli = registerSealCommand(cli, { stdout, stderr });
  cli = registerRecoverCommand(cli, { stdout, stderr });
  cli = registerProviderCommand(cli, { stdout, stderr });
  cli = registerModelCommand(cli, { stdout, stderr });
  cli = registerVaultCommand(cli, { stdout, stderr });
  cli = registerAgentCommand(cli, { stdout, stderr });
  cli = registerCodeCommand(cli, { stdout, stderr });
  cli = registerWitnessCommand(cli, { stdout, stderr });

  return cli
    .command(
      'status',
      'show CLI status (daemon health + active being)',
      () => {},
      async () => { await renderSnapshot({ stdout, version: pkg.version }); },
    )
    .command(
      '$0',
      'open the coding harness on a terminal — otherwise show CLI status',
      () => {},
      async () => {
        // Bare `neuma` at a real terminal IS the harness (the way bare
        // `opencode` is); piped/scripted callers still get the snapshot.
        if (stdout.isTTY) {
          const previousLogLevel = process.env.LOG_LEVEL;
          process.env.LOG_LEVEL = 'error';
          try {
            await runCode({ cwd: process.cwd(), stdout, stderr, argv: {} });
            const flush = () => Promise.all([
              new Promise((r) => process.stdout.write('', r)),
              new Promise((r) => process.stderr.write('', r)),
            ]);
            await flush();
            process.exit(0);
          } finally {
            if (previousLogLevel === undefined) delete process.env.LOG_LEVEL;
            else process.env.LOG_LEVEL = previousLogLevel;
          }
        }
        await renderSnapshot({ stdout, version: pkg.version });
      },
    )
    .demandCommand(0)
    .strict()
    .recommendCommands();
};

/**
 * Entry — parse argv via the configured yargs builder. Production callers
 * pass hideBin(process.argv) from cli/index.js; tests can pass synthetic
 * argv + capture the resolved structure.
 *
 * impure
 * @param {string[]} argv
 */
export const run = async (argv) => buildCli(argv).parseAsync();
