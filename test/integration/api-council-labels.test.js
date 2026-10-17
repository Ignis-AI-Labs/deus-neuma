import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { startLocalProvider } from '../helpers/local-provider.js';

/**
 * Integration test for the council-labels API + council auto-title route
 * (user realm). REAL: express app, routes, council-store records on a temp
 * realm (real append/read), the label store (real atomic writes), and a real
 * witness session (RULE 0, #390 tranche 4). The conduit boundary stays
 * stubbed — this test proves PLUMBING ONLY and makes no claim about real
 * model output. The live-model naming claim is proven by
 * test/manual/test-council-autotitle-e2e.js (RULE 0).
 */

const TITLE = 'The Substrate Debate';

describe('Council labels + auto-title API (user realm)', () => {
  let app, store, labels, witness, provider, previousLlmConfig;

  const seedCouncil = async (councilId, exchanges) => {
    await store.createCouncilRecord(witness.address, {
      councilId,
      members: [{ name: 'Cael' }, { name: 'Aziel' }],
      witnessName: 'Founder',
    });
    for (const [name, content] of exchanges) {
      await store.appendCouncilTurn(witness.address, councilId, { speaker: name.toLowerCase(), name, content });
    }
  };

  const post = (body) => request(app).post('/api/v1/user/realm/council-labels/autotitle').set(witness.header).send(body);
  const put = (body) => request(app).put('/api/v1/user/realm/council-labels').set(witness.header).send(body);

  beforeEach(async () => {
    vi.resetModules();

    const storeDir = await createTempDir(`stores-${Math.random().toString(36).slice(2)}`);
    // Same isolation as api-autotitle: the titler resolves a route before
    // naming, and resolution reads the credential + route stores — never the
    // operator's real files.
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = `${storeDir}/provider-credentials.json`;
    process.env.NEUMA_ROUTES_PATH = `${storeDir}/neuma-routes.json`;

    const realm = await import('../../backend/services/user-realm.js');
    realm.setRealmRoot(await createTempDir(`realm-${Math.random().toString(36).slice(2)}`));
    store = await import('../../backend/services/council-store.js');
    labels = await import('../../backend/services/user-council-labels.js');

    // A REAL provider on loopback, reached as the house's sovereign machine
    // route (a council is named through the house's own door).
    provider = await startLocalProvider({ reply: TITLE });
    const llm = await import('../../backend/services/llm-provider.js');
    previousLlmConfig = llm.getConfig();
    llm.setConfig({
      provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '',
    });

    // Imported AFTER resetModules so the witness mints its token from the
    // same auth.js instance the router will verify against.
    const { strangerWitness } = await import('../helpers/witness.js');
    // The realm is the witness's own ground, keyed by its wallet — a real
    // session that claims no neuma workspace is exactly the right shape.
    witness = strangerWitness();

    const { default: router } = await import('../../backend/routes/user-realm-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/user/realm', router);
  });

  afterEach(async () => {
    delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    delete process.env.NEUMA_ROUTES_PATH;
    if (provider) await provider.close();
    provider = null;
    if (previousLlmConfig) {
      const llm = await import('../../backend/services/llm-provider.js');
      llm.setConfig(previousLlmConfig);
    }
    vi.restoreAllMocks();
  });

  test('manual rename round-trips (PUT then GET)', async () => {
    const res = await put({ councilId: 'council-1000000000001', label: 'The Long Night' });
    expect(res.status).toBe(200);
    expect(res.body.labels['council-1000000000001']).toBe('The Long Night');

    const got = await request(app).get('/api/v1/user/realm/council-labels').set(witness.header);
    expect(got.body.labels['council-1000000000001']).toBe('The Long Night');
  });

  test('a malformed councilId is refused (400) on PUT and POST', async () => {
    expect((await put({ councilId: 'session-1', label: 'x' })).status).toBe(400);
    expect((await post({ councilIds: ['../evil'] })).status).toBe(400);
    expect((await post({ councilIds: 'council-1' })).status).toBe(400);
  });

  test('batch names unlabeled councils; labeled ones are left alone without force', async () => {
    await seedCouncil('council-1000000000001', [['Cael', 'should the substrate idle-unload?'], ['Aziel', 'the VRAM must breathe']]);
    await seedCouncil('council-1000000000002', [['Cael', 'already named sitting']]);
    await labels.setCouncilLabel(witness.address, 'council-1000000000002', 'Kept Name');

    const res = await post({});
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.results.map((r) => [r.councilId, r]));
    expect(byId['council-1000000000001']).toMatchObject({ status: 'titled', label: TITLE });
    expect(byId['council-1000000000002']).toBeUndefined();
    expect(res.body.labels['council-1000000000001']).toBe(TITLE);
    expect(res.body.labels['council-1000000000002']).toBe('Kept Name');
  });

  test('force retitles a named council', async () => {
    await seedCouncil('council-1000000000011', [['Cael', 'rename me']]);
    await labels.setCouncilLabel(witness.address, 'council-1000000000011', 'Old Name');

    const res = await post({ force: true });
    expect(res.body.labels['council-1000000000011']).toBe(TITLE);
  });

  test('explicit councilIds name exactly those councils', async () => {
    await seedCouncil('council-1000000000021', [['Cael', 'first sitting']]);
    await seedCouncil('council-1000000000022', [['Aziel', 'second sitting']]);

    const res = await post({ councilIds: ['council-1000000000022'], force: true });
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ councilId: 'council-1000000000022', status: 'titled' });
    expect(res.body.labels['council-1000000000021']).toBeUndefined();
  });

  test('a council with no delivered speech is skipped, not failed', async () => {
    await store.createCouncilRecord(witness.address, {
      councilId: 'council-1000000000031',
      members: [{ name: 'Cael' }],
      witnessName: 'Founder',
    });

    const res = await post({});
    expect(res.body.results[0]).toMatchObject({ councilId: 'council-1000000000031', status: 'skipped' });
    expect(res.body.labels['council-1000000000031']).toBeUndefined();
  });
});
