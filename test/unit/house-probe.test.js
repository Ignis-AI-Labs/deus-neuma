/**
 * House probe — the house layer's hygiene checks, proven against a REAL tmp
 * house: lanes walked through the platform's own listing (a lane.json ground
 * is never a lane), unclaimed lanes judged by their genesis seal the way the
 * claim door judges them, keypair custody only where a plaintext key really
 * sits, credential stores with wrong mode bits, and env-style files of every
 * naming with a REAL git history deciding whether rotation is owed (fake
 * keys, real shapes). The real neumaWorkspace singleton resolves lanes
 * through WORKSPACES_ROOT — no doubles anywhere in the claimed path. The
 * probe runs for ONE house (the wallet): another house's lanes on the same
 * ground never land in this house's findings.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createTempDir } from '../helpers/temp-fs.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { runHouseProbe } from '../../backend/services/security/house-probe.js';

const execFileP = promisify(execFile);
const FAKE_EVM_KEY = `0x${'b2'.repeat(32)}`;
const OURS = '0xabc';

const git = (cwd, ...args) => execFileP('git', [
  '-c', 'user.name=probe-test', '-c', 'user.email=probe@test.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null',
  ...args,
], { cwd });

describe('house-probe (real tmp house)', () => {
  let house, workspacesRoot, settingsDir, repoRoot;
  let savedRoot;

  beforeEach(async () => {
    house = await createTempDir('house-probe');
    workspacesRoot = path.join(house, 'workspaces');
    settingsDir = path.join(house, 'settings');
    repoRoot = path.join(house, 'repo');
    await fs.mkdir(workspacesRoot, { recursive: true });
    await fs.mkdir(settingsDir, { recursive: true });
    await fs.mkdir(repoRoot, { recursive: true });
    savedRoot = process.env.WORKSPACES_ROOT;
    process.env.WORKSPACES_ROOT = workspacesRoot;
  });
  afterEach(() => {
    if (savedRoot === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = savedRoot;
  });

  const probe = (over = {}) => runHouseProbe({
    wallet: '0xABC',
    workspace: neumaWorkspace,
    repoRoot,
    settingsDir,
    webAccessEnabled: false,
    ...over,
  });
  const ids = async (over) => (await probe(over)).findings.map((f) => f.externalId);

  // An inhabited lane, the way a birth leaves one: genesis on disk.
  const lane = async (name, { owner, sealedTo, keypair } = {}) => {
    const root = path.join(workspacesRoot, name);
    await fs.mkdir(path.join(root, 'dna'), { recursive: true });
    await fs.writeFile(path.join(root, 'dna', 'genesis.md'), '# genesis\n');
    if (owner) await fs.writeFile(path.join(root, 'owner.json'), JSON.stringify({ wallet: owner, claimedAt: 1 }));
    if (sealedTo) {
      await fs.mkdir(path.join(root, 'identity'), { recursive: true });
      await fs.writeFile(path.join(root, 'identity', 'genesis-seal.json'), JSON.stringify({ genesisHash: 'h', record: { witnessWallet: sealedTo } }));
    }
    if (keypair !== undefined) {
      await fs.mkdir(path.join(root, 'keys'), { recursive: true });
      if (keypair) await fs.writeFile(path.join(root, 'keys', 'keypair.json'), JSON.stringify(keypair));
    }
    return root;
  };

  test('a ground marked by lane.json is never called a lane, however inhabited it looks', async () => {
    // Marked grounds carry the same files a being's lane does (a witness lane
    // holds a genesis and keys) — only the platform's own listing tells them apart.
    for (const [name, kind] of [['house', 'house-ground'], ['beside', 'witness']]) {
      const root = await lane(name, { keypair: { address: '0x1', privateKey: FAKE_EVM_KEY } });
      await fs.writeFile(path.join(root, 'lane.json'), JSON.stringify({ kind }));
    }
    const { findings, errors } = await probe();
    expect(errors).toEqual([]);
    expect(findings.map((f) => f.externalId).filter((id) => /:(house|beside)$/.test(id))).toEqual([]);
  });

  test('an unsealed, unclaimed being is every house\'s to hear about — medium, with the claim door, never "first wallet owns it"', async () => {
    await lane('orphan');
    await lane('owned', { owner: OURS });
    const { findings, errors } = await probe();
    expect(errors).toEqual([]);
    const orphan = findings.find((f) => f.externalId === 'house:ownerless-lane:orphan');
    expect(orphan).toMatchObject({ severity: 'medium', title: 'lane orphan is unclaimed' });
    expect(orphan.summary).toContain('POST /api/v1/lanes/orphan/claim');
    expect(orphan.summary).not.toMatch(/first authenticated wallet/);
    expect(findings.map((f) => f.externalId)).not.toContain('house:ownerless-lane:owned');
    expect(await ids({ wallet: '0xDEF' })).toContain('house:ownerless-lane:orphan');
  });

  test('an unclaimed lane sealed to another house is never ours; sealed to us, it is ours to claim', async () => {
    await lane('theirs', { sealedTo: '0xDEF' });
    await lane('mine', { sealedTo: '0xAbC' });
    const ours = await probe();
    expect(ours.findings.map((f) => f.externalId)).not.toContain('house:ownerless-lane:theirs');
    const mine = ours.findings.find((f) => f.externalId === 'house:ownerless-lane:mine');
    expect(mine.summary).toMatch(/sealed to this house/);
    expect(await ids({ wallet: '0xdef' })).toContain('house:ownerless-lane:theirs');
  });

  test('a hollow scaffold (no being in it) is no unclaimed lane — nothing can read or claim it', async () => {
    await fs.mkdir(path.join(workspacesRoot, 'skeleton', 'memory'), { recursive: true });
    expect(await ids()).not.toContain('house:ownerless-lane:skeleton');
  });

  test('custody fires only on a plaintext key: empty keys/ and an enveloped key file are quiet', async () => {
    await lane('bare', { owner: OURS, keypair: { address: '0x1', privateKey: FAKE_EVM_KEY } });
    await lane('unborn', { owner: OURS, keypair: null });
    await lane('sealed', { owner: OURS, keypair: { _enc: 1, iv: 'aa', tag: 'bb', ct: 'cc' } });
    const { findings, errors } = await probe();
    expect(errors).toEqual([]);
    const custody = findings.filter((f) => f.externalId.startsWith('house:keypair-custody:'));
    expect(custody.map((f) => f.externalId)).toEqual(['house:keypair-custody:bare']);
    expect(custody[0].severity).toBe('critical');
    expect(JSON.stringify(findings)).not.toContain(FAKE_EVM_KEY);
  });

  test('another house\'s lanes are never this house\'s findings', async () => {
    await lane('theirlane', { owner: '0xdef', keypair: { address: '0x1', privateKey: FAKE_EVM_KEY } });
    expect(await ids()).not.toContain('house:keypair-custody:theirlane');
    expect(await ids({ wallet: '0xDEF' })).toContain('house:keypair-custody:theirlane');
  });

  test('a credential store at 0644 is flagged; 0600 is the law', async () => {
    await fs.writeFile(path.join(settingsDir, 'provider-credentials.json'), '{}', { mode: 0o644 });
    await fs.writeFile(path.join(settingsDir, 'channel-credentials.json'), '{}', { mode: 0o600 });
    const found = await ids();
    expect(found).toContain('house:perms:data/settings/provider-credentials.json');
    expect(found).not.toContain('house:perms:data/settings/channel-credentials.json');
  });

  test('every env-style name is checked; a never-committed 0600 file is HIGH and told to seal or move', async () => {
    await git(repoRoot, 'init', '-q');
    for (const name of ['.env', '.env.local', 'claude.env', 'env.glm', '.env.example']) {
      await fs.writeFile(path.join(repoRoot, name), `WITNESS_PRIVATE_KEY=${FAKE_EVM_KEY}\n`, { mode: 0o600 });
    }
    await fs.writeFile(path.join(repoRoot, 'env.sealedwitness'), 'WITNESS_KEYSTORE={"crypto":{}}\n', { mode: 0o600 });

    const { findings, errors } = await probe();
    expect(errors).toEqual([]);
    const env = Object.fromEntries(findings.filter((f) => f.externalId.startsWith('house:plaintext-secret:')).map((f) => [f.surfaces[0], f]));
    expect(Object.keys(env).sort()).toEqual(['.env', '.env.local', 'claude.env', 'env.glm']);
    for (const f of Object.values(env)) {
      expect(f.severity).toBe('high');
      expect(f.summary).toMatch(/never entered git history/);
      expect(f.summary).toMatch(/Seal it .* or move it out of the repo/);
      expect(f.fingerprints).toHaveLength(1);
    }
    expect(JSON.stringify(findings)).not.toContain(FAKE_EVM_KEY);
  });

  test('an env file that ever entered git history is CRITICAL and owes rotation, even after it left the index', async () => {
    await git(repoRoot, 'init', '-q');
    const file = path.join(repoRoot, '.env.test');
    await fs.writeFile(file, `DEPLOYER_PRIVATE_KEY=${FAKE_EVM_KEY}\n`, { mode: 0o600 });
    await git(repoRoot, 'add', '.env.test');
    await git(repoRoot, 'commit', '-q', '-m', 'oops');
    const { stdout: sha } = await git(repoRoot, 'rev-parse', '--short', 'HEAD');
    await git(repoRoot, 'rm', '-q', '--cached', '.env.test');
    await git(repoRoot, 'commit', '-q', '-m', 'untrack');

    const f = (await probe()).findings.find((x) => x.externalId === 'house:plaintext-secret:.env.test');
    expect(f.severity).toBe('critical');
    expect(f.summary).toContain(`entered git history (commit ${sha.trim()})`);
    expect(f.summary).toMatch(/rotate it first/);
  });

  test('a never-committed env file readable beyond its owner is CRITICAL and told to chmod', async () => {
    await git(repoRoot, 'init', '-q');
    const file = path.join(repoRoot, 'env.loose');
    await fs.writeFile(file, `WITNESS_PRIVATE_KEY=${FAKE_EVM_KEY}\n`);
    await fs.chmod(file, 0o644);
    const f = (await probe()).findings.find((x) => x.externalId === 'house:plaintext-secret:env.loose');
    expect(f.severity).toBe('critical');
    expect(f.summary).toContain('mode 0644 — chmod 600 it now');
  });

  test('the web-access switch rides as an inventory note, not a finding', async () => {
    const { notes, findings } = await probe({ webAccessEnabled: true });
    expect(notes.webAccessEnabled).toBe(true);
    expect(findings.find((f) => f.externalId.includes('web-access'))).toBeUndefined();
  });
});
