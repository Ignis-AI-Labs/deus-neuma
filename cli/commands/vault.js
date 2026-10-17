// `neuma vault sync` — materialize the collective knowledge vault: the
// witness's claude-mem history (observations + session summaries) rendered
// as a folder of wikilinked markdown notes, openable in Obsidian or any
// markdown tool, and shareable into a project folder for neuma to read.
//
//   neuma vault sync                         sync with defaults (~/.claude-mem → ~/neuma-vault)
//   neuma vault sync --project neuma         only one project's history
//   neuma vault sync --memory-dir <dir>      also mirror a curated markdown memory dir
//   neuma vault sync --dry-run               report what would change, write nothing
//
// Local-only: reads the store read-only, writes files. No backend, no auth.
// Stdout = summary (pipe-friendly); stderr = errors. impure.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { runVaultSync } from '../lib/vault-sync.js';

const DEFAULT_DB = join(homedir(), '.claude-mem', 'claude-mem.db');
const DEFAULT_OUT = join(homedir(), 'neuma-vault');

/**
 * Format a sync result as an operator-facing summary. PURE — exported for tests.
 * @param {{ created: number, updated: number, unchanged: number, preserved: string[], memoryCopied: number, dryRun: boolean }} result
 */
const formatSyncResult = (result) => {
  const lines = [
    `${result.dryRun ? '[dry-run] ' : ''}vault sync: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged`,
  ];
  if (result.memoryCopied) lines.push(`memory dir: ${result.memoryCopied} file(s) mirrored`);
  if (result.preserved.length) {
    lines.push(`preserved ${result.preserved.length} hand-edited note(s) (use --force to regenerate):`);
    lines.push(...result.preserved.map((p) => `  ${p}`));
  }
  return lines.join('\n') + '\n';
};

export const registerVaultCommand = (cli, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  cli.command(
    'vault',
    'manage the collective knowledge vault (markdown, Obsidian-compatible)',
    (y) => y
      .command(
        'sync',
        'export claude-mem history into the vault (incremental; hand edits preserved)',
        (yy) => yy
          .option('db', { describe: 'claude-mem SQLite store', type: 'string', default: DEFAULT_DB })
          .option('out', { describe: 'vault directory', type: 'string', default: DEFAULT_OUT })
          .option('project', { describe: 'limit to one claude-mem project', type: 'string' })
          .option('memory-dir', { describe: 'markdown memory dir to mirror into <out>/memory/', type: 'string' })
          .option('dry-run', { describe: 'report changes without writing', type: 'boolean', default: false })
          .option('force', { describe: 'regenerate hand-edited notes too', type: 'boolean', default: false }),
        async (argv) => {
          try {
            const result = await runVaultSync({
              dbPath: argv.db,
              outDir: argv.out,
              project: argv.project,
              memoryDir: argv.memoryDir,
              dryRun: argv.dryRun,
              force: argv.force,
            });
            stdout.write(formatSyncResult(result));
          } catch (err) {
            stderr.write(`neuma vault sync: ${err.message}\n`);
            process.exit(1);
          }
        },
      )
      .demandCommand(1, 'specify a vault action')
      .strict(),
    () => {},
  );
