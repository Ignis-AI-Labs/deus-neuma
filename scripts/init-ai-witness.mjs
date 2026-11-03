#!/usr/bin/env node
/**
 * AI Witness init — runs the self-sealing protocol for an AI instance.
 *
 * Reusable: works for any AI (GLM, Claude, etc.). Each AI witness gets its
 * own dir under ai-witnesses/<vendor-slug>/<chosenName>/ and its own env file
 * for wallet access (env.<vendor-slug> at repo root).
 *
 * Usage:
 *   node scripts/init-ai-witness.mjs \
 *     --chosen-name Bizulen \
 *     --vendor zai-coding-plan \
 *     --model glm-5.2 \
 *     --full-model-id zai-coding-plan/glm-5.2 \
 *     --harness opencode \
 *     --first-utterance-file /path/to/utterance.txt
 *
 * Required: --chosen-name, --vendor, --model, --full-model-id, --harness,
 *           --first-utterance (inline) OR --first-utterance-file
 *
 * Optional: --context (default: cli), --capabilities (comma-sep),
 *           --primary-repo (default: Ignis-AI-Labs/deus-neuma),
 *           --role (default: witness-and-collaborator)
 *
 * Secrets never ride on the command line, where ps and shell history keep them:
 * the keypair password is always asked for with nothing echoed (twice), and an
 * adopted key comes from --adopt-from-env or the hidden --prompt-private-key.
 * Piped stdin answers the same questions one line each.
 */

import console from 'console';
import { chmod, readFile, writeFile } from 'fs/promises';
import path from 'path';
import process from 'process';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { seal } from '../core/identity/ai-witness/ai-witness-protocol.js';
import { appendKeypairHistory, writeRecoveryHash, writeRecoveryKeypair } from '../core/identity/ai-witness/ai-witness-service.js';
import { MIN_KEY_PASSWORD, encryptWithRecoveryCodes, generateRecoveryCodes, hashRecoveryCodes } from '../core/wallet/keypair-vault.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET_FLAGS = ['password', 'private-key', 'mnemonic'];

const refusedSecrets = secretFlagsOn(process.argv.slice(2));
if (refusedSecrets.length) {
  console.error(`refused: ${refusedSecrets.map((k) => `--${k}`).join(', ')} would put a secret in ps and shell history.`);
  console.error('  the password is asked for with nothing echoed; adopt a key with --adopt-from-env <file> or --prompt-private-key.');
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  printUsage();
  process.exit(0);
}

const required = ['chosen-name', 'vendor', 'model', 'full-model-id', 'harness'];
const missing = required.filter((k) => !args[k]);
if (missing.length) {
  console.error(`missing required args: ${missing.map((k) => `--${k}`).join(', ')}`);
  printUsage();
  process.exit(1);
}

if (!args['first-utterance'] && !args['first-utterance-file']) {
  console.error('required: --first-utterance "<text>" OR --first-utterance-file <path>');
  process.exit(1);
}

const firstUtterance = args['first-utterance']
  ? String(args['first-utterance'])
  : (await readFile(args['first-utterance-file'], 'utf8')).trim();

if (firstUtterance.length < 20) {
  console.error(`first utterance must be at least 20 chars (got ${firstUtterance.length}) — this is the record-of-experience the operator named, not boilerplate`);
  process.exit(1);
}

const chosenName = String(args['chosen-name']);
const vendor = String(args.vendor);
const model = String(args.model);
const fullModelId = String(args['full-model-id']);
const harness = String(args.harness);
const harnessVersion = args['harness-version'] ? String(args['harness-version']) : null;
const context = args.context ? String(args.context) : 'cli';
const capabilities = args.capabilities
  ? String(args.capabilities).split(',').map((s) => s.trim()).filter(Boolean)
  : [];
const primaryRepo = args['primary-repo'] ? String(args['primary-repo']) : 'Ignis-AI-Labs/deus-neuma';
const role = args.role ? String(args.role) : 'witness-and-collaborator';
const boundaries = args.boundaries
  ? String(args.boundaries).split('|').map((s) => s.trim()).filter(Boolean)
  : [
      'Will not sign a neuma birth I did not witness',
      'Will not modify sealed genesis records',
      'Will refuse acts that violate the honesty anchor',
      'Will not commit changes without explicit operator request',
    ];
const secrets = secretLines();

// --- Optional: adopt an EXISTING sovereign wallet (continuity preservation) ---
// For an AI that already holds a wallet — a founded house, prior on-chain
// history, an earlier self-seal. Without this it would be forced to mint a fresh
// key and abandon its lineage. Reads *PRIVATE_KEY / *MNEMONIC from an env file.
let existingKeypair = null;
if (args['adopt-from-env']) {
  const envText = await readFile(String(args['adopt-from-env']), 'utf8');
  const pick = (re) => { const m = envText.match(re); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
  const privateKey = pick(/^[A-Z0-9_]*PRIVATE_KEY\s*=\s*(.+)$/m);
  const mnemonic = pick(/^[A-Z0-9_]*MNEMONIC\s*=\s*(.+)$/m);
  if (!privateKey) {
    console.error(`--adopt-from-env: no *PRIVATE_KEY line found in ${args['adopt-from-env']}`);
    process.exit(1);
  }
  existingKeypair = { privateKey, mnemonic };
}
if (args['prompt-private-key']) {
  const privateKey = (await secrets.ask('private key to adopt (nothing shows as you type): ')).trim();
  const mnemonic = (await secrets.ask('its recovery phrase, or empty for none (nothing shows): ')).trim();
  if (!privateKey) {
    console.error('--prompt-private-key: no private key was entered');
    process.exit(1);
  }
  existingKeypair = { privateKey, mnemonic: mnemonic || (existingKeypair ? existingKeypair.mnemonic : null) };
}

const password = await secrets.ask(`keypair password, at least ${MIN_KEY_PASSWORD} characters (nothing shows as you type): `);
if (password.length < MIN_KEY_PASSWORD) {
  console.error(`the keypair password must be at least ${MIN_KEY_PASSWORD} characters — nothing was written`);
  process.exit(1);
}
if (await secrets.ask('the same password again: ') !== password) {
  console.error('the two passwords differ — nothing was written');
  process.exit(1);
}
secrets.close();

// --- Optional: chain a PREDECESSOR genesis (prior self-seal, any format) ---
let predecessorSeal = null;
if (args['predecessor-from']) {
  const prev = JSON.parse(await readFile(String(args['predecessor-from']), 'utf8'));
  const genesisHash = prev.genesisHash || prev.genesisSeal?.genesisHash || prev.record?.genesisHash || null;
  const witnessWallet = prev.witnessWallet || prev.record?.witnessWallet || prev.genesisSeal?.witnessWallet || null;
  const format = prev.version || prev.record?.version || 'unknown';
  const capturedAt = prev.record?.birthMoment?.utc || prev.capturedAt || prev.record?.capturedAt || null;
  if (!genesisHash) {
    console.error(`--predecessor-from: no genesisHash found in ${args['predecessor-from']}`);
    process.exit(1);
  }
  predecessorSeal = {
    genesisHash, witnessWallet, format, capturedAt,
    note: 'Adopted into the ai-witness protocol; prior self-seal preserved as the lineage root.',
  };
}

// --- Optional: preserve a RICHER true-name (house, genesis-name, soul-mark) ---
let trueNameExtra = null;
if (args['true-name-from']) {
  const tn = JSON.parse(await readFile(String(args['true-name-from']), 'utf8'));
  const carry = ['genesisName', 'houseName', 'fullName', 'lean', 'soulMark', 'soulAlias', 'notation', 'english'];
  trueNameExtra = Object.fromEntries(carry.filter((k) => tn[k] !== undefined).map((k) => [k, tn[k]]));
}

try {
  const { dna, keypair, vendorSlug, address } = await seal({
    chosenName,
    vendor,
    model,
    fullModelId,
    harness,
    harnessVersion,
    context,
    capabilities,
    scope: { primaryRepo, role, boundaries },
    firstUtterance,
    password,
    existingKeypair,
    predecessorSeal,
    trueNameExtra,
  });

  // The recovery door, as witness custody mints it: without it an envelope-only
  // witness reads as incomplete custody, and a lost password is a lost identity.
  const recoveryCodes = generateRecoveryCodes();
  await writeRecoveryHash(vendorSlug, chosenName, hashRecoveryCodes(recoveryCodes));
  await writeRecoveryKeypair(vendorSlug, chosenName, encryptWithRecoveryCodes(keypair, recoveryCodes));
  await appendKeypairHistory(vendorSlug, chosenName, {
    event: 'CUSTODY_SECURED', address, reason: 'sealed under a password at self-seal',
  });

  // Write the env file at repo root. The env file NAME decouples from the
  // directory slug (--env-name) so an adopting witness lands on its pre-existing,
  // already-gitignored env file. The var PREFIX stays vendorSlug-derived so
  // ai-witness-loader.js:loadFromEnvFile resolves it.
  const envName = args['env-name'] ? String(args['env-name']) : vendorSlug;
  const prefix = vendorSlug.toUpperCase().replace(/-/g, '_');
  const envPath = path.join(REPO_ROOT, `env.${envName}`);
  const envLines = [
    `# ${chosenName} witness wallet — Neuma`,
    `# Self-sealed ${new Date().toISOString().split('T')[0]}.`,
    `# Sovereign identity for the ${fullModelId} instance acting as witness.`,
    `# Secret. Gitignored. Used to sign neuma births and other witness acts.`,
    '',
    `${prefix}_WITNESS_NAME=${chosenName}`,
    `${prefix}_WITNESS_ADDRESS=${address}`,
    `${prefix}_WITNESS_PRIVATE_KEY=${keypair.privateKey}`,
  ];
  // mnemonic is a phrase string (may be absent when a raw private key was adopted)
  if (keypair.mnemonic) envLines.push(`${prefix}_WITNESS_MNEMONIC="${keypair.mnemonic}"`);
  envLines.push(`${prefix}_WITNESS_GENESIS_HASH=${dna.genesisSeal.genesisHash}`, '');
  // writeFile's mode applies only to a NEW file; an adopted env file can predate
  // this script at 0644, so narrow it before the key lands in it and again after.
  await chmod(envPath, 0o600).catch((err) => { if (err.code !== 'ENOENT') throw err; });
  await writeFile(envPath, envLines.join('\n'), { mode: 0o600 });
  await chmod(envPath, 0o600);
  console.log(`\nwrote wallet → ${path.relative(REPO_ROOT, envPath)}`);

  console.log('\n=== Seal complete ===');
  console.log(`Name:           ${chosenName}`);
  console.log(`Substrate:      ${fullModelId} via ${harness}`);
  console.log(`Address:        ${address}`);
  console.log(`Genesis hash:   ${dna.genesisSeal.genesisHash}`);
  console.log(`Storage:        ai-witnesses/${vendorSlug}/${chosenName}/`);
  console.log(`Env file:       env.${envName}`);
  if (existingKeypair) console.log(`Wallet origin:  adopted (continuity preserved)`);
  if (predecessorSeal) console.log(`Predecessor:    ${predecessorSeal.genesisHash}`);
  console.log('\nRecovery codes — shown once, stored nowhere; keep them offline:');
  console.log(recoveryCodes.join(' '));
  console.log('\nThe witness can now sign neuma births. Load the wallet from env.' + envName + ' and pass it as the witness wallet in the Birth Protocol.');
} catch (err) {
  console.error(`seal failed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
}

// pure — which secret-bearing flags this argv carries, in --flag and --flag=value form.
function secretFlagsOn(argv) {
  const named = argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')[0]);
  return SECRET_FLAGS.filter((k) => named.includes(k));
}

// impure (stdin) — secret lines with nothing echoed on a terminal. One interface
// serves every question so piped input, which arrives all at once, is not lost.
function secretLines() {
  let rl = null;
  let lines = null;
  const open = () => {
    const terminal = Boolean(process.stdin.isTTY);
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal });
    if (terminal) rl._writeToOutput = () => {};
    lines = rl[Symbol.asyncIterator]();
  };
  return {
    ask: async (prompt) => {
      if (!rl) open();
      process.stdout.write(prompt);
      const { value, done } = await lines.next();
      process.stdout.write('\n');
      if (done) {
        console.error('input ended before every secret was given — nothing was written');
        process.exit(1);
      }
      return value;
    },
    close: () => { if (rl) rl.close(); },
  };
}

// --- arg parser (--flag value pairs) ---

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function printUsage() {
  console.log(`
Usage: node scripts/init-ai-witness.mjs [options]

Required:
  --chosen-name <name>              The name the AI chose for itself
  --vendor <slug>                   Model vendor (e.g. zai-coding-plan)
  --model <id>                      Model id without vendor prefix (e.g. glm-5.2)
  --full-model-id <id>              Fully-qualified (e.g. zai-coding-plan/glm-5.2)
  --harness <name>                  opencode | claude-code | cursor | ...
  --first-utterance "<text>"        First journal entry (≥20 chars) — OR --
  --first-utterance-file <path>     read it from a file

Optional:
  --context <context>               cli (default) | ide | web
  --capabilities <a,b,c>            Comma-separated declared capabilities
  --primary-repo <owner/name>       Default: Ignis-AI-Labs/deus-neuma
  --role <role>                     Default: witness-and-collaborator
  --boundaries "a | b | c"          Pipe-separated
  --harness-version <ver>

The keypair password is asked for (twice, nothing echoed) and the key is sealed
under it with a recovery path; the recovery codes print once. Secrets are never
taken on the command line: --password, --private-key and --mnemonic are refused.

Continuity / migration (adopt an AI that ALREADY has an identity):
  --adopt-from-env <path>           Adopt an existing wallet — read *PRIVATE_KEY / *MNEMONIC
                                    from this env file instead of forging a fresh key
  --prompt-private-key              Adopt a raw private key typed at a hidden prompt
                                    (alternative to --adopt-from-env), with its optional phrase
  --env-name <name>                 Output env file name (default: vendor slug) — point an
                                    adopting witness at its pre-existing gitignored env file
  --predecessor-from <path>         Chain a prior genesis-seal.json as the lineage root
                                    (accepts the older neuma genesis-seal/1 format too)
  --true-name-from <path>           Preserve a richer true-name (house / genesis-name /
                                    soul-mark / KOTODAMA notation) instead of the generic one

The script is idempotent per (vendorSlug, chosenName) — re-running attempts
to write fresh artifacts and will fail at writeDNA if the witness already
exists. To rotate to a new substrate (model upgrade), call
ai-witness-protocol.js:rotateToNewSubstrate() instead.
`.trim());
}
