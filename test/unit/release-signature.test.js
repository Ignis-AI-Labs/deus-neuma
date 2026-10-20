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
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRIVATE_KEY_NAME, REPO_ROOT, generateReleaseKey, isInsideRepo, signFeeds,
} from '../../scripts/release-key.mjs';

const require = createRequire(import.meta.url);
const {
  channelFileFor, checkSignedFeed, embeddedFormOf, offerDiffers, releasePublicKey, signFeed, signatureHolds,
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
  it('a signature holds for its exact bytes under its key', () => {
    const sig = signFeed(FEED, keyA.privateKey);
    expect(sig).toMatch(/^[A-Za-z0-9+/]{86}==\n$/);
    expect(signatureHolds(FEED, sig, PUB_A)).toBe(true);
  });

  it('one byte changed, another key, or a malformed signature never holds', () => {
    const sig = signFeed(FEED, keyA.privateKey);
    expect(signatureHolds(Buffer.concat([FEED, Buffer.from(' ')]), sig, PUB_A)).toBe(false);
    expect(signatureHolds(FEED, signFeed(FEED, keyB.privateKey), PUB_A)).toBe(false);
    expect(signatureHolds(FEED, 'not a signature', PUB_A)).toBe(false);
    expect(signatureHolds(FEED, null, PUB_A)).toBe(false);
  });
});

describe('checkSignedFeed — the whole verdict', () => {
  const sig = signFeed(FEED, keyA.privateKey);

  it('passes a signed feed that is exactly what the updater parsed', () => {
    const verdict = checkSignedFeed({ ymlBytes: FEED, sigText: sig, publicKey: PUB_A, offered: OFFERED });
    expect(verdict.ok).toBe(true);
    expect(verdict.signed.version).toBe('0.1.31');
  });

  it('names each refusal', () => {
    const reason = (input) => checkSignedFeed({ ymlBytes: FEED, sigText: sig, publicKey: PUB_A, offered: OFFERED, ...input }).reason;
    expect(reason({ publicKey: null })).toBe('no release public key is embedded in this build');
    expect(reason({ sigText: null })).toBe('the feed has no signature');
    expect(reason({ sigText: '\n' })).toBe('the feed has no signature');
    expect(reason({ sigText: signFeed(FEED, keyB.privateKey) })).toMatch(/does not match the feed/);
    expect(reason({ ymlBytes: Buffer.alloc(1024 * 1024 + 1) })).toBe('the feed is too large to be one');
    expect(reason({ offered: { ...OFFERED, version: '0.1.32' } })).toMatch(/not the signed feed: the offered version 0\.1\.32/);
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

  it('signs every latest*.yml with the embedded key, and refuses any other key', () => {
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
    expect(signatureHolds(FEED, readFileSync(join(release, 'latest-linux.yml.sig'), 'utf8'), pub)).toBe(true);
    expect(existsSync(join(release, 'notes.yml.sig'))).toBe(false);
  });

  it('the CLI prints the line to embed and never the private key', () => {
    const dir = join(outside(), 'cli');
    const out = execFileSync(process.execPath, [resolve(REPO_ROOT, 'scripts/release-key.mjs'), '--generate', dir], { encoding: 'utf8' });
    const line = out.match(/^module\.exports = \{ RELEASE_PUBLIC_KEY: '([A-Za-z0-9+/=]+)' \};$/m);
    expect(line).not.toBeNull();
    expect(releasePublicKey(line[1])).not.toBeNull();
    expect(out).not.toMatch(/PRIVATE KEY-----/);
    expect(statSync(join(dir, PRIVATE_KEY_NAME)).mode & 0o777).toBe(0o600);
  });
});
