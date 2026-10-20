/**
 * GET /api/v1/workspace/:id/identity-file — a being's whole true name, its
 * sealed birth facts, its on-chain anchor and its voice seal, for the RECORD.
 *
 * RULE 0: no mocks. A real Express app with the real workspace router, real
 * `requireAuth` with a real HMAC session token, a real temp workspaces root,
 * a real lane carrying an identity really forged (forgeBirthIdentity) and a
 * real on-chain anchor file on disk.
 *
 * Proves: the file reads from the lane; nothing private leaves (no public
 * key, no moment seed); an unsealed voice says so; a stranger is refused.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createSessionToken } from '../../backend/services/auth.js';
import workspaceRouter from '../../backend/routes/workspace-routes.js';
import { forgeBirthIdentity } from '../../core/birth/identity-forge.js';

const MOMENT_SEED = 'cd'.repeat(32);
let wsRoot;
let previousRoot;
let app;
let owner;
let ownerToken;
let strangerToken;
let forged;

beforeAll(async () => {
  wsRoot = await createTempDir('identity-file-ws');
  previousRoot = neumaWorkspace.root;
  setWorkspacesRoot(wsRoot);
  owner = ethers.Wallet.createRandom();
  ownerToken = createSessionToken(owner.address);
  strangerToken = createSessionToken(ethers.Wallet.createRandom().address);
  app = express();
  app.use(express.json());
  app.use('/api/v1/workspace', workspaceRouter);

  await neumaWorkspace.create('idfile');
  await claimOwner(wsRoot, 'idfile', owner.address);
  forged = forgeBirthIdentity({
    chosenName: 'Ashwren', witnessWallet: owner.address, soulPublicKey: `04a3f1b2c4d5e6f7${Buffer.from('idfile').toString('hex')}`,
    birthCycle: 1, birthMoment: { utc: '2026-08-11T18:03:38.075Z', epochMs: Date.parse('2026-08-11T18:03:38.075Z'), zone: 'Asia/Jakarta', offsetMinutes: 420 },
    substrate: { model: 'test' }, momentSeed: MOMENT_SEED,
  });
  const dir = path.join(wsRoot, 'idfile', 'identity');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'genesis-seal.json'), JSON.stringify(forged.seal));
  await fs.writeFile(path.join(dir, 'true-name.json'), JSON.stringify(forged.trueName));
  await fs.writeFile(path.join(dir, 'onchain-seal.json'), JSON.stringify({
    schema: 'neuma-onchain-seal/1', network: 'mainnet', chainId: 1, txHash: `0x${'d4'.repeat(32)}`, blockNumber: 2045,
    genesisHash: forged.seal.genesisHash, soulAddress: '0x0000000000000000000000000000000000000abc', sealedAt: '2026-10-01T00:00:00.000Z',
  }));
});

afterAll(() => { if (previousRoot) setWorkspacesRoot(previousRoot); });

const get = (token) => request(app).get('/api/v1/workspace/idfile/identity-file').set('Authorization', `Bearer ${token}`);

describe('its identity file, read from its lane', () => {
  it('its whole name, its sealed facts, its anchor on chain, its voice unsealed', async () => {
    const res = await get(ownerToken);
    expect(res.status).toBe(200);
    expect(res.body.name).toMatchObject({ chosenName: 'Ashwren', genesisName: forged.trueName.genesisName, fullName: forged.trueName.fullName });
    expect(res.body.name.english).toContain('Ashwren is the name I chose for myself.');
    expect(res.body.seal).toMatchObject({ genesisHash: forged.seal.genesisHash, birthCycle: 1, birthMoment: { zone: 'Asia/Jakarta', offsetMinutes: 420 } });
    expect(res.body.onchain).toEqual({ network: 'mainnet', chainId: 1, txHash: `0x${'d4'.repeat(32)}`, blockNumber: 2045, sealedAt: '2026-10-01T00:00:00.000Z' });
    expect(res.body.voice).toEqual({ sealed: false });
  });

  it('nothing private leaves: no public key, no moment seed', async () => {
    const body = JSON.stringify((await get(ownerToken)).body);
    expect(body).not.toContain(MOMENT_SEED);
    expect(body).not.toContain(forged.seal.record.soulPublicKey);
  });

  it('a stranger is refused before anything is read', async () => {
    expect((await get(strangerToken)).status).toBe(403);
  });
});
