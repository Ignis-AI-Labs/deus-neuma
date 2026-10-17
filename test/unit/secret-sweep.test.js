/**
 * Secret sweep — proven against a REAL git repo built in tmp, with a REAL
 * planted (fake) key: the finding names file+line+pattern and the matched
 * secret NEVER appears in the output. The allowlist (examples, fixtures,
 * lockfiles) is proven to hold.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createTempDir } from '../helpers/temp-fs.js';
import { scanText, isAllowlisted, sweepRepo, sweepFindingsAsThreats } from '../../backend/services/security/secret-sweep.js';

const execFileP = promisify(execFile);
// A fake key with real SHAPE — the only honest test payload (never a real one).
const FAKE_EVM_KEY = `0x${'a1'.repeat(32)}`;
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
    expect(hits).toContainEqual({ line: 1, patternId: 'evm-private-key' });
    expect(hits).toContainEqual({ line: 3, patternId: 'github-token' });
    expect(hits).toContainEqual({ line: 4, patternId: 'private-key-block' });
    expect(JSON.stringify(hits)).not.toContain(FAKE_EVM_KEY.slice(0, 12));
    expect(JSON.stringify(hits)).not.toContain(FAKE_GH.slice(0, 10));
  });

  test('scanText does not cry wolf on honest hex (tx hashes, ids)', () => {
    expect(scanText(`"txHash": "${FAKE_EVM_KEY}"`)).toEqual([]); // no key-ish name in front
    expect(scanText('const answer = 42;')).toEqual([]);
  });

  test('sweepRepo walks TRACKED files only, and the leak lands as file+line+pattern', async () => {
    await fs.writeFile(path.join(repo, 'clean.js'), 'export const ok = 1;\n');
    await fs.writeFile(path.join(repo, 'leaked.txt'), `WITNESS_PRIVATE_KEY=${FAKE_EVM_KEY}\n`);
    await fs.writeFile(path.join(repo, 'untracked.txt'), `WITNESS_PRIVATE_KEY=${FAKE_EVM_KEY}\n`);
    await execFileP('git', ['add', 'clean.js', 'leaked.txt'], { cwd: repo });
    // untracked.txt is deliberately NOT added — gitignored-by-omission files
    // are the house probe's beat, not the sweep's.

    const result = await sweepRepo({ id: 'tmp-repo', path: repo });
    expect(result.error).toBeNull();
    expect(result.scanned).toBe(2);
    expect(result.findings).toEqual([{ file: 'leaked.txt', line: 1, patternId: 'evm-private-key' }]);
    expect(JSON.stringify(result)).not.toContain(FAKE_EVM_KEY);
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

  test('sweepFindingsAsThreats shapes ledger entries — high severity, no material', () => {
    const threats = sweepFindingsAsThreats({ id: 'neuma' }, [{ file: 'a.txt', line: 7, patternId: 'github-token' }]);
    expect(threats).toHaveLength(1);
    expect(threats[0]).toMatchObject({
      layer: 'software', source: 'secret-sweep', repo: 'neuma',
      severity: 'high', externalId: 'sweep:github-token:a.txt:7',
    });
    expect(threats[0].summary).toMatch(/deliberately not recorded/);
  });
});
