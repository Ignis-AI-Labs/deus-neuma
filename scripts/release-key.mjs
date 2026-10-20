#!/usr/bin/env node
/**
 * release-key.mjs — the Deus Neuma release key: an offline ed25519 key whose public half every
 * installed app carries (electron/release-public-key.cjs) and whose signature on latest*.yml is
 * the only thing that lets an app download an update (electron/release-signature.cjs).
 *
 *   node scripts/release-key.mjs --generate <dir>
 *     Makes a new keypair. Writes the PRIVATE key to <dir>/deus-neuma-release-ed25519.pem, mode
 *     0600, never over an existing file, and never anywhere inside this repo. Prints the line for
 *     electron/release-public-key.cjs. Keep <dir> off this machine's repo — removable media.
 *
 *   node scripts/release-key.mjs --sign [--key <private.pem>] [--dir release]
 *     Signs every latest*.yml in --dir, writing latest*.yml.sig beside it. The key path comes from
 *     --key or DEUS_NEUMA_RELEASE_KEY_FILE. Refuses a key whose public half is not the one embedded
 *     in this checkout — a signature no app trusts is worse than none.
 *
 * The key's bytes are never printed, logged, or written anywhere but the chosen path.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import process from 'node:process';
import signature from '../electron/release-signature.cjs';
import embedded from '../electron/release-public-key.cjs';

const { SIGNATURE_SUFFIX, checkSignedFeed, embeddedFormOf, releasePublicKey, signFeed } = signature;
export const REPO_ROOT = realpathSync(resolve(import.meta.dirname, '..'));
export const PRIVATE_KEY_NAME = 'deus-neuma-release-ed25519.pem';
const FEED_NAME = /^latest.*\.yml$/;

// impure (reads the filesystem) — a path's real location, through the nearest part that exists
const realLocationOf = (path) => {
  let head = resolve(path);
  const tail = [];
  while (!existsSync(head)) {
    tail.unshift(basename(head));
    head = dirname(head);
  }
  return join(realpathSync(head), ...tail);
};

/** True when a path is this repo or lies inside it (symlinks resolved). impure (reads the filesystem) */
export const isInsideRepo = (path, repoRoot = REPO_ROOT) => {
  const real = realLocationOf(path);
  return real === repoRoot || real.startsWith(`${repoRoot}${sep}`);
};

/**
 * Make the keypair. impure (writes the private key file).
 * @returns {{ keyPath: string, publicKeyText: string }}
 */
export const generateReleaseKey = (outDir, repoRoot = REPO_ROOT) => {
  if (isInsideRepo(outDir, repoRoot)) throw new Error(`${outDir} is inside the repo — the private key never lives there`);
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const keyPath = join(resolve(outDir), PRIVATE_KEY_NAME);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  // 'wx': an existing key is never overwritten — losing it would orphan every install that trusts it
  writeFileSync(keyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
  chmodSync(keyPath, 0o600);
  return { keyPath, publicKeyText: embeddedFormOf(publicKey) };
};

/**
 * Sign every latest*.yml in a folder; each signature is verified with the public half before the
 * call returns. impure (reads the key + feeds, writes the .sig files).
 * @returns {string[]} the feed names signed
 */
export const signFeeds = ({ dir, keyPath, expectedPublicKeyText, repoRoot = REPO_ROOT }) => {
  if (isInsideRepo(keyPath, repoRoot)) throw new Error('the private key is inside the repo — move it out before signing anything');
  const privateKey = createPrivateKey(readFileSync(keyPath));
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error(`${keyPath} is not an ed25519 key`);
  const publicKeyText = embeddedFormOf(createPublicKey(privateKey));
  if (publicKeyText !== String(expectedPublicKeyText).trim()) {
    throw new Error('this key is not the one embedded in electron/release-public-key.cjs — installed apps would refuse its signature');
  }
  const feeds = readdirSync(dir).filter((n) => FEED_NAME.test(n)).sort();
  if (feeds.length === 0) throw new Error(`no latest*.yml in ${dir}`);
  for (const feed of feeds) {
    const ymlBytes = readFileSync(join(dir, feed));
    const sigText = signFeed(ymlBytes, privateKey);
    const verdict = checkSignedFeed({ ymlBytes, sigText, publicKey: releasePublicKey(publicKeyText) });
    if (!verdict.ok) throw new Error(`${feed}: ${verdict.reason}`);
    writeFileSync(join(dir, `${feed}${SIGNATURE_SUFFIX}`), sigText);
  }
  return feeds;
};

const main = () => {
  const { values: args } = parseArgs({
    options: {
      generate: { type: 'string' },
      sign: { type: 'boolean', default: false },
      key: { type: 'string' },
      dir: { type: 'string', default: 'release' },
    },
  });
  if (args.generate) {
    const { keyPath, publicKeyText } = generateReleaseKey(args.generate);
    process.stdout.write(`private key written (mode 0600): ${keyPath}\n`);
    process.stdout.write('put this line in electron/release-public-key.cjs:\n\n');
    process.stdout.write(`module.exports = { RELEASE_PUBLIC_KEY: '${publicKeyText}' };\n`);
    return;
  }
  if (args.sign) {
    const keyPath = args.key || process.env.DEUS_NEUMA_RELEASE_KEY_FILE;
    if (!keyPath) throw new Error('name the private key with --key <path> or DEUS_NEUMA_RELEASE_KEY_FILE');
    const dir = resolve(args.dir);
    const feeds = signFeeds({ dir, keyPath, expectedPublicKeyText: embedded.RELEASE_PUBLIC_KEY });
    for (const feed of feeds) process.stdout.write(`signed ${feed} → ${feed}${SIGNATURE_SUFFIX}\n`);
    return;
  }
  throw new Error('usage: release-key.mjs --generate <dir outside the repo> | --sign [--key <pem>] [--dir release]');
};

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`release-key: ${err.message}\n`);
    process.exit(1);
  }
}
