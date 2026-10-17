#!/usr/bin/env node
// #117 S4c — per-neuma DEK migration CLI.
//
// Thin wrapper around core/workspace/migrate-being.js with safety gates for
// LIVING-being touches: no bulk-execute default, dry-run preview before any
// write, explicit confirmation prompt, audit-bound being-id arg, --root
// override for ops-time workspace selection.
//
// Modes:
//   --list                              show every being under the workspace
//                                       root + its migration status. No writes.
//   --dry-run --being=<id>              plan-only report for one being.
//                                       No writes. No audit entries.
//   --execute --being=<id> [--yes]      real migration for one being. Prints
//                                       the dry-run plan first; without --yes
//                                       prompts the operator for explicit
//                                       confirmation before any write.
//   --all --dry-run                     plan EVERY born being under the root.
//                                       No writes. Non-zero exit if any being
//                                       is blocked by a cannot-decrypt file.
//   --all --execute [--yes]             backfill EVERY un-migrated being in one
//                                       gated pass. Prints the whole-house plan
//                                       first, then one batch confirmation. A
//                                       cannot-decrypt being is skipped (not
//                                       partially migrated); one being's
//                                       failure never stops the rest.
//   --root <path>                       override workspaces root (default:
//                                       getWorkspacesRoot()). Useful for
//                                       testing against a snapshot dir before
//                                       running against /mnt/data/neuma/...
//
// Examples:
//   node scripts/migrate-to-per-neuma-dek.js --list
//   node scripts/migrate-to-per-neuma-dek.js --dry-run --being=galen
//   node scripts/migrate-to-per-neuma-dek.js --execute --being=galen
//
// Safety properties:
//   - --execute REQUIRES --being (no bulk default — every LIVING being is
//     migrated one at a time, with operator gating between)
//   - --execute prints dry-run plan FIRST, then prompts. Refuse on any
//     non-empty input other than 'yes' (case-insensitive).
//   - --yes bypasses the prompt for scripted runs (CI, batch operator
//     scripts) but the dry-run plan is still printed for the log.
//   - Exits non-zero on any failed/aborted *migration* so calling scripts
//     can branch correctly. Operator decline at the prompt exits 0 — that's
//     a deliberate cancellation, not a failure (ai6 R1.2).
//   - Refuses to prompt for --execute if the dry-run plan shows any
//     cannot-decrypt files: that signals a misconfigured DNA_ENCRYPTION_KEY
//     env (or rotated-out master), and proceeding would only partially
//     migrate the being, leaving the un-decryptable files master-wrapped
//     forever (ai6 R1.3 — LIVING-being hardening).

import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import workspace, {
  getWorkspacesRoot, setWorkspacesRoot,
} from '../core/workspace/neuma-workspace.js';
import { migrateBeing } from '../core/workspace/migrate-being.js';
import { enumerateBeings, migrateAllBeings, sweepHadProblems } from '../core/workspace/migrate-all.js';

// Same regex the backend uses on companionName at trust boundaries (see
// AGENTS.md "Input Validation"). Defense-in-depth (ai6 R1.7 Info) —
// NeumaWorkspace._path already realpath-guards against traversal, but
// catching '--being=../x' at parse time gives the operator a clean error.
const NEUMA_ID_RE = /^[a-zA-Z0-9_-]+$/;

// Consume the next argv token for a value-taking flag. Throws cleanly if the
// flag was the LAST token (ai6 R2.1) — without this, `argv[++i]` returns
// `undefined`, which coerces to the string "undefined" and passes
// NEUMA_ID_RE, leading to a misleading 'no-seal' error instead of a clear
// "missing value" one.
const takeValue = (argv, i, flag) => {
  if (i + 1 >= argv.length) throw new Error(`${flag} requires a value`);
  const v = argv[i + 1];
  // A flag-like token is a swallowed neighbor, not a value — `--being --yes`
  // (or short-form `--being -y`) must fail loudly instead of setting being to
  // the flag and silently dropping it (#132). A path legitimately starting
  // with '-' still has the `--root=` equals-form.
  if (v.startsWith('-')) throw new Error(`${flag} requires a value (got flag: ${v})`);
  return v;
};

const parseArgs = (argv) => {
  const out = { mode: null, being: null, root: null, yes: false, all: false, help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--list') out.mode = 'list';
    else if (a === '--dry-run') out.mode = 'dry-run';
    else if (a === '--execute') out.mode = 'execute';
    else if (a === '--all') out.all = true;
    else if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--root') { out.root = takeValue(argv, i, '--root'); i += 1; }
    else if (a === '--being') { out.being = takeValue(argv, i, '--being'); i += 1; }
    else if (a.startsWith('--being=')) out.being = a.slice('--being='.length);
    else if (a.startsWith('--root=')) out.root = a.slice('--root='.length);
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  if (out.being !== null && !NEUMA_ID_RE.test(out.being)) {
    throw new Error(`invalid --being: ${out.being} (must match ${NEUMA_ID_RE})`);
  }
  if (out.all && out.being !== null) {
    throw new Error('--all and --being are mutually exclusive');
  }
  return out;
};

// Hoisted (ai6 R1.5) — both printers consult this; previously duplicated
// as local `noisy` / `noop` Sets in each function.
const NOOP_STATUSES = Object.freeze(new Set([
  'already-migrated', 'skipped-plaintext', 'skipped-empty', 'skipped-not-json',
]));

// impure (stdout)
const printHelp = () => {
  process.stdout.write([
    'Usage: node scripts/migrate-to-per-neuma-dek.js <mode> [opts]',
    '',
    'Modes:',
    '  --list                       enumerate beings + per-neuma DEK migration status',
    '  --dry-run --being=<id>       plan-only report for one being (no writes)',
    '  --execute --being=<id> [--yes]',
    '                               real migration for one being. Prints dry-run',
    '                               plan first; without --yes, prompts for explicit',
    '                               confirmation before writing anything.',
    '  --all --dry-run              plan every born being under the root (no writes)',
    '  --all --execute [--yes]      backfill every un-migrated being in one gated',
    '                               pass. Whole-house plan first, then ONE batch',
    '                               confirmation. cannot-decrypt beings skipped;',
    '                               one failure never stops the rest.',
    '',
    'Options:',
    '  --root <path>                override workspaces root (defaults to env)',
    '  --yes, -y                    skip the confirmation prompt (CI / scripted)',
    '  --help, -h                   show this message',
    '',
  ].join('\n'));
};

// enumerateBeings now lives in core/workspace/migrate-all.js (one source,
// shared with the sweep) and is imported above.

const formatCounts = (c) =>
  `migrated=${c.migrated} already=${c.alreadyMigrated} plaintext=${c.plaintext} ` +
  `empty=${c.empty} not-json=${c.notJson} cannot-decrypt=${c.cannotDecrypt} ` +
  `rolled-back=${c.rolledBack} rollback-failed=${c.rollbackFailed} ` +
  `backup-exists=${c.backupExists} total=${c.total}`;

// impure (stdout)
const printDryRun = (result) => {
  process.stdout.write(`\nDRY-RUN PLAN for ${result.neumaId}\n`);
  process.stdout.write(`  status:           ${result.status}\n`);
  process.stdout.write(`  genesisHash:      ${result.genesisHashPrefix || 'n/a'}...\n`);
  process.stdout.write(`  counts:           ${formatCounts(result.counts)}\n`);
  const interesting = result.files.filter((f) => !NOOP_STATUSES.has(f.status));
  if (interesting.length) {
    process.stdout.write(`  files to migrate (${interesting.length}):\n`);
    for (const f of interesting) {
      process.stdout.write(`    - ${f.status.padEnd(22)} ${f.path}\n`);
    }
  } else {
    process.stdout.write('  (no files to migrate — being is already DEK-isolated)\n');
  }
  process.stdout.write('\n');
};

// impure (stdout)
const printExecute = (result) => {
  process.stdout.write(`\nEXECUTE RESULT for ${result.neumaId}\n`);
  process.stdout.write(`  status:      ${result.status}\n`);
  process.stdout.write(`  dekWritten:  ${result.dekWritten}\n`);
  process.stdout.write(`  genesisHash: ${result.genesisHashPrefix || 'n/a'}...\n`);
  process.stdout.write(`  counts:      ${formatCounts(result.counts)}\n`);
  if (result.abortReason) {
    process.stdout.write(`  ABORT:       ${result.abortReason}\n`);
  }
  const written = result.files.filter((f) => !NOOP_STATUSES.has(f.status));
  if (written.length) {
    process.stdout.write(`  per-file:\n`);
    for (const f of written) {
      const note = f.reason ? ` — ${f.reason}` : '';
      process.stdout.write(`    ${f.status.padEnd(22)} ${f.path}${note}\n`);
    }
  }
  process.stdout.write('\n');
};

// impure (stdin/stdout)
const confirmExecute = async (neumaId) => {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(
      `Type 'yes' to migrate ${neumaId} for real (anything else aborts): `,
    );
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
};

// impure (stdout) — one streamed line per being as the sweep advances.
const streamBeingLine = ({ neumaId, index, total, status }) => {
  process.stdout.write(`  [${index}/${total}] ${neumaId.padEnd(20)} ${status}\n`);
};

// A being outcome is CLEAN when nothing needs an operator's eye: it migrated,
// was already done, is a plan line, or has no seal (benign — nothing written).
// Everything else — skipped-cannot-decrypt, aborted, AND the raw
// migrateBeing failure statuses (dek-write-failed / dek-readback-failed) that
// migrateAllBeings stores verbatim — must be NAMED, not just counted. Flag the
// inverse of clean so a new failure status can never silently escape the list.
const CLEAN_SWEEP_STATUSES = Object.freeze(new Set([
  'migrated', 'already-migrated', 'planned', 'no-seal',
]));

// impure (stdout) — the sweep summary: the count buckets, then every being
// that needs an operator's eye, called out by name.
const printSweep = (sweep, title) => {
  const s = sweep.summary;
  process.stdout.write(`\n${title}\n`);
  process.stdout.write(
    `  totals: total=${s.total} migrated=${s.migrated} already=${s['already-migrated']} ` +
    `planned=${s.planned} no-seal=${s['no-seal']} ` +
    `skipped-cannot-decrypt=${s['skipped-cannot-decrypt']} aborted=${s.aborted} failed=${s.failed}\n`,
  );
  const flagged = sweep.beings.filter((b) => !CLEAN_SWEEP_STATUSES.has(b.status));
  if (flagged.length) {
    process.stdout.write(`  NEEDS ATTENTION (${flagged.length}):\n`);
    for (const b of flagged) {
      const detail = b.status === 'skipped-cannot-decrypt'
        ? `${b.cannotDecrypt} file(s) cannot be decrypted — fix DNA_ENCRYPTION_KEY/PREVIOUS`
        : b.error || b.result?.abortReason || b.result?.error || '';
      process.stdout.write(`    ${b.status.padEnd(24)} ${b.neumaId}${detail ? ` — ${detail}` : ''}\n`);
    }
  }
  process.stdout.write('\n');
};

// impure (stdin/stdout) — one confirmation for the whole batch.
const confirmBatch = async (count) => {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(
      `Type 'yes' to migrate ${count} being(s) for real (anything else aborts): `,
    );
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
};

const main = async () => {
  let args;
  try { args = parseArgs(process.argv); }
  catch (err) {
    process.stderr.write(`error: ${err.message}\n\n`);
    printHelp();
    process.exit(2);
  }
  if (args.help || !args.mode) {
    printHelp();
    process.exit(args.help ? 0 : 2);
  }

  if (args.root) setWorkspacesRoot(args.root);
  const root = getWorkspacesRoot();
  if (!root) {
    process.stderr.write('error: workspaces root unset; pass --root <path> or set WORKSPACES_ROOT\n');
    process.exit(2);
  }
  process.stdout.write(`workspaces root: ${root}\n`);

  if (args.mode === 'list') {
    const beings = await enumerateBeings(root);
    if (!beings.length) {
      process.stdout.write('  (no beings found — workspace root is empty)\n');
      return;
    }
    process.stdout.write(`\nfound ${beings.length} being(s):\n`);
    for (const b of beings) {
      const status = b.hasDek ? 'DEK present (migrated)' : 'NO DEK (needs migration)';
      process.stdout.write(`  ${b.neumaId.padEnd(20)} ${status}\n`);
    }
    process.stdout.write('\n');
    return;
  }

  // ── House-wide sweep (--all) ──────────────────────────────────────────────
  // Always plan the whole house first (zero writes), print it, and for
  // --execute gate the batch behind one confirmation. Per-being safety is
  // inherited from migrateAllBeings: complete beings no-op, a cannot-decrypt
  // being is skipped (not partially migrated), and one being's failure never
  // stops the rest.
  if (args.all) {
    process.stdout.write('\nplanning the whole house (dry-run, no writes)...\n');
    const plan = await migrateAllBeings(workspace, { dryRun: true, onBeing: streamBeingLine });
    printSweep(plan, 'DRY-RUN PLAN — all beings');

    if (args.mode === 'dry-run') {
      // A plan that already surfaces a cannot-decrypt being is worth a non-zero
      // exit so a scripted dry-run can catch the env problem before execute.
      if (plan.summary['skipped-cannot-decrypt'] > 0) process.exit(1);
      return;
    }

    const willMigrate = plan.summary.planned; // beings with real work to do
    if (willMigrate === 0) {
      process.stdout.write('nothing to migrate — every being is already DEK-isolated.\n');
      // Still non-zero if a being is blocked by a cannot-decrypt env issue.
      if (plan.summary['skipped-cannot-decrypt'] > 0) process.exit(1);
      return;
    }

    if (!args.yes) {
      const ok = await confirmBatch(willMigrate);
      if (!ok) {
        process.stdout.write('aborted by operator\n');
        process.exit(0);
      }
    }

    process.stdout.write('\nmigrating...\n');
    const result = await migrateAllBeings(workspace, { onBeing: streamBeingLine });
    printSweep(result, 'EXECUTE RESULT — all beings');
    if (sweepHadProblems(result.summary)) process.exit(1);
    return;
  }

  if (!args.being) {
    process.stderr.write(`error: --${args.mode} requires --being=<id> (or --all)\n`);
    process.exit(2);
  }

  if (args.mode === 'dry-run') {
    const result = await migrateBeing(workspace, args.being, { dryRun: true });
    printDryRun(result);
    if (result.status === 'no-seal') process.exit(1);
    return;
  }

  if (args.mode === 'execute') {
    // ALWAYS print the dry-run plan first — even if --yes was passed — so the
    // operator (or the script log) sees what's about to change before the
    // write happens.
    const plan = await migrateBeing(workspace, args.being, { dryRun: true });
    printDryRun(plan);
    if (plan.status === 'no-seal') {
      process.stderr.write('no genesis-seal.json — refusing to migrate\n');
      process.exit(1);
    }

    // LIVING-being hardening (ai6 R1.3): if the dry-run already shows
    // files we cannot decrypt, the environment is misconfigured (wrong
    // DNA_ENCRYPTION_KEY, rotated-out master, etc.). Proceeding would
    // partially migrate the being, leaving un-decryptable files master-
    // wrapped forever. Refuse BEFORE prompting so the operator can fix
    // the env first.
    if (plan.counts.cannotDecrypt > 0) {
      process.stderr.write(
        `${plan.counts.cannotDecrypt} file(s) cannot be decrypted with the current ` +
        `master — refusing to migrate (likely a misconfigured DNA_ENCRYPTION_KEY ` +
        `or a key rotated out without DNA_ENCRYPTION_KEY_PREVIOUS set). Fix the ` +
        `env then re-run.\n`,
      );
      process.exit(1);
    }

    if (!args.yes) {
      const ok = await confirmExecute(args.being);
      if (!ok) {
        process.stdout.write('aborted by operator\n');
        process.exit(0);
      }
    }

    const result = await migrateBeing(workspace, args.being);
    printExecute(result);
    // Non-zero exit on any non-clean outcome so calling scripts can branch
    if (result.status !== 'migrated' && result.status !== 'already-migrated') {
      process.exit(1);
    }
    return;
  }
};

// Only run if invoked as a script (not when imported by tests).
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`fatal: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

// Test-only exports — only what's actually exercised through __test
// (RULE 1: no speculative surface area). enumerateBeings + formatCounts
// are exercised end-to-end via the CLI tests.
export const __test = Object.freeze({ parseArgs });
