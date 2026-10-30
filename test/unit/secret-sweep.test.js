/**
 * Secret sweep — proven against a REAL git repo built in tmp, with a REAL
 * planted (fake) key: the finding names file+line+pattern+fingerprint and the
 * matched secret NEVER appears in the output. The id survives a moved line;
 * the published Anvil/Hardhat dev keys (derived for real from their public
 * mnemonic) are skipped; the allowlist (examples, fixtures, lockfiles) holds.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { HDNodeWallet } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { scanText, isAllowlisted, sweepRepo, sweepFindingsAsThreats } from '../../backend/services/security/secret-sweep.js';

const execFileP = promisify(execFile);
// A fake key with real SHAPE — the only honest test payload (never a real one).
const FAKE_EVM_KEY = `0x${'a1'.repeat(32)}`;
const OTHER_FAKE_KEY = `0x${'c3'.repeat(32)}`;
const FAKE_GH = `ghp_${'A'.repeat(40)}`;

describe('secret-sweep (real tmp git repo)', () => {
  let repo;
  beforeEach(async () => {
    repo = await createTempDir('secret-sweep');
    await execFileP('git', ['init'], { cwd: repo });
  });

  test('scanText finds the shapes that are secrets-or-nothing, with no match text kept', () => {
    const hits = scanText([
      `WITNESS_PRIVATE_KEY=${FAKE_EVM_KEY}`,
      'const fine = "nothing here";',
      `token: ${FAKE_GH}`,
      '-----BEGIN PRIVATE KEY-----',
    ].join('\n'));
    expect(hits.map(({ line, patternId }) => ({ line, patternId }))).toEqual([
      { line: 1, patternId: 'evm-private-key' },
      { line: 3, patternId: 'github-token' },
      { line: 4, patternId: 'private-key-block' },
    ]);
    for (const hit of hits) expect(hit.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(hits)).not.toContain(FAKE_EVM_KEY.slice(0, 12));
    expect(JSON.stringify(hits)).not.toContain(FAKE_GH.slice(0, 10));
  });

  test('a fingerprint follows the VALUE: same key under another name matches, another key does not', () => {
    const [a] = scanText(`WITNESS_PRIVATE_KEY=${FAKE_EVM_KEY}`);
    const [b] = scanText(`DEPLOYER_PRIVATE_KEY="${FAKE_EVM_KEY}"`);
    const [c] = scanText(`WITNESS_PRIVATE_KEY=${OTHER_FAKE_KEY}`);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
    // Two PEM keys share a header; their first body lines tell them apart.
    const [pemA] = scanText('-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC');
    const [pemB] = scanText('-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC');
    expect(pemA.fingerprint).not.toBe(pemB.fingerprint);
  });

  test('xAI keys and RPC URLs carrying their key are caught; a docs URL is not', () => {
    // Built at runtime so this file never trips the repo's own sweep.
    const xai = ['xai', 'K7'.repeat(25)].join('-');
    const rpc = `https://eth-mainnet.g.alchemy.com/v2/${'Zq9_'.repeat(6)}`;
    const infura = `https://mainnet.infura.io/v3/${'ab12'.repeat(8)}`;
    const hits = scanText([`XAI_API_KEY=${xai}`, `ETH_RPC_URL=${rpc}`, `url: ${infura}`,
      'see https://docs.alchemy.com/v2/reference', 'https://example.com/v2/abcdefghijklmnopqrstuvwxyz'].join('\n'));
    expect(hits.map((h) => `${h.line}:${h.patternId}`)).toEqual(['1:xai-key', '2:rpc-url-key', '3:rpc-url-key']);
  });

  test('scanText does not cry wolf on honest hex (tx hashes, ids)', () => {
    expect(scanText(`"txHash": "${FAKE_EVM_KEY}"`)).toEqual([]); // no key-ish name in front
    expect(scanText('const answer = 42;')).toEqual([]);
  });

  test('the ten published Anvil/Hardhat dev keys are skipped; any other key is not', () => {
    // Derived here from the mnemonic both tools publish; account #0's address
    // is the one their docs print, so the derivation is the tools' own.
    const root = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', '', "m/44'/60'/0'/0");
    const accounts = Array.from({ length: 10 }, (_, i) => root.deriveChild(i));
    expect(accounts[0].address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    for (const { privateKey } of accounts) {
      expect(scanText(`PRIVATE_KEY=${privateKey}`)).toEqual([]);
      expect(scanText(`PRIVATE_KEY=${privateKey.toUpperCase().replace('0X', '0x')}`)).toEqual([]);
    }
    expect(scanText(`PRIVATE_KEY=${root.deriveChild(10).privateKey}`)).toHaveLength(1); // #10 is no default account
    expect(scanText(`PRIVATE_KEY=${FAKE_EVM_KEY}`)).toHaveLength(1);
    // re-audit 2026-10-29, NEW-L3: a dev key first on a line once hid a real one after it
    const [hit] = scanText(`PRIVATE_KEY=${accounts[0].privateKey} PRIVATE_KEY=${FAKE_EVM_KEY}`);
    expect(hit?.patternId).toBe('evm-private-key');
    expect(hit.fingerprint).toBe(scanText(`PRIVATE_KEY=${FAKE_EVM_KEY}`)[0].fingerprint);
  });

  test('sweepRepo walks TRACKED files only, and the leak lands as file+line+pattern+fingerprint', async () => {
    await fs.writeFile(path.join(repo, 'clean.js'), 'export const ok = 1;\n');
    await fs.writeFile(path.join(repo, 'leaked.txt'), `WITNESS_PRIVATE_KEY=${FAKE_EVM_KEY}\n`);
    await fs.writeFile(path.join(repo, 'untracked.txt'), `WITNESS_PRIVATE_KEY=${FAKE_EVM_KEY}\n`);
    await execFileP('git', ['add', 'clean.js', 'leaked.txt'], { cwd: repo });
    // untracked.txt is deliberately NOT added — gitignored-by-omission files
    // are the house probe's beat, not the sweep's.

    const result = await sweepRepo({ id: 'tmp-repo', path: repo });
    expect(result.error).toBeNull();
    expect(result.scanned).toBe(2);
    expect(result.findings).toEqual([{ file: 'leaked.txt', line: 1, patternId: 'evm-private-key', fingerprint: expect.stringMatching(/^[0-9a-f]{8}$/) }]);
    expect(JSON.stringify(result)).not.toContain(FAKE_EVM_KEY);
  });

  test('a leak that moves down the file keeps its ledger id; the line rides in the summary', async () => {
    const file = path.join(repo, 'leaked.txt');
    await fs.writeFile(file, `WITNESS_PRIVATE_KEY=${FAKE_EVM_KEY}\n`);
    await execFileP('git', ['add', 'leaked.txt'], { cwd: repo });
    const before = sweepFindingsAsThreats({ id: 'r' }, (await sweepRepo({ id: 'r', path: repo })).findings);
    await fs.writeFile(file, `# a header\n# another\nWITNESS_PRIVATE_KEY=${FAKE_EVM_KEY}\n`);
    // The sweep reads what git holds, so the move counts once it is staged.
    await execFileP('git', ['add', 'leaked.txt'], { cwd: repo });
    const after = sweepFindingsAsThreats({ id: 'r' }, (await sweepRepo({ id: 'r', path: repo })).findings);
    expect(after[0].externalId).toBe(before[0].externalId);
    expect(after[0].externalId).not.toMatch(/:\d+$/);
    expect(after[0].summary).toContain('leaked.txt:3');
  });

  test('a watched repo whose path is gone says so, not "spawn git ENOENT"', async () => {
    const result = await sweepRepo({ id: 'gone', path: path.join(repo, 'no-such-checkout') });
    expect(result).toMatchObject({ repo: 'gone', scanned: 0, findings: [] });
    expect(result.error).toBe(`watched repo path is gone: ${path.join(repo, 'no-such-checkout')}`);
  });

  test('the allowlist holds: examples, test fixtures, and lockfiles are skipped', async () => {
    await fs.mkdir(path.join(repo, 'test'), { recursive: true });
    await fs.writeFile(path.join(repo, '.env.example'), `WITNESS_PRIVATE_KEY=${FAKE_EVM_KEY}\n`);
    await fs.writeFile(path.join(repo, 'test', 'fixture.txt'), `WITNESS_PRIVATE_KEY=${FAKE_EVM_KEY}\n`);
    await fs.writeFile(path.join(repo, 'package-lock.json'), `"integrity":"${FAKE_EVM_KEY}"`);
    await execFileP('git', ['add', '-A'], { cwd: repo });
    const result = await sweepRepo({ id: 'tmp-repo', path: repo });
    expect(result.findings).toEqual([]);
    expect(isAllowlisted('.env.example')).toBe(true);
    expect(isAllowlisted('test/fixture.txt')).toBe(true);
    // The ONE directory secrets were actually leaked into is IN SCOPE (#160):
    // exempting it made the standing watch blind exactly where it mattered.
    expect(isAllowlisted('docs/audit/archive/SESSION_01.md')).toBe(false);
    expect(isAllowlisted('backend/server.js')).toBe(false);
  });

  test("vendored upstream libraries are not this house's secrets: forge-std's public demo RPC keys never alert", async () => {
    // forge-std's StdChains.sol carries public demo RPC URLs every Foundry repo has.
    const demo = `string constant RPC = "https://eth-mainnet.g.alchemy.com/v2/${'Demo'.repeat(8)}";\n`;
    await fs.mkdir(path.join(repo, 'contracts', 'lib', 'forge-std', 'src'), { recursive: true });
    await fs.writeFile(path.join(repo, 'contracts', 'lib', 'forge-std', 'src', 'StdChains.sol'), demo);
    await fs.writeFile(path.join(repo, 'Deploy.sol'), demo);
    await execFileP('git', ['add', '-A'], { cwd: repo });
    const result = await sweepRepo({ id: 'tmp-repo', path: repo });
    expect(result.findings.map((f) => f.file)).toEqual(['Deploy.sol']); // our own file still alerts
    expect(isAllowlisted('lib/forge-std/foundry.toml')).toBe(true);
    expect(isAllowlisted('lib/forge-stdx/x.sol')).toBe(false);
  });

  test('sweepFindingsAsThreats shapes ledger entries — high severity, no material, no line in the id', () => {
    const threats = sweepFindingsAsThreats({ id: 'neuma' }, [{ file: 'a.txt', line: 7, patternId: 'github-token', fingerprint: '0badc0de' }]);
    expect(threats).toHaveLength(1);
    expect(threats[0]).toMatchObject({
      layer: 'software', source: 'secret-sweep', repo: 'neuma',
      severity: 'high', externalId: 'sweep:github-token:a.txt:0badc0de',
    });
    expect(threats[0].summary).toMatch(/deliberately not recorded/);
    expect(threats[0].summary).toContain('a.txt:7');
  });
});
