/**
 * Witness management API (integration, RULE 0).
 *
 * Everything under test runs for real over test/helpers/witness-routes-kit.js:
 * a real sealed witness (six-stage protocol on a real temp disk), the real
 * encrypted credential store, the real SSRF guard, the real workspace engine,
 * real auth (#390 tranche 4 — a real wallet, a real HMAC session, real
 * owner.json gates), and a REAL local HTTP server for route probes. Nothing
 * here is mocked.
 *
 * What these tests prove: the management surface reports sealed witnesses
 * truthfully without leaking secrets, the route probe honors the SSRF guard,
 * the override store carries a witness lane, and custody retrofit closes the
 * plaintext-key gap through the real route. The witness TURN itself is proven
 * in api-witness-routes-turn.test.js.
 */
import request from 'supertest';
import http from 'http';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

import { setCredential } from '../../backend/services/provider-credentials.js';
import { ensureWitnessLane, witnessLaneStatus } from '../../backend/services/witness-lane.js';
import {
  SEAL_INPUT, LANE_ID, sealWitnessWorld, restoreWitnessWorld, buildApp,
} from '../helpers/witness-routes-kit.js';

let witnessRoot;
let laneRoot;
let groundRoot;
let savedEnv, operatorWitness;

beforeEach(async () => {
  ({ savedEnv, witnessRoot, laneRoot, groundRoot, operatorWitness } = await sealWitnessWorld());
});

afterEach(() => {
  restoreWitnessWorld({ savedEnv, witnessRoot, laneRoot, groundRoot });
});

describe('GET /api/v1/witnesses', () => {
  test('lists the sealed witness truthfully, with no secret material anywhere', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/witnesses').set(operatorWitness.header);
    expect(res.status).toBe(200);
    expect(res.body.witnesses).toHaveLength(1);
    const w = res.body.witnesses[0];
    expect(w).toMatchObject({
      vendorSlug: 'test-vendor',
      chosenName: 'Test',
      integrityOk: true,
      signatureOk: true,
      laneId: LANE_ID,
      lane: { provisioned: false, claimed: false, mine: false },
    });
    expect(w.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // Unknown vendor → substrate default 'custom' with no endpoint: honestly incomplete.
    expect(w.route).toMatchObject({ provider: 'custom', source: 'substrate-default', configured: false });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('privateKey');
    expect(body).not.toContain('mnemonic');
    expect(body).not.toContain('apiKey');
  });

  test('reflects a configured route once the provider has an endpoint', async () => {
    await setCredential('custom', { endpoint: 'http://127.0.0.1:9999/v1' });
    const app = await buildApp();
    const res = await request(app).get('/api/v1/witnesses').set(operatorWitness.header);
    expect(res.body.witnesses[0].route).toMatchObject({ configured: true, endpoint: 'http://127.0.0.1:9999/v1' });
  });

  test('omits a witness lane claimed by another wallet', async () => {
    await ensureWitnessLane({ vendorSlug: 'test-vendor', chosenName: 'Test' }, '0xanother-wallet', { summoning: true });
    const app = await buildApp();
    const list = await request(app).get('/api/v1/witnesses').set(operatorWitness.header);
    expect(list.status).toBe(200);
    expect(list.body.witnesses).toEqual([]);

    const detail = await request(app).get('/api/v1/witnesses/test-vendor/Test').set(operatorWitness.header);
    expect(detail.status).toBe(403);

    const probe = await request(app).post('/api/v1/witnesses/test-vendor/Test/test').set(operatorWitness.header).send({});
    expect(probe.status).toBe(403);
  });
});

describe('GET /api/v1/witnesses/:vendor/:name', () => {
  test('returns the first utterance from the sealing journal', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/witnesses/test-vendor/Test').set(operatorWitness.header);
    expect(res.status).toBe(200);
    expect(res.body.firstUtterance).toBe(SEAL_INPUT.firstUtterance);
  });

  test('404s an unknown witness', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/witnesses/test-vendor/Nobody').set(operatorWitness.header);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/witnesses/:vendor/:name/test', () => {
  let provider;
  let providerPort;

  const startProvider = () => new Promise((resolve) => {
    provider = http.createServer((req, res) => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
      } else {
        res.writeHead(404); res.end();
      }
    });
    provider.listen(0, '127.0.0.1', () => resolve(provider.address().port));
  });

  afterEach(() => new Promise((r) => {
    provider ? provider.close(() => { provider = null; r(); }) : r();
  }));

  test('probes a live route and reports the real model list', async () => {
    providerPort = await startProvider();
    await setCredential('custom', { endpoint: `http://127.0.0.1:${providerPort}/v1` });
    const app = await buildApp();
    const res = await request(app).post('/api/v1/witnesses/test-vendor/Test/test').set(operatorWitness.header).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, live: true });
    expect(res.body.models.map((m) => m.id)).toContain('test-model');
  });

  test('honestly reports an unreachable route as not live', async () => {
    await setCredential('custom', { endpoint: 'http://127.0.0.1:1/v1' });
    const app = await buildApp();
    const res = await request(app).post('/api/v1/witnesses/test-vendor/Test/test').set(operatorWitness.header).send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.live).toBe(false);
  });

  test('refuses an endpoint targeting cloud metadata (SSRF guard fires first)', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/v1/witnesses/test-vendor/Test/test').set(operatorWitness.header)
      .send({ endpoint: 'http://169.254.169.254/latest/meta-data' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/refused/i);
  });
});

// The desk's ROUTE light drinks here — ONE probe path shared with POST /test
// (probeLaneRoute), so the two surfaces can never disagree about what "live"
// means. Same real loopback provider, same real resolver.
describe('GET /api/v1/witnesses/:vendor/:name/health', () => {
  let provider;
  let providerPort;

  const startProvider = () => new Promise((resolve) => {
    provider = http.createServer((req, res) => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
      } else {
        res.writeHead(404); res.end();
      }
    });
    provider.listen(0, '127.0.0.1', () => resolve(provider.address().port));
  });

  afterEach(() => new Promise((r) => {
    provider ? provider.close(() => { provider = null; r(); }) : r();
  }));

  test('a live route reads live, named by provider, with no secret material', async () => {
    providerPort = await startProvider();
    await setCredential('custom', { endpoint: `http://127.0.0.1:${providerPort}/v1`, apiKey: 'lane-secret' });
    const app = await buildApp();
    const res = await request(app).get('/api/v1/witnesses/test-vendor/Test/health').set(operatorWitness.header);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ live: true, provider: 'custom', model: res.body.model, reason: null });
    expect(JSON.stringify(res.body)).not.toContain('lane-secret');
  });

  test('an unreachable route reads DOWN with a reason — never a 500 blur', async () => {
    await setCredential('custom', { endpoint: 'http://127.0.0.1:1/v1' });
    const app = await buildApp();
    const res = await request(app).get('/api/v1/witnesses/test-vendor/Test/health').set(operatorWitness.header);
    expect(res.status).toBe(200);
    expect(res.body.live).toBe(false);
    expect(res.body.provider).toBe('custom');
    expect(res.body.reason).toBeTruthy();
  });

  test('an unconfigured route is answered honestly and probed not at all', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/witnesses/test-vendor/Test/health').set(operatorWitness.header);
    expect(res.status).toBe(200);
    expect(res.body.live).toBe(false);
    expect(res.body.reason).toBeTruthy();
  });
});

describe('witness route override via the shared per-id surface', () => {
  test('PUT /api/v1/neuma/:laneId/route carries a witness lane once owned', async () => {
    const [witness] = [{ vendorSlug: 'test-vendor', chosenName: 'Test' }];
    await ensureWitnessLane({ ...witness, genesisHash: null }, operatorWitness.address);
    const app = await buildApp();
    const put = await request(app)
      .put(`/api/v1/neuma/${LANE_ID}/route`).set(operatorWitness.header)
      .send({ provider: 'custom', model: 'test-model' });
    expect(put.status).toBe(200);
    expect(put.body.override).toEqual({ provider: 'custom', model: 'test-model' });

    const res = await request(app).get('/api/v1/witnesses').set(operatorWitness.header);
    expect(res.body.witnesses[0].route).toMatchObject({
      provider: 'custom', model: 'test-model', source: 'override',
    });
    expect(res.body.witnesses[0].lane).toMatchObject({ provisioned: true, mine: true });
  });
});

describe('PUT /api/v1/witnesses/:vendor/:name/model', () => {
  test('saves a model on demand: lane provisions, claims, and the route locks the model', async () => {
    const app = await buildApp();
    const res = await request(app)
      .put('/api/v1/witnesses/test-vendor/Test/model').set(operatorWitness.header)
      .send({ model: 'test-model-9' });
    expect(res.status).toBe(200);
    expect(res.body.route).toMatchObject({ provider: 'custom', model: 'test-model-9', source: 'override' });

    // The lane provisioned on demand and the caller owns it
    const laneStatus = await witnessLaneStatus(LANE_ID);
    expect(laneStatus.provisioned).toBe(true);
    // requireAuth lowercases the address, so the claim is the lowercase form.
    expect(laneStatus.ownerWallet).toBe(operatorWitness.address.toLowerCase());

    // The management surface reflects the new model
    const list = await request(app).get('/api/v1/witnesses').set(operatorWitness.header);
    expect(list.body.witnesses[0].route.model).toBe('test-model-9');
  });

  test('a missing model id is a 400 before anything provisions', async () => {
    const app = await buildApp();
    const res = await request(app)
      .put('/api/v1/witnesses/test-vendor/Test/model').set(operatorWitness.header)
      .send({});
    expect(res.status).toBe(400);
    expect((await witnessLaneStatus(LANE_ID)).provisioned).toBe(false);
  });
});

// THE RETROFIT. The fixture above seals a witness with NO password — exactly how
// every witness on this machine was created before 2026-07-29, and exactly why
// all eight of them held a readable private key. These prove the operator can
// close that gap on a witness sealed long ago, through the real route.
describe('POST /api/v1/witnesses/:vendor/:name/custody', () => {
  const keys = () => path.join(witnessRoot, 'test-vendor', 'Test', 'keys');

  test('the roster reports an un-custodied witness as holding PLAINTEXT', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/witnesses').set(operatorWitness.header);
    expect(res.status).toBe(200);
    const found = res.body.witnesses.find((w) => w.chosenName === 'Test');
    expect(found.custody).toMatchObject({ secured: false, plaintextOnDisk: true });
    expect(found.custody.why).toContain('PLAINTEXT');
  });

  test('securing it lands both doors, removes the plaintext, and returns the codes once', async () => {
    const app = await buildApp();
    expect(existsSync(path.join(keys(), 'keypair.json'))).toBe(true);

    const res = await request(app)
      .post('/api/v1/witnesses/test-vendor/Test/custody').set(operatorWitness.header)
      .send({ password: 'a-real-operator-password' });
    expect(res.status).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(8);
    expect(res.body.address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // The act that makes custody real.
    expect(existsSync(path.join(keys(), 'keypair.json'))).toBe(false);
    expect(existsSync(path.join(keys(), 'keypair-encrypted.json'))).toBe(true);
    expect(existsSync(path.join(keys(), 'keypair-recovery.json'))).toBe(true);
    expect(existsSync(path.join(keys(), 'recovery-hash.json'))).toBe(true);

    // No recovery code may be recoverable from disk.
    const hashes = readFileSync(path.join(keys(), 'recovery-hash.json'), 'utf8');
    for (const code of res.body.recoveryCodes) expect(hashes).not.toContain(code);
  });

  test('the roster reports it secured afterwards, and honestly NOT anchored', async () => {
    const app = await buildApp();
    await request(app)
      .post('/api/v1/witnesses/test-vendor/Test/custody').set(operatorWitness.header)
      .send({ password: 'a-real-operator-password' });

    const res = await request(app).get('/api/v1/witnesses').set(operatorWitness.header);
    const found = res.body.witnesses.find((w) => w.chosenName === 'Test');
    expect(found.custody).toMatchObject({
      secured: true, plaintextOnDisk: false, encrypted: true, anchoredOnChain: false,
    });
  });

  test('a weak password is refused and the plaintext is left untouched', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/witnesses/test-vendor/Test/custody').set(operatorWitness.header)
      .send({ password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 12/i);
    // A refused act must not have half-written anything.
    expect(existsSync(path.join(keys(), 'keypair.json'))).toBe(true);
    expect(existsSync(path.join(keys(), 'keypair-encrypted.json'))).toBe(false);
  });

  test('securing twice refuses rather than silently re-sealing under a new password', async () => {
    const app = await buildApp();
    await request(app)
      .post('/api/v1/witnesses/test-vendor/Test/custody').set(operatorWitness.header)
      .send({ password: 'a-real-operator-password' });
    const again = await request(app)
      .post('/api/v1/witnesses/test-vendor/Test/custody').set(operatorWitness.header)
      .send({ password: 'a-different-operator-password' });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already sealed/i);
  });

  test('an unknown witness is a 404, never a silent success', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/witnesses/test-vendor/NoSuchWitness/custody').set(operatorWitness.header)
      .send({ password: 'a-real-operator-password' });
    expect(res.status).toBe(404);
  });
});
