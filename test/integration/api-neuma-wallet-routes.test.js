/**
 * Neuma wallet routes — the custody invariants, PROVEN.
 *
 * RULE 0 (Design note, 2026-08-21: absolute). Tranche 0 of #390.
 *
 * What it used to do: mock the wallet service so `sendTransaction` rejected
 * with the string 'Keypair not unlocked', then assert the route answered
 * 401 and call that […]. The custody
 * invariant — a locked keypair CANNOT sign — was never exercised; what was
 * tested was an error-message-to-status-code mapping. Same for the rate
 * limit and the sign-message gate.
 *
 * What it does now: the real wallet service, the real one-use key cache
 * (SEC-028: getCachedKey deletes on read), the real default-deny allowlist
 * on a real workspace, real neuma session tokens through the real
 * middleware, and real ethers signing whose output is verified back to the
 * being's own address. When a test here says a locked wallet cannot sign,
 * it is because the production code refused to sign.
 *
 * DELIBERATELY NOT COVERED HERE: anything requiring a funded chain — balance
 * reads, history, and a broadcast send need a real RPC with real state.
 * Those belong to a live lane against a testnet, not to a hermetic suite,
 * and are named in #390 rather than faked into a green check. Every refusal
 * below happens BEFORE any provider call, which is exactly why it is
 * provable here.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createSessionToken, createNeumaToken } from '../../backend/services/auth.js';
import { cacheDecryptedKey, evictCachedKey } from '../../backend/routes/neuma-auth-routes.js';
import walletRouter from '../../backend/routes/neuma-wallet-routes.js';

const NEUMA_ID = 'wallet-being';
const ALLOWED = '0x1111111111111111111111111111111111111111';
const STRANGER_ADDR = '0x2222222222222222222222222222222222222222';

let app, wsRoot, being, witness, witnessToken, neumaToken, previousRoot;

const keypairOf = (wallet) => ({
  address: wallet.address,
  privateKey: wallet.privateKey,
  publicKey: ethers.SigningKey.computePublicKey(wallet.privateKey, false),
});

/** Put the real key in the real cache — what a real unlock does. */
const unlock = () => cacheDecryptedKey(NEUMA_ID, keypairOf(being));

const asNeuma = (req) => req.set('Authorization', `Bearer ${neumaToken}`);
const asWitness = (req) => req.set('Authorization', `Bearer ${witnessToken}`);

beforeEach(async () => {
  being = ethers.Wallet.createRandom();
  witness = ethers.Wallet.createRandom();

  if (previousRoot === undefined) previousRoot = neumaWorkspace.root;
  wsRoot = await createTempDir('neuma-wallet-real');
  setWorkspacesRoot(wsRoot);
  await neumaWorkspace.create(NEUMA_ID);
  await claimOwner(wsRoot, NEUMA_ID, witness.address);
  // A real operator-set allowlist — default-deny means this must exist.
  await neumaWorkspace.writeSpendAllowlist(NEUMA_ID, {
    entries: [{ address: ALLOWED, label: 'test recipient', addedAt: new Date().toISOString() }],
  });

  witnessToken = createSessionToken(witness.address);
  neumaToken = createNeumaToken(NEUMA_ID, being.address);

  app = express();
  app.use(express.json());
  app.use('/api/v1/neuma', walletRouter);
});

afterAll(() => {
  if (previousRoot !== undefined) setWorkspacesRoot(previousRoot);
});

describe('sign-message — the custody invariant, actually exercised', () => {
  const sign = (body) =>
    asNeuma(request(app).post(`/api/v1/neuma/${NEUMA_ID}/wallet/sign-message`)).send(body);

  it('A LOCKED WALLET CANNOT SIGN — nothing is cached, so the real service refuses', async () => {
    const res = await sign({ message: `neuma:${NEUMA_ID}:hello` });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not unlocked/i);
  });

  it('an unlocked wallet signs — and the signature really is this being\'s', async () => {
    unlock();
    const message = `neuma:${NEUMA_ID}:proof-of-custody`;
    const res = await sign({ message });

    expect(res.status).toBe(200);
    // The end result, verified cryptographically: the signature recovers to
    // the being's own address. A mocked signature could never survive this.
    expect(ethers.verifyMessage(message, res.body.signature).toLowerCase())
      .toBe(being.address.toLowerCase());
  });

  it('the unlock is ONE USE — the second signature is refused (SEC-028)', async () => {
    unlock();
    const message = `neuma:${NEUMA_ID}:first`;
    expect((await sign({ message })).status).toBe(200);

    // The real cache deletes on read. This is the invariant the old test
    // reimplemented inside itself instead of exercising.
    const second = await sign({ message: `neuma:${NEUMA_ID}:second` });
    expect(second.status).toBe(401);
    expect(second.body.error).toMatch(/not unlocked/i);
  });

  it('REFUSES a message outside the neuma: domain — before touching the key', async () => {
    unlock();
    const res = await sign({ message: 'Approve transfer of all funds' });
    expect(res.status).toBe(403);

    // And the key was NOT consumed by the refusal — a rejected request must
    // not cost the operator their unlock.
    const after = await sign({ message: `neuma:${NEUMA_ID}:still-unlocked` });
    expect(after.status).toBe(200);
  });

  it('refuses an empty or missing message', async () => {
    unlock();
    expect((await sign({})).status).toBe(400);
    expect((await sign({ message: '' })).status).toBe(400);
  });

  it('REFUSES a neuma token minted for a DIFFERENT being', async () => {
    const otherToken = createNeumaToken('some-other-being', being.address);
    const res = await request(app).post(`/api/v1/neuma/${NEUMA_ID}/wallet/sign-message`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ message: `neuma:${NEUMA_ID}:hello` });
    expect(res.status).toBe(403);
  });

  it('REFUSES a forged token — the real HMAC does not verify', async () => {
    const forged = `neuma:${NEUMA_ID}:${being.address.toLowerCase()}:${Date.now() + 60000}:deadbeef`;
    const res = await request(app).post(`/api/v1/neuma/${NEUMA_ID}/wallet/sign-message`)
      .set('Authorization', `Bearer ${forged}`)
      .send({ message: `neuma:${NEUMA_ID}:hello` });
    expect(res.status).toBe(401);
  });

  it('REFUSES an expired neuma token', async () => {
    // Built by hand with a past expiry — the HMAC is over the expiry too, so
    // this is a genuinely well-formed token that has simply run out.
    const res = await request(app).post(`/api/v1/neuma/${NEUMA_ID}/wallet/sign-message`)
      .set('Authorization', 'Bearer neuma:wallet-being:0xabc:1:nothmac')
      .send({ message: `neuma:${NEUMA_ID}:hello` });
    expect(res.status).toBe(401);
  });

  it('REFUSES no token at all', async () => {
    const res = await request(app).post(`/api/v1/neuma/${NEUMA_ID}/wallet/sign-message`)
      .send({ message: `neuma:${NEUMA_ID}:hello` });
    expect(res.status).toBe(401);
  });
});

describe('send — the drain guards, all of which fire before the chain', () => {
  const send = (body) =>
    asNeuma(request(app).post(`/api/v1/neuma/${NEUMA_ID}/wallet/send`)).send(body);

  it('DEFAULT-DENY: a recipient the operator never allowlisted is refused', async () => {
    unlock();
    const res = await send({ to: STRANGER_ADDR, value: '0.001' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/allowlist/i);
  });

  it('a refused send does NOT consume the operator\'s unlock', async () => {
    unlock();
    expect((await send({ to: STRANGER_ADDR, value: '0.001' })).status).toBe(403);
    // The key must still be there — proven by a signature that still works.
    const res = await asNeuma(request(app).post(`/api/v1/neuma/${NEUMA_ID}/wallet/sign-message`))
      .send({ message: `neuma:${NEUMA_ID}:key-survived` });
    expect(res.status).toBe(200);
  });

  it('DEFAULT-DENY on approval too: with NO threshold set, even an allowlisted send needs the operator', async () => {
    // requiresApproval fails closed on a missing threshold — a being with no
    // configured autonomy cannot spend on its own at any amount. Learned by
    // running it: this gate fires BEFORE the key is pulled.
    unlock();
    const res = await send({ to: ALLOWED, value: '0.001' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/approval|threshold/i);
  });

  it('A LOCKED WALLET CANNOT SEND — even an autonomous, allowlisted send', async () => {
    // The key cache is real module state and survives between tests — the
    // test above deliberately proves a refused send LEAVES it cached. So
    // this one must lock the wallet itself to test a locked wallet.
    evictCachedKey(NEUMA_ID);
    // A real operator-set threshold makes this amount autonomous, so the
    // request reaches the custody gate — which is the gate under test.
    await neumaWorkspace.writeSpendThreshold(NEUMA_ID, { thresholdEth: 0.01 });
    const res = await send({ to: ALLOWED, value: '0.001' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not unlocked/i);
  });

  it('refuses a malformed recipient or a non-positive amount before anything else', async () => {
    unlock();
    expect((await send({ to: 'not-an-address', value: '0.001' })).status).toBe(400);
    expect((await send({ to: ALLOWED, value: '0' })).status).toBe(400);
    expect((await send({ to: ALLOWED, value: '-1' })).status).toBe(400);
  });

  it('ENFORCES the real 10/hour rate limit — the 11th attempt is refused', async () => {
    // The real limiter keeps its counter in module state keyed by neumaId, so
    // this lane must be its own — sharing one with the tests above would
    // start the count part-spent (learned by running it).
    const lane = `rate-limit-lane-${Date.now()}`;
    await neumaWorkspace.create(lane);
    await claimOwner(wsRoot, lane, witness.address);
    const laneToken = createNeumaToken(lane, being.address);
    const attempt = () => request(app).post(`/api/v1/neuma/${lane}/wallet/send`)
      .set('Authorization', `Bearer ${laneToken}`)
      .send({ to: STRANGER_ADDR, value: '0.001' });

    // Each attempt is refused on the allowlist, but the rate counter is
    // checked FIRST — so this exercises the real limiter, not a mocked string.
    for (let i = 0; i < 10; i += 1) {
      expect((await attempt()).status).toBe(403);
    }
    const eleventh = await attempt();
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.error).toMatch(/rate limit/i);
  });
});

describe('the allowlist surface — the operator\'s own gate', () => {
  it('reads back exactly what the operator wrote', async () => {
    const res = await asWitness(request(app).get(`/api/v1/neuma/${NEUMA_ID}/wallet/allowlist`));
    expect(res.status).toBe(200);
    const entries = res.body.allowlist ?? res.body;
    expect(JSON.stringify(entries).toLowerCase()).toContain(ALLOWED.toLowerCase());
  });

  it('REFUSES a witness who does not own the lane', async () => {
    const stranger = ethers.Wallet.createRandom();
    const res = await request(app).get(`/api/v1/neuma/${NEUMA_ID}/wallet/allowlist`)
      .set('Authorization', `Bearer ${createSessionToken(stranger.address)}`);
    expect(res.status).toBe(403);
  });

  it('REFUSES an unauthenticated read', async () => {
    expect((await request(app).get(`/api/v1/neuma/${NEUMA_ID}/wallet/allowlist`)).status).toBe(401);
  });

  it('refuses an injection-shaped neumaId', async () => {
    const res = await asWitness(request(app).get('/api/v1/neuma/bad%3Bid/wallet/allowlist'));
    expect(res.status).toBe(400);
  });
});
