import fs from 'node:fs/promises';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { sendTransaction } from '../../backend/services/neuma-wallet-spend.js';
import { spendMemo } from '../../core/wallet/spend-policy.js';
import { startAnvil } from '../helpers/money-in-kit.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { loadConfig, _resetConfig } from '../../backend/config.js';
import { resetChainProviders } from '../../backend/services/chain/chain-registry.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { accessScopeMiddleware } from '../../backend/services/remote/access-guard.js';
import authRouter, { hasCachedKey, evictCachedKey } from '../../backend/routes/neuma-auth-routes.js';
import recoveryRouter from '../../backend/routes/recovery-routes.js';
import { generateRecoveryCodes, hashRecoveryCodes } from '../../core/wallet/keypair-vault.js';

const child = new URL('../helpers/pr600-rate-slot-child.mjs', import.meta.url).pathname;
const signer = ethers.HDNodeWallet.fromPhrase('test test test test test test test test test test test junk');
const password = 'a-real-test-password';
let anvil; let provider; let root; let priorRoot; let priorRpc; let counter = 0;

const lane = async (prefix) => {
  const id = `${prefix}-${counter += 1}`;
  await workspace.create(id);
  return id;
};

const legacyEncrypt = (keypair, secret) => {
  const iterations = 100_000;
  const salt = crypto.randomBytes(32);
  const key = crypto.pbkdf2Sync(secret, salt, iterations, 32, 'sha512');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(keypair), 'utf8'), cipher.final()]);
  return {
    version: '1.0.0', algorithm: 'aes-256-gcm', kdf: 'pbkdf2', kdfIterations: iterations,
    salt: salt.toString('hex'), iv: iv.toString('hex'), ciphertext: ciphertext.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'), address: keypair.address, encryptedAt: new Date().toISOString(),
  };
};

const race = async () => {
  const runs = Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
    const childProcess = spawn(process.execPath, [child], {
      env: { ...process.env, RATE_SLOT_ROOT: root, RATE_SLOT_ATTEMPTS: '10' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    childProcess.stdout.on('data', (chunk) => { stdout += chunk; });
    childProcess.stderr.on('data', (chunk) => { stderr += chunk; });
    childProcess.once('error', reject);
    childProcess.once('exit', (code) => code === 0 ? resolve(JSON.parse(stdout.trim())) : reject(new Error(stderr)));
  }));
  return Promise.all(runs);
};

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 50 });
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pr600-wallet-spend-'));
  priorRoot = getWorkspacesRoot();
  priorRpc = process.env.BASE_MAINNET_RPC_URL;
  process.env.BASE_MAINNET_RPC_URL = anvil.url;
  loadConfig({ ...process.env, NODE_ENV: 'test', BASE_PUBLIC_RPC_URL: '' });
  setWorkspacesRoot(root);
}, 30000);

afterAll(async () => {
  provider?.destroy();
  await anvil?.stop();
  resetChainProviders();
  setWorkspacesRoot(priorRoot);
  if (priorRpc === undefined) delete process.env.BASE_MAINNET_RPC_URL; else process.env.BASE_MAINNET_RPC_URL = priorRpc;
  _resetConfig();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const entry of await fs.readdir(root)) await fs.rm(path.join(root, entry), { recursive: true, force: true });
  resetChainProviders();
  await provider.send('anvil_setBalance', [signer.address, ethers.toQuantity(ethers.parseEther('1'))]);
  await provider.send('anvil_setNextBlockBaseFeePerGas', [ethers.toQuantity(1_000_000_000n)]);
});

describe('P6-20 and P6-25 — cross-process allowance and bounded sends', () => {
  test('four real processes share exactly ten durable slots', async () => {
    await workspace.create('rate-limit-proof');
    const results = await race();
    expect(results.reduce((sum, result) => sum + result.granted, 0)).toBe(10);
    const files = await fs.readdir(path.join(root, 'rate-limit-proof', 'config', 'spend-rate-slots'));
    expect(files.filter((file) => file.endsWith('.json'))).toHaveLength(10);
  });

  test('an active legacy counter keeps only its remaining slots', async () => {
    const id = await lane('legacy');
    await workspace._writeJSON(path.join(workspace._path(id), 'config', 'spend-rate.json'), { windowStart: Date.now(), count: 8 });
    expect(await workspace.consumeSpendRateSlot(id, { limit: 10, windowMs: 3_600_000 })).toBe(true);
    expect(await workspace.consumeSpendRateSlot(id, { limit: 10, windowMs: 3_600_000 })).toBe(true);
    expect(await workspace.consumeSpendRateSlot(id, { limit: 10, windowMs: 3_600_000 })).toBe(false);
  });

  test('hostile recipient and extreme fee burn no slot; a real bounded transfer succeeds', async () => {
    const id = await lane('send');
    const recipient = ethers.Wallet.createRandom().address;
    const outsider = ethers.Wallet.createRandom().address;
    await workspace.writeSpendAllowlist(id, { version: 1, entries: [{ address: recipient }] });
    await workspace.writeSpendThreshold(id, { thresholdEth: 1 });
    const keypair = { address: signer.address, privateKey: signer.privateKey, publicKey: signer.publicKey };
    await expect(sendTransaction(id, { to: outsider, value: '0.000001' }, keypair)).rejects.toThrow(/not allowlisted/);
    const receipt = await sendTransaction(id, { to: recipient, value: '0.000001' }, keypair);
    expect(receipt.status).toBe(1);
    expect(receipt.from).toBe(signer.address);
    expect(receipt.to).toBe(recipient);
    const chainTx = await provider.getTransaction(receipt.hash);
    expect(chainTx.maxFeePerGas * chainTx.gasLimit).toBeLessThanOrEqual(ethers.parseEther('0.002'));
    await provider.send('anvil_setNextBlockBaseFeePerGas', [ethers.toQuantity(1_000_000_000_000_000n)]);
    await provider.send('anvil_mine', [1]);
    await expect(sendTransaction(id, { to: recipient, value: '0.000001' }, keypair)).rejects.toThrow(/over the 0\.002 ETH ceiling/);
    const files = await fs.readdir(path.join(root, id, 'config', 'spend-rate-slots'));
    expect(files.filter((file) => file.endsWith('.json'))).toHaveLength(1);
  });
});

describe('P6-31 — portable claims, unlock ordering, and recovery quota', () => {
  test('one nonce has exactly one winner under real concurrent exclusive writes', async () => {
    const id = await lane('nonce');
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => workspace.consumeSpendApproval(id, 'one-real-nonce', 2_000_000_000)));
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected').every((attempt) => attempt.reason.message === 'Operator approval already used')).toBe(true);
  });

  test('a failed legacy re-seal does not reject the correct password', async () => {
    const id = await lane('unlock');
    const owner = ethers.Wallet.createRandom();
    await claimOwner(root, id, owner.address);
    const keypair = { address: signer.address, privateKey: signer.privateKey, publicKey: signer.publicKey };
    await workspace.writeEncryptedKeypair(id, legacyEncrypt(keypair, password));
    const keys = path.join(root, id, 'keys');
    await fs.chmod(keys, 0o500);
    const app = express();
    app.use(express.json());
    app.use('/api/neuma-auth', authRouter);
    try {
      const response = await request(app).post('/api/neuma-auth/unlock')
        .set('Authorization', `Bearer ${createSessionToken(owner.address)}`).send({ neumaId: id, password });
      expect(response.status).toBe(200);
      expect(response.body.keyUpgradeRequired).toBe(true);
      expect(hasCachedKey(id)).toBe(true);
      evictCachedKey(id);
    } finally {
      await fs.chmod(keys, 0o700);
    }
  });

  test('valid codes pass once; eight hostile guesses lead to a durable 429', async () => {
    const validId = await lane('recovery-valid');
    const validOwner = ethers.Wallet.createRandom();
    await claimOwner(root, validId, validOwner.address);
    const validCodes = generateRecoveryCodes();
    await workspace.writeRecoveryHash(validId, hashRecoveryCodes(validCodes));
    const hostileId = await lane('recovery-hostile');
    const hostileOwner = ethers.Wallet.createRandom();
    await claimOwner(root, hostileId, hostileOwner.address);
    await workspace.writeRecoveryHash(hostileId, hashRecoveryCodes(generateRecoveryCodes()));
    const app = express();
    app.use(express.json());
    app.use(accessScopeMiddleware);
    app.use('/api/v1/neuma', recoveryRouter);
    const valid = await request(app).post(`/api/v1/neuma/${validId}/recovery/verify-codes`)
      .set('Authorization', `Bearer ${createSessionToken(validOwner.address)}`).send({ recoveryCodes: validCodes });
    expect(valid.status).toBe(200);
    const wrong = generateRecoveryCodes();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await request(app).post(`/api/v1/neuma/${hostileId}/recovery/verify-codes`)
        .set('Authorization', `Bearer ${createSessionToken(hostileOwner.address)}`).send({ recoveryCodes: wrong });
      expect(response.status).toBe(401);
    }
    const limited = await request(app).post(`/api/v1/neuma/${hostileId}/recovery/verify-codes`)
      .set('Authorization', `Bearer ${createSessionToken(hostileOwner.address)}`).send({ recoveryCodes: wrong });
    expect(limited.status).toBe(429);
  });
});

describe('P6-INFO-SPEND-MEMOS', () => {
  test('ordinary Unicode survives and every bidi/zero-width control is stripped', () => {
    expect(spendMemo('Café ผู้ให้บริการ — ordinary text')).toBe('Café ผู้ให้บริการ — ordinary text');
    const hostile = 'pay\u202E\u200B now\u2066\ufeff\u00ad';
    expect(spendMemo(hostile)).toBe('pay now');
    expect(spendMemo(`${'a'.repeat(280)}\u200B`)).toHaveLength(280);
    expect(spendMemo(`${'a'.repeat(280)}\u200B`)).not.toContain('\u200B');
  });
});
