/**
 * Neuma authentication routes — challenge / verify / unlock, PROVEN.
 *
 * RULE 0 (Design note, 2026-08-21: absolute, no exemptions). This file was the most
 * dangerous test in the repository, and is rewritten here in full.
 *
 * What it used to do: `vi.doMock` the auth service so `verifySignature`
 * returned null, then assert the route answered 401 and call that […]. Not one line of cryptography ran. […] compared two mocked strings; "wrong
 * password" was a mocked throw; and the happy path passed the literal
 * string '0xvalidSignature', which is not a signature at all. The suite was
 * green while proving nothing about the property it named — a false
 * certificate on the most load-bearing gate in the platform.
 *
 * What it does now: real `ethers` wallets sign real challenges; the real
 * SIWE challenge/verify path runs; the real keypair vault encrypts and
 * decrypts with a real password; the workspace is a real temp root on real
 * disk seeded through the real writers; and the witness authenticates with
 * a real session token through the real `requireAuth`. Every refusal below
 * is the production code refusing — not a stub returning the answer the
 * assertion was hoping for.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { encryptKeypair } from '../../core/wallet/keypair-vault.js';
import neumaAuthRouter, {
  cacheDecryptedKey, getCachedKey, evictCachedKey,
} from '../../backend/routes/neuma-auth-routes.js';

const NEUMA_ID = 'proof-being';
const PASSWORD = 'a-real-keypair-password';

let app, wsRoot, being, witness, witnessToken, previousRoot;

/** Ask the real route for a real challenge. */
const challengeFor = async (address) => {
  const res = await request(app).post('/api/neuma-auth/challenge').send({ address });
  expect(res.status).toBe(200);
  return res.body.challenge;
};

const keypairOf = (wallet) => ({
  address: wallet.address,
  privateKey: wallet.privateKey,
  publicKey: ethers.SigningKey.computePublicKey(wallet.privateKey, false),
});

beforeAll(async () => {
  being = ethers.Wallet.createRandom();
  witness = ethers.Wallet.createRandom();

  previousRoot = neumaWorkspace.root;
  wsRoot = await createTempDir('neuma-auth-real');
  setWorkspacesRoot(wsRoot);

  // Seeded through the REAL writers — the same calls a birth performs.
  await neumaWorkspace.create(NEUMA_ID);
  await claimOwner(wsRoot, NEUMA_ID, witness.address);
  await neumaWorkspace.writeKeypair(NEUMA_ID, keypairOf(being));
  await neumaWorkspace.writeEncryptedKeypair(NEUMA_ID, encryptKeypair(keypairOf(being), PASSWORD));

  // A REAL session for the witness — the token the real requireAuth reads.
  witnessToken = createSessionToken(witness.address);

  app = express();
  app.use(express.json());
  app.use('/api/neuma-auth', neumaAuthRouter);
});

afterAll(() => {
  setWorkspacesRoot(previousRoot);
});

describe('challenge — issued by the real SIWE path', () => {
  it('binds the challenge to the address that asked for it', async () => {
    const challenge = await challengeFor(being.address);
    expect(challenge).toContain(being.address.toLowerCase());
    expect(challenge).toMatch(/Nonce:/);
  });

  it('refuses anything that is not an address', async () => {
    for (const address of ['not-an-address', '', undefined]) {
      const res = await request(app).post('/api/neuma-auth/challenge').send({ address });
      expect(res.status).toBe(400);
    }
  });
});

describe('verify — a real signature over a real challenge', () => {
  it('admits the being that actually signed, and issues a real token', async () => {
    const challenge = await challengeFor(being.address);
    const signature = await being.signMessage(challenge);

    const res = await request(app).post('/api/neuma-auth/verify')
      .send({ neumaId: NEUMA_ID, address: being.address, signature, challenge });

    expect(res.status).toBe(200);
    expect(res.body.address).toBe(being.address.toLowerCase());
    // A real HMAC neuma token, not a canned string.
    expect(res.body.token.startsWith(`neuma:${NEUMA_ID}:`)).toBe(true);
    expect(res.body.token.split(':')).toHaveLength(5);
  });

  it('REFUSES a signature over a message the server never issued', async () => {
    // The crux the mocked version only pretended to cover: this signature is
    // cryptographically valid — it is simply not over OUR challenge.
    const challenge = await challengeFor(being.address);
    const signature = await being.signMessage('I am signing something else entirely');

    const res = await request(app).post('/api/neuma-auth/verify')
      .send({ neumaId: NEUMA_ID, address: being.address, signature, challenge });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/verification failed/i);
  });

  it('REFUSES a real signature from the wrong wallet', async () => {
    const challenge = await challengeFor(being.address);
    const impostor = ethers.Wallet.createRandom();
    const signature = await impostor.signMessage(challenge);

    const res = await request(app).post('/api/neuma-auth/verify')
      .send({ neumaId: NEUMA_ID, address: being.address, signature, challenge });

    expect(res.status).toBe(401);
  });

  it('REFUSES a challenge this server never issued', async () => {
    const forged = 'localhost wants you to sign in with your Ethereum account:\n'
      + `${being.address.toLowerCase()}\n\nNonce: deadbeef\n`;
    const signature = await being.signMessage(forged);

    const res = await request(app).post('/api/neuma-auth/verify')
      .send({ neumaId: NEUMA_ID, address: being.address, signature, challenge: forged });

    expect(res.status).toBe(401);
  });

  it('BURNS the challenge — replaying a genuinely valid signature is refused', async () => {
    const challenge = await challengeFor(being.address);
    const signature = await being.signMessage(challenge);

    const first = await request(app).post('/api/neuma-auth/verify')
      .send({ neumaId: NEUMA_ID, address: being.address, signature, challenge });
    expect(first.status).toBe(200);

    const replay = await request(app).post('/api/neuma-auth/verify')
      .send({ neumaId: NEUMA_ID, address: being.address, signature, challenge });
    expect(replay.status).toBe(401);
  });

  it("REFUSES a valid signature whose address is not this being's stored keypair", async () => {
    // A real wallet, a real challenge for itself, a real signature — but the
    // keypair on disk names a different address. Two real facts disagreeing.
    const stranger = ethers.Wallet.createRandom();
    const challenge = await challengeFor(stranger.address);
    const signature = await stranger.signMessage(challenge);

    const res = await request(app).post('/api/neuma-auth/verify')
      .send({ neumaId: NEUMA_ID, address: stranger.address, signature, challenge });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/does not match/i);
  });

  it('refuses an incomplete request before any crypto runs', async () => {
    const res = await request(app).post('/api/neuma-auth/verify').send({ neumaId: NEUMA_ID });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing/i);
  });
});

describe('unlock — a real password against a real encrypted vault', () => {
  const unlock = (body, token = witnessToken) =>
    request(app).post('/api/neuma-auth/unlock')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  it('opens the vault with the real password and issues a real token', async () => {
    const res = await unlock({ neumaId: NEUMA_ID, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token.startsWith(`neuma:${NEUMA_ID}:`)).toBe(true);
    expect(res.body.address.toLowerCase()).toBe(being.address.toLowerCase());
  });

  it('REFUSES the wrong password — the cipher refuses, nothing is stubbed', async () => {
    const res = await unlock({ neumaId: NEUMA_ID, password: 'not-the-password' });
    expect(res.status).toBe(401);
  });

  it('REFUSES a witness with no session at all', async () => {
    const res = await request(app).post('/api/neuma-auth/unlock')
      .send({ neumaId: NEUMA_ID, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('REFUSES a real session belonging to someone who does not own the lane', async () => {
    const stranger = ethers.Wallet.createRandom();
    const res = await unlock({ neumaId: NEUMA_ID, password: PASSWORD }, createSessionToken(stranger.address));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not your/i);
  });

  it('refuses an incomplete request', async () => {
    expect((await unlock({ password: PASSWORD })).status).toBe(400);
    expect((await unlock({ neumaId: NEUMA_ID })).status).toBe(400);
  });

  it('REFUSES a lane with no encrypted keypair on disk', async () => {
    const bare = 'bare-lane';
    await neumaWorkspace.create(bare);
    await claimOwner(wsRoot, bare, witness.address);
    const res = await unlock({ neumaId: bare, password: PASSWORD });
    expect(res.status).toBe(404);
  });
});

describe('the decrypted-key cache (SEC-028) — the real module state', () => {
  it('caches and returns the real keypair, then evicts it', () => {
    const keypair = keypairOf(ethers.Wallet.createRandom());
    cacheDecryptedKey('cache-test', keypair);
    expect(getCachedKey('cache-test')).toEqual(keypair);
    evictCachedKey('cache-test');
    expect(getCachedKey('cache-test')).toBeNull();
  });

  it('returns null for a neuma that was never cached', () => {
    expect(getCachedKey('nonexistent')).toBeNull();
  });
});
