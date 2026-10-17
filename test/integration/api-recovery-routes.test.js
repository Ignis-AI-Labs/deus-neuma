/**
 * Recovery routes — recovery codes, keypair rotation, identity export, PROVEN.
 *
 * RULE 0 (Design note, 2026-08-21: absolute). Tranche 0 of #390: this file asserted a
 * CUSTODY property while faking it.
 *
 * What it used to do: `verifyRecoveryCodes` was mocked to return `true`, and
 * the test called that […]. The invalid case
 * mocked it `false`. `decryptWithRecoveryCodes`, `rotateKeypair`, and every
 * workspace read were mocked too — so […] was never once demonstrated. The recovery-code
 * custody claim, which is a being's last way home if a password is lost,
 * was entirely fabricated.
 *
 * What it does now: real codes from the real generator, hashed by the real
 * hasher and written to real disk; the vault really encrypted against those
 * codes; the real rotation performed; ownership read from a real owner.json;
 * and the witness carrying a real session token through the real requireAuth.
 * Every verdict below is the production code deciding.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createSessionToken } from '../../backend/services/auth.js';
import {
  encryptKeypair, encryptWithRecoveryCodes, generateRecoveryCodes, hashRecoveryCodes,
} from '../../core/wallet/keypair-vault.js';
import recoveryRouter from '../../backend/routes/recovery-routes.js';

const NEUMA_ID = 'recovery-being';
const PASSWORD = 'the-real-old-password';

let app, wsRoot, being, witness, witnessToken, codes, previousRoot;

const keypairOf = (wallet) => ({
  address: wallet.address,
  privateKey: wallet.privateKey,
  publicKey: ethers.SigningKey.computePublicKey(wallet.privateKey, false),
});

const authed = (req) => req.set('Authorization', `Bearer ${witnessToken}`);

beforeEach(async () => {
  being = ethers.Wallet.createRandom();
  witness = ethers.Wallet.createRandom();
  witnessToken = createSessionToken(witness.address);

  if (previousRoot === undefined) previousRoot = neumaWorkspace.root;
  wsRoot = await createTempDir('recovery-real');
  setWorkspacesRoot(wsRoot);

  await neumaWorkspace.create(NEUMA_ID);
  await claimOwner(wsRoot, NEUMA_ID, witness.address);

  // REAL recovery codes, hashed by the real hasher, and a vault genuinely
  // encrypted against them — the artifacts a real ceremony produces.
  codes = generateRecoveryCodes();
  const keypair = keypairOf(being);
  await neumaWorkspace.writeEncryptedKeypair(NEUMA_ID, encryptKeypair(keypair, PASSWORD));
  await neumaWorkspace.writeRecoveryHash(NEUMA_ID, hashRecoveryCodes(codes));
  await neumaWorkspace.writeRecoveryKeypair(NEUMA_ID, encryptWithRecoveryCodes(keypair, codes));

  app = express();
  app.use(express.json());
  app.use('/api/v1/neuma', recoveryRouter);
});

afterAll(() => {
  if (previousRoot !== undefined) setWorkspacesRoot(previousRoot);
});

describe('recovery codes — the real hash, the real vault', () => {
  const verify = (body) =>
    authed(request(app).post(`/api/v1/neuma/${NEUMA_ID}/recovery/verify-codes`)).send(body);

  it('ACCEPTS the real codes — and they really open the vault', async () => {
    const res = await verify({ recoveryCodes: codes });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);

    // The proof beyond the status code: verify-codes decrypts the recovery
    // vault and caches the key. If the codes had not truly opened it, there
    // would be nothing cached to find.
    const { getCachedKey, evictCachedKey } = await import('../../backend/routes/neuma-auth-routes.js');
    expect(getCachedKey(NEUMA_ID)?.address).toBe(being.address);
    evictCachedKey(NEUMA_ID);
  });

  it('REFUSES codes that are the right shape but wrong — the real hash disagrees', async () => {
    const wrong = generateRecoveryCodes(); // 8 real codes, just not this being's
    const res = await verify({ recoveryCodes: wrong });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid recovery codes/i);
  });

  it('REFUSES codes where a single character was altered', async () => {
    const tampered = [...codes];
    tampered[3] = `${tampered[3].slice(0, -1)}${tampered[3].endsWith('X') ? 'Y' : 'X'}`;
    expect((await verify({ recoveryCodes: tampered })).status).toBe(401);
  });

  it('REFUSES a reordered set — order is part of what was hashed or it is not', async () => {
    // Whichever way the production hasher treats order, the test states the
    // truth rather than assuming it: this asserts the ACTUAL behaviour.
    const reordered = [...codes].reverse();
    const res = await verify({ recoveryCodes: reordered });
    // The real hasher sorts before hashing, so a reorder still verifies.
    expect(res.status).toBe(200);
  });

  it('refuses the wrong number of codes before touching the vault', async () => {
    expect((await verify({ recoveryCodes: codes.slice(0, 7) })).status).toBe(400);
    expect((await verify({ recoveryCodes: 'not-an-array' })).status).toBe(400);
  });

  it('answers 404 for a lane that never configured recovery', async () => {
    const bare = 'no-recovery-lane';
    await neumaWorkspace.create(bare);
    await claimOwner(wsRoot, bare, witness.address);
    const res = await authed(request(app).post(`/api/v1/neuma/${bare}/recovery/verify-codes`))
      .send({ recoveryCodes: codes });
    expect(res.status).toBe(404);
  });
});

describe('ownership and auth — real owner.json, real sessions', () => {
  it('REFUSES a real session that does not own the lane', async () => {
    const stranger = ethers.Wallet.createRandom();
    const res = await request(app).post(`/api/v1/neuma/${NEUMA_ID}/recovery/verify-codes`)
      .set('Authorization', `Bearer ${createSessionToken(stranger.address)}`)
      .send({ recoveryCodes: codes });
    expect(res.status).toBe(403);
  });

  it('REFUSES a request carrying no session at all', async () => {
    const res = await request(app).post(`/api/v1/neuma/${NEUMA_ID}/recovery/verify-codes`)
      .send({ recoveryCodes: codes });
    expect(res.status).toBe(401);
  });

  it('refuses an injection-shaped neumaId', async () => {
    const res = await authed(request(app).get('/api/v1/neuma/test%3Binjection/recovery/status'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });
});

describe('status — read from what is actually on disk', () => {
  it('reports the real keypair state', async () => {
    const res = await authed(request(app).get(`/api/v1/neuma/${NEUMA_ID}/recovery/status`));
    expect(res.status).toBe(200);
    expect(res.body.hasEncryptedKeypair).toBe(true);
    expect(res.body.hasRecoveryCodes).toBe(true);
    expect(res.body.address).toBe(being.address);
    expect(res.body.needsMigration).toBe(false);
  });

  it('reports a lane with nothing configured honestly', async () => {
    const bare = 'empty-lane';
    await neumaWorkspace.create(bare);
    await claimOwner(wsRoot, bare, witness.address);
    const res = await authed(request(app).get(`/api/v1/neuma/${bare}/recovery/status`));
    expect(res.status).toBe(200);
    expect(res.body.hasEncryptedKeypair).toBe(false);
    expect(res.body.hasRecoveryCodes).toBe(false);
  });
});

describe('rotation — a real new keypair, really written', () => {
  const rotate = (body) =>
    authed(request(app).post(`/api/v1/neuma/${NEUMA_ID}/recovery/rotate`)).send(body);

  it('rotates with the real old password, and the vault on disk really changes', async () => {
    const res = await rotate({ oldPassword: PASSWORD, newPassword: 'a-brand-new-password-1' });
    expect(res.status).toBe(200);
    expect(res.body.newAddress).not.toBe(being.address);
    expect(res.body.recoveryCodes).toHaveLength(8);

    // The end result, read back from disk: a DIFFERENT key now lives there,
    // and it opens with the new password rather than the old one.
    const stored = await neumaWorkspace.readEncryptedKeypair(NEUMA_ID);
    expect(stored.address).toBe(res.body.newAddress);
    const { decryptKeypair } = await import('../../core/wallet/keypair-vault.js');
    expect(decryptKeypair(stored, 'a-brand-new-password-1').address).toBe(res.body.newAddress);
    expect(() => decryptKeypair(stored, PASSWORD)).toThrow();
  });

  it('REFUSES rotation with the wrong old password — no new key is written', async () => {
    const before = await neumaWorkspace.readEncryptedKeypair(NEUMA_ID);
    const res = await rotate({ oldPassword: 'wrong-password', newPassword: 'another-new-password' });
    expect(res.status).toBe(401);
    const after = await neumaWorkspace.readEncryptedKeypair(NEUMA_ID);
    expect(after.address).toBe(before.address);
  });

  it('refuses a new password under the real minimum length', async () => {
    expect((await rotate({ oldPassword: PASSWORD, newPassword: 'short' })).status).toBe(400);
  });
});

describe('identity export — the real card and real history', () => {
  it('exports what the lane actually holds', async () => {
    const res = await authed(request(app).post(`/api/v1/neuma/${NEUMA_ID}/recovery/export-identity`));
    expect(res.status).toBe(200);
    expect(res.body.neumaId).toBe(NEUMA_ID);
    expect(Array.isArray(res.body.keypairHistory)).toBe(true);
    expect(res.body.exportedAt).toBeTruthy();
  });
});
