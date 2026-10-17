// `neuma edit <path>` — the R-01 critical-path subcommand. Wraps the pure
// applyEdit primitive with filesystem IO, stale-content protection, an
// operator-undo snapshot for every write, and --dry-run preview.
//
// SAFETY DISCIPLINE (sprint plan §5 R-01):
//   - --dry-run prints the would-change summary without writing.
//   - Stale-content check: re-read the file immediately before write and
//     abort if it changed between the initial read and the write.
//   - Per-write snapshot under <project>/.neuma/edit-undo/<ts>.json
//     containing { path, preEditContent, appliedAt }. Operator-undo via
//     `neuma edit --undo` restores the LAST snapshot and consumes it.
//   - Multi-match without --replace-all fails loud (primitive enforces).
//   - Zero-match fails loud (primitive enforces).
//
// SCOPE NOTE: slice 1 ships SINGLE-step undo (most recent snapshot).
// Multi-step undo stack is slice 2 per sprint plan §7 out-of-scope.
//
// impure (process.cwd, fs read/write/mkdir/rename, process.stderr/stdout)

import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync, statSync,
} from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { applyEdit } from '../../backend/services/edit-primitive.js';
import { findProjectRoot } from '../lib/project-root.js';
import { writeEditSnapshot, UNDO_SUBDIR, APPLIED_SUBDIR } from '../../backend/services/edit-undo.js';


// Halt-on-corrupt is intentional: silently iterating past a corrupt newest
// snapshot would restore an OLDER (possibly unrelated) edit, clobbering a
// different file with stale content. The operator asked to undo their
// LAST edit; if the latest snapshot can't be parsed, we refuse and let
// them inspect it. Throws a structured error the caller turns into an
// exit-1 message.
class CorruptSnapshotError extends Error {
  constructor(snapshotPath, cause) {
    super(`newest snapshot ${snapshotPath} is corrupt: ${cause.message}`);
    this.snapshotPath = snapshotPath;
  }
}

const readLatestSnapshot = (projectRoot) => {
  const dir = join(projectRoot, UNDO_SUBDIR);
  if (!existsSync(dir)) return null;
  // Only consider pending snapshots (top-level numeric .json files). The
  // applied/ subdir is excluded by the numeric-prefix filter.
  const files = readdirSync(dir).filter((f) => /^\d+(-\d+)?\.json$/.test(f));
  if (!files.length) return null;
  // Sort by leading timestamp descending; counter suffix breaks ties.
  files.sort((a, b) => {
    const [aTs, aN = '0'] = a.replace('.json', '').split('-');
    const [bTs, bN = '0'] = b.replace('.json', '').split('-');
    return Number(bTs) - Number(aTs) || Number(bN) - Number(aN);
  });
  const latest = files[0];
  const fullPath = join(dir, latest);
  let data;
  try {
    data = JSON.parse(readFileSync(fullPath, 'utf8'));
  } catch (err) {
    throw new CorruptSnapshotError(fullPath, err);
  }
  return { ...data, snapshotPath: fullPath };
};

const formatLineEnding = (le) => le === '\r\n' ? 'CRLF' : 'LF';

const runUndo = ({ cwd, stdout, stderr }) => {
  const projectRoot = findProjectRoot(cwd);
  let snapshot;
  try {
    snapshot = readLatestSnapshot(projectRoot);
  } catch (err) {
    if (err instanceof CorruptSnapshotError) {
      stderr.write(
        `neuma edit --undo: ${err.message}. `
        + 'Refusing to undo an unintended edit (silently restoring an older snapshot '
        + 'could clobber an unrelated file). Inspect or remove the corrupt snapshot, '
        + 'then retry.\n',
      );
      process.exit(1);
    }
    throw err;
  }
  if (!snapshot) {
    stderr.write(
      `neuma edit --undo: no edit snapshots found in ${join(projectRoot, UNDO_SUBDIR)}\n`,
    );
    process.exit(1);
  }
  if (!existsSync(snapshot.path)) {
    stderr.write(`neuma edit --undo: target file no longer exists; recreating ${snapshot.path}\n`);
  }
  writeFileSync(snapshot.path, snapshot.preEditContent);
  // Move to applied/ instead of unlink: preserves the audit trail of what
  // the file looked like pre-edit (RULE 7). Multi-step undo in slice 2 can
  // iterate the applied/ + pending/ split; slice 1 only restores the most
  // recent pending snapshot. Same allocateUniquePath collision guard so a
  // basename collision can't silently overwrite a prior archive entry.
  const appliedDir = join(projectRoot, APPLIED_SUBDIR);
  mkdirSync(appliedDir, { recursive: true });
  const sourceBasename = basename(snapshot.snapshotPath);
  let appliedPath = join(appliedDir, sourceBasename);
  if (existsSync(appliedPath)) {
    // Same-basename collision (e.g. undo → re-edit → undo of a same-ms
    // counter-suffixed snapshot). Append a fresh ts so the archive is
    // append-only-safe.
    appliedPath = join(appliedDir, `${sourceBasename.replace(/\.json$/, '')}-archived-${Date.now()}.json`);
  }
  renameSync(snapshot.snapshotPath, appliedPath);
  stdout.write(
    `neuma edit --undo: restored ${snapshot.path} `
    + `(snapshot from ${new Date(snapshot.appliedAt).toISOString()}; `
    + `archived to ${appliedPath})\n`,
  );
};

const runEdit = ({ cwd, stdout, stderr, argv }) => {
  if (!argv.path) {
    stderr.write('neuma edit: path is required (or use --undo)\n');
    process.exit(1);
  }
  if (argv.old === undefined) {
    stderr.write('neuma edit: --old is required\n');
    process.exit(1);
  }
  if (argv.new === undefined) {
    stderr.write('neuma edit: --new is required\n');
    process.exit(1);
  }

  const absPath = resolve(cwd, argv.path);
  if (!existsSync(absPath)) {
    stderr.write(`neuma edit: file not found: ${absPath}\n`);
    process.exit(1);
  }
  // Refuse to edit anything that isn't a regular file (no devices, no dirs,
  // no special files). The primitive would happily blow up on binary later
  // but explicit refusal early is friendlier.
  if (!statSync(absPath).isFile()) {
    stderr.write(`neuma edit: not a regular file: ${absPath}\n`);
    process.exit(1);
  }

  const preEditContent = readFileSync(absPath, 'utf8');

  let result;
  try {
    result = applyEdit({
      content: preEditContent,
      oldString: argv.old,
      newString: argv.new,
      replaceAll: argv['replace-all'],
    });
  } catch (err) {
    stderr.write(`neuma edit: ${err.message}\n`);
    process.exit(1);
  }

  const { nextContent, occurrences, lineEnding, hadBOM } = result;

  if (argv['dry-run']) {
    stdout.write(
      `neuma edit --dry-run: would replace ${occurrences} occurrence(s) in ${argv.path} `
      + `(line endings: ${formatLineEnding(lineEnding)}, BOM: ${hadBOM ? 'yes' : 'no'}). `
      + 'Run without --dry-run to apply.\n',
    );
    return;
  }

  // Stale-content check — re-read immediately before write. If the file
  // changed under us between the initial read and now, abort to avoid
  // overwriting whatever the other writer did. There's still a microscopic
  // TOCTOU between this re-read and the writeFileSync; acceptable for a
  // single-operator CLI tool.
  const staleCheck = readFileSync(absPath, 'utf8');
  if (staleCheck !== preEditContent) {
    stderr.write(
      `neuma edit: file changed between read and write — aborting to avoid data loss: ${absPath}\n`,
    );
    process.exit(1);
  }

  const projectRoot = findProjectRoot(cwd);
  const snapshotPath = writeEditSnapshot(projectRoot, absPath, preEditContent);
  writeFileSync(absPath, nextContent);
  stdout.write(
    `neuma edit: replaced ${occurrences} occurrence(s) in ${argv.path} `
    + `(line endings: ${formatLineEnding(lineEnding)}, BOM: ${hadBOM ? 'yes' : 'no'}). `
    + `Snapshot: ${snapshotPath}. Run 'neuma edit --undo' to revert.\n`,
  );
};

/**
 * Register the edit subcommand against a yargs builder. Returns the builder
 * for chaining. Accepts an optional { stdout, stderr } sink override so the
 * command is unit-testable without touching real process streams.
 */
export const registerEditCommand = (cli, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  cli.command(
    'edit [path]',
    'edit a file with exact-match replacement (use --undo to revert the last edit)',
    (y) => y
      .positional('path', { describe: 'file to edit (omit when using --undo)', type: 'string' })
      .option('old', { describe: 'string to find (exact match)', type: 'string' })
      .option('new', { describe: 'string to replace with', type: 'string' })
      .option('replace-all', { describe: 'replace ALL occurrences (default: only one)', type: 'boolean', default: false })
      .option('dry-run', { describe: 'preview without writing', type: 'boolean', default: false })
      .option('undo', { describe: 'revert the last edit (no path required)', type: 'boolean', default: false }),
    (argv) => {
      const cwd = process.cwd();
      if (argv.undo) {
        runUndo({ cwd, stdout, stderr });
        return;
      }
      runEdit({ cwd, stdout, stderr, argv });
    },
  );
