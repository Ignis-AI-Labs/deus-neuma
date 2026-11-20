import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { keyListTextOf } from '../../scripts/publish-site/artifact-key.mjs';
import { feedPolicyProblems, prepareFeedForSigning } from '../../scripts/release/feed-policy.mjs';
import { appContentProblems, attestationProblems, contentRows, gitBlobSha } from '../../scripts/artifact-content.mjs';
import { verifyNativePrebuild } from '../../scripts/verify-native-prebuild.mjs';

const { embeddedFormOf } = createRequire(import.meta.url)('../../electron/release-signature.cjs');
const dirs = [];
const temp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-supply-'));
  dirs.push(dir);
  return dir;
};
const put = (root, name, bytes) => {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
};
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

const keySource = (keys) => `module.exports = { RELEASE_PUBLIC_KEY: '${keys[0]}' };\nmodule.exports.RELEASE_PUBLIC_KEYS = Object.freeze([\n${keys.map((key) => `  '${key}',`).join('\n')}\n]);\n`;
const keys = [generateKeyPairSync('ed25519').publicKey, generateKeyPairSync('ed25519').publicKey].map((key) => embeddedFormOf(key));

describe('the whole release key list', () => {
  it('accepts the ordered valid list and refuses malformed, duplicate, or reordered entries', () => {
    expect(keyListTextOf(keySource(keys))).toEqual(keys);
    const reordered = keySource([...keys].reverse()).replace(`RELEASE_PUBLIC_KEY: '${keys[1]}'`, `RELEASE_PUBLIC_KEY: '${keys[0]}'`);
    expect(() => keyListTextOf(reordered)).toThrow(/primary key/);
    expect(() => keyListTextOf(keySource([keys[0], keys[0]]))).toThrow(/duplicate/);
    expect(() => keyListTextOf(keySource([keys[0], 'bm90IGEga2V5']))).toThrow(/not an Ed25519/);
    expect(() => keyListTextOf(keySource(keys).replace(`  '${keys[1]}',`, '  nope,'))).toThrow(/malformed/);
  });
});

describe('signed feed freshness inputs', () => {
  const feed = 'version: 1.2.3\nfiles:\n  - url: app.AppImage\n    sha512: AAAA\n    size: 1\nreleaseDate: 2026-01-01T00:00:00.000Z\n';
  it('stamps a legitimate feed and accepts its signed values', () => {
    const signed = prepareFeedForSigning(feed, new Date('2026-01-02T00:00:00.000Z'));
    expect(feedPolicyProblems(signed, Date.parse('2026-01-03T00:00:00.000Z'))).toEqual([]);
    expect(signed).toContain('minimumVersion: 1.2.3');
  });
  it('refuses missing, future, pre-release, and wrong-floor values', () => {
    expect(feedPolicyProblems(feed, Date.parse('2026-01-03T00:00:00.000Z'))).toContain('signedAt is missing or is not an exact ISO timestamp');
    const future = prepareFeedForSigning(feed, new Date('2026-01-04T00:00:00.000Z'));
    expect(feedPolicyProblems(future, Date.parse('2026-01-03T00:00:00.000Z'))).toContain('signedAt is in the future');
    const early = prepareFeedForSigning(feed, new Date('2025-12-31T00:00:00.000Z'));
    expect(feedPolicyProblems(early, Date.parse('2026-01-03T00:00:00.000Z'))).toContain('signedAt is before the feed releaseDate');
    expect(feedPolicyProblems(future.replace('minimumVersion: 1.2.3', 'minimumVersion: 1.2.2'), Date.parse('2026-01-05T00:00:00.000Z'))).toContain('minimumVersion does not equal the feed version');
  });
});

describe('real app content attestation', () => {
  it('passes identical source/dependency/frontend bytes and refuses one-byte or extra-file changes', () => {
    const root = temp();
    const reference = path.join(root, 'reference');
    const app = path.join(root, 'app');
    const files = { 'backend/server.js': 'real source\n', 'node_modules/x/index.js': 'real dependency\n', 'dist/index.html': 'real frontend\n' };
    for (const [name, bytes] of Object.entries(files)) { put(reference, name, bytes); put(app, name, bytes); }
    const publicBlobs = { 'backend/server.js': gitBlobSha(Buffer.from(files['backend/server.js'])) };
    expect(appContentProblems({ appRoot: app, referenceRoot: reference, publicBlobs })).toEqual([]);
    const attestation = { schemaVersion: 1, files: contentRows(app) };
    expect(attestationProblems({ appRoot: app, attestation })).toEqual([]);
    const badDigest = { schemaVersion: 1, files: { ...attestation.files, 'backend/server.js': null } };
    expect(attestationProblems({ appRoot: app, attestation: badDigest })).toContain('backend/server.js: attestation has no full SHA-256');
    put(app, 'node_modules/x/index.js', 'hostile dependency\n');
    expect(appContentProblems({ appRoot: app, referenceRoot: reference, publicBlobs }).join('\n')).toMatch(/node_modules.*differs/);
    expect(attestationProblems({ appRoot: app, attestation }).join('\n')).toMatch(/node_modules.*attestation/);
    put(app, 'dist/index.html', 'hostile frontend\n');
    expect(appContentProblems({ appRoot: app, referenceRoot: reference, publicBlobs }).join('\n')).toMatch(/dist.*differs/);
    put(app, 'docs/private.md', 'not public\n');
    expect(appContentProblems({ appRoot: app, referenceRoot: reference, publicBlobs }).join('\n')).toMatch(/not in the public tree/);
    expect(attestationProblems({ appRoot: app, attestation }).join('\n')).toMatch(/absent from the content attestation/);
  });
});

describe('native prebuild verification', () => {
  it('accepts the real expected binary and refuses altered bytes or an absent pin', () => {
    const file = path.join(temp(), 'better_sqlite3.node');
    fs.writeFileSync(file, 'real native bytes');
    const expectedSha256 = createHash('sha256').update('real native bytes').digest('hex');
    expect(verifyNativePrebuild({ file, expectedSha256 })).toBeNull();
    fs.appendFileSync(file, 'x');
    expect(verifyNativePrebuild({ file, expectedSha256 })).toMatch(/not the reviewed/);
    expect(verifyNativePrebuild({ file, expectedSha256: null })).toMatch(/no reviewed SHA-256 pin/);
  });
});

describe('release input source gates', () => {
  const linux = fs.readFileSync(new URL('../../scripts/release/ship-linux.mjs', import.meta.url), 'utf8');
  const whisper = fs.readFileSync(new URL('../../scripts/speech/build-whisper-cuda.sh', import.meta.url), 'utf8');
  it('Linux installs from its public lock and scans/hashes dependencies', () => {
    expect(linux).toContain('installLinuxDependencies({ work: WORK, source })');
    expect(linux).not.toMatch(/cp['"]?, \[['"]?-a.*node_modules/);
    expect(linux).not.toMatch(/--exclude['"]?,\s*['"]node_modules/);
    expect(linux).not.toContain("-not -path './node_modules/*'");
  });
  it('whisper uses immutable source, image, apt, and hashed Python inputs', () => {
    expect(whisper).toContain('COMMIT=d1be6fde11ac6e0407606b4e42fe72d34add8037');
    expect(whisper).toContain('IMAGE=sha256:9abcaffc92a5279fff3a6a41635c0800ea33e528425fb389658806476e7defde');
    expect(whisper).toContain('SNAPSHOT=20261115T000000Z');
    expect(whisper).toContain('pip3 install -q --require-hashes -r /w/requirements.txt');
    const requirements = fs.readFileSync(new URL('../../scripts/speech/whisper-cuda-requirements.txt', import.meta.url), 'utf8');
    expect(requirements).toContain('cmake==3.31.6');
    expect(requirements.match(/--hash=sha256:[0-9a-f]{64}/g).length).toBe(19);
  });
});
