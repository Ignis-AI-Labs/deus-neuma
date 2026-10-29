/**
 * CSO routes (/api/v1/cso) — the operator's window onto the office, end to
 * end against the REAL designation, watch store, ledger, scheduler, and
 * REAL auth (RULE 0, #390 tranche 4) on real temp disk. No mock stands in
 * for the caller's session — a real wallet with a real HMAC token proves
 * every request, and a genuine 401 comes from sending none.
 *
 * The manual scan run here is REAL and small by construction: the watch file
 * is pre-seeded at a one-package tmp repo, so the run makes ONE real OSV
 * call plus the real host/house probes.
 *
 * Every route reads the SIGNED-IN OPERATOR'S HOUSE (ruling, 2026-10-16): a
 * second operator never reads, clears or scans the first's office.
 */
import express from 'express';
import request from 'supertest';
import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createTempDir, writeJSON } from '../helpers/temp-fs.js';
import { connectionsOn } from '../helpers/connections-kit.js';

// The security watch's online check is off until the person turns it on (CONNECTIONS); this suite proves it on.
const connections = connectionsOn(['security-watch']);
afterAll(() => connections.restore());

const execFileP = promisify(execFile);

describe('CSO routes (/api/v1/cso)', () => {
  let app, house, tinyRepo, witness;
  const saved = {};
  const ENV = [
    'NEUMA_SECURITY_CSO_PATH', 'NEUMA_SECURITY_THREATS_PATH',
    'NEUMA_SECURITY_WATCH_PATH', 'NEUMA_SECURITY_SCAN_STATE_PATH',
    'NEUMA_SECURITY_HOST_PATH', 'NEUMA_REALM_ROOT', 'WORKSPACES_ROOT',
  ];
  // The house's own office file, in the tmp realm.
  const officePath = (wallet, name) => path.join(house, 'realm', wallet.toLowerCase(), 'offices', 'security', name);

  const buildApp = async () => {
    const { default: router } = await import('../../backend/routes/cso-routes.js');
    const a = express();
    a.use(express.json());
    a.use('/api/v1/cso', router);
    return a;
  };

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) { saved[k] = process.env[k]; }

    house = await createTempDir('cso-routes');
    process.env.NEUMA_SECURITY_CSO_PATH = path.join(house, 'cso.json');
    process.env.NEUMA_SECURITY_THREATS_PATH = path.join(house, 'threats.json');
    process.env.NEUMA_SECURITY_WATCH_PATH = path.join(house, 'watch.json');
    process.env.NEUMA_SECURITY_SCAN_STATE_PATH = path.join(house, 'scan-state.json');
    process.env.NEUMA_SECURITY_HOST_PATH = path.join(house, 'host.json');
    // Read by user-realm at import — set before the router's fresh import.
    process.env.NEUMA_REALM_ROOT = path.join(house, 'realm');
    process.env.WORKSPACES_ROOT = path.join(house, 'workspaces');

    // A one-package watched repo so the manual run is real AND fast.
    tinyRepo = path.join(house, 'tiny-repo');
    await fs.mkdir(tinyRepo, { recursive: true });
    await execFileP('git', ['init'], { cwd: tinyRepo });
    await writeJSON(tinyRepo, 'package-lock.json', {
      lockfileVersion: 3,
      packages: { '': { name: 'tiny' }, 'node_modules/minimist': { version: '1.2.5' } },
    });
    await fs.writeFile(path.join(tinyRepo, 'index.js'), 'export const ok = 1;\n');
    await execFileP('git', ['add', '-A'], { cwd: tinyRepo });

    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against — the token secret is
    // memoized per module instance, so a stale import would 401 honestly.
    const { witnessFor } = await import('../helpers/witness.js');
    // THE CALLER MUST OWN THE LANE IT SEATS. This wallet used to be a
    // stranger, on the reasoning that it was […] and
    // the ownership gate was "exercised separately" — true only while the auth
    // mock waved `assertNeumaOwner` through. Against the real gate, seating
    // `guardianlane` from a wallet that owns nothing is a 404, and correctly
    // so: nobody seats a lane they do not hold (#409 cause A).
    witness = await witnessFor(process.env.WORKSPACES_ROOT, 'guardianlane');
    // The watch list is the witness's house's own.
    await fs.mkdir(path.dirname(officePath(witness.address, 'security-watch.json')), { recursive: true });
    await fs.writeFile(officePath(witness.address, 'security-watch.json'), JSON.stringify({
      repos: [{ id: 'tiny-repo', path: tinyRepo, addedAt: new Date().toISOString(), hasLockfile: true }],
      host: { expectedPorts: [3333, 7777, 22, 631, 9121] },
    }));
    app = await buildApp();
  });

  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  test('the seat: null → seated (office scaffolded on real disk) → cleared', async () => {
    expect((await request(app).get('/api/v1/cso/seat').set(witness.header)).body.cso).toBeNull();
    expect((await request(app).put('/api/v1/cso/seat').set(witness.header).send({})).status).toBe(400);

    const seated = await request(app).put('/api/v1/cso/seat').set(witness.header).send({ laneId: 'guardianlane' });
    expect(seated.status).toBe(200);
    expect(seated.body.cso.laneId).toBe('guardianlane');
    // The office on disk rides the seat — playbook + surfaces, real files.
    const dir = path.join(process.env.WORKSPACES_ROOT, 'guardianlane', 'security');
    const playbook = await fs.readFile(path.join(dir, 'playbook.md'), 'utf8');
    expect(playbook).toContain('24-hour law');
    expect(await fs.readFile(path.join(dir, 'surfaces.md'), 'utf8')).toContain('HARDWARE');

    expect((await request(app).get('/api/v1/cso/seat').set(witness.header)).body.cso.laneId).toBe('guardianlane');
    expect((await request(app).delete('/api/v1/cso/seat').set(witness.header)).body.cleared).toBe(true);
    expect((await request(app).get('/api/v1/cso/seat').set(witness.header)).body.cso).toBeNull();
  }, 30000);

  test('the watch list: read, add, remove, host ports', async () => {
    const watch = (await request(app).get('/api/v1/cso/watch').set(witness.header)).body.watch;
    expect(watch.repos.map((r) => r.id)).toEqual(['tiny-repo']);

    const another = path.join(house, 'another-repo');
    await fs.mkdir(another, { recursive: true });
    await execFileP('git', ['init'], { cwd: another });
    expect((await request(app).post('/api/v1/cso/watch/repos').set(witness.header).send({ path: another })).status).toBe(201);
    expect((await request(app).post('/api/v1/cso/watch/repos').set(witness.header).send({ path: '/not/a/repo' })).status).toBe(400);
    expect((await request(app).delete('/api/v1/cso/watch/repos/another-repo').set(witness.header)).status).toBe(200);
    expect((await request(app).delete('/api/v1/cso/watch/repos/ghost').set(witness.header)).status).toBe(404);

    const host = (await request(app).put('/api/v1/cso/watch/host').set(witness.header).send({ expectedPorts: [3333] })).body.host;
    expect(host.expectedPorts).toEqual([3333]);
    expect((await request(app).put('/api/v1/cso/watch/host').set(witness.header).send({ expectedPorts: ['x'] })).status).toBe(400);
  }, 30000);

  test('a REAL manual scan run: OSV answers, the ledger lands the minimist hit, the state records it', async () => {
    const run = await request(app).post('/api/v1/cso/scan/run').set(witness.header).send({});
    expect(run.status).toBe(200);
    const { summary } = run.body;
    expect(summary.trigger).toBe('manual');
    expect(summary.repos[0]).toMatchObject({ repo: 'tiny-repo', checked: 1 });
    expect(summary.error).toBeUndefined();

    const threats = (await request(app).get('/api/v1/cso/threats').set(witness.header)).body;
    const minimist = threats.threats.find((t) => t.externalId === 'GHSA-xvch-5gv4-984h');
    expect(minimist).toBeTruthy();
    expect(minimist).toMatchObject({ layer: 'software', source: 'osv', repo: 'tiny-repo', status: 'new' });

    const scan = (await request(app).get('/api/v1/cso/scan').set(witness.header)).body.scan;
    expect(scan.lastRunAt).toBe(summary.startedAt);
    expect(scan.host.kernel).toBeTruthy(); // the real rig, measured mid-run

    const posture = (await request(app).get('/api/v1/cso/posture').set(witness.header)).body;
    expect(posture.counts.byStatus.new).toBeGreaterThan(0);
    expect(posture.watch.repos.map((r) => r.id)).toEqual(['tiny-repo']);
  }, 90000);

  test('threat detail by prefix id, and the filters', async () => {
    await request(app).post('/api/v1/cso/scan/run').set(witness.header).send({});
    const { threats } = (await request(app).get('/api/v1/cso/threats?layer=software').set(witness.header)).body;
    expect(threats.length).toBeGreaterThan(0);
    expect(threats.every((t) => t.layer === 'software')).toBe(true);
    const one = await request(app).get(`/api/v1/cso/threats/${threats[0].id.slice(0, 10)}`).set(witness.header);
    expect(one.status).toBe(200);
    expect(one.body.threat.id).toBe(threats[0].id);
    expect((await request(app).get('/api/v1/cso/threats/th_nope').set(witness.header)).status).toBe(404);

    // Another operator's house holds none of it — not by list, not by id.
    const { strangerWitness } = await import('../helpers/witness.js');
    const other = strangerWitness();
    expect((await request(app).get('/api/v1/cso/threats').set(other.header)).body.threats).toEqual([]);
    expect((await request(app).get(`/api/v1/cso/threats/${threats[0].id}`).set(other.header)).status).toBe(404);
    expect((await request(app).get('/api/v1/cso/scan').set(other.header)).body.scan.lastRunAt).toBeNull();
  }, 90000);

  test('two operators: another house\'s DELETE never clears this seat; an unowned seat is refused', async () => {
    const { strangerWitness } = await import('../helpers/witness.js');
    const other = strangerWitness();
    // A lane the caller does not own is never theirs to seat.
    expect((await request(app).put('/api/v1/cso/seat').set(other.header).send({ laneId: 'guardianlane' })).status).toBe(403);
    expect((await request(app).put('/api/v1/cso/seat').set(witness.header).send({ laneId: 'guardianlane' })).status).toBe(200);

    // The other operator's DELETE touches only their own (empty) house.
    expect((await request(app).delete('/api/v1/cso/seat').set(other.header)).status).toBe(200);
    expect((await request(app).get('/api/v1/cso/seat').set(witness.header)).body.cso.laneId).toBe('guardianlane');
    expect((await request(app).get('/api/v1/cso/seat').set(other.header)).body.cso).toBeNull();

    // A house record naming a lane its operator does not own (a forged or
    // stale file) cannot be cleared by them — the seat's lane must be theirs.
    const forged = path.join(house, 'realm', other.address.toLowerCase(), 'house-cso.json');
    await fs.writeFile(forged, JSON.stringify({ laneId: 'guardianlane', designatedAt: new Date().toISOString() }));
    expect((await request(app).delete('/api/v1/cso/seat').set(other.header)).status).toBe(403);
    expect(JSON.parse(await fs.readFile(forged, 'utf8')).laneId).toBe('guardianlane');
  }, 30000);

  // re-audit 2026-10-29, NEW-M6: only the operator's word verifies a leak; the route refuses what it cannot settle
  test('revoked: a leak not claimed mitigated is refused; another house never reaches it; no such id is 404', async () => {
    const { threatLedgerFor } = await import('../../backend/services/security/threat-ledger.js');
    const ledger = await threatLedgerFor(witness.address);
    await ledger.ingest([{ layer: 'software', source: 'secret-sweep', repo: 'tiny-repo', externalId: 'history:openai-key:abcd1234', title: 'a leak', severity: 'high', live: false }]);
    const leak = (await ledger.load()).find((e) => e.externalId === 'history:openai-key:abcd1234');
    const refused = await request(app).put(`/api/v1/cso/threats/${leak.id}/revoked`).set(witness.header).send({});
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/not marked mitigated/);
    const { strangerWitness } = await import('../helpers/witness.js');
    expect((await request(app).put(`/api/v1/cso/threats/${leak.id}/revoked`).set(strangerWitness().header).send({})).status).toBe(404);
    expect((await request(app).put('/api/v1/cso/threats/th_nope/revoked').set(witness.header).send({})).status).toBe(404);
  }, 30000);
});

describe('CSO routes — real auth', () => {
  test('no token is a 401', async () => {
    // No mock stands between the router and the real requireAuth — sending
    // no Authorization header IS the real refusal.
    const { default: router } = await import('../../backend/routes/cso-routes.js');
    const a = express();
    a.use(express.json());
    a.use('/api/v1/cso', router);
    expect((await request(a).get('/api/v1/cso/seat')).status).toBe(401);
  });
});
