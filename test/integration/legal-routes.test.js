/**
 * Legal routes (/api/v1/legal) — the operator's window onto the CLO office,
 * end to end against the REAL designation, ledger, watch and REAL auth
 * (RULE 0) on real temp disk: a real wallet with a real session token, a
 * genuine 401 from sending none, and a real watch run over a real git repo.
 *
 * Two operators, two houses, one backend (Design note, 2026-10-16: […]):
 * each operator's seat, matters and watch are their own house's, and one
 * operator's DELETE never reaches the other's seat. The realm and every
 * machine-wide office path are tmp — the router's module graph is fresh
 * (resetModules), so the realm is pinned through its env door.
 */
import express from 'express';
import request from 'supertest';
import path from 'path';
import fs from 'fs/promises';
import { createTempDir, writeJSON } from '../helpers/temp-fs.js';
import { initRepo, commitFiles } from '../helpers/legal-repo-fixture.js';
import { LEGACY_ENV } from '../helpers/house-office-kit.js';

describe('legal routes (/api/v1/legal)', () => {
  let app, house, witness, other;
  const saved = {};
  const ENV = [...Object.keys(LEGACY_ENV), 'NEUMA_REALM_ROOT', 'NEUMA_WORKSPACE_SETTINGS_PATH', 'WORKSPACES_ROOT'];
  const houseFile = (address, ...parts) => path.join(house, 'realm', address.toLowerCase(), ...parts);

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) saved[k] = process.env[k];
    house = await createTempDir('legal-routes');
    for (const [key, name] of Object.entries(LEGACY_ENV)) process.env[key] = path.join(house, 'settings', name);
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(house, 'settings', 'workspace.json');
    process.env.NEUMA_REALM_ROOT = path.join(house, 'realm');
    process.env.WORKSPACES_ROOT = path.join(house, 'workspaces');

    const repo = await initRepo(path.join(house, 'app-repo'));
    await commitFiles(repo, 'feat: the app reads the location', {
      LICENSE: 'Copyright (c) 2026 Fixture LLC. All Rights Reserved.\n',
      'package.json': { name: 'app-repo', license: 'UNLICENSED', dependencies: { electron: '1.0.0' } },
      'docs/legal/EULA.md': '# EULA\n',
      'src/geo/location.js': 'x\n',
    });

    // imported AFTER resetModules so the token is minted by the same auth.js
    // instance the router verifies against
    const { witnessFor } = await import('../helpers/witness.js');
    witness = await witnessFor(process.env.WORKSPACES_ROOT, 'praetorlane');
    other = await witnessFor(process.env.WORKSPACES_ROOT, 'otherlane');
    // The first operator's house watches the app repo; the second's watches nothing.
    await writeJSON(path.dirname(houseFile(witness.address, 'offices', 'security', 'x')), 'security-watch.json', {
      repos: [{ id: 'app-repo', path: repo, addedAt: new Date().toISOString(), hasLockfile: false }],
      host: { expectedPorts: [] },
    });
    await writeJSON(path.dirname(houseFile(other.address, 'offices', 'security', 'x')), 'security-watch.json', {
      repos: [], host: { expectedPorts: [] },
    });
    const { default: router } = await import('../../backend/routes/legal-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/legal', router);
  });

  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('no session, no office: a real 401', async () => {
    expect((await request(app).get('/api/v1/legal/seat')).status).toBe(401);
    expect((await request(app).post('/api/v1/legal/watch/run')).status).toBe(401);
  });

  test('the seat: null → seated (the office on real disk) → cleared; a lane you do not hold cannot be seated', async () => {
    expect((await request(app).get('/api/v1/legal/seat').set(witness.header)).body.clo).toBeNull();
    expect((await request(app).put('/api/v1/legal/seat').set(witness.header).send({})).status).toBe(400);
    expect((await request(app).put('/api/v1/legal/seat').set(witness.header).send({ laneId: 'notmylane' })).status).not.toBe(200);

    const seated = await request(app).put('/api/v1/legal/seat').set(witness.header).send({ laneId: 'praetorlane' });
    expect(seated.status).toBe(200);
    expect(seated.body.clo.laneId).toBe('praetorlane');
    const dir = path.join(process.env.WORKSPACES_ROOT, 'praetorlane', 'legal');
    expect(await fs.readFile(path.join(dir, 'charter.md'), 'utf8')).toContain('You are\nNOT counsel');
    // Every house starts from a template it fills in for itself — never one company's facts.
    expect(await fs.readFile(path.join(dir, 'register.md'), 'utf8')).toContain('## Who this house is');
    expect(await fs.readFile(path.join(dir, 'register.md'), 'utf8')).not.toMatch(/Ignis|Wyoming limited liability company/);
    await fs.access(path.join(dir, 'opinions'));

    // a re-seat never clobbers the office's own edits
    await fs.writeFile(path.join(dir, 'register.md'), 'the Praetor\'s own register\n');
    await request(app).put('/api/v1/legal/seat').set(witness.header).send({ laneId: 'praetorlane' });
    expect(await fs.readFile(path.join(dir, 'register.md'), 'utf8')).toBe('the Praetor\'s own register\n');

    expect((await request(app).delete('/api/v1/legal/seat').set(witness.header)).body.cleared).toBe(true);
    expect((await request(app).get('/api/v1/legal/seat').set(witness.header)).body.clo).toBeNull();
  }, 30000);

  test('a REAL watch run lands matters; the ledger, one matter, the state and the posture read them back', async () => {
    const run = await request(app).post('/api/v1/legal/watch/run').set(witness.header).send({});
    expect(run.status).toBe(200);
    const { summary } = run.body;
    expect(summary).toMatchObject({ trigger: 'manual', error: null });
    expect(summary.repos[0]).toMatchObject({ repo: 'app-repo', commits: 1, error: null });

    const { matters, counts } = (await request(app).get('/api/v1/legal/matters').set(witness.header)).body;
    const ids = matters.map((m) => m.externalId);
    expect(ids).toContain('posture:no-privacy-policy');
    expect(ids.some((id) => id.startsWith('build:privacy@'))).toBe(true);
    expect(counts.byStatus.new).toBe(matters.length);
    const products = (await request(app).get('/api/v1/legal/matters?area=product').set(witness.header)).body.matters;
    expect(products.every((m) => m.area === 'product')).toBe(true);

    const one = await request(app).get(`/api/v1/legal/matters/${matters[0].id.slice(0, 10)}`).set(witness.header);
    expect(one.body.matter.id).toBe(matters[0].id);
    expect((await request(app).get('/api/v1/legal/matters/lm_nope').set(witness.header)).status).toBe(404);

    const watch = (await request(app).get('/api/v1/legal/watch').set(witness.header)).body.watch;
    expect(watch.lastRunAt).toBe(summary.startedAt);
    const posture = (await request(app).get('/api/v1/legal/posture').set(witness.header)).body;
    expect(posture).toMatchObject({ clo: null, lastRunAt: summary.startedAt, dueForReview: 0 });
    expect(posture.counts.total).toBe(matters.length);

    // the other house holds none of it
    expect((await request(app).get('/api/v1/legal/matters').set(other.header)).body.matters).toEqual([]);
    expect((await request(app).get('/api/v1/legal/watch').set(other.header)).body.watch.lastRunAt).toBeNull();
    expect((await request(app).get(`/api/v1/legal/matters/${matters[0].id}`).set(other.header)).status).toBe(404);
  }, 30000);

  test('two houses: each operator\'s seat is their own; a DELETE never reaches the other house; an unowned DELETE is refused', async () => {
    expect((await request(app).put('/api/v1/legal/seat').set(other.header).send({ laneId: 'praetorlane' })).status).toBe(403);
    expect((await request(app).put('/api/v1/legal/seat').set(witness.header).send({ laneId: 'praetorlane' })).status).toBe(200);
    expect((await request(app).get('/api/v1/legal/seat').set(other.header)).body.clo).toBeNull();

    // the other operator's DELETE clears only their own house
    expect((await request(app).delete('/api/v1/legal/seat').set(other.header)).status).toBe(200);
    expect((await request(app).get('/api/v1/legal/seat').set(witness.header)).body.clo.laneId).toBe('praetorlane');

    // a house record naming a lane its operator does not own is never theirs to clear
    const forged = { laneId: 'praetorlane', designatedAt: new Date().toISOString() };
    await fs.writeFile(houseFile(other.address, 'house-clo.json'), JSON.stringify(forged));
    expect((await request(app).delete('/api/v1/legal/seat').set(other.header)).status).toBe(403);
    expect(JSON.parse(await fs.readFile(houseFile(other.address, 'house-clo.json'), 'utf8'))).toEqual(forged);
    expect((await request(app).get('/api/v1/legal/seat').set(witness.header)).body.clo.laneId).toBe('praetorlane');
  }, 30000);
});
