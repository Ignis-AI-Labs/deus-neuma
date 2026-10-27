/**
 * Campaign shape v2 (campaign plan slice 5) — proven on real disk with no
 * mock anywhere on the path (RULE 0): the house's REAL first-shape campaign
 * file is moved to v2 with its old bytes kept beside it; the seated CMO files
 * campaigns/create through the REAL intent sweep, the REAL card reaches the
 * operator's REAL socket and is answered allow, and the record lands on disk;
 * a sub on another company's account is refused before any card; the asks run
 * both ways through the real store and the real campaigns/ask intent.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { useServedHouse } from '../helpers/served-house.js';
import { writeReadyBrandKit } from '../helpers/ready-brand-kit.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { addAccount } from '../../backend/services/social/account-store.js';
import { listCompanies } from '../../backend/services/marketing/companies.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { campaignStoreFor } from '../../backend/services/marketing/campaign-store.js';
import { officeFile } from '../../backend/services/house-office.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { fileIntent, sweep } from '../helpers/intent-path.js';

const CMO = 'v2-cmo';
const OTHER = 'v2-other';
const ENV = ['NEUMA_CAMPAIGNS_PATH', 'NEUMA_CMO_PATH'];

describe('campaign shape v2 — migration, the CMO\'s card, the company law, the asks', () => {
  let dir; let operator; let otherHouse; let served; let priorRealm; let saved;
  let httpServer; let wss; let client; let serverWs;
  const cards = [];

  const connectionFor = (laneId) => {
    const connection = { ws: serverWs, walletAddress: operator.address, companion: { name: laneId, neumaId: laneId }, toolMode: 'ask', _sessionToolPolicy: null };
    serverWs.__connection = connection;
    return connection;
  };
  const bench = () => campaignStoreFor(operator.address);

  beforeAll(async () => {
    saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    dir = await fs.realpath(await createTempDir('campaign-v2'));
    process.env.NEUMA_CAMPAIGNS_PATH = path.join(dir, 'legacy-campaigns.json');
    process.env.NEUMA_CMO_PATH = path.join(dir, 'legacy-cmo.json');
    priorRealm = getRealmRoot();
    setRealmRoot(path.join(dir, 'realm'));
    [operator, otherHouse] = [await fullAuth(), await fullAuth()];
    served = await useServedHouse({ wallet: operator.address, lanes: [CMO, OTHER] });
    await setHouseWorkspace(operator.address, path.join(dir, 'ground'));
    await writeReadyBrandKit(path.join(dir, 'ground'), 'northwind');
    await writeReadyBrandKit(path.join(dir, 'ground'), 'brookmere');
    const companies = (await listCompanies(operator.address)).map((c) => c.id);
    expect((await addAccount(operator.address, 'x', { companyId: 'northwind' }, companies)).accountId).toBe('x-1');
    expect((await addAccount(operator.address, 'x', { companyId: 'brookmere' }, companies)).accountId).toBe('x-2');
    await cmoDesignation.designate(operator.address, CMO);

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws) => {
        serverWs = ws;
        ws.on('message', (d) => {
          const m = JSON.parse(d.toString());
          if (m.type === 'tool:approval_response') resolveToolApproval(ws.__connection, m.id, m.decision);
        });
        resolve();
      });
    });
    client = new WebSocket(`ws://127.0.0.1:${port}/`);
    client.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type !== 'tool:approval_request') return;
      cards.push(msg);
      client.send(JSON.stringify({ type: 'tool:approval_response', id: msg.id, decision: 'allow' }));
    });
    await linked;
  }, 60000);

  afterAll(async () => {
    client?.close();
    wss?.close();
    httpServer?.close();
    served?.restore();
    setRealmRoot(priorRealm);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('a real first-shape bench moves to v2: pillars → angles, one platform → a sub, old bytes kept 0400, idempotent', async () => {
    const file = officeFile(operator.address, 'marketing', 'marketing-campaigns.json');
    const v1 = [
      {
        id: '0123456789abcdef', name: 'Northwind on X', brand: 'northwind', status: 'active', channelId: 'x',
        pillars: ['capital efficiency', 'no unwind'], cadence: '1 post/day', marketingPlan: 'the plan', funnelPlan: '', notes: '',
        sharedFiles: [{ path: '/tmp/brief.md', addedAt: '2026-10-01T00:00:00.000Z' }],
        createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
      },
      {
        id: 'fedcba9876543210', name: 'House story', brand: 'Somebody Else', status: 'paused', channelId: null,
        pillars: [], cadence: '', marketingPlan: '', funnelPlan: '', notes: 'kept',
        createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z',
      },
    ];
    // Written exactly as the first-shape store wrote it.
    const raw = `${JSON.stringify(v1, null, 2)}\n`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, raw, { mode: 0o600 });

    const moved = await (await bench()).load();
    expect(moved).toHaveLength(2);
    const [onX, story] = moved;
    expect(onX).toMatchObject({
      v: 2, id: v1[0].id, name: 'Northwind on X', companyId: 'northwind', status: 'active', cadence: '1 post/day',
      marketingPlan: 'the plan', sharedFiles: v1[0].sharedFiles, createdAt: v1[0].createdAt,
      subs: [{ accountId: 'x-1', role: '', cadence: '1 post/day', angleIds: ['capital-efficiency', 'no-unwind'] }],
      migratedFrom: { v: 1, channelId: 'x', pillars: ['capital efficiency', 'no unwind'] },
    });
    expect(onX.angles.map((a) => a.name)).toEqual(['capital efficiency', 'no unwind']);
    expect(story).toMatchObject({ v: 2, companyId: null, brand: 'Somebody Else', status: 'paused', notes: 'kept', subs: [] });
    expect(story.log.at(-1).what).toMatch(/UNSORTED/);

    // On disk: the moved bench; beside it the old bytes, read-only.
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(moved);
    const backup = file.replace(/\.json$/, '.v1.json');
    expect(await fs.readFile(backup, 'utf8')).toBe(raw);
    expect((await fs.stat(backup)).mode & 0o777).toBe(0o400);

    // A second read moves nothing and writes nothing.
    const before = await fs.readFile(file, 'utf8');
    expect(await (await bench()).load()).toEqual(moved);
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    // Another house reads none of it.
    expect(await (await campaignStoreFor(otherHouse.address)).load()).toEqual([]);

    // An UNSORTED campaign is edited freely; giving it a company is one edit.
    const sorted = await (await bench()).update(story.id, { companyId: 'brookmere' }, { companies: await listCompanies(operator.address), accounts: [] }, operator.address);
    expect(sorted.ok).toBe(true);
    expect(sorted.campaign.companyId).toBe('brookmere');
    expect(sorted.campaign.log.at(-1).what).toBe('changed company');
    for (const c of await (await bench()).load()) await (await bench()).remove(c.id);
  });

  test('the CMO files campaigns/create → the card reaches the operator → allow → the record lands on disk', async () => {
    cards.length = 0;
    const connection = connectionFor(CMO);
    await fileIntent(connection, 'campaigns/create', {
      name: 'Launch Week', company: 'northwind', status: 'draft',
      goal: { kind: 'downloads', label: 'Linux installs' },
      kpi: { metric: 'conversions', target: 1000, by: '2026-11-15' },
      window: { start: '2026-10-25', end: '2026-11-15' },
      budget: { hours: 12, note: 'planning only' },
      angles: [{ name: 'proof', thesis: 'only the harness changed', audience: 'developers' }, 'speed'],
      subs: [{ account: 'x-1', role: 'lead', cadence: '1 post/day', angles: ['proof'] }],
    });
    const [receipt] = await sweep(connection, 'ask', null);
    expect(receipt.status).toBe('ok');
    expect(cards).toHaveLength(1);
    expect(JSON.stringify(cards[0])).toContain('Launch Week');

    const [stored] = JSON.parse(await fs.readFile(officeFile(operator.address, 'marketing', 'marketing-campaigns.json'), 'utf8'));
    expect(stored).toMatchObject({
      v: 2, name: 'Launch Week', companyId: 'northwind', status: 'draft',
      goal: { kind: 'downloads', label: 'Linux installs' },
      kpi: { metric: 'conversions', target: 1000, by: '2026-11-15' },
      window: { start: '2026-10-25', end: '2026-11-15' },
      budget: { hours: 12, money: null, note: 'planning only' },
      subs: [{ accountId: 'x-1', role: 'lead', cadence: '1 post/day', angleIds: ['proof'] }],
      asks: [],
    });
    expect(stored.angles).toEqual([
      { id: 'proof', name: 'proof', thesis: 'only the harness changed', audience: 'developers' },
      { id: 'speed', name: 'speed', thesis: '', audience: '' },
    ]);
    expect(stored.log).toEqual([{ at: stored.createdAt, by: CMO, what: 'declared' }]);
  }, 30000);

  test('a sub on another company\'s account is refused at validate — before any card, nothing written', async () => {
    cards.length = 0;
    const connection = connectionFor(CMO);
    const before = await (await bench()).load();
    await fileIntent(connection, 'campaigns/create', { name: 'Crossed', company: 'northwind', subs: [{ account: 'x-2' }] });
    const [receipt] = await sweep(connection, 'ask', null);
    expect(receipt.status).toBe('error'); // the sweep's chip word for an invalid filing
    expect(receipt.error || receipt.content).toContain('account x-2 belongs to brookmere, not northwind');
    expect(cards).toHaveLength(0);
    expect(await (await bench()).load()).toEqual(before);
  }, 30000);

  test('asks both ways: the operator asks, the CMO answers; the CMO asks, it waits for the operator; no other lane speaks as the CMO', async () => {
    cards.length = 0;
    const [launch] = await (await bench()).load();
    const asked = await (await bench()).ask(launch.id, { from: 'operator', text: 'Three hooks for Thursday?', by: operator.address });
    const opAsk = asked.campaign.asks[0];
    const cmo = connectionFor(CMO);

    await fileIntent(cmo, 'campaigns/ask', { id: launch.id.slice(0, 8), askId: opAsk.id, answer: 'Staged as drafts on x-1' });
    expect((await sweep(cmo, 'ask', null))[0].status).toBe('ok');
    await fileIntent(cmo, 'campaigns/ask', { id: launch.id.slice(0, 8), text: 'May the launch slip one day?' });
    expect((await sweep(cmo, 'ask', null))[0].status).toBe('ok');
    expect(cards).toHaveLength(0); // a word to the operator carries no card

    const [after] = await (await bench()).load();
    expect(after.asks).toMatchObject([
      { id: opAsk.id, from: 'operator', state: 'done', answer: 'Staged as drafts on x-1', doneBy: CMO },
      { from: 'cmo', state: 'open', text: 'May the launch slip one day?', by: CMO },
    ]);
    expect(after.log.slice(1).map((l) => l.what)).toEqual([
      'the operator asked: Three hooks for Thursday?',
      'the CMO answered the ask: Three hooks for Thursday?',
      'the CMO asked: May the launch slip one day?',
    ]);

    // The CMO's open ask waits in the operator's WAITING ON YOU, and only there.
    const { readWaiting } = await import('../../backend/services/waiting/waiting-sources.js');
    const waiting = await readWaiting(operator.address);
    const item = waiting.items.find((i) => i.kind === 'campaign-ask');
    expect(item).toMatchObject({
      title: 'Launch Week: May the launch slip one day?',
      where: { app: 'marketing', campaignId: launch.id, askId: after.asks[1].id },
      who: { laneId: CMO },
    });
    expect((await readWaiting(otherHouse.address)).items.filter((i) => i.kind === 'campaign-ask')).toEqual([]);

    const other = connectionFor(OTHER);
    await fileIntent(other, 'campaigns/ask', { id: launch.id.slice(0, 8), text: 'me too' });
    expect((await sweep(other, 'ask', null))[0].status).toBe('denied');
  }, 30000);
});
