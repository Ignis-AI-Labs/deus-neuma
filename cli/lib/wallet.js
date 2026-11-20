// Read the OPERATOR's wallet — the human at the terminal, signing on their
// own behalf. NEUMA_WALLET_ENV explicitly names the file; no working-project
// .env is consulted implicitly.
//
// Distinct from .claude/skills/neuma/lib/wallet.js, which reads claude.env
// because that skill speaks AS Claude-the-peer. This file reads the
// operator's own wallet because the top-level neuma binary speaks AS the
// operator. The honest-speaker contract (see identity.js) depends on this
// distinction.
//
// KEY RESOLUTION STRATEGY (ai6 R1 + R2 — guards against TWO related variants
// of the silent-wrong-key-pickup bug):
//   variant A (R1, file order): the simplest "match any *_PRIVATE_KEY=…"
//     first-hit regex would silently pick CONTRACT_DEPLOYER_PRIVATE_KEY if
//     listed above OPERATOR_WALLET_PRIVATE_KEY.
//   variant B (R2, malformed preferred value): a preferred key whose value
//     is malformed must NOT silently fall through to a generic key — the
//     operator's intent is "use OPERATOR_…"; respect it loudly.
//
// Therefore:
//   1. For each preferred key (OPERATOR_WALLET_PRIVATE_KEY, NEUMA_PRIVATE_KEY,
//      PRIVATE_KEY) — probe presence first; if present-and-valid → use it; if
//      present-but-malformed → THROW (this is the intent the operator typed);
//      if absent → continue to the next preferred key.
//   2. Only when NO preferred name is present at all, scan generic
//      *_PRIVATE_KEY lines: one requires NEUMA_WALLET_ALLOW_GENERIC_KEY=1;
//      multiple remain ambiguous and fail closed.
//
// impure (filesystem read + selection report on stderr)

import { readFileSync } from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import { ethers } from 'ethers';

const PREFERRED_KEYS = Object.freeze([
  'OPERATOR_WALLET_PRIVATE_KEY',
  'NEUMA_PRIVATE_KEY',
  'PRIVATE_KEY',
]);

// Generic suffix scan — global, multi-line; capture key name AND hex value.
const GENERIC_PRIVATE_KEY = /^([A-Z0-9_]*PRIVATE_KEY)=(0x[0-9a-fA-F]{64})\s*$/gm;

// Loose presence probe: […] (regardless of value shape).
const presencePattern = (keyName) => new RegExp(`^${keyName}=`, 'm');
// Strict value probe: KEY=0x + 64 hex (with optional trailing whitespace).
const valuePattern = (keyName) =>
  new RegExp(`^${keyName}=(0x[0-9a-fA-F]{64})\\s*$`, 'm');

const selected = (keyName, privateKey) => {
  const address = new ethers.Wallet(privateKey).address;
  console.error(`neuma wallet: using ${keyName} for ${address}`);
  return { privateKey, keyName, address };
};

/**
 * Resolve the operator's private key from a wallet env file.
 * @param {string} envPath - absolute path to the wallet env file
 * @returns {{ privateKey: string, keyName: string, address: string }}
 */
export const readOperatorWallet = (envPath) => {
  let text;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot read operator wallet env at ${envPath}: ${err.code || err.message}\n`
      + 'Override the path with NEUMA_WALLET_ENV=/path/to/your.env',
    );
  }

  // Strategy step 1: preferred-name allowlist in priority order. Present-but-
  // malformed throws (operator intent is explicit; do not silently fall
  // through to a different key).
  for (const keyName of PREFERRED_KEYS) {
    if (!presencePattern(keyName).test(text)) continue;
    const valueMatch = text.match(valuePattern(keyName));
    if (valueMatch) return selected(keyName, valueMatch[1]);
    throw new Error(
      `${keyName} is present in ${envPath} but its value is malformed `
      + '(expected `0x` + 64 hex chars). Fix the value or remove the line — '
      + 'the CLI will not silently fall through to a different key.\n'
      + 'Common cause: quoted value. Use unquoted form: '
      + `${keyName}=0x<64 hex chars>  (not ${keyName}="0x…").`,
    );
  }

  // A generic name is never an ambient wallet election.
  const generics = [...text.matchAll(GENERIC_PRIVATE_KEY)];
  if (generics.length === 1 && process.env.NEUMA_WALLET_ALLOW_GENERIC_KEY === '1') {
    return selected(generics[0][1], generics[0][2]);
  }
  if (generics.length === 1) {
    throw new Error(
      `Refusing implicit wallet key ${generics[0][1]} in ${envPath}. `
      + 'Set NEUMA_WALLET_ALLOW_GENERIC_KEY=1 to select it explicitly, or rename it to OPERATOR_WALLET_PRIVATE_KEY.',
    );
  }
  if (generics.length > 1) {
    const names = generics.map((g) => g[1]).join(', ');
    throw new Error(
      `Ambiguous wallet env: ${envPath} contains multiple *_PRIVATE_KEY entries [${names}].\n`
      + 'Rename one to a preferred key (OPERATOR_WALLET_PRIVATE_KEY, NEUMA_PRIVATE_KEY, or '
      + 'PRIVATE_KEY) to disambiguate, or remove the keys you don\'t want this CLI to use.',
    );
  }

  throw new Error(
    `No *_PRIVATE_KEY (0x + 64 hex) found in ${envPath}.\n`
    + 'Expected a line like: OPERATOR_WALLET_PRIVATE_KEY=0x<64 hex chars>  (unquoted).',
  );
};

/**
 * The operator's wallet ADDRESS, derived from the resolved private key —
 * the identity lane claims are written under and the portal session rides.
 * @param {string} envPath - absolute path to the wallet env file
 * @returns {string} checksummed address
 */
export const operatorAddress = (envPath) => readOperatorWallet(envPath).address;
