/**
 * Global ignite HTTP contract — the catalog listing and ignite-by-model routes
 * proven over real HTTP against the real router, real config store, a real
 * model catalog on real disk, and a real spawned stand-in substrate (RULE 0).
 * Only auth is a passthrough (the sanctioned route-test pattern — the claim
 * here is the ignite contract, not challenge-signing).
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { writeFile, chmod, mkdir } from 'fs/promises';
import { createServer } from 'http';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

// NEUMA_SUBSTRATE_CLAIM_DIR: the claim registry is CROSS-PROCESS state
// (~/.neuma by default), shared with any live desk on this machine —
// unpinned, the live stack's idle-unload can claim-stop this suite's
// stand-in child, and this suite's ignites could touch the live claim.
const ENV_KEYS = ['NEUMA_MODELS_DIRS', 'LLAMA_SERVER_BIN', 'LLAMA_SERVER_MODEL', 'LLAMA_SERVER_URL', 'NEUMA_SUBSTRATE_CLAIM_DIR', 'SUBSTRATE_MODEL', 'NEUMA_PROVIDER_CHOICE_PATH'];
const savedEnv = {};

const freePort = () => new Promise((resolve) => {
  const srv = createServer();
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

describe('substrate model catalog + ignite-by-model routes', () => {
  let app, root, bin, port, supervisor, lifecycle, provider, witness;

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

    // real catalog root: two stand-in weights on real disk
    root = await createTempDir('api-substrate-models');
    await mkdir(path.join(root, 'pub/alpha'), { recursive: true });
    await mkdir(path.join(root, 'pub/beta'), { recursive: true });
    await writeFile(path.join(root, 'pub/alpha/alpha.gguf'), 'alpha-weights');
    await writeFile(path.join(root, 'pub/beta/beta.gguf'), 'beta-weights');
    // No lineage sidecars: stand-in weights carry no committed lineage, so an
    // ignite lawfully boots them BASE-ONLY (the gate authorizes committed
    // tuples only — a sidecar here would route the launch into a gate it can
    // never pass).

    // a real executable that answers a healthy /health on the configured port
    const server = path.join(root, 'serve-health.mjs');
    await writeFile(server, `
import http from 'http';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
}).listen(port, '127.0.0.1');
`);
    bin = path.join(root, 'fake-substrate');
    await writeFile(bin, `#!/bin/sh\nexec "${process.execPath}" "${server}" "$@"\n`);
    await chmod(bin, 0o755);

    port = await freePort();

    process.env.NEUMA_MODELS_DIRS = root;
    process.env.LLAMA_SERVER_BIN = bin;
    process.env.LLAMA_SERVER_MODEL = path.join(root, 'pub/alpha/alpha.gguf');
    process.env.LLAMA_SERVER_URL = `http://127.0.0.1:${port}`;
    process.env.NEUMA_SUBSTRATE_CLAIM_DIR = path.join(root, 'claims');
    // The ignite route persists the operator's durable provider choice — that
    // write must land here, never in the machine's real settings-store.
    process.env.NEUMA_PROVIDER_CHOICE_PATH = path.join(root, 'llm-provider.json');
    // Force no SUBSTRATE_MODEL so channel falls to LLAMA_SERVER_MODEL path for active
    // (prevents host env pollution from making active 'gemma' etc in no-selection test).
    // Seed SUBSTRATE_MODEL to a bounded key (catalog id form) so validator + channel agree.
    // The initial active will be this key; test asserts the catalog id form.
    process.env.SUBSTRATE_MODEL = 'pub/alpha/alpha';

    supervisor = await import('../../backend/services/llama-server-supervisor.js');
    lifecycle = await import('../../backend/services/substrate-lifecycle.js');
    provider = await import('../../backend/services/llm-provider.js');
    provider.setConfig({ provider: 'llama-server', endpoint: `http://127.0.0.1:${port}` });

    // Imported AFTER resetModules so the witness mints its token from the
    // same auth.js instance the router will verify against.
    const { strangerWitness } = await import('../helpers/witness.js');
    // These routes carry no neuma lane (global substrate config) — a real
    // session that claims no workspace is exactly the right shape.
    witness = strangerWitness();

    const { default: router } = await import('../../backend/routes/llm-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1', router);
  });

  afterEach(async () => {
    supervisor.selectSubstrateModel(null);
    await supervisor.stopSupervised();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.restoreAllMocks();
  });

  test('GET /llm/substrate/models: nothing serving → no active row, resting target seeds served', async () => {
    const res = await request(app).get('/api/v1/llm/substrate/models').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('llama-server');
    // LOADED is a live fact — with no server answering, no row is active…
    expect(res.body.active).toBeNull();
    // …but the resting target (the env key here) still seeds the picker.
    expect(res.body.served).toBe('pub/alpha/alpha');
  });

  test('POST ignite refuses a model the catalog does not name', async () => {
    const res = await request(app)
      .post('/api/v1/llm/substrate/ignite')
      .set(witness.header)
      .send({ model: 'not/in/catalog' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/catalog/);
  });

  test('POST ignite with a cataloged model boots it; status + models follow the selection', async () => {
    const res = await request(app)
      .post('/api/v1/llm/substrate/ignite')
      .set(witness.header)
      .send({ model: 'pub/beta/beta' });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('igniting');

    // observe completion through the same endpoint the desk polls
    let loaded = false;
    const deadline = Date.now() + 15000;
    while (!loaded && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      const st = await request(app).get('/api/v1/llm/substrate/ignition').set(witness.header);
      loaded = st.body.targetLoaded === true;
    }
    expect(loaded).toBe(true);

    const models = await request(app).get('/api/v1/llm/substrate/models').set(witness.header);
    // After ignite the LIVE claim names the served key; the loaded row is
    // offered even when the gate would refuse it, and active is never an FD.
    expect(models.body.active).toBe('pub/beta/beta');
    expect(models.body.models.map((m) => m.id)).toContain('pub/beta/beta');
    expect(models.body.models.every((m) => m.id === models.body.active || m.authorized !== false)).toBe(true);

    // The accepted ignite persisted the operator's durable choice — the next
    // boot restores this lane and relights this model, never the env default.
    const { readFile } = await import('fs/promises');
    const choice = JSON.parse(await readFile(process.env.NEUMA_PROVIDER_CHOICE_PATH, 'utf8'));
    expect(choice).toMatchObject({ provider: 'llama-server', model: 'pub/beta/beta', chosenBy: 'operator' });
  }, 30000);
});
