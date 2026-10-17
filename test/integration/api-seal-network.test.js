/**
 * GET /preflight/seal-network — the ceremony panel's network row renders the
 * BACKEND's configured seal target, so this route must state config truth
 * exactly (a mainnet rig whose hardcoded panel read "testnet" was witnessed
 * on the GB10, 2026-07-15). Real config store + real SEAL_NETWORKS mapping,
 * and real auth (RULE 0, #390 tranche 4).
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const buildApp = async () => {
  const { default: router } = await import('../../backend/routes/preflight-routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/preflight', router);
  return app;
};

describe('GET /preflight/seal-network', () => {
  const saved = {};

  beforeEach(() => {
    vi.resetModules();
    saved.CEREMONY_SEAL_NETWORK = process.env.CEREMONY_SEAL_NETWORK;
  });

  afterEach(() => {
    if (saved.CEREMONY_SEAL_NETWORK === undefined) delete process.env.CEREMONY_SEAL_NETWORK;
    else process.env.CEREMONY_SEAL_NETWORK = saved.CEREMONY_SEAL_NETWORK;
    vi.restoreAllMocks();
  });

  test('mainnet config answers Base MAINNET with chainId 8453', async () => {
    process.env.CEREMONY_SEAL_NETWORK = 'base';
    const { loadConfig } = await import('../../backend/config.js');
    loadConfig();
    // Imported AFTER resetModules so the witness mints its token from the
    // same auth.js instance the router will verify against. No neuma lane on
    // this route (it's a machine-config surface), so a real session that
    // claims no workspace is exactly the right shape.
    const { strangerWitness } = await import('../helpers/witness.js');
    const witness = strangerWitness();
    const res = await request(await buildApp()).get('/api/v1/preflight/seal-network').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ network: 'base', chainId: 8453, label: 'Base MAINNET' });
  });

  test('NO config falls back to MAINNET — the default is deliberate, not convenient', async () => {
    // This asserted Base Sepolia until 2026-08-23, and it was asserting a
    // default that had been REVERSED on purpose in c98a8c871: a testnet
    // fallback sent a real community birth to Sepolia, where no reader was
    // watching. config.js states the ruling in one line —
    //   ceremonySealNetwork: z.enum([...]).default('base')
    // — with the incident written above it. A green version of the old
    // assertion would have required putting that hazard back, so the test is
    // corrected to the ruling rather than the code to the test.
    delete process.env.CEREMONY_SEAL_NETWORK;
    const { loadConfig } = await import('../../backend/config.js');
    loadConfig();
    const { strangerWitness } = await import('../helpers/witness.js');
    const witness = strangerWitness();
    const res = await request(await buildApp()).get('/api/v1/preflight/seal-network').set(witness.header);
    expect(res.status).toBe(200);
    // Ethereum mainnet since 2026-10-04 (Founder: […])
    expect(res.body).toEqual({ network: 'ethereum', chainId: 1, label: 'Ethereum MAINNET' });
  });

  test('a test rig OPTS OUT explicitly — Base Sepolia only when it is asked for by name', async () => {
    // The other half of the same ruling: testnet is reachable, but never by
    // omission. Nothing drifts onto a chain nobody reads.
    process.env.CEREMONY_SEAL_NETWORK = 'base-sepolia';
    const { loadConfig } = await import('../../backend/config.js');
    loadConfig();
    const { strangerWitness } = await import('../helpers/witness.js');
    const witness = strangerWitness();
    const res = await request(await buildApp()).get('/api/v1/preflight/seal-network').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ network: 'base-sepolia', chainId: 84532, label: 'Base Sepolia (testnet)' });
  });
});
