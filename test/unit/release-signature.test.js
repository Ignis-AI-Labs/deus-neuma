/**
 * The update feed's offline signature (security seat G2) — the sign/verify helpers the app, the
 * publisher and the key tool share (electron/release-signature.cjs), and the key tool itself
 * (scripts/release-key.mjs) on the real filesystem. Every key is generated at run time; a private
 * key is only ever written into a temp dir outside the repo. No mocks (RULE 0).
 *
 * The app-side gate — real Electron, real electron-updater, real loopback feed — is proven by
 * scripts/prove-update-signature.mjs.
 */
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRIVATE_KEY_NAME, REPO_ROOT, fingerprintOf, generateReleaseKey, isInsideRepo, signFeeds, verifyRelease,
} from '../../scripts/release-key.mjs';

const require = createRequire(import.meta.url);
const {
  channelFileFor, checkSignedFeed, embeddedFormOf, offerDiffers, releasePublicKey, signFeed, signatureHolds,
  signedMessage, unfitForPlatform,
} = require('../../electron/release-signature.cjs');

const FEED = Buffer.from('version: 0.1.31\nfiles:\n  - url: Deus-Neuma-0.1.31-x86_64.AppImage\n    sha512: AAAA\n    size: 10\npath: Deus-Neuma-0.1.31-x86_64.AppImage\nsha512: AAAA\n');
const OFFERED = Object.freeze({
  version: '0.1.31',
  files: [{ url: 'Deus-Neuma-0.1.31-x86_64.AppImage', sha512: 'AAAA', size: 10 }],
  path: 'Deus-Neuma-0.1.31-x86_64.AppImage',
  sha512: 'AAAA',
});
const keyA = generateKeyPairSync('ed25519');
const keyB = generateKeyPairSync('ed25519');
const PUB_A = releasePublicKey(embeddedFormOf(keyA.publicKey));
const LINUX = 'latest-linux.yml';

describe('the embedded release public key', () => {
  it('round-trips through its embedded form, and the form is one short line', () => {
    const text = embeddedFormOf(keyA.publicKey);
    expect(text).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(text.length).toBe(60); // 44 bytes of SPKI DER
    expect(embeddedFormOf(releasePublicKey(text))).toBe(text);
  });

  it('empty, garbage, or a non-ed25519 key is no key at all', () => {
    expect(releasePublicKey('')).toBeNull();
    expect(releasePublicKey('   ')).toBeNull();
    expect(releasePublicKey(undefined)).toBeNull();
    expect(releasePublicKey('bm90IGEga2V5')).toBeNull();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey;
    expect(releasePublicKey(rsa.export({ format: 'der', type: 'spki' }).toString('base64'))).toBeNull();
  });
});

describe('sign and verify', () => {
  it('a signature holds for its exact bytes under its file name and key', () => {
    const sig = signFeed(LINUX, FEED, keyA.privateKey);
    expect(sig).toMatch(/^[A-Za-z0-9+/]{86}==\n$/);
    expect(signatureHolds(LINUX, FEED, sig, PUB_A)).toBe(true);
  });

  it('what is signed is the domain tag, the file name and the bytes — the format the ceremony fixes', () => {
    const message = signedMessage(LINUX, FEED);
    expect(message.equals(Buffer.concat([Buffer.from('deus-neuma-feed-v1\nlatest-linux.yml\n'), FEED]))).toBe(true);
    const sig = Buffer.from(signFeed(LINUX, FEED, keyA.privateKey).trim(), 'base64');
    expect(verify(null, message, keyA.publicKey, sig)).toBe(true); // any ed25519 verifier, over exactly these bytes
    expect(verify(null, FEED, keyA.publicKey, sig)).toBe(false); // never the bare file
  });

  it('one byte changed, another key, or a malformed signature never holds', () => {
    const sig = signFeed(LINUX, FEED, keyA.privateKey);
    expect(signatureHolds(LINUX, Buffer.concat([FEED, Buffer.from(' ')]), sig, PUB_A)).toBe(false);
    expect(signatureHolds(LINUX, FEED, signFeed(LINUX, FEED, keyB.privateKey), PUB_A)).toBe(false);
    expect(signatureHolds(LINUX, FEED, 'not a signature', PUB_A)).toBe(false);
    expect(signatureHolds(LINUX, FEED, null, PUB_A)).toBe(false);
  });

  it('a signature made for one channel never holds for another — the cross-channel replay', () => {
    const windowsSig = signFeed('latest.yml', FEED, keyA.privateKey);
    expect(signatureHolds('latest.yml', FEED, windowsSig, PUB_A)).toBe(true);
    expect(signatureHolds(LINUX, FEED, windowsSig, PUB_A)).toBe(false);
    expect(signatureHolds('SHA256SUMS', FEED, windowsSig, PUB_A)).toBe(false);
  });

  it('a name that is not a bare file name is never signed and never holds', () => {
    for (const bad of ['', '../latest-linux.yml', 'a/b.yml', 'latest.yml\nlatest-linux.yml', null]) {
      expect(() => signFeed(bad, FEED, keyA.privateKey)).toThrow(/not a release file name/);
      expect(signatureHolds(bad, FEED, signFeed(LINUX, FEED, keyA.privateKey), PUB_A)).toBe(false);
    }
  });
});

describe('checkSignedFeed — the whole verdict', () => {
  const sig = signFeed(LINUX, FEED, keyA.privateKey);

  it('passes a signed feed that is exactly what the updater parsed', () => {
    const verdict = checkSignedFeed({ fileName: LINUX, ymlBytes: FEED, sigText: sig, publicKey: PUB_A, offered: OFFERED });
    expect(verdict.ok).toBe(true);
    expect(verdict.signed.version).toBe('0.1.31');
  });

  it('names each refusal', () => {
    const reason = (input) => checkSignedFeed({ fileName: LINUX, ymlBytes: FEED, sigText: sig, publicKey: PUB_A, offered: OFFERED, ...input }).reason;
    expect(reason({ publicKey: null })).toBe('no release public key is embedded in this build');
    expect(reason({ sigText: null })).toBe('no signature for latest-linux.yml');
    expect(reason({ sigText: '\n' })).toBe('no signature for latest-linux.yml');
    expect(reason({ sigText: signFeed(LINUX, FEED, keyB.privateKey) })).toMatch(/does not match latest-linux\.yml/);
    expect(reason({ ymlBytes: Buffer.alloc(1024 * 1024 + 1) })).toBe('latest-linux.yml is too large to be a signed release file');
    expect(reason({ offered: { ...OFFERED, version: '0.1.32' } })).toMatch(/not the signed feed: the offered version 0\.1\.32/);
  });

  it('a validly signed latest.yml served as latest-linux.yml is refused', () => {
    const verdict = checkSignedFeed({ fileName: LINUX, ymlBytes: FEED, sigText: signFeed('latest.yml', FEED, keyA.privateKey), publicKey: PUB_A, offered: OFFERED });
    expect(verdict).toEqual({ ok: false, reason: 'the signature does not match latest-linux.yml (altered, signed for another file, or by another key)' });
  });
});

describe('offerDiffers — what the updater will download must be what was signed', () => {
  it('the same offer does not differ', () => {
    expect(offerDiffers(OFFERED, { ...OFFERED })).toBeNull();
  });

  it('a changed sha512, size, url, extra file, or package differs', () => {
    const file = OFFERED.files[0];
    expect(offerDiffers({ ...OFFERED, files: [{ ...file, sha512: 'BBBB' }] }, OFFERED)).toMatch(/sha512/);
    expect(offerDiffers({ ...OFFERED, files: [{ ...file, size: 11 }] }, OFFERED)).toMatch(/sha512/);
    expect(offerDiffers({ ...OFFERED, files: [{ ...file, url: 'x.AppImage' }] }, OFFERED)).toMatch(/sha512/);
    expect(offerDiffers({ ...OFFERED, files: [file, { ...file, url: 'y.AppImage' }] }, OFFERED)).toMatch(/sha512/);
    expect(offerDiffers({ ...OFFERED, packages: { x64: { sha512: 'C' } } }, OFFERED)).toMatch(/packages/);
  });

  it('ANY other field of a file differs — isAdminRightsRequired, blockMapSize, one never seen before', () => {
    const file = OFFERED.files[0];
    for (const extra of [{ isAdminRightsRequired: true }, { blockMapSize: 5 }, { someFutureField: 'x' }]) {
      expect(offerDiffers({ ...OFFERED, files: [{ ...file, ...extra }] }, OFFERED)).toMatch(/files or their sha512/);
    }
    const signedAdmin = { ...OFFERED, files: [{ ...file, isAdminRightsRequired: true }] };
    expect(offerDiffers({ ...OFFERED, files: [{ ...file, isAdminRightsRequired: false }] }, signedAdmin)).toMatch(/files/);
  });

  it('every other field of the offer differs too — stagingPercentage, minimumSystemVersion, releaseDate', () => {
    expect(offerDiffers({ ...OFFERED, stagingPercentage: 1 }, OFFERED)).toBe('the offered stagingPercentage is not the signed value');
    expect(offerDiffers({ ...OFFERED, minimumSystemVersion: '99.0.0' }, OFFERED)).toMatch(/minimumSystemVersion/);
    const dated = { ...OFFERED, releaseDate: '2026-10-21T00:00:00.000Z' };
    expect(offerDiffers({ ...OFFERED, releaseDate: '2026-10-22T00:00:00.000Z' }, dated)).toMatch(/releaseDate/);
    expect(offerDiffers({ ...OFFERED, a: 1, b: 2 }, OFFERED)).toBe('the offered a, b are not the signed value');
  });

  it('a feed parsed from the same bytes does not differ', () => {
    const yml = Buffer.from(`${FEED.toString()}releaseDate: 2026-10-21T00:00:00.000Z\nstagingPercentage: 50\n`);
    const verdict = checkSignedFeed({ fileName: LINUX, ymlBytes: yml, sigText: signFeed(LINUX, yml, keyA.privateKey), publicKey: PUB_A, offered: require('js-yaml').load(yml.toString()) });
    expect(verdict.ok).toBe(true);
  });

  it('an offer with no files, or a file with no sha512, is refused outright', () => {
    expect(offerDiffers({ version: '0.1.31' }, { version: '0.1.31' })).toMatch(/names no files/);
    const bare = { version: '0.1.31', files: [{ url: 'a.AppImage', sha2: 'ff' }] };
    expect(offerDiffers(bare, bare)).toMatch(/no sha512/);
  });

  it('the legacy path/sha512 form is read the way electron-updater reads it', () => {
    const legacy = { version: '0.1.31', path: 'a.AppImage', sha512: 'AAAA' };
    expect(offerDiffers(legacy, legacy)).toBeNull();
    expect(offerDiffers(legacy, { ...legacy, sha512: 'BBBB' })).toMatch(/sha512/);
  });
});

describe('unfitForPlatform — a self install updates only from its own file type', () => {
  const offer = (...urls) => ({ version: '0.1.31', files: urls.map((url) => ({ url, sha512: 'AAAA', size: 1 })) });

  it('Linux takes an AppImage, Windows an exe', () => {
    expect(unfitForPlatform(offer('Deus-Neuma-0.1.31-x86_64.AppImage'), 'linux')).toBeNull();
    expect(unfitForPlatform(offer('Deus-Neuma-0.1.31-x64.exe'), 'win32')).toBeNull();
    expect(unfitForPlatform({ version: '0.1.31', path: 'a.AppImage', sha512: 'AAAA' }, 'linux')).toBeNull();
  });

  it('anything else is refused before a byte downloads — the findFile fallback never runs', () => {
    expect(unfitForPlatform(offer('Deus-Neuma-0.1.31-x64.exe'), 'linux')).toBe('the offered file Deus-Neuma-0.1.31-x64.exe is not an .AppImage, the only file this install updates itself from');
    expect(unfitForPlatform(offer('Deus-Neuma-0.1.31-x86_64.AppImage'), 'win32')).toMatch(/is not an \.exe/);
    expect(unfitForPlatform(offer('neuma_0.1.31_amd64.deb'), 'linux')).toMatch(/is not an \.AppImage/);
    expect(unfitForPlatform(offer('a.AppImage', 'b.exe'), 'linux')).toMatch(/b\.exe is not an \.AppImage/);
    expect(unfitForPlatform(offer('x.exe?name=.AppImage'), 'linux')).toMatch(/is not an \.AppImage/); // judged by its path, as electron-updater does
    expect(unfitForPlatform({ version: '0.1.31' }, 'linux')).toBe('the offered feed names no files');
    expect(unfitForPlatform(offer('a.dmg'), 'darwin')).toBe('an install on darwin does not update itself');
  });
});

describe('channelFileFor — the feed name electron-updater asks for', () => {
  it('matches the generic provider per platform', () => {
    expect(channelFileFor('linux', 'x64')).toBe('latest-linux.yml');
    expect(channelFileFor('linux', 'arm64')).toBe('latest-linux-arm64.yml');
    expect(channelFileFor('win32', 'x64')).toBe('latest.yml');
    expect(channelFileFor('darwin', 'arm64')).toBe('latest-mac.yml');
  });
});

describe('scripts/release-key.mjs', () => {
  const outside = () => mkdtempSync(join(tmpdir(), 'release-key-'));

  it('refuses to put a private key anywhere inside the repo', () => {
    expect(isInsideRepo(REPO_ROOT)).toBe(true);
    expect(isInsideRepo(join(REPO_ROOT, 'not-yet', 'made'))).toBe(true);
    expect(isInsideRepo(outside())).toBe(false);
    const target = join(REPO_ROOT, 'release-key-must-not-exist');
    expect(() => generateReleaseKey(target)).toThrow(/inside the repo/);
    expect(existsSync(target)).toBe(false);
  });

  it('generates a 0600 private key outside the repo, never over an existing one', () => {
    const dir = join(outside(), 'keys');
    const { keyPath, publicKeyText } = generateReleaseKey(dir);
    expect(keyPath).toBe(join(dir, PRIVATE_KEY_NAME));
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(keyPath, 'utf8')).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(releasePublicKey(publicKeyText)).not.toBeNull();
    expect(() => generateReleaseKey(dir)).toThrow(/EEXIST/);
  });

  it('signs every latest*.yml with the embedded key, each under its own name, and refuses any other key', () => {
    const { keyPath, publicKeyText } = generateReleaseKey(outside());
    const release = outside();
    writeFileSync(join(release, 'latest-linux.yml'), FEED);
    writeFileSync(join(release, 'latest.yml'), FEED);
    writeFileSync(join(release, 'notes.yml'), FEED);
    expect(() => signFeeds({ dir: release, keyPath, expectedPublicKeyText: embeddedFormOf(keyB.publicKey) }))
      .toThrow(/not the one embedded/);
    expect(existsSync(join(release, 'latest-linux.yml.sig'))).toBe(false);
    expect(signFeeds({ dir: release, keyPath, expectedPublicKeyText: publicKeyText })).toEqual(['latest-linux.yml', 'latest.yml']);
    const pub = releasePublicKey(publicKeyText);
    const linuxSig = readFileSync(join(release, 'latest-linux.yml.sig'), 'utf8');
    expect(signatureHolds(LINUX, FEED, linuxSig, pub)).toBe(true);
    expect(signatureHolds('latest.yml', FEED, linuxSig, pub)).toBe(false); // same bytes, other channel
    expect(signatureHolds('latest.yml', FEED, readFileSync(join(release, 'latest.yml.sig'), 'utf8'), pub)).toBe(true);
    expect(existsSync(join(release, 'notes.yml.sig'))).toBe(false);
  });

  it('the CLI asks for a passphrase, writes the key encrypted, and prints only the line to embed', () => {
    const dir = join(outside(), 'cli');
    const cli = resolve(REPO_ROOT, 'scripts/release-key.mjs');
    const phrase = `phrase-${process.pid}-${Date.now()}`;
    const out = execFileSync(process.execPath, [cli, '--generate', dir], { encoding: 'utf8', input: `${phrase}\n` });
    const line = out.match(/^module\.exports = \{ RELEASE_PUBLIC_KEY: '([A-Za-z0-9+/=]+)' \};$/m);
    expect(line).not.toBeNull();
    expect(releasePublicKey(line[1])).not.toBeNull();
    expect(out).not.toMatch(/PRIVATE KEY-----/);
    expect(out).not.toContain(phrase);
    const keyPath = join(dir, PRIVATE_KEY_NAME);
    expect(readFileSync(keyPath, 'utf8')).toMatch(/^-----BEGIN ENCRYPTED PRIVATE KEY-----/);
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    // no passphrase given: nothing is written
    const bare = join(outside(), 'bare');
    expect(() => execFileSync(process.execPath, [cli, '--generate', bare], { encoding: 'utf8', input: '', stdio: ['pipe', 'pipe', 'pipe'] })).toThrow(/no passphrase/);
    expect(existsSync(join(bare, PRIVATE_KEY_NAME))).toBe(false);
  });

  it('an encrypted key signs only with its passphrase — a copied file alone signs nothing', () => {
    const phrase = 'correct horse battery staple';
    const { keyPath, publicKeyText, encrypted } = generateReleaseKey(outside(), { passphrase: phrase });
    expect(encrypted).toBe(true);
    expect(readFileSync(keyPath, 'utf8')).not.toMatch(/-----BEGIN PRIVATE KEY-----/);
    const release = outside();
    writeFileSync(join(release, 'latest-linux.yml'), FEED);
    expect(() => signFeeds({ dir: release, keyPath, expectedPublicKeyText: publicKeyText })).toThrow(/locked with a passphrase/);
    expect(() => signFeeds({ dir: release, keyPath, expectedPublicKeyText: publicKeyText, passphrase: 'not the phrase at all' })).toThrow(/does not open this key/);
    expect(existsSync(join(release, 'latest-linux.yml.sig'))).toBe(false);
    expect(signFeeds({ dir: release, keyPath, expectedPublicKeyText: publicKeyText, passphrase: phrase })).toEqual(['latest-linux.yml']);
    expect(signatureHolds(LINUX, FEED, readFileSync(join(release, 'latest-linux.yml.sig'), 'utf8'), releasePublicKey(publicKeyText))).toBe(true);
  });

  it('refuses a passphrase too short to stand against a copied file', () => {
    const dir = outside();
    expect(() => generateReleaseKey(dir, { passphrase: 'short' })).toThrow(/at least 12/);
    expect(existsSync(join(dir, PRIVATE_KEY_NAME))).toBe(false);
  });
});

describe('SHA256SUMS under the release key — what a person checks a hand download with', () => {
  const outside = () => mkdtempSync(join(tmpdir(), 'release-sums-'));
  const APP = 'Deus-Neuma-0.1.31-x86_64.AppImage';
  const DEB = 'neuma_0.1.31_amd64.deb';
  const hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

  // impure — a signed release folder on the real fs; returns its paths and public key
  const signedRelease = () => {
    const { keyPath, publicKeyText } = generateReleaseKey(outside());
    const dir = outside();
    const files = { [APP]: Buffer.from('appimage bytes'), [DEB]: Buffer.from('deb bytes') };
    for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), bytes);
    writeFileSync(join(dir, LINUX), FEED);
    writeFileSync(join(dir, 'SHA256SUMS'), Object.entries(files).map(([n, b]) => `${hex(b)}  ${n}\n`).join(''));
    expect(signFeeds({ dir, keyPath, expectedPublicKeyText: publicKeyText })).toEqual([LINUX, 'SHA256SUMS']);
    return { dir, publicKeyText };
  };

  it('--sign signs SHA256SUMS under its own name, and --verify holds every signature and sum', async () => {
    const { dir, publicKeyText } = signedRelease();
    const pub = releasePublicKey(publicKeyText);
    expect(signatureHolds('SHA256SUMS', readFileSync(join(dir, 'SHA256SUMS')), readFileSync(join(dir, 'SHA256SUMS.sig'), 'utf8'), pub)).toBe(true);
    const result = await verifyRelease({ dir, publicKeyText });
    expect(result.problems).toEqual([]);
    expect(result.fingerprint).toBe(fingerprintOf(publicKeyText));
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.verified).toEqual(['SHA256SUMS.sig', 'latest-linux.yml.sig', `${APP} sha256`, `${DEB} sha256`]);
  });

  it('a download whose bytes changed is refused by its sum', async () => {
    const { dir, publicKeyText } = signedRelease();
    writeFileSync(join(dir, DEB), 'other deb bytes');
    expect((await verifyRelease({ dir, publicKeyText })).problems).toEqual([`${DEB}: its sha256 is not the one SHA256SUMS names`]);
  });

  it('a tampered sum is refused by the signature on SHA256SUMS', async () => {
    const { dir, publicKeyText } = signedRelease();
    writeFileSync(join(dir, DEB), 'evil deb');
    writeFileSync(join(dir, 'SHA256SUMS'), `${hex(Buffer.from('appimage bytes'))}  ${APP}\n${hex(Buffer.from('evil deb'))}  ${DEB}\n`);
    const { problems } = await verifyRelease({ dir, publicKeyText });
    expect(problems).toEqual(['SHA256SUMS.sig: the signature does not match SHA256SUMS (altered, signed for another file, or by another key)']);
  });

  it('a person holding one download checks just that one; files not here are named, not failed', async () => {
    const { dir, publicKeyText } = signedRelease();
    rmSync(join(dir, APP));
    const result = await verifyRelease({ dir, publicKeyText });
    expect(result.problems).toEqual([]);
    expect(result.absent).toEqual([APP]);
    expect(result.verified).toContain(`${DEB} sha256`);
  });

  it('SHA256SUMS with no .sig, a .sig of another key, or a renamed signature is refused', async () => {
    const { dir, publicKeyText } = signedRelease();
    copyFileSync(join(dir, 'latest-linux.yml.sig'), join(dir, 'SHA256SUMS.sig'));
    expect((await verifyRelease({ dir, publicKeyText })).problems).toEqual(['SHA256SUMS.sig: the signature does not match SHA256SUMS (altered, signed for another file, or by another key)']);
    rmSync(join(dir, 'SHA256SUMS.sig'));
    expect((await verifyRelease({ dir, publicKeyText })).problems).toEqual(['SHA256SUMS has no SHA256SUMS.sig']);
    expect((await verifyRelease({ dir, publicKeyText: embeddedFormOf(keyB.publicKey) })).problems).toEqual([
      'latest-linux.yml.sig: the signature does not match latest-linux.yml (altered, signed for another file, or by another key)',
      'SHA256SUMS has no SHA256SUMS.sig',
    ]);
  });

  it('the --verify CLI checks against the EMBEDDED key — a folder signed by any other key fails, exit 1', () => {
    const { dir } = signedRelease();
    const cli = resolve(REPO_ROOT, 'scripts/release-key.mjs');
    const run = () => execFileSync(process.execPath, [cli, '--verify', '--dir', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    let failure = null;
    try { run(); } catch (error) { failure = error; }
    expect(failure?.status).toBe(1);
    // empty before the key ceremony; after it, the embedded key is not this test's fresh key
    expect(`${failure.stdout}`).toMatch(/^FAIL {4}(no release public key is embedded in this build|latest-linux\.yml\.sig: the signature does not match)/m);
  });
});
