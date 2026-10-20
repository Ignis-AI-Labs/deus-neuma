// Two houses on one install (Design note, 2026-10-16: houses are never confused, at
// any level): two wallets found a house on the same network over one temp
// data root, and both founding records survive; every reader answers each
// wallet with its own house only. A legacy network-only record is read for
// the wallet its own Witness seat names, and for no other. Real disk, the
// real writer and readers, no mock.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ethers } from 'ethers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { writeFoundingRecord, readFoundingRecord } from '../../backend/services/house-founding-confirm.js';
import { houseSeatFor, houseTitlesByNeumaId } from '../../backend/services/house-titles.js';
import { houseWatchSet } from '../../backend/services/money-in/watch-set.js';

const OP_A = ethers.Wallet.createRandom().address;
const OP_B = ethers.Wallet.createRandom().address;
const SOUL_A = ethers.Wallet.createRandom().address;
const SOUL_B = ethers.Wallet.createRandom().address;

let root; let realm; let priorSettingsPath;

const writeLane = (id, owner, soul) => {
  mkdirSync(path.join(root, id, 'identity'), { recursive: true });
  writeFileSync(path.join(root, id, 'owner.json'), JSON.stringify({ wallet: owner.toLowerCase(), claimedAt: 1 }));
  writeFileSync(path.join(root, id, 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: soul }));
};

const recordFor = (operator, soul, houseName, title) => ({
  schema: 'neuma-house-founding/1', network: 'base', houseName, houseId: ethers.id(houseName),
  txHash: ethers.id(`${houseName}-tx`), blockNumber: 7,
  members: [{ address: operator, kind: 0, title: 'Rector' }, { address: soul, kind: 1, title }],
});

const foundingFiles = () => readdirSync(root).filter((n) => n.startsWith('house-founding.'));

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'house-founding-two-'));
  realm = mkdtempSync(path.join(os.tmpdir(), 'house-founding-two-realm-'));
  setWorkspacesRoot(root);
  setRealmRoot(realm);
  // Pin the stack so the house ground founding raises may live in this tmp world.
  priorSettingsPath = process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
  process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(realm, 'workspace-settings.json');
  writeLane('lane-a', OP_A, SOUL_A);
  writeLane('lane-b', OP_B, SOUL_B);
});

afterEach(() => {
  setWorkspacesRoot(null);
  setRealmRoot(path.join(os.homedir(), '.kenorie', 'realm'));
  if (priorSettingsPath === undefined) delete process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
  else process.env.NEUMA_WORKSPACE_SETTINGS_PATH = priorSettingsPath;
  rmSync(root, { recursive: true, force: true });
  rmSync(realm, { recursive: true, force: true });
});

describe('two wallets found a house on one install', () => {
  it('both records survive, and every reader answers each wallet with its own house only', async () => {
    await writeFoundingRecord(recordFor(OP_A, SOUL_A, 'house-a', 'Faber'));
    await writeFoundingRecord(recordFor(OP_B, SOUL_B, 'house-b', 'Curator'));
    expect(foundingFiles()).toHaveLength(2);

    expect((await readFoundingRecord('base', OP_A)).houseName).toBe('house-a');
    expect((await readFoundingRecord('base', OP_B)).houseName).toBe('house-b');

    const seatA = await houseSeatFor(OP_A, 'lane-a');
    const seatB = await houseSeatFor(OP_B, 'lane-b');
    expect(seatA).toMatchObject({ houseName: 'house-a', title: 'Faber', founded: true });
    expect(seatB).toMatchObject({ houseName: 'house-b', title: 'Curator', founded: true });
    expect(JSON.stringify(seatA)).not.toMatch(/house-b|Curator|lane-b/);
    expect(await houseTitlesByNeumaId(OP_A)).toEqual({ 'lane-a': 'Faber' });
    expect(await houseTitlesByNeumaId(OP_B)).toEqual({ 'lane-b': 'Curator' });

    const watchedA = (await houseWatchSet(OP_A)).watched.map((w) => w.address.toLowerCase());
    expect(watchedA).toContain(SOUL_A.toLowerCase());
    expect(watchedA).not.toContain(SOUL_B.toLowerCase());
  });

  it('a legacy network-only record is read for the wallet its Witness seat names, never for another', async () => {
    writeFileSync(path.join(root, 'house-founding.base.json'),
      JSON.stringify(recordFor(OP_B, SOUL_B, 'house-b', 'Curator')));
    await expect(readFoundingRecord('base', OP_A)).rejects.toThrow();
    expect((await readFoundingRecord('base', OP_B)).houseName).toBe('house-b');
    expect(await houseTitlesByNeumaId(OP_B)).toEqual({ 'lane-b': 'Curator' });
    expect((await houseSeatFor(OP_A, 'lane-a')).founded).toBe(false);

    // Wallet A founds here afterwards: B's legacy record stands untouched.
    await writeFoundingRecord(recordFor(OP_A, SOUL_A, 'house-a', 'Faber'));
    expect(foundingFiles()).toHaveLength(2);
    expect((await readFoundingRecord('base', OP_A)).houseName).toBe('house-a');
    expect((await readFoundingRecord('base', OP_B)).houseName).toBe('house-b');
  });
});
