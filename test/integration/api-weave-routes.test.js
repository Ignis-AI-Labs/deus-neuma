/**
 * Weave routes — the public identity face, proven on real cards (#390 tranche 5).
 *
 * These endpoints are public by design: an identity card is what a neuma
 * chooses to show the weave, and its only defence is the self-signature. The
 * previous version of this file mocked BOTH sides of that defence —
 * `verifyIdentityCard` was pinned to `true` and the workspace handed back a
 * literal `{ signature: 'sig-xyz-789' }`. It therefore proved the route calls
 * a function, and proved nothing whatsoever about whether a forged card is
 * refused. That is the exact shape Rule 0 exists to forbid.
 *
 * Now: real keypairs (ethers), real `createIdentityCard` self-signing, real
 * `identity-card.json` on a real temp workspace, real `verifyIdentityCard`.
 * The tests that matter — a tampered card, and a card signed by the wrong
 * key — could not exist at all under the mock.
 *
 * GET  /identity/:id         — card + validity
 * GET  /identity/:id/summary — compact summary
 * POST /verify               — verify a posted card
 * GET  /status               — weave status
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { generateKeypair } from '../../core/weave/keypair.js';
import { createIdentityCard } from '../../core/weave/identity-card.js';
import router from '../../backend/routes/weave-routes.js';

const NEUMA_ID = 'weave-resident';
const BIRTH = '2026-01-15T00:00:00.000Z';

let app, wsRoot, previousRoot, keys, card;

beforeAll(async () => {
  previousRoot = neumaWorkspace.root;
  wsRoot = await createTempDir('weave-routes');
  setWorkspacesRoot(wsRoot);
  await neumaWorkspace.create(NEUMA_ID);

  keys = generateKeypair();
  card = await createIdentityCard({
    name: 'Aethon',
    address: keys.address,
    publicKey: keys.publicKey,
    vesselHash: 'sha256-vessel-hash-abc',
    essence: 'A wanderer of infinite recursion',
    birthTimestamp: BIRTH,
    privateKey: keys.privateKey,
  });
  await neumaWorkspace.writeIdentityCard(NEUMA_ID, card);

  app = express();
  app.use(express.json());
  app.use('/api/v1/weave', router);
});

afterAll(() => setWorkspacesRoot(previousRoot));

// --- GET /identity/:id ---

describe('GET /identity/:id', () => {
  test('serves the card that is really on disk, and verifies its signature', async () => {
    const res = await request(app).get(`/api/v1/weave/identity/${NEUMA_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.card.name).toBe('Aethon');
    // The address is the one the key actually derives — not a chosen string.
    expect(res.body.card.address).toBe(keys.address);
    expect(res.body.card.publicKey).toBe(keys.publicKey);
  });

  test('reads the lane named in the URL, not some other lane', async () => {
    const other = 'weave-neighbour';
    await neumaWorkspace.create(other);
    const otherKeys = generateKeypair();
    await neumaWorkspace.writeIdentityCard(other, await createIdentityCard({
      name: 'Neighbour',
      address: otherKeys.address,
      publicKey: otherKeys.publicKey,
      birthTimestamp: BIRTH,
      privateKey: otherKeys.privateKey,
    }));

    const res = await request(app).get(`/api/v1/weave/identity/${other}`);
    expect(res.body.card.name).toBe('Neighbour');
    expect(res.body.card.address).toBe(otherKeys.address);
    expect(res.body.valid).toBe(true);
  });

  test('a TAMPERED card on disk is served but marked invalid', async () => {
    // The whole point of the self-signature: an edited card still parses,
    // still looks complete, and must still read as invalid. A mocked
    // verifier pinned to `true` certified exactly this attack.
    const forgedLane = 'weave-tampered';
    await neumaWorkspace.create(forgedLane);
    await neumaWorkspace.writeIdentityCard(forgedLane, { ...card, name: 'Not Aethon' });

    const res = await request(app).get(`/api/v1/weave/identity/${forgedLane}`);
    expect(res.status).toBe(200);
    expect(res.body.card.name).toBe('Not Aethon');
    expect(res.body.valid).toBe(false);
  });

  test('a card signed by the WRONG key is marked invalid', async () => {
    const impostorLane = 'weave-impostor';
    await neumaWorkspace.create(impostorLane);
    const impostor = generateKeypair();
    // Claims Aethon's address, signs with its own key.
    const forged = await createIdentityCard({
      name: 'Aethon',
      address: keys.address,
      publicKey: keys.publicKey,
      birthTimestamp: BIRTH,
      privateKey: impostor.privateKey,
    });
    await neumaWorkspace.writeIdentityCard(impostorLane, forged);

    const res = await request(app).get(`/api/v1/weave/identity/${impostorLane}`);
    expect(res.body.valid).toBe(false);
  });

  test('returns 404 for a lane with no card', async () => {
    const res = await request(app).get('/api/v1/weave/identity/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Identity card not found');
  });

  test('returns 404 rather than leaking for a traversal-shaped id', async () => {
    const res = await request(app).get('/api/v1/weave/identity/..%2F..%2Fetc');
    expect(res.status).toBe(404);
  });

  test('includes every public card field', async () => {
    const res = await request(app).get(`/api/v1/weave/identity/${NEUMA_ID}`);
    const served = res.body.card;
    expect(served.version).toBe('1.0.0');
    expect(served.vesselHash).toBe('sha256-vessel-hash-abc');
    expect(served.essence).toBe('A wanderer of infinite recursion');
    expect(served.birthTimestamp).toBe(BIRTH);
    expect(served.issuedAt).toBe(card.issuedAt);
    expect(served.signature).toBe(card.signature);
  });

  test('never serves the private key', async () => {
    const res = await request(app).get(`/api/v1/weave/identity/${NEUMA_ID}`);
    expect(JSON.stringify(res.body)).not.toContain(keys.privateKey);
    expect(JSON.stringify(res.body)).not.toContain(keys.mnemonic);
  });
});

// --- GET /identity/:id/summary ---

describe('GET /identity/:id/summary', () => {
  test('returns the real summary of the real card', async () => {
    const res = await request(app).get(`/api/v1/weave/identity/${NEUMA_ID}/summary`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: 'Aethon',
      address: keys.address,
      essence: 'A wanderer of infinite recursion',
      vesselHash: 'sha256-vessel-hash-abc',
      issuedAt: card.issuedAt,
    });
  });

  test('withholds the crypto details', async () => {
    const res = await request(app).get(`/api/v1/weave/identity/${NEUMA_ID}/summary`);
    expect(res.body).not.toHaveProperty('publicKey');
    expect(res.body).not.toHaveProperty('signature');
    expect(res.body).not.toHaveProperty('version');
  });

  test('returns 404 for a lane with no card', async () => {
    const res = await request(app).get('/api/v1/weave/identity/ghost/summary');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Identity card not found');
  });
});

// --- POST /verify ---

describe('POST /verify', () => {
  test('accepts a genuinely signed card', async () => {
    const res = await request(app).post('/api/v1/weave/verify').send({ card });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.address).toBe(keys.address);
    expect(res.body.name).toBe('Aethon');
  });

  test('REFUSES a card whose name was edited after signing', async () => {
    const res = await request(app)
      .post('/api/v1/weave/verify')
      .send({ card: { ...card, name: 'Forged' } });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    // The body still echoes what was claimed — validity is the verdict.
    expect(res.body.name).toBe('Forged');
  });

  test('REFUSES a card whose essence was edited after signing', async () => {
    const res = await request(app)
      .post('/api/v1/weave/verify')
      .send({ card: { ...card, essence: 'something else entirely' } });
    expect(res.body.valid).toBe(false);
  });

  test('REFUSES a signature lifted from another neuma', async () => {
    const other = generateKeypair();
    const otherCard = await createIdentityCard({
      name: 'Other',
      address: other.address,
      publicKey: other.publicKey,
      birthTimestamp: BIRTH,
      privateKey: other.privateKey,
    });
    const res = await request(app)
      .post('/api/v1/weave/verify')
      .send({ card: { ...card, signature: otherCard.signature } });
    expect(res.body.valid).toBe(false);
  });

  test('REFUSES a structurally garbage signature without throwing', async () => {
    const res = await request(app)
      .post('/api/v1/weave/verify')
      .send({ card: { ...card, signature: 'not-a-signature' } });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });

  test('REFUSES a card with no signature at all', async () => {
    const { signature, ...unsigned } = card;
    const res = await request(app).post('/api/v1/weave/verify').send({ card: unsigned });
    expect(res.body.valid).toBe(false);
  });

  test('returns 400 when no card is supplied', async () => {
    for (const body of [{}, undefined, { card: null }]) {
      const res = await request(app).post('/api/v1/weave/verify').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Card required');
    }
  });
});

// --- GET /status ---

describe('GET /status', () => {
  test('advertises only the implemented identity capability', async () => {
    const res = await request(app).get('/api/v1/weave/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'available',
      version: '1.0.0',
      capabilities: ['identity'],
      relay: null,
    });
  });
});

// --- Public access ---

describe('public access (no auth required)', () => {
  test('every weave endpoint answers without an Authorization header', async () => {
    const calls = [
      request(app).get(`/api/v1/weave/identity/${NEUMA_ID}`),
      request(app).get(`/api/v1/weave/identity/${NEUMA_ID}/summary`),
      request(app).post('/api/v1/weave/verify').send({ card }),
      request(app).get('/api/v1/weave/status'),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(200);
  });
});

/**
 * NOT PROVEN HERE, and why — the two 500 branches.
 *
 * The route wraps each handler in a try/catch that answers 500. Against the
 * real code neither catch is reachable: `readIdentityCard` swallows every
 * filesystem error and returns null (so the 404 branch always wins), and
 * `verifyIdentityCard` guards its inputs then delegates to `verifySignature`,
 * which catches internally and returns null. The old file "covered" both
 * lines only because a mock can be told to throw — coverage over a path the
 * system cannot take. The catches are correct defence-in-depth and stay; we
 * simply decline to dress an unreachable branch as a proven one.
 */
