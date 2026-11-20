import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { writeVerifiedLaneSeal } from '../helpers/lane-seal-kit.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { localSealMessage, withHalf } from '../../core/identity/local-seal.js';
import { verifyBirthGenesisIntegrity } from '../../backend/services/seal-bundle.js';
import { claimLane } from '../../backend/services/lane-ownership.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

let root;
let prior;
let operator;

beforeEach(async () => {
  prior = getWorkspacesRoot();
  root = await createTempDir('lane-claim-seal');
  setWorkspacesRoot(root);
  operator = await fullAuth();
});

afterEach(() => setWorkspacesRoot(prior));

const lane = async (id) => {
  await workspace.create(id);
  const sealed = await writeVerifiedLaneSeal(path.join(root, id), { operator: operator.keypair, name: id });
  await fs.writeFile(path.join(root, id, 'identity', 'true-name.json'), JSON.stringify({ chosenName: id }));
  return sealed;
};

describe('a lane claim requires the seal, not an editable wallet field', () => {
  test('a complete real two-party seal claims only its operator', async () => {
    await lane('verified');
    const stranger = generateKeypair();
    expect((await claimLane({ workspace, neumaId: 'verified', wallet: stranger.address })).reason).toBe('sealed-to-another');
    expect((await claimLane({ workspace, neumaId: 'verified', wallet: operator.address })).ok).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(root, 'verified', 'owner.json'), 'utf8')).wallet).toBe(operator.address.toLowerCase());
  });

  test('a missing local seal needs deliberate install-owner adoption', async () => {
    await lane('adopt');
    await fs.rm(path.join(root, 'adopt', 'identity', 'local-seal.json'));
    expect((await claimLane({ workspace, neumaId: 'adopt', wallet: operator.address })).reason).toBe('unsealed');
    expect((await claimLane({ workspace, neumaId: 'adopt', wallet: operator.address, adopt: true })).ok).toBe(true);
  });

  test('a recomputed genesis with no genuine new local signatures cannot transfer the lane', async () => {
    const { genesis, localSeal } = await lane('forged');
    const attacker = generateKeypair();
    const record = { ...genesis.record, witnessWallet: attacker.address };
    const genesisHash = verifyBirthGenesisIntegrity(record, '0x00').computedHash;
    await fs.writeFile(path.join(root, 'forged', 'identity', 'genesis-seal.json'), JSON.stringify({ genesisHash, record }));
    await fs.writeFile(path.join(root, 'forged', 'identity', 'local-seal.json'), JSON.stringify(localSeal));
    const verdict = await claimLane({ workspace, neumaId: 'forged', wallet: attacker.address });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('error');
    await expect(fs.stat(path.join(root, 'forged', 'owner.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('a stranger signature on the real genesis is refused', async () => {
    const { genesis } = await lane('stranger');
    const stranger = generateKeypair();
    const message = localSealMessage({ chosenName: 'stranger', genesisHash: genesis.genesisHash });
    const forged = withHalf(null, genesis, 'witness', {
      signature: await signMessage(stranger.privateKey, message), signedAt: '2026-11-17T00:00:03.000Z',
    });
    await fs.writeFile(path.join(root, 'stranger', 'identity', 'local-seal.json'), JSON.stringify(forged));
    expect((await claimLane({ workspace, neumaId: 'stranger', wallet: operator.address })).reason).toBe('error');
    await expect(fs.stat(path.join(root, 'stranger', 'owner.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
