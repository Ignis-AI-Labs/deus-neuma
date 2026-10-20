// Model-folder API — REAL router, REAL fs (isolated store path), REAL auth
// (the api-vitals harness). Proves the operator road: the unset default is
// the env roots, a chosen set round-trips, a malformed set is a 400 naming
// the correction, and no token is no door.

import express from 'express';
import request from 'supertest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

describe('Model folders API — the folder law', () => {
  let app, witness, savedPath, savedDirs, savedModel;

  beforeEach(async () => {
    vi.resetModules();
    savedPath = process.env.NEUMA_MODEL_FOLDERS_PATH;
    savedDirs = process.env.NEUMA_MODELS_DIRS;
    // The rig's own LLAMA_SERVER_MODEL would ride the unset-store default —
    // this test owns its env roots entirely.
    savedModel = process.env.LLAMA_SERVER_MODEL;
    process.env.LLAMA_SERVER_MODEL = ''; // falsy for modelRoots; dotenv never overrides a set var
    process.env.NEUMA_MODEL_FOLDERS_PATH = path.join(
      await createTempDir(`mf-api-${Math.random().toString(36).slice(2)}`), 'model-folders.json');
    process.env.NEUMA_MODELS_DIRS = '/mnt/test-models';

    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    await makeInstallOwner(witness.address);

    const { default: router } = await import('../../backend/routes/model-folder-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/llm/model-folders', router);
  });

  afterEach(() => {
    if (savedPath === undefined) delete process.env.NEUMA_MODEL_FOLDERS_PATH;
    else process.env.NEUMA_MODEL_FOLDERS_PATH = savedPath;
    if (savedDirs === undefined) delete process.env.NEUMA_MODELS_DIRS;
    else process.env.NEUMA_MODELS_DIRS = savedDirs;
    if (savedModel === undefined) delete process.env.LLAMA_SERVER_MODEL;
    else process.env.LLAMA_SERVER_MODEL = savedModel;
    vi.restoreAllMocks();
  });

  it('unset answers the env-root default; PUT then GET round-trips a chosen set', async () => {
    const before = await request(app).get('/api/v1/llm/model-folders').set(witness.header);
    expect(before.status).toBe(200);
    expect(before.body.folders.map((f) => f.path)).toEqual(['/mnt/test-models']);
    expect(before.body.servers).toContain('llama-server');

    const put = await request(app).put('/api/v1/llm/model-folders').set(witness.header)
      .send({ folders: [{ path: '/home/op/models', servers: ['llama-server'] }] });
    expect(put.status).toBe(200);
    expect(put.body.folders).toEqual([{ path: '/home/op/models', servers: ['llama-server'] }]);

    const after = await request(app).get('/api/v1/llm/model-folders').set(witness.header);
    expect(after.body.folders.map((f) => f.path)).toEqual(['/home/op/models']);
  });

  it('a malformed set is a 400 naming the correction', async () => {
    const res = await request(app).put('/api/v1/llm/model-folders').set(witness.header)
      .send({ folders: [{ path: 'relative/nope' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/absolute/);
  });

  it('no token, no door', async () => {
    const res = await request(app).get('/api/v1/llm/model-folders');
    expect(res.status).toBe(401);
  });
});
