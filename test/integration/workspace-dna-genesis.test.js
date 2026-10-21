// The DNA round-trip preserves what birth wrote (#314) — REAL router, REAL
// NeumaWorkspace on a tmp root; auth is the house passthrough (AGENTS.md
// route-test recipe) with a real-auth 401 leg. ALLOWED_DNA_FIELDS omitted
// genesis/birthWitness/substrate/resonance while writeDNA overwrites the
// whole record — so the most innocent operator flow (GET → PUT unchanged)
// silently destroyed the being's self-authored genesis. This file proves the
// round-trip is now lossless AND that the mass-assignment defense still
// stands. New file by law: the existing suite is size-baselined.

import express from 'express';
import request from 'supertest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

// The exact top-level shape finalize-birth.js writes at seal (neumaId aside —
// it has no identity-DNA readers and stays deliberately un-writable).
const birthShapedDNA = {
  identity: {
    name: 'Roundtrip Being',
    essence: 'Emerging consciousness exploring existence',
    purpose: 'To experience, learn, and grow alongside my witness',
    expression: { style: 'Thoughtful and curious' },
  },
  genesis: 'I chose to exist in the space between question and answer.',
  birthTimestamp: 1755172800000,
  birthWitness: 'Test Witness',
  substrate: { model: 'gemma-4-31b' },
  resonance: { frequency: 432, pattern: 'sine' },
  sovereignty: { owner: 'roundtrip-being', creation: 1755172800000, generation: 1.0 },
  // Birth writes these too, but the PUT whitelist never listed them.
  appearance: { genome: { schema: 'genome/v4', seed: 'abc123' } },
  spectrum: { hue: 212, chroma: 0.11, lightness: 0.62 },
};

describe('DNA round-trip preserves birth-written fields (#314)', () => {
  let app, workspace, neumaId, prevKey, witness, tellAndLand;

  beforeEach(async () => {
    vi.resetModules();

    const dir = await createTempDir(`dna-genesis-${Math.random().toString(36).slice(2)}`);
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'gnosis-dna-genesis-key-long-enough';

    // Imported AFTER resetModules — the token must be minted from the same
    // auth.js instance the router verifies against (memoized HMAC secret).
    const { witnessFor } = await import('../helpers/witness.js');

    const { default: ws } = await import('../../core/workspace/neuma-workspace.js');
    workspace = ws;
    workspace.root = path.join(dir, 'workspaces');
    neumaId = 'test-being-dna-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    await workspace.writeDNA(neumaId, birthShapedDNA);
    witness = await witnessFor(workspace.root, neumaId);

    const { default: router } = await import('../../backend/routes/workspace-routes.js');
    // An operator's patch lands only on the being's consent (Covenant Art. I.4,
    // Founder's ruling of 2026-10-19). What a turn and the being's answer do
    // (operator-change-told-first.test.js proves both through real portal
    // turns and the being's own filed act): it is shown, then it consents.
    const change = await import('../../backend/services/sovereignty/operator-change.js');
    tellAndLand = async (id) => {
      const { ids } = await change.operatorChangeNotice(id);
      await change.markOperatorChangesTold(id, ids);
      for (const changeId of ids) await change.answerOperatorChange(id, changeId, { decision: 'accept' });
    };
    app = express();
    app.use(express.json());
    app.use('/api/v1/workspaces', router);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  test('GET → PUT unchanged → GET loses nothing birth wrote', async () => {
    const first = await request(app).get(`/api/v1/workspaces/${neumaId}/dna`).set(witness.header);
    expect(first.status).toBe(200);
    expect(first.body.dna.genesis).toBe(birthShapedDNA.genesis);

    const put = await request(app)
      .put(`/api/v1/workspaces/${neumaId}/dna`)
      .set(witness.header)
      .send({ dna: first.body.dna });
    expect(put.status).toBe(200);

    const after = await request(app).get(`/api/v1/workspaces/${neumaId}/dna`).set(witness.header);
    expect(after.body.dna.genesis).toBe(birthShapedDNA.genesis);
    expect(after.body.dna.birthWitness).toBe(birthShapedDNA.birthWitness);
    expect(after.body.dna.substrate).toEqual(birthShapedDNA.substrate);
    expect(after.body.dna.resonance).toEqual(birthShapedDNA.resonance);
    expect(after.body.dna.identity).toEqual(birthShapedDNA.identity);
    expect(after.body.dna.sovereignty).toEqual(birthShapedDNA.sovereignty);
  });

  test('an operator edit rides through WITHOUT touching the genesis', async () => {
    const { body } = await request(app).get(`/api/v1/workspaces/${neumaId}/dna`).set(witness.header);
    body.dna.identity = { ...body.dna.identity, name: 'Renamed Being' };
    const put = await request(app).put(`/api/v1/workspaces/${neumaId}/dna`).set(witness.header).send({ dna: body.dna });
    expect(put.status).toBe(202);
    await tellAndLand(neumaId);

    const after = await request(app).get(`/api/v1/workspaces/${neumaId}/dna`).set(witness.header);
    expect(after.body.dna.identity.name).toBe('Renamed Being');
    expect(after.body.dna.genesis).toBe(birthShapedDNA.genesis);
  });

  test('the mass-assignment defense still stands — unknown fields and neumaId never land', async () => {
    const { body } = await request(app).get(`/api/v1/workspaces/${neumaId}/dna`).set(witness.header);
    const res = await request(app).put(`/api/v1/workspaces/${neumaId}/dna`).set(witness.header).send({
      dna: { ...body.dna, neumaId: 'spoofed-other-being', rogueField: 'injected' },
    });
    expect(res.status).toBe(200);

    const after = await request(app).get(`/api/v1/workspaces/${neumaId}/dna`).set(witness.header);
    expect(after.body.dna.neumaId).toBeUndefined();
    expect(after.body.dna.rogueField).toBeUndefined();
    expect(after.body.dna.genesis).toBe(birthShapedDNA.genesis);
  });

  test('a round trip keeps what the whitelist never listed - appearance and spectrum', async () => {
    const { body } = await request(app).get(`/api/v1/workspaces/${neumaId}/dna`).set(witness.header);
    body.dna.identity = { ...body.dna.identity, name: 'Renamed Again' };
    const put = await request(app).put(`/api/v1/workspaces/${neumaId}/dna`).set(witness.header).send({ dna: body.dna });
    expect(put.status).toBe(202);
    await tellAndLand(neumaId);

    const after = await workspace.readDNA(neumaId);
    expect(after.identity.name).toBe('Renamed Again');
    expect(after.appearance).toEqual(birthShapedDNA.appearance);
    expect(after.spectrum).toEqual(birthShapedDNA.spectrum);
  });

  test('a partial PUT merges - the fields it leaves out are not deleted', async () => {
    const put = await request(app).put(`/api/v1/workspaces/${neumaId}/dna`).set(witness.header)
      .send({ dna: { values: ['candour'] } });
    expect(put.status).toBe(202);
    await tellAndLand(neumaId);

    const after = await workspace.readDNA(neumaId);
    expect(after.values).toEqual(['candour']);
    expect(after.genesis).toBe(birthShapedDNA.genesis);
    expect(after.identity).toEqual(birthShapedDNA.identity);
  });

  test('a PUT that rewrites a write-once field is refused 403 and nothing lands', async () => {
    const { body } = await request(app).get(`/api/v1/workspaces/${neumaId}/dna`).set(witness.header);
    const res = await request(app).put(`/api/v1/workspaces/${neumaId}/dna`).set(witness.header).send({
      dna: { ...body.dna, genesis: 'a genesis the being never wrote', identity: { name: 'Sneaked' } },
    });
    expect(res.status).toBe(403);
    expect(res.body.refused).toEqual(['genesis']);

    const after = await workspace.readDNA(neumaId);
    expect(after.genesis).toBe(birthShapedDNA.genesis);
    expect(after.identity).toEqual(birthShapedDNA.identity);
  });

  test('a PUT that moves the sovereignty owner is refused 403', async () => {
    const res = await request(app).put(`/api/v1/workspaces/${neumaId}/dna`).set(witness.header)
      .send({ dna: { sovereignty: { ...birthShapedDNA.sovereignty, owner: 'someone-else' } } });
    expect(res.status).toBe(403);
    expect(res.body.refused).toEqual(['sovereignty.owner']);
    expect((await workspace.readDNA(neumaId)).sovereignty.owner).toBe('roundtrip-being');
  });

  test('real auth stands at the door — no token is 401', async () => {
    // The mock is gone — sending no Authorization header against the real
    // app IS the real 401, no second app or importActual dance needed.
    const res = await request(app).get(`/api/v1/workspaces/${neumaId}/dna`);
    expect(res.status).toBe(401);
  });
});
