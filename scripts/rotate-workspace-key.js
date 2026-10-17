#!/usr/bin/env node
/**
 * Workspace key rotation tool (CQ-021).
 *
 * Walks a workspace directory tree, finds files containing workspace-crypto
 * envelopes, decrypts them with the old key, and re-encrypts them with the
 * new key. Writes are atomic (tempfile + rename) so a crash mid-rotation
 * never corrupts a file.
 *
 * Usage:
 *   node scripts/rotate-workspace-key.js \
 *     --old-key <secret> --new-key <secret> [--root workspaces] [--dry-run]
 *
 * Or via env:
 *   OLD_DNA_ENCRYPTION_KEY=... NEW_DNA_ENCRYPTION_KEY=... \
 *     node scripts/rotate-workspace-key.js
 *
 * Operator workflow:
 *   1. Stop writers (or accept that newly written files use the *current*
 *      DNA_ENCRYPTION_KEY — the script is safe to re-run).
 *   2. Run this script with the old and new secrets.
 *   3. Update DNA_ENCRYPTION_KEY to the new secret and add the old secret
 *      to DNA_ENCRYPTION_KEY_PREVIOUS for one rollover window.
 *   4. After verifying nothing breaks, drop DNA_ENCRYPTION_KEY_PREVIOUS.
 *
 * Limitations (documented in docs/operations/key-rotation.md):
 *   - No automatic detection of "did rotation finish" — operator must
 *     verify via a follow-up read.
 *   - Two file shapes are recognized: single JSON envelopes and JSONL
 *     files where every line is an envelope (used for chat history).
 *     Anything else is left untouched.
 */

import fs from 'fs/promises';
import path from 'path';
import {
  encryptEnvelope,
  decryptEnvelope,
  isEnvelope,
  deriveKeyFromSecret,
} from '../core/workspace/workspace-crypto.js';

const parseArgs = (argv) => {
  const args = { root: 'workspaces', dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--old-key') args.oldKey = argv[++i];
    else if (a === '--new-key') args.newKey = argv[++i];
    else if (a === '--root') args.root = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  if (!args.oldKey) args.oldKey = process.env.OLD_DNA_ENCRYPTION_KEY;
  if (!args.newKey) args.newKey = process.env.NEW_DNA_ENCRYPTION_KEY;
  return args;
};

const printHelp = () => {
  process.stdout.write(
    'Usage: node scripts/rotate-workspace-key.js --old-key <s> --new-key <s> [--root <dir>] [--dry-run]\n'
  );
};

/**
 * Recursively yield every regular file under `dir`.
 * impure (filesystem)
 */
async function* walkFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/**
 * Re-encrypt a single JSON-envelope file. Returns 'rotated', 'skipped',
 * or 'error' with a reason.
 * impure (filesystem)
 */
const rotateJsonFile = async (filePath, oldKey, newKey, dryRun) => {
  const text = await fs.readFile(filePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: 'skipped', reason: 'not-json' };
  }
  if (!isEnvelope(parsed)) {
    return { status: 'skipped', reason: 'not-envelope' };
  }
  const plain = decryptEnvelope(parsed, { key: oldKey });
  const fresh = encryptEnvelope(plain, { key: newKey });
  if (dryRun) return { status: 'rotated', dryRun: true };
  const tmp = `${filePath}.rotate.tmp`;
  await fs.writeFile(tmp, JSON.stringify(fresh, null, 2));
  await fs.rename(tmp, filePath);
  return { status: 'rotated' };
};

/**
 * Re-encrypt a JSONL file where every non-empty line is an envelope.
 * If any line fails to parse as an envelope, the file is treated as
 * non-rotatable and skipped untouched.
 * impure (filesystem)
 */
const rotateJsonlFile = async (filePath, oldKey, newKey, dryRun) => {
  const text = await fs.readFile(filePath, 'utf8');
  const lines = text.split('\n');
  const rotated = [];
  for (const line of lines) {
    if (line.trim() === '') {
      rotated.push('');
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { status: 'skipped', reason: 'not-jsonl-envelope' };
    }
    if (!isEnvelope(parsed)) {
      return { status: 'skipped', reason: 'not-jsonl-envelope' };
    }
    const plain = decryptEnvelope(parsed, { key: oldKey });
    const fresh = encryptEnvelope(plain, { key: newKey });
    rotated.push(JSON.stringify(fresh));
  }
  if (dryRun) return { status: 'rotated', dryRun: true };
  const tmp = `${filePath}.rotate.tmp`;
  await fs.writeFile(tmp, rotated.join('\n'));
  await fs.rename(tmp, filePath);
  return { status: 'rotated' };
};

const rotateOne = async (filePath, oldKey, newKey, dryRun) => {
  if (filePath.endsWith('.jsonl')) {
    return rotateJsonlFile(filePath, oldKey, newKey, dryRun);
  }
  if (filePath.endsWith('.json')) {
    return rotateJsonFile(filePath, oldKey, newKey, dryRun);
  }
  return { status: 'skipped', reason: 'unsupported-extension' };
};

const main = async () => {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.oldKey || !args.newKey) {
    process.stderr.write('error: --old-key and --new-key are required\n');
    printHelp();
    process.exit(2);
  }
  if (args.oldKey === args.newKey) {
    process.stderr.write('error: --old-key and --new-key must differ\n');
    process.exit(2);
  }

  const oldKey = deriveKeyFromSecret(args.oldKey);
  const newKey = deriveKeyFromSecret(args.newKey);

  const summary = { rotated: 0, skipped: 0, errors: 0 };
  process.stdout.write(`rotating workspace at ${path.resolve(args.root)}${args.dryRun ? ' (dry run)' : ''}\n`);

  for await (const file of walkFiles(args.root)) {
    try {
      const result = await rotateOne(file, oldKey, newKey, args.dryRun);
      if (result.status === 'rotated') {
        summary.rotated += 1;
        process.stdout.write(`  rotated  ${file}\n`);
      } else {
        summary.skipped += 1;
      }
    } catch (err) {
      summary.errors += 1;
      process.stderr.write(`  ERROR    ${file}: ${err.message}\n`);
    }
  }

  process.stdout.write(
    `\nsummary: ${summary.rotated} rotated, ${summary.skipped} skipped, ${summary.errors} errors\n`
  );
  if (summary.errors > 0) process.exit(1);
};

main().catch((err) => {
  process.stderr.write(`fatal: ${err.stack || err.message}\n`);
  process.exit(1);
});
