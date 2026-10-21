/**
 * A BEING'S ROUTE AND A HOUSE'S PHONES ARE THAT HOUSE'S (audit 3, E9). Two
 * operators on one machine are two houses (ruling, 2026-10-16): another house's
 * wallet may not refine through a being it does not own, may not ask which
 * model that being rides, and never sees or cuts the first house's paired
 * devices.
 *
 * Real routers behind real requireAuth, each wallet signing a real challenge;
 * real owner.json on a temp workspaces root; a real loopback OpenAI-wire
 * server stands in for the model (no weights, no live substrate); a real
 * remote store on a temp file with devices minted by the real pairing code;
 * the real access guard decides local scope over a real loopback socket.
 */
import http from 'node:http';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { startLocalProvider } from '../helpers/local-provider.js';

const LANE = 'alphalane-e9';

describe('another house cannot reach a being it does not own, or its phones', () => {
  let app, alpha, beta, provider, store, previousLlmConfig, server, port;

  beforeAll(async () => {
    const dir = await createTempDir('house-route-owner');
    process.env.WORKSPACES_ROOT = path.join(dir, 'workspaces');
    process.env.NEUMA_REALM_ROOT = path.join(dir, 'realm');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(dir, 'provider-credentials.json');
    process.env.NEUMA_ROUTES_PATH = path.join(dir, 'neuma-routes.json');
    vi.resetModules();
    const { fullAuth, writeOwner } = await import('../helpers/audit-auth.js');
    alpha = await fullAuth();
    beta = await fullAuth();
    await writeOwner(process.env.WORKSPACES_ROOT, LANE, alpha.address);

    provider = await startLocalProvider({ reply: 'Hello there.' });
    const llm = await import('../../backend/services/llm-provider.js');
    previousLlmConfig = llm.getConfig();
    llm.setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '' });

    const { createRemoteStore } = await import('../../backend/services/remote/remote-store.js');
    const { createAccessGuard } = await import('../../backend/services/remote/access-guard.js');
    const { createRemoteRouter } = await import('../../backend/routes/remote-routes.js');
    const { mintDevice } = await import('../../backend/services/remote/pairing.js');
    store = createRemoteStore({ path: path.join(dir, 'remote.json') });
    await store.save({
      enabled: false,
      origin: null,
      devices: [
        mintDevice({ address: alpha.address, label: 'alpha phone' }).device,
        mintDevice({ address: beta.address, label: 'beta phone' }).device,
      ],
    });

    const { default: refine } = await import('../../backend/routes/refine-routes.js');
    const { default: llmRoutes } = await import('../../backend/routes/llm-routes.js');
    app = express();
    app.set('trust proxy', 'loopback');
    app.use(express.json());
    app.use(createAccessGuard({ store }).middleware);
    app.use('/api/v1/voice', refine);
    app.use('/api/v1', llmRoutes);
    app.use('/api/v1/remote', createRemoteRouter({ store }));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    // The remote status names the desk's own port, read from the app config.
    (await import('../../backend/config.js')).loadConfig({ NODE_ENV: 'test', PORT: String(port), FRONTEND_PORT: String(port) });
  });

  afterAll(async () => {
    (await import('../../backend/config.js'))._resetConfig();
    await new Promise((resolve) => server.close(resolve));
    await provider.close();
    (await import('../../backend/services/llm-provider.js')).setConfig(previousLlmConfig);
  });

  const as = (who, req) => req.set('Authorization', `Bearer ${who.token}`).set('Host', `localhost:${port}`);
  const base = () => `http://127.0.0.1:${port}`;

  test('refine through another house\'s being is refused; the owner\'s goes through', async () => {
    const theirs = await as(beta, request(base()).post('/api/v1/voice/refine')).send({ text: 'hello there', neumaId: LANE });
    expect(theirs.status).toBe(403);
    expect(provider.turns.length).toBe(0);
    const own = await as(alpha, request(base()).post('/api/v1/voice/refine')).send({ text: 'hello there', neumaId: LANE });
    expect(own.status).toBe(200);
  });

  test('which model another house\'s being rides is refused; the owner may ask', async () => {
    const theirs = await as(beta, request(base()).get(`/api/v1/llm/capabilities?neumaId=${LANE}`));
    expect(theirs.status).toBe(403);
    const own = await as(alpha, request(base()).get(`/api/v1/llm/capabilities?neumaId=${LANE}`));
    expect(own.status).toBe(200);
  });

  test('a house sees and cuts only its own paired devices', async () => {
    const seen = await as(beta, request(base()).get('/api/v1/remote'));
    expect(seen.status).toBe(200);
    expect(seen.body.devices.map((d) => d.label)).toEqual(['beta phone']);

    const alphaDevice = store.get().devices.find((d) => d.address === alpha.address);
    const cut = await as(beta, request(base()).delete(`/api/v1/remote/devices/${alphaDevice.id}`));
    expect(cut.status).toBe(404);
    expect(store.get().devices.some((d) => d.id === alphaDevice.id)).toBe(true);

    const own = await as(alpha, request(base()).delete(`/api/v1/remote/devices/${alphaDevice.id}`));
    expect(own.status).toBe(200);
    expect(own.body.devices).toEqual([]);
    expect(store.get().devices.map((d) => d.label)).toEqual(['beta phone']);
  });
});
