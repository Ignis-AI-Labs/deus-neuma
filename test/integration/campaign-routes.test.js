import express from 'express';
import request from 'supertest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

/**
 * Campaign routes — the marketing bench's REST window, end to end against
 * the REAL store, REAL CMO designation, and REAL auth (RULE 0, #390
 * tranche 4) on real temp disk. No mock stands in for the caller's session
 * — a real wallet with a real HMAC token proves every request, and a
 * genuine 401 comes from sending none.
 *
 * Every route reads the signed-in operator's OWN house (ruling, 2026-10-16:
 * two houses on one machine are never confused): the realm is pinned to temp
 * so each wallet's bench and seat land in its own tmp house.
 */
describe('Campaign routes (/api/v1/campaigns)', () => {
  let app;
  let tempDir;
  let witness;
  let savedCampaignsPath;
  let savedCmoPath;
  let savedWorkspacesRoot;
  let savedRealmRoot;
  let savedWorkspaceSettings;

  const buildApp = async () => {
    const { default: router } = await import('../../backend/routes/campaign-routes.js');
    const a = express();
    a.use(express.json());
    a.use('/api/v1/campaigns', router);
    return a;
  };

  beforeEach(async () => {
    vi.resetModules();

    savedCampaignsPath = process.env.NEUMA_CAMPAIGNS_PATH;
    savedCmoPath = process.env.NEUMA_CMO_PATH;
    savedWorkspacesRoot = process.env.WORKSPACES_ROOT;
    savedRealmRoot = process.env.NEUMA_REALM_ROOT;
    savedWorkspaceSettings = process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
    tempDir = await createTempDir(`campaign-routes-${Math.random().toString(36).slice(2)}`);
    process.env.NEUMA_CAMPAIGNS_PATH = path.join(tempDir, 'campaigns.json');
    process.env.NEUMA_CMO_PATH = path.join(tempDir, 'cmo.json');
    // The CMO route scaffolds the lane's office on designation — the scaffold
    // must land on temp disk too, never in the real workspaces root.
    process.env.WORKSPACES_ROOT = path.join(tempDir, 'workspaces');
    // Read at import by the freshly reset user-realm — every house is tmp.
    process.env.NEUMA_REALM_ROOT = path.join(tempDir, 'realm');
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(tempDir, 'workspace.json');

    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against — the token secret is
    // memoized per module instance, so a stale import would 401 honestly.
    const { witnessFor } = await import('../helpers/witness.js');
    // THE CALLER MUST OWN THE LANE IT SEATS. This was a stranger wallet on the
    // reasoning that the CMO seat's ownership gate "is exercised separately" —
    // true only while the auth mock waved `assertNeumaOwner` through. Seating
    // `hazel` from a wallet that owns nothing is a 404 against the real gate,
    // and rightly so (#409 cause A).
    witness = await witnessFor(process.env.WORKSPACES_ROOT, 'hazel');

    app = await buildApp();
  });

  afterEach(() => {
    for (const [key, saved] of [
      ['NEUMA_CAMPAIGNS_PATH', savedCampaignsPath],
      ['NEUMA_CMO_PATH', savedCmoPath],
      ['WORKSPACES_ROOT', savedWorkspacesRoot],
      ['NEUMA_REALM_ROOT', savedRealmRoot],
      ['NEUMA_WORKSPACE_SETTINGS_PATH', savedWorkspaceSettings],
    ]) {
      if (saved === undefined) delete process.env[key];
      else process.env[key] = saved;
    }
    vi.restoreAllMocks();
  });

  test('declare → bench → edit → remove: the whole walk under the caller wallet', async () => {
    const declared = await request(app).post('/api/v1/campaigns').set(witness.header).send({
      name: 'First Light', companyId: 'ignis', pillars: ['craft', 'proof'], cadence: 'weekly',
      goal: { kind: 'downloads', label: 'Linux installs' },
      kpi: { metric: 'conversions', target: 500, by: '2026-12-01' },
      window: { start: '2026-11-01', end: '2026-12-01' },
    });
    expect(declared.status).toBe(201);
    expect(declared.body.campaign).toMatchObject({
      v: 2, name: 'First Light', companyId: 'ignis', status: 'active', cadence: 'weekly',
      goal: { kind: 'downloads', label: 'Linux installs' },
      kpi: { metric: 'conversions', target: 500, by: '2026-12-01' },
      window: { start: '2026-11-01', end: '2026-12-01' },
      subs: [], asks: [],
    });
    // Pillars an old caller sends are read as angle names.
    expect(declared.body.campaign.angles.map((a) => a.name)).toEqual(['craft', 'proof']);
    expect(declared.body.campaign.log.map((l) => l.what)).toEqual(['declared']);
    expect(declared.body.campaign.id).toMatch(/^[0-9a-f]{16}$/);

    const bench = await request(app).get('/api/v1/campaigns').set(witness.header);
    expect(bench.status).toBe(200);
    expect(bench.body.campaigns).toHaveLength(1);
    expect(bench.body.statuses).toEqual(['draft', 'active', 'paused', 'done']);
    expect(bench.body.goalKinds).toContain('downloads');

    const edited = await request(app).put(`/api/v1/campaigns/${declared.body.campaign.id}`).set(witness.header).send({
      status: 'paused', notes: 'holding for the launch window',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.campaign.status).toBe('paused');
    expect(edited.body.campaign.notes).toBe('holding for the launch window');
    expect(edited.body.campaign.name).toBe('First Light'); // untouched fields hold
    expect(edited.body.campaign.angles).toEqual(declared.body.campaign.angles);
    expect(edited.body.campaign.log.at(-1).what).toBe('status active → paused; changed notes');
    expect(edited.body.campaign.log.at(-1).by.toLowerCase()).toBe(witness.address.toLowerCase());
    expect(Date.parse(edited.body.campaign.updatedAt)).toBeGreaterThanOrEqual(Date.parse(declared.body.campaign.updatedAt));

    const removed = await request(app).delete(`/api/v1/campaigns/${declared.body.campaign.id}`).set(witness.header);
    expect(removed.status).toBe(200);
    expect((await request(app).get('/api/v1/campaigns').set(witness.header)).body.campaigns).toEqual([]);
  });

  test('a campaign runs on its company\'s accounts — one sub per account; another company\'s account is refused', async () => {
    const { addAccount } = await import('../../backend/services/social/account-store.js');
    const { listCompanies } = await import('../../backend/services/marketing/companies.js');
    const companies = (await listCompanies(witness.address)).map((c) => c.id);
    expect((await addAccount(witness.address, 'x', { companyId: 'ignis', label: 'ignis on X' }, companies)).accountId).toBe('x-1');
    expect((await addAccount(witness.address, 'x', { companyId: 'umbrae', label: 'umbrae on X' }, companies)).accountId).toBe('x-2');

    const onX = await request(app).post('/api/v1/campaigns').set(witness.header).send({
      name: 'Ignis on X', companyId: 'ignis', angles: [{ name: 'proof' }],
      subs: [{ account: 'x-1', cadence: '1/day', angles: ['proof'] }],
    });
    expect(onX.status).toBe(201);
    expect(onX.body.campaign.subs).toEqual([{ accountId: 'x-1', role: '', cadence: '1/day', angleIds: ['proof'] }]);

    const crossed = await request(app).post('/api/v1/campaigns').set(witness.header).send({
      name: 'Crossed', companyId: 'ignis', subs: [{ account: 'x-2' }],
    });
    expect(crossed.status).toBe(400);
    expect(crossed.body.error).toBe('account x-2 belongs to umbrae, not ignis — a campaign runs only on its own company\'s accounts');
    const widened = await request(app).put(`/api/v1/campaigns/${onX.body.campaign.id}`).set(witness.header)
      .send({ subs: [{ account: 'x-1' }, { account: 'x-2' }] });
    expect(widened.status).toBe(400);
    expect(widened.body.error).toContain('belongs to umbrae');

    // The single platform field is gone, and an old caller is told so in words.
    const old = await request(app).post('/api/v1/campaigns').set(witness.header).send({ name: 'Old', companyId: 'ignis', channelId: 'x' });
    expect(old.status).toBe(400);
    expect(old.body.error).toMatch(/no longer belong to one platform/);
    const ghost = await request(app).post('/api/v1/campaigns').set(witness.header).send({ name: 'Ghost', companyId: 'ignis', channelId: 'myspace' });
    expect(ghost.body.error).toContain('Unknown channel');
    // Removing an angle drops it from the subs that named it.
    const trimmed = await request(app).put(`/api/v1/campaigns/${onX.body.campaign.id}`).set(witness.header).send({ angles: [] });
    expect(trimmed.status).toBe(200);
    expect(trimmed.body.campaign.subs[0].angleIds).toEqual([]);
  });

  test('asks both ways: the operator asks, withdraws; the log records each', async () => {
    const made = await request(app).post('/api/v1/campaigns').set(witness.header).send({ name: 'Asks', companyId: 'ignis' });
    const id = made.body.campaign.id;
    const asked = await request(app).post(`/api/v1/campaigns/${id}/asks`).set(witness.header).send({ text: 'Draft three hooks for Thursday' });
    expect(asked.status).toBe(201);
    const [ask] = asked.body.campaign.asks;
    expect(ask).toMatchObject({ from: 'operator', state: 'open', text: 'Draft three hooks for Thursday' });
    expect(ask.by.toLowerCase()).toBe(witness.address.toLowerCase());
    expect((await request(app).post(`/api/v1/campaigns/${id}/asks`).set(witness.header).send({ text: '  ' })).status).toBe(400);
    const withdrawn = await request(app).put(`/api/v1/campaigns/${id}/asks/${ask.id}`).set(witness.header).send({});
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.campaign.asks[0].state).toBe('done');
    expect(withdrawn.body.campaign.log.map((l) => l.what)).toEqual([
      'declared', 'the operator asked: Draft three hooks for Thursday', 'the operator withdrew their ask: Draft three hooks for Thursday',
    ]);
    expect((await request(app).post('/api/v1/campaigns/ghost/asks').set(witness.header).send({ text: 'x' })).status).toBe(404);
  });

  test('bad declarations and bad edits are refused at the door', async () => {
    expect((await request(app).post('/api/v1/campaigns').set(witness.header).send({ companyId: 'ignis' })).status).toBe(400);
    const noCompany = await request(app).post('/api/v1/campaigns').set(witness.header).send({ name: 'First Light' });
    expect(noCompany.status).toBe(400);
    expect(noCompany.body.error).toMatch(/needs its company/);
    expect((await request(app).post('/api/v1/campaigns').set(witness.header).send({ name: 'F', companyId: 'nobody' })).status).toBe(400);
    expect((await request(app).post('/api/v1/campaigns').set(witness.header).send({ name: 'F', companyId: 'ignis', status: 'maybe' })).status).toBe(400);
    expect((await request(app).post('/api/v1/campaigns').set(witness.header).send({ name: 'F', companyId: 'ignis', pillars: ['craft', 7] })).status).toBe(400);
    expect((await request(app).post('/api/v1/campaigns').set(witness.header).send({ name: 'F', companyId: 'ignis', pillars: 'craft' })).status).toBe(400);

    // A brand naming a company of the house is read as that company.
    const ok = await request(app).post('/api/v1/campaigns').set(witness.header).send({ name: 'First Light', brand: 'Ignis' });
    expect(ok.status).toBe(201);
    expect(ok.body.campaign.companyId).toBe('ignis');
    const badStatus = await request(app).put(`/api/v1/campaigns/${ok.body.campaign.id}`).set(witness.header).send({ status: 'maybe' });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toContain('Unknown status');

    expect((await request(app).put('/api/v1/campaigns/ghost').set(witness.header).send({ notes: 'x' })).status).toBe(404);
    expect((await request(app).delete('/api/v1/campaigns/ghost').set(witness.header)).status).toBe(404);
  });

  test('the CMO seat: empty, designated, cleared — and a missing lane id is refused', async () => {
    expect((await request(app).get('/api/v1/campaigns/cmo').set(witness.header)).body.cmo).toBeNull();

    expect((await request(app).put('/api/v1/campaigns/cmo').set(witness.header).send({})).status).toBe(400);
    expect((await request(app).put('/api/v1/campaigns/cmo').set(witness.header).send({ laneId: '   ' })).status).toBe(400);

    const seated = await request(app).put('/api/v1/campaigns/cmo').set(witness.header).send({ laneId: 'hazel' });
    expect(seated.status).toBe(200);
    expect(seated.body.cmo.laneId).toBe('hazel');
    expect(Date.parse(seated.body.cmo.designatedAt)).not.toBeNaN();

    expect((await request(app).get('/api/v1/campaigns/cmo').set(witness.header)).body.cmo.laneId).toBe('hazel');

    const cleared = await request(app).delete('/api/v1/campaigns/cmo').set(witness.header);
    expect(cleared.status).toBe(200);
    expect(cleared.body.cleared).toBe(true);
    expect((await request(app).get('/api/v1/campaigns/cmo').set(witness.header)).body.cmo).toBeNull();
  });

  test('two houses: each operator\'s bench and seat are its own; another house\'s DELETE never unseats', async () => {
    const { witnessFor } = await import('../helpers/witness.js');
    const other = await witnessFor(process.env.WORKSPACES_ROOT, 'linden');
    await request(app).post('/api/v1/campaigns').set(witness.header).send({ name: 'First Light', companyId: 'ignis' });
    expect((await request(app).put('/api/v1/campaigns/cmo').set(witness.header).send({ laneId: 'hazel' })).status).toBe(200);

    // House B sees an empty bench and no CMO — never house A's.
    expect((await request(app).get('/api/v1/campaigns').set(other.header)).body.campaigns).toEqual([]);
    expect((await request(app).get('/api/v1/campaigns/cmo').set(other.header)).body.cmo).toBeNull();
    // B cannot seat A's lane: the real owner gate answers 403.
    expect((await request(app).put('/api/v1/campaigns/cmo').set(other.header).send({ laneId: 'hazel' })).status).toBe(403);
    // B's DELETE touches B's house alone — A's CMO stands.
    expect((await request(app).delete('/api/v1/campaigns/cmo').set(other.header)).status).toBe(200);
    expect((await request(app).get('/api/v1/campaigns/cmo').set(witness.header)).body.cmo.laneId).toBe('hazel');
  });

  test('a DELETE whose house record names a lane the caller does not own is refused 403', async () => {
    const { default: fs } = await import('fs/promises');
    const { witnessFor } = await import('../helpers/witness.js');
    const other = await witnessFor(process.env.WORKSPACES_ROOT, 'linden');
    // A forged (or stale) record in B's house naming A's lane.
    const record = path.join(process.env.NEUMA_REALM_ROOT, other.address.toLowerCase(), 'house-cmo.json');
    await fs.mkdir(path.dirname(record), { recursive: true });
    await fs.writeFile(record, JSON.stringify({ laneId: 'hazel', designatedAt: new Date().toISOString() }));
    const refused = await request(app).delete('/api/v1/campaigns/cmo').set(other.header);
    expect(refused.status).toBe(403);
    expect(JSON.parse(await fs.readFile(record, 'utf8')).laneId).toBe('hazel');
  });

  test('a corrupt store is our fault, not the caller\'s — declare answers 500, never 400', async () => {
    const { default: fs } = await import('fs/promises');
    const bench = path.join(process.env.NEUMA_REALM_ROOT, witness.address.toLowerCase(), 'offices', 'marketing', 'marketing-campaigns.json');
    await fs.mkdir(path.dirname(bench), { recursive: true });
    await fs.writeFile(bench, '{"not":"an array"}');
    const res = await request(app).post('/api/v1/campaigns').set(witness.header).send({ name: 'First Light', companyId: 'ignis' });
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Failed to declare');
  });

  test('without a Bearer token the real auth answers 401 on every route', async () => {
    // No mock stands between `app` and the real requireAuth now — sending no
    // Authorization header IS the real refusal.
    for (const [method, url] of [
      ['get', '/api/v1/campaigns'],
      ['post', '/api/v1/campaigns'],
      ['get', '/api/v1/campaigns/cmo'],
      ['put', '/api/v1/campaigns/cmo'],
      ['delete', '/api/v1/campaigns/cmo'],
      ['put', '/api/v1/campaigns/some-id'],
      ['delete', '/api/v1/campaigns/some-id'],
      ['post', '/api/v1/campaigns/some-id/asks'],
      ['put', '/api/v1/campaigns/some-id/asks/an-ask'],
    ]) {
      const res = await request(app)[method](url);
      expect(res.status).toBe(401);
    }
  });
});
