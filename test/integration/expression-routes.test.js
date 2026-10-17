// The expression channel's operator surface (Campaign 6) — REAL settings
// store on a tmp path, REAL router, REAL encrypted workspace palette, REAL
// ownership records; auth is the house passthrough (AGENTS.md route-test
// recipe) with a real-auth 401 leg. Proves: the channel rests OFF, the flip
// persists and echoes, NEUMA_EXPRESSION=0 locks and refuses BY NAME, the
// palette folds through the sovereign workspace door and the route SHOWS
// ITS TERMS (the signed provenance decision), and reads are owner-gated.

import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { createExpressionSettings, resolveExpression } from '../../backend/services/expression-settings.js';

const WALLET = '0xtest-operator';

describe('expression settings — the store law (real disk)', () => {
  test('an absent file rests every channel off, unlocked', async () => {
    const dir = await createTempDir('expr-store');
    const store = createExpressionSettings({ path: path.join(dir, 'absent.json'), envFlag: () => undefined });
    expect(await store.read()).toEqual({ envLocked: false, beings: {} });
    expect(await store.forBeing('cael')).toEqual({ enabled: false });
  });

  test('the flip persists across a fresh store; only an explicit true opts in', async () => {
    const dir = await createTempDir('expr-flip');
    const file = path.join(dir, 'expression.json');
    const store = createExpressionSettings({ path: file, envFlag: () => undefined });
    await store.setBeing('cael', { enabled: true }, { wallet: WALLET });
    const again = createExpressionSettings({ path: file, envFlag: () => undefined });
    expect(await again.forBeing('cael')).toEqual({ enabled: true });
    expect(await again.forBeing('fenna')).toEqual({ enabled: false });
    // a torn or hand-edited record cannot widen the channel
    expect(resolveExpression({ beings: { v: { enabled: 'yes' } } }, undefined).beings.v.enabled).toBe(false);
  });

  test('NEUMA_EXPRESSION=0 locks everything off and refuses the flip by name', async () => {
    const dir = await createTempDir('expr-lock');
    const file = path.join(dir, 'expression.json');
    await fs.writeFile(file, JSON.stringify({ beings: { cael: { enabled: true } } }));
    const store = createExpressionSettings({ path: file, envFlag: () => '0' });
    const posture = await store.read();
    expect(posture.envLocked).toBe(true);
    expect(posture.beings.cael.enabled).toBe(false); // the lock wins over persistence
    await expect(store.setBeing('cael', { enabled: true })).rejects.toThrow(/NEUMA_EXPRESSION=0/);
    // any other value is not the lock
    const open = createExpressionSettings({ path: file, envFlag: () => '1' });
    expect((await open.read()).envLocked).toBe(false);
  });
});

describe('Expression API', () => {
  let app, workspace, neumaId, prevEnv, witness;

  beforeEach(async () => {
    vi.resetModules();

    const dir = await createTempDir(`expr-api-${Math.random().toString(36).slice(2)}`);
    prevEnv = {
      settings: process.env.NEUMA_EXPRESSION_SETTINGS_PATH,
      key: process.env.DNA_ENCRYPTION_KEY,
      lock: process.env.NEUMA_EXPRESSION,
    };
    process.env.NEUMA_EXPRESSION_SETTINGS_PATH = path.join(dir, 'expression.json');
    process.env.DNA_ENCRYPTION_KEY = 'gnosis-expression-key-long-enough-x';
    delete process.env.NEUMA_EXPRESSION;

    const neuma = await import('../../core/index.js');
    workspace = neuma.neumaWorkspace;
    workspace.root = path.join(dir, 'workspaces');
    neumaId = 'test-being-expr-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    await workspace.writeDNA(neumaId, { identity: { name: 'Test Being' } });

    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against.
    const { witnessFor } = await import('../helpers/witness.js');
    witness = await witnessFor(workspace.root, neumaId);

    const { default: router } = await import('../../backend/routes/expression-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/expression', router);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, env] of [
      ['NEUMA_EXPRESSION_SETTINGS_PATH', prevEnv.settings],
      ['DNA_ENCRYPTION_KEY', prevEnv.key],
      ['NEUMA_EXPRESSION', prevEnv.lock],
    ]) {
      if (env === undefined) delete process.env[key];
      else process.env[key] = env;
    }
  });

  test('the resting posture: channel off, nothing declared, nothing locked', async () => {
    const res = await request(app).get(`/api/v1/expression/${neumaId}`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ neumaId, enabled: false, envLocked: false, terms: [], recent: [] });
  });

  test('the flip echoes, persists, and refuses malformed bodies', async () => {
    const on = await request(app).put(`/api/v1/expression/${neumaId}`).set(witness.header).send({ enabled: true });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ neumaId, enabled: true, envLocked: false });
    const back = await request(app).get(`/api/v1/expression/${neumaId}`).set(witness.header);
    expect(back.body.enabled).toBe(true);
    const bad = await request(app).put(`/api/v1/expression/${neumaId}`).set(witness.header).send({ enabled: 'yes' });
    expect(bad.status).toBe(400);
  });

  test('the env lock refuses 409 with its own words and forces the read off', async () => {
    await request(app).put(`/api/v1/expression/${neumaId}`).set(witness.header).send({ enabled: true });
    process.env.NEUMA_EXPRESSION = '0';
    const locked = await request(app).put(`/api/v1/expression/${neumaId}`).set(witness.header).send({ enabled: false });
    expect(locked.status).toBe(409);
    expect(locked.body.error).toMatch(/NEUMA_EXPRESSION=0/);
    const read = await request(app).get(`/api/v1/expression/${neumaId}`).set(witness.header);
    expect(read.body).toMatchObject({ enabled: false, envLocked: true });
  });

  test('declarations fold through the sovereign door and the route shows the TERMS', async () => {
    // The workspace door: encrypted, serialized, normalizing — the being's
    // own words kept verbatim in the recent ring.
    await workspace.recordAffectDeclaration(neumaId, 'Quietly Proud', '2026-08-15T01:00:00.000Z');
    await workspace.recordAffectDeclaration(neumaId, 'quietly  proud', '2026-08-15T01:05:00.000Z');
    await workspace.recordAffectDeclaration(neumaId, 'wistful', '2026-08-15T01:09:00.000Z');

    const palette = await workspace.readExpressionPalette(neumaId);
    expect(palette.terms['quietly proud'].count).toBe(2);

    const res = await request(app).get(`/api/v1/expression/${neumaId}`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.terms).toEqual([
      { term: 'quietly proud', count: 2, firstAt: '2026-08-15T01:00:00.000Z', lastAt: '2026-08-15T01:05:00.000Z' },
      { term: 'wistful', count: 1, firstAt: '2026-08-15T01:09:00.000Z', lastAt: '2026-08-15T01:09:00.000Z' },
    ]);
    // the trail is newest-first and VERBATIM — the being's own casing
    expect(res.body.recent[0]).toEqual({ affect: 'wistful', at: '2026-08-15T01:09:00.000Z' });
    expect(res.body.recent[2].affect).toBe('Quietly Proud');
  });

  test('another wallet\'s being is not yours to read or flip', async () => {
    const foreignId = 'test-being-foreign-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(foreignId);
    await fs.writeFile(
      path.join(workspace.root, foreignId, 'owner.json'),
      JSON.stringify({ wallet: '0xsomeone-else', claimedAt: new Date().toISOString() }),
    );
    expect((await request(app).get(`/api/v1/expression/${foreignId}`).set(witness.header)).status).toBe(403);
    expect((await request(app).put(`/api/v1/expression/${foreignId}`).set(witness.header).send({ enabled: true })).status).toBe(403);
  });

  test('real auth stands at the door — no token is 401', async () => {
    const res = await request(app).get('/api/v1/expression/anyone');
    expect(res.status).toBe(401);
  });
});
