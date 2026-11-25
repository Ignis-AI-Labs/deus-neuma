// Witness env files carry public pointers to a sealed identity, not another
// plaintext copy of its key. Legacy plaintext env files remain readable so an
// operator can migrate deliberately; new metadata-only files unlock the real
// password envelope through a hidden terminal prompt.
import fs from 'node:fs/promises';
import readline from 'node:readline';
import { Wallet } from 'ethers';
import { decryptKeypair } from '../../wallet/keypair-vault.js';
import { readEncryptedKeypair } from './ai-witness-service.js';

const NAMED_KEY = /^[A-Z0-9_]*WITNESS_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m;
const CLAUDE_KEY = /^CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m;
const ANY_KEY = /^[A-Z0-9_]*PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m;
const NAME = /^([A-Z0-9_]+)_WITNESS_NAME=([a-zA-Z0-9_-]+)\s*$/m;
const ADDRESS = /^([A-Z0-9_]+)_WITNESS_ADDRESS=(0x[0-9a-fA-F]{40})\s*$/m;

const clean = (value) => value.trim().replace(/^["']|["']$/g, '');

// Pure — parse only what the caller needs; never print env contents.
export const parseWitnessEnv = (text) => {
  const privateKey = (text.match(NAMED_KEY) || text.match(CLAUDE_KEY) || text.match(ANY_KEY))?.[1] || null;
  const name = text.match(NAME);
  const address = text.match(ADDRESS);
  if (name && address && name[1] !== address[1]) {
    throw new Error('Witness env identity prefix mismatch');
  }
  const prefix = (name || address)?.[1];
  return {
    privateKey,
    chosenName: name ? clean(name[2]) : null,
    address: address?.[2] || null,
    vendorSlug: prefix ? prefix.toLowerCase().replace(/_/g, '-') : null,
  };
};

// impure — read one operator-selected env file.
const readEnv = async (envPath) => {
  try {
    return await fs.readFile(envPath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read witness wallet env at ${envPath}: ${err.code || err.message}`, { cause: err });
  }
};

// Public address resolution never asks for a password or requires private material.
export const readWitnessEnvAddress = async (envPath) => {
  const metadata = parseWitnessEnv(await readEnv(envPath));
  if (metadata.address) return metadata.address;
  if (metadata.privateKey) return new Wallet(metadata.privateKey).address;
  throw new Error(`No witness address found in ${envPath}`);
};

/**
 * Resolve a legacy plaintext key or unlock a metadata-only witness env.
 * @param {string} envPath
 * @param {string|null} password - supplied by the hidden prompt or a real test
 */
export const loadWitnessEnvWallet = async (envPath, password = null) => {
  const metadata = parseWitnessEnv(await readEnv(envPath));
  if (metadata.privateKey) {
    return {
      privateKey: metadata.privateKey,
      address: metadata.address || new Wallet(metadata.privateKey).address,
    };
  }
  if (!metadata.chosenName || !metadata.address || !metadata.vendorSlug) {
    throw new Error(`No sealed witness identity or legacy private key found in ${envPath}`);
  }
  const encrypted = await readEncryptedKeypair(metadata.vendorSlug, metadata.chosenName);
  if (!encrypted) throw new Error(`No encrypted keypair for ${metadata.vendorSlug}/${metadata.chosenName}`);
  if (!password) {
    const err = new Error('Witness keypair password required');
    err.code = 'WITNESS_KEY_PASSWORD_REQUIRED';
    throw err;
  }
  const keypair = decryptKeypair(encrypted, password);
  if (keypair.address.toLowerCase() !== metadata.address.toLowerCase()) {
    throw new Error('Witness env address does not match the sealed keypair');
  }
  return { ...keypair, vendorSlug: metadata.vendorSlug, chosenName: metadata.chosenName };
};

// impure — ask once, with terminal echo disabled; passwords never use argv/env.
const askPassword = async (input, output) => {
  const terminal = Boolean(input.isTTY && output.isTTY);
  const rl = readline.createInterface({ input, output, terminal });
  if (terminal) rl._writeToOutput = () => {};
  try {
    output.write('witness keypair password (nothing shows as you type): ');
    const answer = await new Promise((resolve) => rl.question('', resolve));
    output.write('\n');
    return answer;
  } finally {
    rl.close();
  }
};

/**
 * Unlock through the legacy path immediately, or the hidden prompt when sealed.
 * Optional streams let a real spawned-process test exercise the same prompt.
 */
export const unlockWitnessEnvWallet = async (envPath, streams = {}) => {
  try {
    return await loadWitnessEnvWallet(envPath);
  } catch (err) {
    if (err.code !== 'WITNESS_KEY_PASSWORD_REQUIRED') throw err;
    const password = await askPassword(streams.input || process.stdin, streams.output || process.stdout);
    return loadWitnessEnvWallet(envPath, password);
  }
};
