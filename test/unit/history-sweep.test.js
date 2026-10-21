/**
 * History sweep — proven on REAL git repos built in tmp: a FAKE key planted
 * in an old commit and later deleted (the HEAD sweep reads clean; the history
 * sweep must not), a real bare remote that the commit is pushed to, one
 * sample of every rule run through git's real pickaxe, and the end-to-end
 * escalation of an env file whose value leaked through another file. The
 * matched value never appears in any output.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { HDNodeWallet } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { sweepRepo } from '../../backend/services/security/secret-sweep.js';
import { sweepRepoHistory, escalateLeakedEnvFindings } from '../../backend/services/security/history-sweep.js';
import { runHouseProbe } from '../../backend/services/security/house-probe.js';

const execFileP = promisify(execFile);
const FAKE_EVM_KEY = `0x${'d4'.repeat(32)}`;

const git = (cwd, ...args) => execFileP('git', [
  '-c', 'user.name=history-test', '-c', 'user.email=history@test.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null',
  ...args,
], { cwd });

// impure — write files then commit them; returns the new commit's sha.
const commit = async (repo, files, message) => {
  for (const [rel, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(repo, rel)), { recursive: true });
    await fs.writeFile(path.join(repo, rel), body);
  }
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', message);
  return (await git(repo, 'rev-parse', 'HEAD')).stdout.trim();
};

describe('history-sweep (real tmp git repos)', () => {
  let repo;
  beforeEach(async () => {
    repo = await createTempDir('history-sweep');
    await git(repo, 'init', '-q', '-b', 'main');
  });

  test('a key planted in an old commit and later deleted: HEAD reads clean, history names the commit', async () => {
    await commit(repo, { 'README.md': '# app\n' }, 'start');
    const planted = await commit(repo, { 'docs/notes.md': `deploy with\nDEPLOYER_PRIVATE_KEY=${FAKE_EVM_KEY}\n` }, 'notes');
    await fs.rm(path.join(repo, 'docs', 'notes.md'));
    await commit(repo, {}, 'remove the notes');

    expect((await sweepRepo({ id: 'tmp', path: repo })).findings).toEqual([]);

    const result = await sweepRepoHistory({ id: 'tmp', path: repo });
    expect(result.error).toBeNull();
    expect(result.findings).toHaveLength(1);
    const [f] = result.findings;
    expect(f).toMatchObject({
      layer: 'software', source: 'secret-sweep', repo: 'tmp',
      patternId: 'evm-private-key', commit: planted, path: 'docs/notes.md',
      onRemote: false, commits: 1, severity: 'high', surfaces: ['docs/notes.md'],
    });
    expect(f.externalId).toMatch(/^history:evm-private-key:[0-9a-f]{8}$/);
    expect(f.summary).toContain(planted.slice(0, 12));
    expect(f.summary).toMatch(/No remote branch holds it yet/);
    expect(JSON.stringify(result)).not.toContain(FAKE_EVM_KEY.slice(2, 20));
  });

  test('once a remote branch holds the commit, the finding is CRITICAL and says the value has left', async () => {
    await commit(repo, { 'docs/notes.md': `DEPLOYER_PRIVATE_KEY=${FAKE_EVM_KEY}\n` }, 'notes');
    await commit(repo, { 'docs/notes.md': 'redacted\n' }, 'redact');
    const remote = await createTempDir('history-sweep-remote');
    await git(remote, 'init', '-q', '--bare');
    await git(repo, 'remote', 'add', 'origin', remote);
    await git(repo, 'push', '-q', 'origin', 'main');
    await git(repo, 'fetch', '-q', 'origin');

    const [f] = (await sweepRepoHistory({ id: 'tmp', path: repo })).findings;
    expect(f).toMatchObject({ onRemote: true, severity: 'critical' });
    expect(f.summary).toMatch(/A remote branch holds it/);
  });

  test('every rule reaches the history through git\'s pickaxe prefilter (one fake sample each)', async () => {
    const samples = {
      'a/evm.md': `wallet SECRET_KEY: ${FAKE_EVM_KEY}`,
      'a/gh.md': `token ghp_${'Z'.repeat(36)}`,
      'a/openai.md': `OPENAI=sk-${'q'.repeat(24)}`,
      'a/slack.md': `SLACK=xoxb-1234567890-${'w'.repeat(12)}`,
      'a/aws.md': `AWS=AKIA${'Q'.repeat(16)}`,
      'a/pem.md': '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAfakefakefake\n-----END RSA PRIVATE KEY-----',
    };
    await commit(repo, Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, `${v}\n`])), 'samples');
    await fs.rm(path.join(repo, 'a'), { recursive: true });
    await commit(repo, {}, 'gone');

    const rules = (await sweepRepoHistory({ id: 'tmp', path: repo })).findings.map((f) => f.patternId).sort();
    expect(rules).toEqual(['aws-access-key', 'evm-private-key', 'github-token', 'openai-key', 'private-key-block', 'slack-token']);
  });

  test('one value in many commits and paths is one finding, traced to where it entered', async () => {
    const first = await commit(repo, { 'one.txt': `PRIVATE_KEY=${FAKE_EVM_KEY}\n` }, 'first');
    await commit(repo, { 'two.txt': `OTHER_PRIVATE_KEY="${FAKE_EVM_KEY}"\n` }, 'second');
    const { findings } = await sweepRepoHistory({ id: 'tmp', path: repo });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ commit: first, path: 'one.txt', commits: 2 });
    expect(findings[0].surfaces.sort()).toEqual(['one.txt', 'two.txt']);
  });

  test('the allowlist and the public dev keys hold in history too', async () => {
    const anvil0 = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', '', "m/44'/60'/0'/0").deriveChild(0).privateKey;
    await commit(repo, {
      'test/fixture.txt': `PRIVATE_KEY=${FAKE_EVM_KEY}\n`,
      'script/Deploy.s.sol': `// Anvil #0\nuint256 PRIVATE_KEY = ${anvil0};\n`,
    }, 'fixtures');
    const result = await sweepRepoHistory({ id: 'tmp', path: repo });
    expect(result).toMatchObject({ error: null, findings: [] });
  });

  test('a gone path and a non-repo directory are honest errors, never a clean bill', async () => {
    const gone = await sweepRepoHistory({ id: 'gone', path: path.join(repo, 'nope') });
    expect(gone.error).toBe(`watched repo path is gone: ${path.join(repo, 'nope')}`);
    const plain = await createTempDir('history-sweep-plain');
    const notRepo = await sweepRepoHistory({ id: 'plain', path: plain });
    expect(notRepo.findings).toEqual([]);
    expect(notRepo.error).toMatch(/^git log failed: /);
  });

  test('an env file never committed itself, whose value leaked through a doc, is escalated to rotate', async () => {
    const leaked = await commit(repo, { 'docs/audit.md': `DEPLOYER_PRIVATE_KEY=${FAKE_EVM_KEY}\n` }, 'audit notes');
    await commit(repo, { 'docs/audit.md': 'DEPLOYER_PRIVATE_KEY=0x…REDACTED\n' }, 'redact');
    await fs.writeFile(path.join(repo, '.env'), `DEPLOYER_PRIVATE_KEY=${FAKE_EVM_KEY}\n`, { mode: 0o600 });
    await fs.writeFile(path.join(repo, 'env.other'), `WITNESS_PRIVATE_KEY=0x${'e5'.repeat(32)}\n`, { mode: 0o600 });
    const workspacesRoot = await createTempDir('history-sweep-lanes');
    const savedRoot = process.env.WORKSPACES_ROOT;
    process.env.WORKSPACES_ROOT = workspacesRoot;
    try {
      const houseRun = await runHouseProbe({ wallet: '0xabc', workspace: neumaWorkspace, repoRoot: repo, settingsDir: workspacesRoot });
      const history = await sweepRepoHistory({ id: 'tmp', path: repo });
      const escalated = escalateLeakedEnvFindings(houseRun.findings, history.findings);
      const env = escalated.find((f) => f.externalId === 'house:plaintext-secret:.env');
      const other = escalated.find((f) => f.externalId === 'house:plaintext-secret:env.other');
      expect(houseRun.findings.find((f) => f.externalId === 'house:plaintext-secret:.env').severity).toBe('high');
      expect(env.severity).toBe('critical');
      expect(env.summary).toContain(`tmp commit ${leaked.slice(0, 12)} (docs/audit.md)`);
      expect(other.severity).toBe('high');
      expect(JSON.stringify(escalated)).not.toContain(FAKE_EVM_KEY.slice(2, 20));
    } finally {
      if (savedRoot === undefined) delete process.env.WORKSPACES_ROOT;
      else process.env.WORKSPACES_ROOT = savedRoot;
    }
  });
});
