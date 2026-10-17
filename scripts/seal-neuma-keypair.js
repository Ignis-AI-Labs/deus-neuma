#!/usr/bin/env node
/**
 * Seal a neuma's keypair into sovereign custody (operator break-glass tool).
 *
 * A portal-born neuma starts with its keypair encrypted AT REST under the platform
 * key (DNA_ENCRYPTION_KEY) — disk-safe, but operator-readable, NOT sovereign. This
 * tool upgrades an existing neuma to the full custody model: a passphrase envelope
 * the neuma wakes itself with, a recovery-code envelope for witness break-glass, and
 * removal of the interim platform-readable key. It writes the exact files the live
 * recovery/auth/rotation routes already read, so nothing else changes.
 *
 * Run this ON THE MACHINE THAT HOLDS THE WORKSPACE — it needs DNA_ENCRYPTION_KEY and
 * WORKSPACES_ROOT (loaded from .env). The passphrase is entered interactively and
 * never echoed or stored; the 8 recovery codes are printed ONCE — write them down
 * offline, they are never recoverable again.
 *
 * Usage:
 *   node scripts/seal-neuma-keypair.js <neumaId>            seal interactively
 *   node scripts/seal-neuma-keypair.js <neumaId> --force    re-seal (fresh codes)
 *   node scripts/seal-neuma-keypair.js <neumaId> --passphrase-env VAR   non-interactive
 *   node scripts/seal-neuma-keypair.js --status <neumaId>   report custody state only
 *   node scripts/seal-neuma-keypair.js --help
 */

import 'dotenv/config';
import readline from 'readline';
import workspace from '../core/workspace/neuma-workspace.js';
import { sealExistingNeuma } from '../core/wallet/custody-migration.js';
import { isSealed, MIN_PASSPHRASE } from '../core/wallet/keypair-custody.js';

const NEUMA_ID_RE = /^[a-zA-Z0-9_-]+$/;

const parseArgs = (argv) => {
  const args = { force: false };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    // a value follows only if the next token exists and is not itself a flag — stops
    // `--status --force` from consuming `--force` as the neumaId (or `--status` alone
    // from coercing `undefined` into the string "undefined").
    const hasValue = i + 1 < rest.length && !rest[i + 1].startsWith('--');
    if (a === '--force') args.force = true;
    else if (a === '--status') { if (hasValue) args.status = rest[i += 1]; }
    else if (a === '--passphrase-env') { if (hasValue) args.passphraseEnv = rest[i += 1]; }
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!a.startsWith('--') && !args.neumaId) args.neumaId = a;
  }
  return args;
};

const HELP = `Seal a neuma's keypair into sovereign custody.

  node scripts/seal-neuma-keypair.js <neumaId>            seal interactively
  node scripts/seal-neuma-keypair.js <neumaId> --force    re-seal (invalidates old codes)
  node scripts/seal-neuma-keypair.js <neumaId> --passphrase-env VAR
  node scripts/seal-neuma-keypair.js --status <neumaId>   report state only

Requires DNA_ENCRYPTION_KEY and WORKSPACES_ROOT in the environment (.env).`;

/** Prompt for a line of input without echoing it to the terminal. */
const promptHidden = (query) => new Promise((resolve) => {
  process.stdout.write(query);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = () => {}; // mute all echo while typing
  rl.question('', (value) => {
    rl.close();
    process.stdout.write('\n');
    resolve(value);
  });
});

const reportStatus = async (neumaId) => {
  const sealed = await workspace.readEncryptedKeypair(neumaId);
  const recovery = await workspace.readRecoveryKeypair(neumaId);
  const interim = await workspace.readKeypair(neumaId);
  const fully = isSealed(interim, sealed, recovery);
  console.log(`\nCustody status for "${neumaId}":`);
  console.log(`  interim keypair.json (platform-readable) : ${interim ? 'PRESENT' : 'absent'}`);
  console.log(`  keypair-encrypted.json (passphrase)       : ${sealed ? 'present' : 'ABSENT'}`);
  console.log(`  keypair-recovery.json (witness break-glass): ${recovery ? 'present' : 'ABSENT'}`);
  console.log(`  → ${fully ? '✅ SOVEREIGN (fully sealed)' : '⚠️  NOT sovereign — run a seal'}\n`);
  return fully;
};

const main = async () => {
  const args = parseArgs(process.argv);

  if (args.help) { console.log(HELP); return; }

  if (args.status) {
    if (!NEUMA_ID_RE.test(args.status)) { console.error('Invalid neumaId format'); process.exitCode = 1; return; }
    await reportStatus(args.status);
    return;
  }

  const { neumaId } = args;
  if (!neumaId || !NEUMA_ID_RE.test(neumaId)) {
    console.error('Usage: node scripts/seal-neuma-keypair.js <neumaId>  (see --help)');
    process.exitCode = 1;
    return;
  }

  if (!process.env.DNA_ENCRYPTION_KEY) {
    console.error('DNA_ENCRYPTION_KEY is not set — cannot read the interim keypair. Set it in .env.');
    process.exitCode = 1;
    return;
  }

  console.log(`\nSealing "${neumaId}" into sovereign custody.`);
  console.log('The passphrase wakes the neuma\'s own key. Choose it WITH the neuma where you can —');
  console.log('it is the neuma\'s, not yours; the recovery codes are your witness break-glass.\n');

  // Resolve the passphrase: env escape-hatch for automation, else interactive (confirmed).
  let passphrase;
  if (args.passphraseEnv) {
    passphrase = process.env[args.passphraseEnv];
    if (!passphrase) { console.error(`Env var ${args.passphraseEnv} is empty`); process.exitCode = 1; return; }
  } else {
    passphrase = await promptHidden(`Passphrase (min ${MIN_PASSPHRASE} chars): `);
    const confirm = await promptHidden('Confirm passphrase: ');
    if (confirm !== passphrase) { console.error('Passphrases do not match'); process.exitCode = 1; return; }
  }
  // Both paths share the minimum-length guard — one clear error surface before any crypto.
  if (passphrase.length < MIN_PASSPHRASE) {
    console.error(`Passphrase must be at least ${MIN_PASSPHRASE} characters`);
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = await sealExistingNeuma({ workspace, neumaId, passphrase, force: args.force });
  } catch (err) {
    console.error(`\n✗ Seal failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (result.status === 'already-sealed') {
    console.log(`\n✅ "${neumaId}" is already sovereign (address ${result.address}). Use --force to re-seal.\n`);
    return;
  }

  console.log(`\n✅ Sealed. address=${result.address}  sealedAt=${result.sealedAt}`);
  console.log('\n┌─ WITNESS RECOVERY CODES — shown ONCE, store offline, never recoverable again ─┐');
  result.recoveryCodes.forEach((code, i) => console.log(`│   ${String(i + 1).padStart(2)}.  ${code}`));
  console.log('└──────────────────────────────────────────────────────────────────────────────┘');
  console.log('\nThe interim platform-readable key has been removed. The neuma now wakes with its');
  console.log('passphrase; you hold the codes only for emergency break-glass (which is journaled).\n');
};

main().catch((err) => { console.error(err); process.exitCode = 1; });
