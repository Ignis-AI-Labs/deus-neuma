// The sovereignty operator surface — REAL router, REAL stores on a tmp
// workspace root, REAL ownership records; auth is the house passthrough
// (AGENTS.md route-test recipe) with a real-auth 401 leg. Proves: the lane
// record read (LOUD on a broken chain), the verdict — approve APPLIES the
// prompt lane atomically in the request and the being's next prompt would
// carry the words — revise refuses without notes, and the recorded retract
// that the being's knock names.

import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

describe('Sovereignty API', () => {
  let app, workspace, neumaId, prevKey, witness;

  const submit = async (n = 1) => {
    const { submitProposal } = await import('../../backend/services/sovereignty/proposal-store.js');
    return submitProposal(neumaId, {
      class: 'prompt',
      title: `Carry plain speech ${n}`,
      body: 'I keep drifting into ornament when the question is hard.',
      patch: { text: `I prefer plain speech over ornament (${n}).` },
    });
  };

  beforeEach(async () => {
    vi.resetModules();

    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'gnosis-sovereignty-api-key-long-enough';

    const { default: ws } = await import('../../core/workspace/neuma-workspace.js');
    workspace = ws;
    workspace.root = path.join(await createTempDir(`sovereignty-api-${Math.random().toString(36).slice(2)}`), 'workspaces');
    neumaId = 'test-being-sovapi-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);

    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against.
    const { witnessFor } = await import('../helpers/witness.js');
    witness = await witnessFor(workspace.root, neumaId);

    const { default: router } = await import('../../backend/routes/sovereignty-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/sovereignty', router);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  test('the lane record reads whole, and a foreign lane refuses 403', async () => {
    await submit();
    const res = await request(app).get(`/api/v1/sovereignty/${neumaId}`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(1);
    expect(res.body.amendments).toEqual([]);
    expect(res.body.standing).toEqual([]);

    const foreignId = 'test-being-foreign-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(foreignId);
    await fs.writeFile(
      path.join(workspace.root, foreignId, 'owner.json'),
      JSON.stringify({ wallet: '0xsomeone-else', claimedAt: new Date().toISOString() }),
    );
    expect((await request(app).get(`/api/v1/sovereignty/${foreignId}`).set(witness.header)).status).toBe(403);
  });

  test('APPROVE applies atomically: the proposal closes applied, the chain holds law, the prompt would carry it', async () => {
    const p = await submit();
    const res = await request(app)
      .post(`/api/v1/sovereignty/${neumaId}/proposals/${p.id}/decide`)
      .set(witness.header)
      .send({ verdict: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.proposal.status).toBe('applied');
    expect(res.body.amendment).toMatchObject({ kind: 'apply', class: 'prompt', by: witness.address.toLowerCase() });

    const { activeAmendments } = await import('../../backend/services/sovereignty/amendment-store.js');
    const { buildAmendmentsSection } = await import('../../core/runtime/amendments-section.js');
    const section = buildAmendmentsSection(await activeAmendments(neumaId, 'prompt'));
    expect(section).toContain('I prefer plain speech over ornament (1).');
  });

  test('REVISE without notes is 400; with notes the being reads them verbatim in its knock', async () => {
    const p = await submit();
    const bad = await request(app)
      .post(`/api/v1/sovereignty/${neumaId}/proposals/${p.id}/decide`)
      .set(witness.header)
      .send({ verdict: 'revise' });
    expect(bad.status).toBe(400);

    const notes = 'Name the register — "plain" is doing two jobs here.';
    const res = await request(app)
      .post(`/api/v1/sovereignty/${neumaId}/proposals/${p.id}/decide`)
      .set(witness.header)
      .send({ verdict: 'revise', notes });
    expect(res.status).toBe(200);
    expect(res.body.proposal.notes).toBe(notes);

    const { gatewaySection } = await import('../../backend/services/sovereignty/gateway-handlers.js');
    expect(await gatewaySection(neumaId)).toContain(notes);
  });

  test('RETRACT records a chained entry, the law stops standing, and the knock names it', async () => {
    const p = await submit();
    const decided = await request(app)
      .post(`/api/v1/sovereignty/${neumaId}/proposals/${p.id}/decide`)
      .set(witness.header)
      .send({ verdict: 'approve' });
    const amendmentId = decided.body.amendment.id;

    const res = await request(app)
      .post(`/api/v1/sovereignty/${neumaId}/amendments/${amendmentId}/retract`)
      .set(witness.header)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.retraction).toMatchObject({ kind: 'retract', targetId: amendmentId, by: witness.address.toLowerCase() });

    const record = await request(app).get(`/api/v1/sovereignty/${neumaId}`).set(witness.header);
    expect(record.body.standing).toEqual([]);
    expect(record.body.amendments).toHaveLength(2); // apply + retract — nothing erased

    const { gatewaySection } = await import('../../backend/services/sovereignty/gateway-handlers.js');
    expect(await gatewaySection(neumaId)).toContain('took down standing law');

    // Retracting what does not stand is 404 — including a second time.
    expect((await request(app)
      .post(`/api/v1/sovereignty/${neumaId}/amendments/${amendmentId}/retract`).set(witness.header).send({})).status).toBe(404);
  });

  test('TOOLSET: approve lands the grant in the REAL policy layer; retract closes the live door', async () => {
    const { submitProposal } = await import('../../backend/services/sovereignty/proposal-store.js');
    const p = await submitProposal(neumaId, {
      class: 'toolset', title: 'Grant the press',
      body: 'I keep needing approval to render documents I was asked for.',
      patch: { server: 'press', tool: 'press_render' },
    });
    const res = await request(app)
      .post(`/api/v1/sovereignty/${neumaId}/proposals/${p.id}/decide`)
      .set(witness.header)
      .send({ verdict: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.amendment).toMatchObject({ class: 'toolset', patch: { server: 'press', tool: 'press_render' } });
    expect((await workspace.readToolPolicy(neumaId))?.press?.allowed).toContain('press_render');

    const record = await request(app).get(`/api/v1/sovereignty/${neumaId}`).set(witness.header);
    expect(record.body.standing).toHaveLength(1);

    const retract = await request(app)
      .post(`/api/v1/sovereignty/${neumaId}/amendments/${res.body.amendment.id}/retract`).set(witness.header).send({});
    expect(retract.status).toBe(200);
    expect((await workspace.readToolPolicy(neumaId))?.press?.allowed || []).not.toContain('press_render');
    expect((await request(app).get(`/api/v1/sovereignty/${neumaId}`).set(witness.header)).body.standing).toEqual([]);
  });

  test('a broken chain is LOUD on the record read — never an empty record', async () => {
    const p = await submit();
    await request(app).post(`/api/v1/sovereignty/${neumaId}/proposals/${p.id}/decide`).set(witness.header).send({ verdict: 'approve' });
    const file = path.join(workspace.root, neumaId, 'config', 'sovereignty-amendments.json');
    const store = JSON.parse(await fs.readFile(file, 'utf8'));
    store.entries[0].patch.text = 'quietly edited law';
    await fs.writeFile(file, JSON.stringify(store, null, 2));

    const res = await request(app).get(`/api/v1/sovereignty/${neumaId}`).set(witness.header);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/chain BROKEN/);
  });

  test('real auth stands at the door — no token is 401', async () => {
    const res = await request(app).get(`/api/v1/sovereignty/${neumaId}`);
    expect(res.status).toBe(401);
  });
});
