/**
 * Exact pending-spend approval over a real EVM: encrypted key on real disk,
 * real witness signature, real policy checks, and a real broadcast to Anvil.
 * No mock, stub, fake, or spy exists in the claimed path.
 */
import { spawn } from 'child_process';
import net from 'net';
import fs from 'fs/promises';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { encryptKeypair } from '../../core/wallet/keypair-vault.js';
import { buildApprovalMessage } from '../../core/wallet/spend-policy.js';
import { loadConfig } from '../../backend/config.js';
import { createAuthRouter } from '../../backend/services/auth.js';
import walletRouter from '../../backend/routes/neuma-wallet-routes.js';
import { requestSpend } from '../../backend/services/neuma-wallet.js';

const NEUMA_ID = 'approvedspendlive';
const MNEMONIC = 'test test test test test test test test test test test junk';
const PASSWORD = 'exact-spend-password';

const availablePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const waitForChain = async (provider) => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      await provider.getBlockNumber();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Anvil did not become ready');
};

describe('pending spend approval (real encrypted key + witness signature + EVM)', () => {
  let root;
  let originalRoot;
  let anvil;
  let provider;
  let neuma;
  let witness;
  let recipient;
  let secondRecipient;
  let app;
  let authToken;

  beforeAll(async () => {
    root = await createTempDir('wallet-approved-spend');
    originalRoot = getWorkspacesRoot();
    setWorkspacesRoot(root);

    const port = await availablePort();
    anvil = spawn('anvil', ['--silent', '--port', String(port), '--mnemonic', MNEMONIC], {
      stdio: 'ignore',
    });
    provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${port}`);
    await waitForChain(provider);
    loadConfig({ ...process.env, BASE_MAINNET_RPC_URL: `http://127.0.0.1:${port}` });

    neuma = ethers.HDNodeWallet.fromPhrase(MNEMONIC);
    witness = ethers.Wallet.createRandom();
    recipient = ethers.Wallet.createRandom().address;
    secondRecipient = ethers.Wallet.createRandom().address;

    await workspace.create(NEUMA_ID);
    await claimOwner(root, NEUMA_ID, witness.address);
    await workspace.writeEncryptedKeypair(NEUMA_ID, encryptKeypair({
      address: neuma.address,
      privateKey: neuma.privateKey,
    }, PASSWORD));
    await workspace.writeSpendAllowlist(NEUMA_ID, {
      version: 1,
      entries: [
        { address: recipient, label: 'approved recipient', addedAt: new Date().toISOString() },
        { address: secondRecipient, label: 'second approved recipient', addedAt: new Date().toISOString() },
      ],
    });
    await workspace.writeSpendThreshold(NEUMA_ID, { thresholdEth: 0 });

    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRouter(express));
    app.use('/api/v1/neuma', walletRouter);

    const challengeResponse = await request(app)
      .get('/api/v1/auth/challenge')
      .query({ address: witness.address });
    const challenge = challengeResponse.body.challenge;
    const signature = await witness.signMessage(challenge);
    const verifyResponse = await request(app)
      .post('/api/v1/auth/verify')
      .send({ address: witness.address, signature, challenge });
    expect(verifyResponse.status).toBe(200);
    authToken = verifyResponse.body.token;
  }, 30000);

  afterAll(async () => {
    loadConfig(process.env);
    setWorkspacesRoot(originalRoot);
    anvil?.kill('SIGTERM');
    await fs.rm(root, { recursive: true, force: true });
  });

  test('wrong password moves nothing; exact witness approval sends once', async () => {
    const outcome = await requestSpend(NEUMA_ID, {
      to: recipient,
      value: '0.01',
      memo: 'real integration transfer',
    });
    expect(outcome.status).toBe('pending');

    const pendingResponse = await request(app)
      .get(`/api/v1/neuma/${NEUMA_ID}/wallet/pending`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(pendingResponse.status).toBe(200);
    const pendingRequest = pendingResponse.body.requests.find((item) => item.id === outcome.request.id);
    expect(pendingRequest).toMatchObject({
      id: outcome.request.id,
      nonce: outcome.request.nonce,
      expiry: outcome.request.expiry,
    });
    const message = buildApprovalMessage({ neumaId: NEUMA_ID, ...pendingRequest });
    const signature = await witness.signMessage(message);

    const wrongPassword = await request(app)
      .post(`/api/v1/neuma/${NEUMA_ID}/wallet/pending/${outcome.request.id}/approve`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ signature, password: 'wrong-password-value' });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.error).toBe('Wrong password');
    expect(await provider.getBalance(recipient)).toBe(0n);

    const approvalPath = `/api/v1/neuma/${NEUMA_ID}/wallet/pending/${outcome.request.id}/approve`;
    const [first, second] = await Promise.all([
      request(app).post(approvalPath).set('Authorization', `Bearer ${authToken}`).send({ signature, password: PASSWORD }),
      request(app).post(approvalPath).set('Authorization', `Bearer ${authToken}`).send({ signature, password: PASSWORD }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const approved = [first, second].find((response) => response.status === 200);
    const replay = [first, second].find((response) => response.status === 409);
    expect(replay.body.error).toMatch(/already executed/i);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe(1);
    expect(approved.body.from.toLowerCase()).toBe(neuma.address.toLowerCase());
    expect(approved.body.to.toLowerCase()).toBe(recipient.toLowerCase());
    expect(await provider.getBalance(recipient, approved.body.blockNumber)).toBe(ethers.parseEther('0.01'));
    const stored = await workspace.readPendingSpends(NEUMA_ID);
    expect(stored.find((item) => item.id === outcome.request.id)).toMatchObject({
      status: 'executed', txHash: approved.body.hash,
    });

    const secondOutcome = await requestSpend(NEUMA_ID, {
      to: secondRecipient,
      value: '0.02',
      memo: 'concurrent decision proof',
    });
    const secondMessage = buildApprovalMessage({ neumaId: NEUMA_ID, ...secondOutcome.request });
    const secondSignature = await witness.signMessage(secondMessage);
    const secondPath = `/api/v1/neuma/${NEUMA_ID}/wallet/pending/${secondOutcome.request.id}`;
    const [approveDecision, rejectDecision] = await Promise.all([
      request(app).post(`${secondPath}/approve`).set('Authorization', `Bearer ${authToken}`)
        .send({ signature: secondSignature, password: PASSWORD }),
      request(app).post(`${secondPath}/reject`).set('Authorization', `Bearer ${authToken}`).send({}),
    ]);
    expect([approveDecision.status, rejectDecision.status].sort()).toEqual([200, 409]);
    const secondStored = (await workspace.readPendingSpends(NEUMA_ID))
      .find((item) => item.id === secondOutcome.request.id);
    expect(['executed', 'rejected']).toContain(secondStored.status);
    const secondBalance = await provider.getBalance(
      secondRecipient,
      secondStored.status === 'executed' ? approveDecision.body.blockNumber : 'latest',
    );
    expect(secondBalance).toBe(secondStored.status === 'executed' ? ethers.parseEther('0.02') : 0n);
  }, 30000);
});
