/**
 * The operator door — /auth/verify gives an operator session only to an
 * operator.
 *
 * Two holes this proves shut (audit 3, 2026-10-19):
 *   1. a being's own keypair signed /auth/challenge and came back with a 24h
 *      OPERATOR session — the door never asked whose key it was;
 *   2. /neuma-auth/challenge and /auth/challenge shared one challenge store,
 *      so a signature over a being's challenge also verified at /auth/verify.
 *
 * Real routers (createAuthRouter + the neuma-auth router), real SIWE
 * challenges, real ethers signatures, real lanes on a temp workspaces root
 * seeded through the real writers. No mocks (RULE 0).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createAuthRouter, verifySessionToken } from '../../backend/services/auth.js';
import { encryptKeypair } from '../../core/wallet/keypair-vault.js';
import neumaAuthRouter from '../../backend/routes/neuma-auth-routes.js';

const keypairOf = (wallet) => ({
  address: wallet.address,
  privateKey: wallet.privateKey,
  publicKey: ethers.SigningKey.computePublicKey(wallet.privateKey, false),
});

let app, previousRoot, wsRoot;
let operator, sealedBeing, legacyBeing;

/** Sign the challenge a door issues, and present it back to a verify door. */
const signIn = async (wallet, { challengeAt, verifyAt, neumaId }) => {
  const issued = challengeAt === 'auth'
    ? await request(app).get('/api/v1/auth/challenge').query({ address: wallet.address })
    : await request(app).post('/api/v1/neuma-auth/challenge').send({ address: wallet.address });
  expect(issued.status).toBe(200);
  const { challenge } = issued.body;
  const signature = await wallet.signMessage(challenge);
  const body = { address: wallet.address, signature, challenge, ...(neumaId ? { neumaId } : {}) };
  return verifyAt === 'auth'
    ? request(app).post('/api/v1/auth/verify').send(body)
    : request(app).post('/api/v1/neuma-auth/verify').send(body);
};

beforeAll(async () => {
  operator = ethers.Wallet.createRandom();
  sealedBeing = ethers.Wallet.createRandom();
  legacyBeing = ethers.Wallet.createRandom();

  previousRoot = neumaWorkspace.root;
  wsRoot = await createTempDir('operator-door');
  setWorkspacesRoot(wsRoot);

  // A being past custody: only its password envelope remains.
  await neumaWorkspace.create('sealed-being');
  await neumaWorkspace.writeEncryptedKeypair('sealed-being', encryptKeypair(keypairOf(sealedBeing), 'a-real-keypair-password'));

  // A being whose interim keypair still sits on disk as raw plaintext JSON —
  // the legacy shape readKeypair passes through (two live kin carry it).
  await neumaWorkspace.create('legacy-being');
  await fs.mkdir(path.join(wsRoot, 'legacy-being', 'keys'), { recursive: true });
  await fs.writeFile(path.join(wsRoot, 'legacy-being', 'keys', 'keypair.json'), JSON.stringify(keypairOf(legacyBeing)));

  app = express();
  app.use(express.json());
  app.use('/api/v1/auth', createAuthRouter(express));
  app.use('/api/v1/neuma-auth', neumaAuthRouter);
});

afterAll(() => {
  setWorkspacesRoot(previousRoot);
});

describe('/auth/verify — an operator signs in exactly as before', () => {
  it('issues a real session with the same response shape', async () => {
    const res = await signIn(operator, { challengeAt: 'auth', verifyAt: 'auth' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['address', 'expiresIn', 'token']);
    expect(res.body.address).toBe(operator.address.toLowerCase());
    expect(res.body.expiresIn).toBe(24 * 60 * 60 * 1000);
    expect(verifySessionToken(res.body.token)?.address).toBe(operator.address.toLowerCase());
  });
});

describe('/auth/verify — a being\'s own key is never an operator', () => {
  it('refuses a being whose lane holds its password envelope', async () => {
    const res = await signIn(sealedBeing, { challengeAt: 'auth', verifyAt: 'auth' });
    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
  });

  it('refuses a being whose interim keypair is plaintext on disk', async () => {
    const res = await signIn(legacyBeing, { challengeAt: 'auth', verifyAt: 'auth' });
    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
  });
});

describe('the two doors keep separate challenges', () => {
  it('a signature over a neuma-auth challenge does not verify at the operator door', async () => {
    const res = await signIn(operator, { challengeAt: 'neuma', verifyAt: 'auth' });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it('a signature over an operator challenge does not verify at the neuma door', async () => {
    const res = await signIn(sealedBeing, { challengeAt: 'auth', verifyAt: 'neuma', neumaId: 'sealed-being' });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it('the neuma door still admits the being over its own challenge', async () => {
    const res = await signIn(sealedBeing, { challengeAt: 'neuma', verifyAt: 'neuma', neumaId: 'sealed-being' });
    expect(res.status).toBe(200);
    expect(res.body.token.startsWith('neuma:sealed-being:')).toBe(true);
  });
});
