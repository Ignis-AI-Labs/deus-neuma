import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { encryptKeypair } from '../../core/wallet/keypair-vault.js';
import { createAuthRouter } from '../../backend/services/auth.js';
import { accessScopeMiddleware } from '../../backend/services/remote/access-guard.js';
import neumaAuthRouter from '../../backend/routes/neuma-auth-routes.js';
import recoveryRouter from '../../backend/routes/recovery-routes.js';
import walletRouter from '../../backend/routes/neuma-wallet-routes.js';

const neumaId = 'rotation-session-regression';
const oldPassword = 'old-real-test-password';
const newPassword = 'new-real-test-password';
let root;
let originalRoot;

beforeEach(async () => {
  root = await createTempDir('wallet-rotation-session');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
});

afterEach(async () => {
  setWorkspacesRoot(originalRoot);
});

test('rotation invalidates the old neuma token before it can use the replacement key', async () => {
  const oldWallet = ethers.Wallet.createRandom();
  const owner = ethers.Wallet.createRandom();
  await workspace.create(neumaId);
  await claimOwner(root, neumaId, owner.address);
  await workspace.writeEncryptedKeypair(neumaId, encryptKeypair({
    address: oldWallet.address, publicKey: oldWallet.publicKey, privateKey: oldWallet.privateKey,
  }, oldPassword));

  const app = express();
  app.use(express.json());
  app.use(accessScopeMiddleware);
  app.use('/api/v1/auth', createAuthRouter(express));
  app.use('/api/v1/neuma-auth', neumaAuthRouter);
  app.use('/api/v1/neuma', walletRouter);
  app.use('/api/v1/neuma', recoveryRouter);

  const challengeResponse = await request(app).get('/api/v1/auth/challenge').query({ address: owner.address });
  const challenge = challengeResponse.body.challenge;
  const signature = await owner.signMessage(challenge);
  const verified = await request(app).post('/api/v1/auth/verify').send({ address: owner.address, signature, challenge });
  expect(verified.status).toBe(200);
  const ownerToken = verified.body.token;
  const owned = (req) => req.set('Authorization', `Bearer ${ownerToken}`);

  const oldUnlock = await owned(request(app).post('/api/v1/neuma-auth/unlock')).send({ neumaId, password: oldPassword });
  expect(oldUnlock.status).toBe(200);
  const oldNeumaToken = oldUnlock.body.token;

  const rotated = await owned(request(app).post(`/api/v1/neuma/${neumaId}/recovery/rotate`)).send({ oldPassword, newPassword });
  expect(rotated.status).toBe(200);
  const newAddress = rotated.body.newAddress;
  const delivered = await owned(request(app).get(`/api/v1/neuma/${neumaId}/recovery/rotation/codes`));
  expect(delivered.status).toBe(200);
  expect(delivered.body.recoveryCodes).toEqual(rotated.body.recoveryCodes);
  const resumed = await owned(request(app).post(`/api/v1/neuma/${neumaId}/recovery/rotate`)).send({});
  expect(resumed.status).toBe(200);
  expect(resumed.body).toMatchObject({ newAddress, resumed: true });
  expect(resumed.body.recoveryCodes).toEqual(rotated.body.recoveryCodes);
  const acknowledged = await owned(request(app).post(`/api/v1/neuma/${neumaId}/recovery/rotation/ack`)).send({ address: newAddress });
  expect(acknowledged.status).toBe(200);
  expect((await owned(request(app).get(`/api/v1/neuma/${neumaId}/recovery/rotation/codes`))).status).toBe(404);

  const newUnlock = await owned(request(app).post('/api/v1/neuma-auth/unlock')).send({ neumaId, password: newPassword });
  expect(newUnlock.status).toBe(200);

  const message = 'neuma:post-rotation-session-check';
  const oldTokenAttempt = await request(app).post(`/api/v1/neuma/${neumaId}/wallet/sign-message`)
    .set('Authorization', `Bearer ${oldNeumaToken}`).send({ message });
  expect(oldTokenAttempt.status).toBe(401);
  expect(oldTokenAttempt.body.signature).toBeUndefined();

  const newTokenAttempt = await request(app).post(`/api/v1/neuma/${neumaId}/wallet/sign-message`)
    .set('Authorization', `Bearer ${newUnlock.body.token}`).send({ message });
  expect(newTokenAttempt.status).toBe(200);
  expect(ethers.verifyMessage(message, newTokenAttempt.body.signature)).toBe(newAddress);

  const retired = await owned(request(app).post(`/api/v1/neuma/${neumaId}/recovery/retired/${oldWallet.address}/reveal`))
    .send({ password: newPassword });
  expect(retired.status).toBe(200);
  const retiredSigner = new ethers.Wallet(retired.body.privateKey);
  expect(retiredSigner.address).toBe(oldWallet.address);
  const retiredMessage = 'neuma:retired-key-recovery-proof';
  expect(ethers.verifyMessage(retiredMessage, await retiredSigner.signMessage(retiredMessage))).toBe(oldWallet.address);
});
