// birth-finalize-crash-atomic.test.js — a finalize that dies between its
// identity writes leaves a birth a retry can finish, never a stuck one or a
// second keypair (RULE 0: the real finalizeBirth with the real birth deps the
// portal injects, a real workspace on real disk; the faults are real disk
// faults — a path occupied by a directory, a file cut short mid-write).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { finalizeBirth } from '../../core/birth/finalize-birth.js';
import { generateKeypair, serializeForStorage } from '../../core/weave/keypair.js';
import { createIdentityCard } from '../../core/weave/identity-card.js';
import { forgeBirthIdentity } from '../../core/birth/identity-forge.js';
import { captureBirthMoment } from '../../core/identity/genesis-seal.js';

const WALLET = '0x4c013a6ed735da91f866ed08a92b1e089c6d0cce';
const DEPS = {
  generateKeypair,
  serializeKeypairForStorage: serializeForStorage,
  createIdentityCard,
  forgeBirthIdentity,
  captureBirthMoment,
  countWitnessBirths: async () => 1,
  loadWorkspaceSettings: async () => ({}),
  HONESTY_ANCHOR: 'honest',
};
const quietLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const session = (neumaId) => ({
  isTest: false, isResume: false, witnessName: 'Operator',
  data: { neumaId, chosenName: 'Steady', resonanceFrequency: 528, selfCreatedDNA: '# Me\n\nMine.' },
});
const finalize = (neumaId, events) => finalizeBirth({
  session: session(neumaId),
  connection: { walletAddress: WALLET, birthSession: `s-${neumaId}` },
  workspace, platform: null,
  emitComplete: (p) => events.push(p),
  birthLog: quietLog,
  getSubstrate: async () => ({ model: 'test' }),
  deps: DEPS,
});

describe('finalizeBirth — a crash between the identity writes', () => {
  let root;
  beforeAll(async () => {
    root = path.join(await createTempDir('finalize-crash'), 'house');
    setWorkspacesRoot(root);
  });
  afterAll(() => { setWorkspacesRoot(null); });

  it('a forge that dies before its true name lands leaves no seal — the retry finishes the birth', async () => {
    const neumaId = 'torn-name';
    // The true-name write fails for real: its path is occupied by a directory.
    const nameAt = path.join(root, neumaId, 'identity', 'true-name.json');
    await fs.mkdir(nameAt, { recursive: true });
    const first = [];
    expect((await finalize(neumaId, first)).completed).toBe(false);
    expect(first.find((e) => e.type === 'birth:completion_error')?.error).toBe('identity_forge_failed');
    // No seal names an identity whose true name never landed.
    expect(await workspace.readGenesisSeal(neumaId)).toBeNull();

    await fs.rm(nameAt, { recursive: true });
    const second = [];
    expect((await finalize(neumaId, second)).completed).toBe(true);
    const seal = await workspace.readGenesisSeal(neumaId);
    const name = await workspace.readTrueName(neumaId);
    expect(name.genesisHash).toBe(seal.genesisHash);
    expect(second.find((e) => e.type === 'birth:complete')?.trueName.fullName).toBe(name.fullName);
  });

  it('a seal cut short mid-write is refused — never a second keypair forged over the first', async () => {
    const neumaId = 'torn-seal';
    // A lane as a crash under a plain write left it: keypair and card
    // forged, the seal file truncated mid-JSON.
    await workspace.create(neumaId);
    await fs.writeFile(path.join(root, neumaId, 'owner.json'), JSON.stringify({ wallet: WALLET.toLowerCase(), claimedAt: 1 }));
    const keypair = generateKeypair();
    await workspace.writeKeypair(neumaId, serializeForStorage(keypair));
    const keyBefore = await fs.readFile(path.join(root, neumaId, 'keys', 'keypair.json'));
    await fs.mkdir(path.join(root, neumaId, 'identity'), { recursive: true });
    await fs.writeFile(path.join(root, neumaId, 'identity', 'genesis-seal.json'), '{"genesisHash":"ab12');

    const events = [];
    expect((await finalize(neumaId, events)).completed).toBe(false);
    const err = events.find((e) => e.type === 'birth:completion_error');
    expect(err.message).toMatch(/retry_identity_unreadable/);
    expect((await fs.readFile(path.join(root, neumaId, 'keys', 'keypair.json'))).equals(keyBefore)).toBe(true);
  });
});
