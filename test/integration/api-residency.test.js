/**
 * Residency API — the conduit probe against real sockets (#390 tranche 6).
 *
 * The route, getResidencyState and the workspace were already real. The one
 * mock was llm-provider, pinned so `testConnection` resolved false. That
 * proved the route can render the word "false"; it proved nothing about
 * whether the probe can tell a live conduit from a dead one — the single
 * distinction this endpoint exists to report.
 *
 * Now both answers come from the real probe over a real socket: a real
 * loopback OpenAI-compatible server for reachable, and a really-closed port
 * for unreachable. No stub speaks on the network's behalf in either case.
 */
import { describe, test, expect, beforeEach, afterEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { strangerWitness } from '../helpers/witness.js';
import { startLocalProvider, closedProviderEndpoint } from '../helpers/local-provider.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setConfig, getConfig } from '../../backend/services/llm-provider.js';
import router from '../../backend/routes/residency-routes.js';

const previousRoot = neumaWorkspace.root;
let app, witness, previousConfig;

beforeEach(async () => {
  previousConfig = getConfig();
  setWorkspacesRoot(await createTempDir('residency-ws'));
  // This route carries no neuma lane — a real session that claims no
  // workspace is exactly the right shape.
  witness = strangerWitness();

  app = express();
  app.use(express.json());
  app.use('/api/v1/residency', router);
});

afterEach(() => setConfig(previousConfig));
afterAll(() => setWorkspacesRoot(previousRoot));

test('a conduit that is really down is reported unreachable', async () => {
  const { endpoint } = await closedProviderEndpoint();
  setConfig({ provider: 'lm-studio', model: 'qwen', endpoint, apiKey: '' });

  const res = await request(app).get('/api/v1/residency').set(witness.header);
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('enabled');
  // ECONNREFUSED from the real network stack, not a stub returning false.
  expect(res.body.conduit).toMatchObject({ provider: 'lm-studio', reachable: false });
  expect(Array.isArray(res.body.neuma)).toBe(true); // empty machine → no residents, no crash
});

test('a conduit that is really UP is reported reachable', async () => {
  // The half the mock could never express: pinned to false, the probe could
  // have been broken outright and this suite would not have noticed.
  const provider = await startLocalProvider({ models: ['qwen'] });
  setConfig({ provider: 'lm-studio', model: 'qwen', endpoint: provider.endpoint, apiKey: '' });

  const res = await request(app).get('/api/v1/residency').set(witness.header);
  expect(res.status).toBe(200);
  expect(res.body.conduit).toMatchObject({ provider: 'lm-studio', reachable: true });
  // And the probe really went out over the wire.
  expect(provider.hits.length).toBeGreaterThan(0);

  await provider.close();
});

test('no session is a real 401', async () => {
  expect((await request(app).get('/api/v1/residency')).status).toBe(401);
});
