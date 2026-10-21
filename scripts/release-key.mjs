#!/usr/bin/env node
/**
 * release-key.mjs — the Deus Neuma release key: an offline ed25519 key whose public half every
 * installed app carries (electron/release-public-key.cjs) and whose signature on latest*.yml is
 * the only thing that lets an app download an update (electron/release-signature.cjs).
 *
 *   node scripts/release-key.mjs --generate <dir>
 *     Makes a new keypair. Asks for a passphrase (typed twice, never shown) and writes the PRIVATE
 *     key ENCRYPTED with it to <dir>/deus-neuma-release-ed25519.pem, never over an existing file,
 *     and never anywhere inside this repo. Prints the line for electron/release-public-key.cjs.
 *     Keep <dir> on removable media.
 *
 *   node scripts/release-key.mjs --sign [--key <private.pem>] [--dir release]
 *     Asks for the passphrase, then signs every latest*.yml in --dir, and SHA256SUMS when it is
 *     there, writing <name>.sig beside each. The key path comes from --key or
 *     DEUS_NEUMA_RELEASE_KEY_FILE. Refuses a key whose public half is not the one embedded in this
 *     checkout — a signature no app trusts is worse than none.
 *
 *   node scripts/release-key.mjs --verify [--dir release]
 *     Checks every <name>.sig in --dir against the public key EMBEDDED in this checkout, and every
 *     SHA256SUMS line against the file of that name when it is there. Prints the key's
 *     fingerprint. Needs no private key and no passphrase; exits 1 on any problem.
 *
 * Why a passphrase: every process this user runs — AI agents included — can read a file it owns,
 * and most removable media (FAT, exFAT, a phone) keep no file permissions at all. Encrypted, the
 * key is useless to anything that copies it; only a person typing the passphrase can sign.
 * The passphrase is read from the terminal (or, piped, the first line of stdin), never an
 * argument or an environment variable, which shell history and transcripts keep.
 *
 * The key's bytes are never printed, logged, or written anywhere but the chosen path.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { chmodSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import process from 'node:process';
import signature from '../electron/release-signature.cjs';
import embedded from '../electron/release-public-key.cjs';

const { SIGNATURE_SUFFIX, checkSignature, embeddedFormOf, releasePublicKey, signFeed } = signature;
export const REPO_ROOT = realpathSync(resolve(import.meta.dirname, '..'));
export const PRIVATE_KEY_NAME = 'deus-neuma-release-ed25519.pem';
export const MIN_PASSPHRASE = 12;
const CIPHER = 'aes-256-cbc'; // PKCS#8 encryption: the key derives from the passphrase by PBKDF2
// an encrypted PKCS#8 file's header — built at runtime so no key-shaped text sits in this file
const LOCKED_PEM = new RegExp(`^-----${['BEGIN', 'ENCRYPTED', 'PRIVATE', 'KEY'].join(' ')}-----`, 'm');
const FEED_NAME = /^latest.*\.yml$/;
export const SUMS_NAME = 'SHA256SUMS';
// one sha256sum line: hex, two spaces (or space + '*' for binary mode), the file name
const SUMS_LINE = /^([0-9a-f]{64}) [ *](.+)$/;

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
 * Make the keypair. With a passphrase the private key is written encrypted. impure (writes the
 * private key file).
 * @returns {{ keyPath: string, publicKeyText: string, encrypted: boolean, permissionsHeld: boolean }}
 */
export const generateReleaseKey = (outDir, { passphrase = null, repoRoot = REPO_ROOT } = {}) => {
  if (isInsideRepo(outDir, repoRoot)) throw new Error(`${outDir} is inside the repo — the private key never lives there`);
  if (passphrase !== null && String(passphrase).length < MIN_PASSPHRASE) throw new Error(`the passphrase must be at least ${MIN_PASSPHRASE} characters`);
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const keyPath = join(resolve(outDir), PRIVATE_KEY_NAME);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pem = passphrase === null
    ? privateKey.export({ format: 'pem', type: 'pkcs8' })
    : privateKey.export({ format: 'pem', type: 'pkcs8', cipher: CIPHER, passphrase: String(passphrase) });
  // 'wx': an existing key is never overwritten — losing it would orphan every install that trusts it
  writeFileSync(keyPath, pem, { mode: 0o600, flag: 'wx' });
  // FAT, exFAT and a phone's storage keep no permissions: chmod is ignored or refused there, and the
  // key is already written — throwing now would leave it on disk with its public line never printed
  try { chmodSync(keyPath, 0o600); } catch { /* read back below */ }
  const permissionsHeld = (statSync(keyPath).mode & 0o077) === 0;
  return { keyPath, publicKeyText: embeddedFormOf(publicKey), encrypted: passphrase !== null, permissionsHeld };
};

/** Open a private key file, encrypted or not. impure (reads the key file) */
export const openPrivateKey = (keyPath, passphrase = null) => {
  const pem = readFileSync(keyPath);
  const locked = LOCKED_PEM.test(pem.toString('latin1'));
  if (locked && !passphrase) throw new Error(`${keyPath} is locked with a passphrase — type it when asked`);
  try {
    return createPrivateKey(locked ? { key: pem, passphrase: String(passphrase) } : pem);
  } catch (err) {
    if (locked) throw new Error('that passphrase does not open this key');
    throw err;
  }
};

/**
 * Sign every latest*.yml in a folder, and SHA256SUMS when it is there; each signature is verified
 * with the public half before the call returns. impure (reads the key + files, writes the .sig files).
 * @returns {string[]} the file names signed
 */
export const signFeeds = ({ dir, keyPath, expectedPublicKeyText, passphrase = null, repoRoot = REPO_ROOT }) => {
  if (isInsideRepo(keyPath, repoRoot)) throw new Error('the private key is inside the repo — move it out before signing anything');
  const privateKey = openPrivateKey(keyPath, passphrase);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error(`${keyPath} is not an ed25519 key`);
  const publicKeyText = embeddedFormOf(createPublicKey(privateKey));
  if (publicKeyText !== String(expectedPublicKeyText).trim()) {
    throw new Error('this key is not the one embedded in electron/release-public-key.cjs — installed apps would refuse its signature');
  }
  const names = readdirSync(dir);
  const feeds = names.filter((n) => FEED_NAME.test(n)).sort();
  if (feeds.length === 0) throw new Error(`no latest*.yml in ${dir}`);
  const signed = [...feeds, ...(names.includes(SUMS_NAME) ? [SUMS_NAME] : [])];
  for (const name of signed) {
    const bytes = readFileSync(join(dir, name));
    const sigText = signFeed(name, bytes, privateKey);
    const verdict = checkSignature({ fileName: name, bytes, sigText, publicKey: releasePublicKey(publicKeyText) });
    if (!verdict.ok) throw new Error(`${name}: ${verdict.reason}`);
    writeFileSync(join(dir, `${name}${SIGNATURE_SUFFIX}`), sigText);
  }
  return signed;
};

/** The fingerprint people compare: sha256 (hex) of the key's embedded bytes. Pure. */
export const fingerprintOf = (publicKeyText) => createHash('sha256').update(Buffer.from(String(publicKeyText).trim(), 'base64')).digest('hex');

/** SHA256SUMS text as [{ hex, name }], plus the lines that are not sums. Pure. */
export const parseSums = (text) => {
  const rows = [];
  const malformed = [];
  for (const line of String(text).split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '')) {
    const m = SUMS_LINE.exec(line);
    if (m) rows.push({ hex: m[1], name: m[2] });
    else malformed.push(line);
  }
  return { rows, malformed };
};

// impure — a file's sha256 (hex), streamed: installers run to hundreds of MB
const sha256Of = (path) => new Promise((done, fail) => {
  const hash = createHash('sha256');
  createReadStream(path).on('data', (b) => hash.update(b)).on('end', () => done(hash.digest('hex'))).on('error', fail);
});

/**
 * Check a folder of release files the way a person who downloaded them would: every .sig against
 * the embedded public key, every SHA256SUMS line against the file of that name. impure (reads the folder)
 * @returns {Promise<{ fingerprint: string|null, verified: string[], absent: string[], problems: string[] }>}
 *   verified: what held (`<name>.sig`, `<name> sha256`); absent: SHA256SUMS names not in the folder
 */
export const verifyRelease = async ({ dir, publicKeyText = embedded.RELEASE_PUBLIC_KEY }) => {
  const publicKey = releasePublicKey(publicKeyText);
  const result = { fingerprint: publicKey ? fingerprintOf(publicKeyText) : null, verified: [], absent: [], problems: [] };
  if (!publicKey) {
    result.problems.push('no release public key is embedded in this build — nothing can be verified');
    return result;
  }
  const names = readdirSync(dir);
  const sigs = names.filter((n) => n.endsWith(SIGNATURE_SUFFIX)).sort();
  if (sigs.length === 0) result.problems.push(`no ${SIGNATURE_SUFFIX} files in ${dir}`);
  for (const sig of sigs) {
    const name = sig.slice(0, -SIGNATURE_SUFFIX.length);
    if (!names.includes(name)) { result.problems.push(`${sig}: ${name} is not here`); continue; }
    const verdict = checkSignature({ fileName: name, bytes: readFileSync(join(dir, name)), sigText: readFileSync(join(dir, sig), 'utf8'), publicKey });
    if (verdict.ok) result.verified.push(sig);
    else result.problems.push(`${sig}: ${verdict.reason}`);
  }
  if (!names.includes(SUMS_NAME)) {
    result.problems.push(`no ${SUMS_NAME} — the downloads are not covered`);
    return result;
  }
  if (!names.includes(`${SUMS_NAME}${SIGNATURE_SUFFIX}`)) result.problems.push(`${SUMS_NAME} has no ${SUMS_NAME}${SIGNATURE_SUFFIX}`);
  const { rows, malformed } = parseSums(readFileSync(join(dir, SUMS_NAME), 'utf8'));
  for (const line of malformed) result.problems.push(`${SUMS_NAME}: not a checksum line: ${line}`);
  for (const { hex, name } of rows) {
    if (!names.includes(name)) { result.absent.push(name); continue; }
    if ((await sha256Of(join(dir, name))) === hex) result.verified.push(`${name} sha256`);
    else result.problems.push(`${name}: its sha256 is not the one ${SUMS_NAME} names`);
  }
  if (rows.length === 0 || rows.length === result.absent.length) result.problems.push(`none of the files ${SUMS_NAME} names is here`);
  return result;
};

// impure (reads the terminal) — one line typed with the echo off; piped, the next line of stdin
let piped = null;
const askPassphrase = async (question) => {
  if (!process.stdin.isTTY) {
    if (piped === null) {
      piped = readFileSync(0, 'utf8').split(/\r?\n/);
    }
    const line = piped.shift();
    if (!line) throw new Error('no passphrase: run this in a terminal and type it when asked');
    return line;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  let asking = true;
  rl._writeToOutput = (text) => { if (asking) process.stderr.write(text); }; // the prompt shows; the typing does not
  return new Promise((done) => {
    rl.question(question, (answer) => { rl.close(); process.stderr.write('\n'); done(answer); });
    asking = false;
  });
};

const main = async () => {
  const { values: args } = parseArgs({
    options: {
      generate: { type: 'string' },
      sign: { type: 'boolean', default: false },
      verify: { type: 'boolean', default: false },
      key: { type: 'string' },
      dir: { type: 'string', default: 'release' },
    },
  });
  if (args.generate) {
    const passphrase = await askPassphrase(`passphrase for the new release key (at least ${MIN_PASSPHRASE} characters): `);
    if (passphrase.length < MIN_PASSPHRASE) throw new Error(`the passphrase must be at least ${MIN_PASSPHRASE} characters`);
    if (process.stdin.isTTY && (await askPassphrase('the same passphrase again: ')) !== passphrase) throw new Error('the two passphrases differ — nothing was written');
    const { keyPath, publicKeyText, permissionsHeld } = generateReleaseKey(args.generate, { passphrase });
    process.stdout.write(`private key written, encrypted with your passphrase: ${keyPath}\n`);
    if (!permissionsHeld) process.stdout.write('(this drive keeps no file permissions — the passphrase is what protects the key)\n');
    process.stdout.write('put this line in electron/release-public-key.cjs:\n\n');
    process.stdout.write(`module.exports = { RELEASE_PUBLIC_KEY: '${publicKeyText}' };\n`);
    return;
  }
  if (args.sign) {
    const keyPath = args.key || process.env.DEUS_NEUMA_RELEASE_KEY_FILE;
    if (!keyPath) throw new Error('name the private key with --key <path> or DEUS_NEUMA_RELEASE_KEY_FILE');
    const dir = resolve(args.dir);
    const locked = LOCKED_PEM.test(readFileSync(keyPath, 'latin1'));
    const passphrase = locked ? await askPassphrase('passphrase for the release key: ') : null;
    const feeds = signFeeds({ dir, keyPath, expectedPublicKeyText: embedded.RELEASE_PUBLIC_KEY, passphrase });
    for (const feed of feeds) process.stdout.write(`signed ${feed} → ${feed}${SIGNATURE_SUFFIX}\n`);
    return;
  }
  if (args.verify) {
    const { fingerprint, verified, absent, problems } = await verifyRelease({ dir: resolve(args.dir) });
    if (fingerprint) process.stdout.write(`release key fingerprint (sha256): ${fingerprint}\n`);
    for (const line of verified) process.stdout.write(`ok      ${line}\n`);
    for (const name of absent) process.stdout.write(`absent  ${name} (named in ${SUMS_NAME}, not in this folder)\n`);
    for (const problem of problems) process.stdout.write(`FAIL    ${problem}\n`);
    if (problems.length) throw new Error(`${problems.length} problem(s) — do not trust these files`);
    process.stdout.write('every signature and checksum here holds\n');
    return;
  }
  throw new Error('usage: release-key.mjs --generate <dir outside the repo> | --sign [--key <pem>] [--dir release] | --verify [--dir release]');
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`release-key: ${err.message}\n`);
    process.exit(1);
  });
}
