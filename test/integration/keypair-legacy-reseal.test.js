import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { sealLegacyEnvelope } from '../helpers/legacy-keypair-envelope.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  decryptKeypair, decryptWithRecoveryCodes, encryptWithRecoveryCodes,
  generateRecoveryCodes, hashRecoveryCodes, verifyRecoveryCodes,
} from '../../core/wallet/keypair-vault.js';
import { createSessionToken } from '../../backend/services/auth.js';
import neumaAuthRouter from '../../backend/routes/neuma-auth-routes.js';

let root;
let originalRoot;

beforeEach(async () => {
  root = await createTempDir('legacy-keypair-reseal');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
});

afterEach(() => setWorkspacesRoot(originalRoot));

test('a real legacy unlock persists a 600k envelope and preserves recovery', async () => {
  const neumaId = 'legacy-unlock';
  const password = 'legacy-envelope-password';
  const wallet = ethers.Wallet.createRandom();
  const keypair = { address: wallet.address, publicKey: wallet.publicKey, privateKey: wallet.privateKey };
  const owner = ethers.Wallet.createRandom();
  const codes = generateRecoveryCodes();
  await workspace.create(neumaId);
  await claimOwner(root, neumaId, owner.address);
  await workspace.writeEncryptedKeypair(neumaId, sealLegacyEnvelope(keypair, password));
  await workspace.writeRecoveryHash(neumaId, hashRecoveryCodes(codes));
  await workspace.writeRecoveryKeypair(neumaId, encryptWithRecoveryCodes(keypair, codes));

  const app = express();
  app.use(express.json());
  app.use('/api/neuma-auth', neumaAuthRouter);
  const unlocked = await request(app).post('/api/neuma-auth/unlock')
    .set('Authorization', `Bearer ${createSessionToken(owner.address)}`)
    .send({ neumaId, password });
  expect(unlocked.status).toBe(200);

  const persisted = await workspace.readEncryptedKeypair(neumaId);
  expect(persisted.kdfIterations).toBe(600_000);
  expect(decryptKeypair(persisted, password).address).toBe(wallet.address);
  expect(decryptWithRecoveryCodes(await workspace.readRecoveryKeypair(neumaId), codes).address).toBe(wallet.address);
  expect(verifyRecoveryCodes(codes, await workspace.readRecoveryHash(neumaId))).toBe(true);
});
