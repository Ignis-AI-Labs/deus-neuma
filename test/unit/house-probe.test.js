/**
 * House probe — the house layer's hygiene checks, proven against a REAL tmp
 * house: lanes with and without owner.json, a birthed lane owing custody,
 * credential stores with wrong mode bits, and a plaintext-carrying env file
 * (fake key, real shape). The real neumaWorkspace singleton resolves lanes
 * through WORKSPACES_ROOT — no doubles anywhere in the claimed path. The
 * probe runs for ONE house (the wallet): another house's lanes on the same
 * ground never land in this house's findings.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { runHouseProbe } from '../../backend/services/security/house-probe.js';

const FAKE_EVM_KEY = `0x${'b2'.repeat(32)}`;

describe('house-probe (real tmp house)', () => {
  let house, workspacesRoot, settingsDir, repoRoot;
  const saved = {};
  const ENV = ['WORKSPACES_ROOT'];

  beforeEach(async () => {
    house = await createTempDir('house-probe');
    workspacesRoot = path.join(house, 'workspaces');
    settingsDir = path.join(house, 'settings');
    repoRoot = house;
    await fs.mkdir(workspacesRoot, { recursive: true });
    await fs.mkdir(settingsDir, { recursive: true });
    for (const k of ENV) { saved[k] = process.env[k]; }
    process.env.WORKSPACES_ROOT = workspacesRoot;
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  const probe = (over = {}) => runHouseProbe({
    wallet: '0xABC',
    workspace: neumaWorkspace,
    repoRoot,
    workspacesRoot,
    settingsDir,
    webAccessEnabled: false,
    ...over,
  });

  test('a lane without owner.json is flagged; a claimed lane is not', async () => {
    await fs.mkdir(path.join(workspacesRoot, 'orphanlane'));
    const owned = path.join(workspacesRoot, 'ownedlane');
    await fs.mkdir(owned);
    await fs.writeFile(path.join(owned, 'owner.json'), '{"wallet":"0xabc","claimedAt":"now"}');

    const { findings, errors } = await probe();
    expect(errors).toEqual([]);
    expect(findings.map((f) => f.externalId)).toContain('house:ownerless-lane:orphanlane');
    expect(findings.map((f) => f.externalId)).not.toContain('house:ownerless-lane:ownedlane');
  });

  test('a birthed lane with interim plaintext keys owes custody — critical', async () => {
    const lane = path.join(workspacesRoot, 'bornlane');
    await fs.mkdir(path.join(lane, 'keys'), { recursive: true });
    await fs.writeFile(path.join(lane, 'owner.json'), '{"wallet":"0xabc"}');
    await fs.writeFile(path.join(lane, 'keys', 'keypair.json'), '{"address":"0x…","privateKey":"…"}');

    const { findings } = await probe();
    const custody = findings.find((f) => f.externalId === 'house:keypair-custody:bornlane');
    expect(custody).toBeTruthy();
    expect(custody.severity).toBe('critical');
    expect(JSON.stringify(findings)).not.toContain('privateKey');
  });

  test('another house\'s lanes are never this house\'s findings; an ownerless lane is every house\'s', async () => {
    const theirs = path.join(workspacesRoot, 'theirlane');
    await fs.mkdir(path.join(theirs, 'keys'), { recursive: true });
    await fs.writeFile(path.join(theirs, 'owner.json'), '{"wallet":"0xdef"}');
    await fs.writeFile(path.join(theirs, 'keys', 'keypair.json'), '{"address":"0x…","privateKey":"…"}');
    await fs.mkdir(path.join(workspacesRoot, 'orphanlane'));

    const ours = (await probe()).findings.map((f) => f.externalId);
    expect(ours).not.toContain('house:keypair-custody:theirlane');
    expect(ours).toContain('house:ownerless-lane:orphanlane');
    const theirsSeen = (await probe({ wallet: '0xDEF' })).findings.map((f) => f.externalId);
    expect(theirsSeen).toContain('house:keypair-custody:theirlane');
  });

  test('a credential store at 0644 is flagged; 0600 is the law', async () => {
    const loose = path.join(settingsDir, 'provider-credentials.json');
    const tight = path.join(settingsDir, 'channel-credentials.json');
    await fs.writeFile(loose, '{}', { mode: 0o644 });
    await fs.writeFile(tight, '{}', { mode: 0o600 });

    const { findings } = await probe();
    const ids = findings.map((f) => f.externalId);
    expect(ids).toContain('house:perms:data/settings/provider-credentials.json');
    expect(ids).not.toContain('house:perms:data/settings/channel-credentials.json');
  });

  test('a plaintext-carrying env file is named, and its material never leaves it', async () => {
    await fs.writeFile(path.join(repoRoot, 'env.testwitness'), `WITNESS_PRIVATE_KEY=${FAKE_EVM_KEY}\n`);
    await fs.writeFile(path.join(repoRoot, 'env.sealedwitness'), 'WITNESS_KEYSTORE={"crypto":{}}\n');

    const { findings } = await probe();
    const ids = findings.map((f) => f.externalId);
    expect(ids).toContain('house:plaintext-secret:env.testwitness');
    expect(ids).not.toContain('house:plaintext-secret:env.sealedwitness');
    expect(findings.find((f) => f.externalId === 'house:plaintext-secret:env.testwitness').severity).toBe('critical');
    expect(JSON.stringify(findings)).not.toContain(FAKE_EVM_KEY);
  });

  test('the web-access switch rides as an inventory note, not a finding', async () => {
    const { notes, findings } = await probe({ webAccessEnabled: true });
    expect(notes.webAccessEnabled).toBe(true);
    expect(findings.find((f) => f.externalId.includes('web-access'))).toBeUndefined();
  });
});
