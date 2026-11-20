import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { encryptKeypair } from '../../core/wallet/keypair-vault.js';
import { createAuthRouter } from '../../backend/services/auth.js';
import { createSessionToken } from '../../backend/services/auth.js';
import neumaAuthRouter from '../../backend/routes/neuma-auth-routes.js';
import recoveryRouter from '../../backend/routes/recovery-routes.js';
import { claimOwner } from './claim-owner.js';

const root = process.env.WALLET_CRASH_ROOT;
const phase = process.env.WALLET_CRASH_PHASE;
const neumaId = 'rotation-crash';
const oldPassword = 'old-rotation-password';
const newPassword = 'new-rotation-password';
const owner = new ethers.Wallet(process.env.WALLET_CRASH_OWNER_KEY);
setWorkspacesRoot(root);
await workspace.create(neumaId);
await claimOwner(root, neumaId, owner.address);
if (phase === 'crash') {
  const oldWallet = ethers.Wallet.createRandom();
  await workspace.writeEncryptedKeypair(neumaId, encryptKeypair({
    address: oldWallet.address, publicKey: oldWallet.publicKey, privateKey: oldWallet.privateKey,
  }, oldPassword));
}
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.accessScope = 'local'; next(); });
app.use('/api/v1/auth', createAuthRouter(express));
app.use('/api/v1/neuma-auth', neumaAuthRouter);
app.use('/api/v1/neuma', recoveryRouter);
const token = createSessionToken(owner.address);
const authed = (req) => req.set('Authorization', `Bearer ${token}`);
process.send({ type: 'ready', phase });
if (phase === 'crash') {
  const response = await authed(request(app).post(`/api/v1/neuma/${neumaId}/recovery/rotate`)).send({ oldPassword, newPassword });
  process.send({ type: 'responded', status: response.status, body: response.body });
} else {
  const delivered = await authed(request(app).get(`/api/v1/neuma/${neumaId}/recovery/rotation/codes`));
  const body = delivered.body;
  const acknowledged = await authed(request(app).post(`/api/v1/neuma/${neumaId}/recovery/rotation/ack`)).send({ address: body.newAddress });
  process.send({ type: 'resumed', delivered: delivered.status, codes: body.recoveryCodes, address: body.newAddress, acknowledged: acknowledged.status });
}
process.exit(0);
