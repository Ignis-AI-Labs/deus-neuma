/**
 * STANDBY honesty (RULE 0, no mocks anywhere on the claimed path): when the
 * idle monitor deliberately unloads the supervised substrate, the health
 * payload must say STANDBY — never OFFLINE. OFFLINE remains for genuinely
 * unreachable-when-it-should-serve.
 *
 * Proven with the REAL monitor (startIdleMonitor) unloading a REAL loopback
 * server (closed for real, as stopSupervised would stop the process), the
 * REAL /api/v1/llm/provider handler with a REAL session token, and the REAL
 * llm-provider config pointed at the dead port. The monitor's check/unload
 * are its own documented injection seams (the module owns no substrate deps
 * by design); what is claimed here — the standby state and the payload shape
 * — is entirely real code.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'http';
import { createSessionToken } from '../../backend/services/auth.js';
import { setConfig } from '../../backend/services/llm-provider.js';
import {
  startIdleMonitor, markActivity, deliberateStandby,
} from '../../backend/services/substrate-idle.js';
import llmRouter from '../../backend/routes/llm-routes.js';

const WALLET = '0x00B0110a0000000000000000000000000000b01a';

const health = (app) => request(app)
  .get('/api/v1/llm/provider')
  .set('Authorization', `Bearer ${createSessionToken(WALLET)}`);

describe('standby in the health payload (real monitor, real handler)', () => {
  let app;
  let substrate;      // a real loopback server standing in for llama-server
  let substratePort;

  beforeAll(async () => {
    substrate = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'served-model' }] }));
    });
    await new Promise((r) => substrate.listen(0, '127.0.0.1', r));
    substratePort = substrate.address().port;

    app = express();
    app.use(express.json());
    app.use('/api/v1', llmRouter);
  });

  afterAll(async () => {
    await new Promise((r) => substrate.close(r));
  });

  test('a deliberate idle-unload reads STANDBY; a wake clears it; other providers never claim it', async () => {
    // The machine is configured for the supervised substrate, serving for real.
    setConfig({
      provider: 'llama-server',
      endpoint: `http://127.0.0.1:${substratePort}`,
      apiKey: '',
      model: 'served-model',
    });

    // While serving, the payload is connected and never standby.
    const up = await health(app);
    expect(up.status).toBe(200);
    expect(up.body.status).toBe('connected');
    expect(up.body.standby).toBe(false);

    // The REAL monitor reaps the idle substrate: the check reads the real
    // serving state, the unload closes the real server (stopSupervised's
    // analogue at this seam — what is claimed is the STATE, not the kill).
    markActivity();
    const stopMonitor = startIdleMonitor({
      idleMs: 1,
      intervalMs: 10,
      check: async () => ({ serving: substrate.listening, owned: true, busy: false }),
      unload: () => new Promise((resolve) => substrate.close(resolve)),
    });
    await new Promise((r) => setTimeout(r, 200));
    stopMonitor();

    // The monitor itself reports deliberate rest.
    const rest = deliberateStandby();
    expect(rest.standby).toBe(true);
    expect(rest.since).toBeTruthy();
    expect(substrate.listening).toBe(false); // the unload really landed

    // …and the health payload says STANDBY with the honest wake story,
    // not OFFLINE.
    const asleep = await health(app);
    expect(asleep.status).toBe(200);
    expect(asleep.body.status).toBe('disconnected');
    expect(asleep.body.standby).toBe(true);
    expect(asleep.body.standbySince).toBe(rest.since);
    expect(asleep.body.wakeOn).toBe('next local turn');

    // A non-supervised provider never wears the substrate's rest — its own
    // unreachable stays plainly disconnected.
    setConfig({
      provider: 'lm-studio',
      endpoint: `http://127.0.0.1:${substratePort}`,
      apiKey: '',
      model: 'served-model',
    });
    const foreign = await health(app);
    expect(foreign.body.status).toBe('disconnected');
    expect(foreign.body.standby).toBe(false);

    // A summon wakes the substrate (markActivity is what a local turn calls)
    // — the rest is over, and unreachable-when-it-should-serve is OFFLINE's
    // honest shape again: standby false, no wake story.
    setConfig({
      provider: 'llama-server',
      endpoint: `http://127.0.0.1:${substratePort}`,
      apiKey: '',
      model: 'served-model',
    });
    markActivity();
    const woken = await health(app);
    expect(woken.body.status).toBe('disconnected');
    expect(woken.body.standby).toBe(false);
    expect(woken.body.wakeOn).toBeUndefined();
  }, 30_000);
});
