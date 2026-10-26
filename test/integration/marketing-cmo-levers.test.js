/**
 * THE CMO'S LEVERS on the MARKETING board (marketing panel slice 5) — proven on
 * real stores on tmp disk, the REAL intent sweep, the REAL marketing tool
 * handler over a real WebSocket pair, the REAL policy table. No double (RULE 0).
 *
 *  - board_read: the board at a level as the operator sees it, for the seated
 *    CMO alone; another house's level is no level here.
 *  - marketing/board-arrange through the sweep: a valid board is saved as the
 *    CMO's with no card; refused (every reason, nothing written) on a pinned
 *    panel moved, removed or changed, an unreported metric, a house-only kind
 *    on a company board, another house's company; a stranger house's CMO
 *    lands only in its own house.
 *  - the surface: only the CMO seat is offered either lever, neither stands
 *    from round 0 (load on demand), and the CMO briefing carries ONE line.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { writeOwner } from '../helpers/audit-auth.js';
import { writeReadyBrandKit } from '../helpers/ready-brand-kit.js';
import { viaIntent } from '../helpers/intent-path.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { listCompanies, setCompanyBlock } from '../../backend/services/marketing/companies.js';
import { addAccount } from '../../backend/services/social/account-store.js';
import { campaignStoreFor } from '../../backend/services/marketing/campaign-store.js';
import { campaignContextFor } from '../../backend/services/marketing/campaign-context.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { boardStoreFor } from '../../backend/services/marketing/board-store.js';
import { campaignToolsFor, handleCampaignTool } from '../../backend/services/portal-tools/crew-desk-tools.js';
import { intentSectionFor } from '../../backend/services/intents/intents-section.js';
import { stashBeingTurnCatalog } from '../../backend/services/being-tool-surface.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const TMP = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cmo-levers-')));
const ENV = ['NEUMA_CMO_PATH', 'NEUMA_CAMPAIGNS_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_LEAD_LEDGER_PATH'];
const saved = { realm: getRealmRoot(), lanes: getWorkspacesRoot(), env: Object.fromEntries(ENV.map((k) => [k, process.env[k]])) };
const HOUSE = `0x${'a1'.repeat(20)}`;
const STRANGER = `0x${'b2'.repeat(20)}`;
const CMO = 'kestrel';
const PEER = 'heron';
const STRANGER_CMO = 'tern';
const ARRANGE = 'marketing/board-arrange';

let ws; let wss; let client; let httpServer; let campaign;
const lane = (neumaId, walletAddress = HOUSE) => ({ ws, walletAddress, companion: { name: neumaId, neumaId }, toolMode: 'ask' });
const store = () => boardStoreFor(HOUSE);
const posts = (extra = {}) => ({ id: 'posts', kind: 'posts', span: 12, scope: { companyId: 'northwind' }, ...extra });

// impure — one filing through the real sweep; the receipt and every chip it raised.
const arrange = async (connection, payload) => {
  const frames = [];
  const [receipt] = await viaIntent(connection, ARRANGE, payload, 'ask', null, (f) => frames.push(f));
  return { receipt, frames };
};
const reasonsOf = (receipt) => receipt.error.split('\n');

beforeAll(async () => {
  setRealmRoot(path.join(TMP, 'realm'));
  setWorkspacesRoot(path.join(TMP, 'lanes'));
  for (const k of ENV) process.env[k] = path.join(TMP, `${k.toLowerCase()}.json`);
  for (const [wallet, ground, kits] of [[HOUSE, 'a-ground', ['northwind', 'northwind-labs']], [STRANGER, 'b-ground', ['harbor']]]) {
    await setHouseWorkspace(wallet, path.join(TMP, ground));
    for (const kit of kits) await writeReadyBrandKit(path.join(TMP, ground), kit);
  }
  expect((await setCompanyBlock(HOUSE, 'northwind-labs', { parentId: 'northwind' })).ok).toBe(true);
  const ids = (await listCompanies(HOUSE)).map((c) => c.id);
  for (const [ch, companyId] of [['x', 'northwind'], ['bluesky', 'northwind']]) expect((await addAccount(HOUSE, ch, { companyId }, ids)).ok).toBe(true);
  campaign = await (await campaignStoreFor(HOUSE)).add({ name: 'Launch Week', companyId: 'northwind', goal: { kind: 'downloads', label: 'installs' } }, await campaignContextFor(HOUSE), HOUSE);
  for (const [id, wallet] of [[CMO, HOUSE], [PEER, HOUSE], [STRANGER_CMO, STRANGER]]) await writeOwner(getWorkspacesRoot(), id, wallet);
  await cmoDesignation.designate(HOUSE, CMO);
  await cmoDesignation.designate(STRANGER, STRANGER_CMO);
  httpServer = createServer();
  wss = new WebSocketServer({ server: httpServer });
  const port = await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve(httpServer.address().port)));
  const linked = new Promise((resolve) => wss.on('connection', (s) => { ws = s; resolve(); }));
  client = new WebSocket(`ws://127.0.0.1:${port}`);
  client.on('message', () => {});
  await linked;
}, 60000);

afterAll(async () => {
  client?.close(); wss?.close(); httpServer?.close();
  setRealmRoot(saved.realm);
  setWorkspacesRoot(saved.lanes);
  for (const [k, v] of Object.entries(saved.env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await fs.rm(TMP, { recursive: true, force: true });
});

describe('board_read — the board as the operator sees it, for the CMO seat', () => {
  const read = (connection, args) => handleCampaignTool(ws, connection, null, 'ask', { toolName: 'board_read' }, args);

  test('the default board of a company, then a saved one with the operator\'s pin', async () => {
    const out = await read(lane(CMO), { level: 'northwind' });
    expect(out.status).toBe('ok');
    const name = (await listCompanies(HOUSE)).find((c) => c.id === 'northwind').name;
    expect(out.content.split('\n').slice(0, 9)).toEqual([
      `MARKETING BOARD northwind (${name}) · DEFAULT (none saved) · 8/24 panels · place id kind span scope choices pin set`,
      '1 tiles tiles 12 default',
      `2 campaign:${campaign.id} campaign 6 campaignId=${campaign.id} default`,
      '3 accounts accounts 6 default',
      '4 angles angles 12 default',
      // One PLATFORM panel per platform the company's accounts are on, in the house's account order.
      '5 platform:bluesky platform 4 platform=bluesky default',
      '6 platform:x platform 4 platform=x default',
      '7 next-7-days next-7-days 4 default',
      '8 posts posts 12 default',
    ]);
    expect(out.content).toContain(`campaigns here: ${campaign.id} Launch Week (northwind, active)`);
    expect(out.content).toContain('accounts here: bluesky-1 northwind · x-1 northwind');

    const house = { companies: await listCompanies(HOUSE), campaigns: await (await campaignStoreFor(HOUSE)).load() };
    expect((await (await store()).save('northwind', [posts({ pinned: true }), { id: 'accounts', kind: 'accounts', span: 6, scope: { companyId: 'northwind' } }],
      { ...house, setBy: 'operator' })).ok).toBe(true);
    const again = await read(lane(CMO), { level: 'northwind' });
    expect(again.content.split('\n')[1]).toMatch(/^1 posts posts 12 PINNED set operator \d{4}-\d\d-\d\dT\d\d:\d\d$/);
    expect(again.content.split('\n')[0]).toContain('· saved · 2/24 panels');
  });

  test('another lane of the house, another house\'s level, and a stranger house\'s CMO read nothing here', async () => {
    expect(await read(lane(PEER), { level: 'house' })).toMatchObject({ status: 'error', error: expect.stringContaining('only the house\'s seated CMO') });
    expect(await read(lane(CMO), { level: 'harbor' })).toMatchObject({ status: 'error', error: 'there is no "harbor" company in this house' });
    expect(await read(lane(CMO), { level: '../x' })).toMatchObject({ status: 'error' });
    // The stranger house's CMO, asking for this house's company, finds no such company in ITS house.
    expect(await read(lane(STRANGER_CMO, STRANGER), { level: 'northwind' })).toMatchObject({ status: 'error', error: 'there is no "northwind" company in this house' });
    // …and this house's CMO lane under the stranger's wallet holds no seat there.
    expect(await read(lane(CMO, STRANGER), { level: 'house' })).toMatchObject({ status: 'error', error: expect.stringContaining('only the house\'s seated CMO') });
  });
});

describe('marketing/board-arrange — through the real sweep', () => {
  test('a valid board is saved as the CMO\'s, with no card; the pin stands where it was; the count is kept', async () => {
    const before = await (await store()).load('northwind');
    const { receipt, frames } = await arrange(lane(CMO), { level: 'northwind', panels: [
      { kind: 'posts', span: 12 },
      { kind: 'platform', span: 6, scope: { platform: 'bluesky' }, show: ['likes', 'shares'], window: '30d' },
      { kind: 'top-posts', span: 6, sort: 'likes', count: 5 },
    ] });
    expect(receipt).toMatchObject({ tool: 'intents/marketing.board-arrange', status: 'ok' });
    expect(receipt.content).toBe('Board northwind: 3 panel(s) saved; 2 set by you; 1 pinned by the operator, kept.');
    expect(frames.map((f) => f.status)).toEqual(['executing', 'ok']);
    const board = await (await store()).load('northwind');
    expect(board.map((p) => [p.id, p.span, p.pinned, p.setBy])).toEqual([['posts', 12, true, 'operator'], ['platform:bluesky', 6, false, 'cmo'], ['top-posts', 6, false, 'cmo']]);
    expect(board[0].at).toBe(before[0].at);
    expect(board[1]).toMatchObject({ scope: { companyId: 'northwind', platform: 'bluesky' }, show: ['likes', 'shares'], window: '30d' });
    expect(await (await store()).cmoRecord()).toMatchObject({ changes: 1, lastLevel: 'northwind' });
  });

  test('refused on the operator\'s pin: moved, removed, changed — every reason, nothing written', async () => {
    const before = JSON.stringify(await (await store()).load('northwind'));
    const tops = { kind: 'top-posts', span: 6, sort: 'likes', count: 5 };
    for (const [panels, why] of [
      [[tops, { kind: 'posts', span: 12 }], 'panel "posts" is pinned by the operator: the CMO cannot move it'],
      [[tops], 'panel "posts" is pinned by the operator: the CMO cannot remove it'],
      [[{ kind: 'posts', span: 6 }], 'panel "posts" is pinned by the operator: the CMO cannot change it'],
      [[{ kind: 'posts', span: 12, pinned: false }], 'panel "posts" is pinned by the operator: the CMO cannot unpin it'],
    ]) {
      const { receipt, frames } = await arrange(lane(CMO), { level: 'northwind', panels });
      // A refusal the seat can fix in the same file reads as an error, never a denial.
      expect(receipt.status).toBe('error');
      expect(reasonsOf(receipt)).toEqual([`- ${why}`]);
      expect(frames.map((f) => [f.status, f.summary])).toEqual([['error', `${ARRANGE} — invalid`]]);
    }
    expect(JSON.stringify(await (await store()).load('northwind'))).toBe(before);
    expect((await (await store()).cmoRecord()).changes).toBe(1);
  });

  test('refused on what cannot stand: a metric the platform does not report, a house-only kind on a company board, another house\'s company', async () => {
    const { receipt } = await arrange(lane(CMO), { level: 'northwind', panels: [
      { kind: 'posts', span: 12 },
      { kind: 'platform', span: 6, scope: { platform: 'bluesky' }, show: ['views'] },
      { kind: 'links', span: 6 },
      { kind: 'cmo-log', span: 7 },
    ] });
    expect(reasonsOf(receipt)).toEqual([
      '- panel 2 (platform): bluesky does not report views: Bluesky counts no views',
      '- panel 3 (links): a links panel stands on the house\'s board only',
      '- panel 4 (cmo-log): a cmo-log panel stands on the house\'s board only',
      '- panel 4 (cmo-log): its width is one of 3, 4, 6, 8, 12 columns',
    ]);
    const elsewhere = await arrange(lane(CMO), { level: 'harbor', panels: [{ kind: 'posts', span: 12 }] });
    expect(reasonsOf(elsewhere.receipt)).toEqual(['- there is no "harbor" company in this house']);
    expect(await (await boardStoreFor(STRANGER)).load('harbor')).toBeNull();
    expect((await (await store()).cmoRecord()).changes).toBe(1);
  });

  test('only the seated CMO files it; a stranger house\'s CMO lands in its own house alone', async () => {
    const peer = await arrange(lane(PEER), { level: 'house', panels: [{ kind: 'posts', span: 12 }] });
    expect(peer.receipt.status).toBe('denied');
    expect(peer.receipt.error).toContain('only the house\'s seated CMO');
    const houseBoard = JSON.stringify(await (await store()).load('house'));
    const stranger = await arrange(lane(STRANGER_CMO, STRANGER), { level: 'house', panels: [{ kind: 'posts', span: 12 }] });
    expect(stranger.receipt.status).toBe('ok');
    expect((await (await boardStoreFor(STRANGER)).load('house')).map((p) => [p.id, p.setBy])).toEqual([['posts', 'cmo']]);
    expect(JSON.stringify(await (await store()).load('house'))).toBe(houseBoard);
    expect((await (await store()).cmoRecord()).changes).toBe(1);
    // The stranger's CMO naming this house's company finds none in its own.
    const reach = await arrange(lane(STRANGER_CMO, STRANGER), { level: 'northwind', panels: [{ kind: 'posts', span: 12 }] });
    expect(reasonsOf(reach.receipt)).toEqual(['- there is no "northwind" company in this house']);
  });
});

describe('the surface — the CMO seat alone, on demand', () => {
  test('board_read and marketing/board-arrange are offered to the seated CMO only', async () => {
    const names = async (c) => (await campaignToolsFor(c)).map((t) => t.name);
    expect(await names(lane(CMO))).toContain('board_read');
    for (const c of [lane(PEER), lane(CMO, STRANGER), lane(STRANGER_CMO, HOUSE)]) expect(await names(c)).not.toContain('board_read');
    const offered = async (c) => { await intentSectionFor(c); return c._turnIntents.map((t) => t.name); };
    expect(await offered(lane(CMO))).toContain(ARRANGE);
    for (const c of [lane(PEER), lane(CMO, STRANGER)]) expect(await offered(c)).not.toContain(ARRANGE);
  });

  test('neither stands from round 0: the CMO reaches board_read on demand', async () => {
    const tools = [...await campaignToolsFor(lane(CMO))].map((t) => ({ ...t, access: 'allowed' }));
    const connection = lane(CMO);
    const stamped = await stashBeingTurnCatalog(connection, tools, []);
    expect(stamped.find((t) => t.name === 'board_read')?.access).toBe('allowed');
    expect([...connection._turnDisclosedToolIds]).toContain('marketing/campaign_list');
    expect([...connection._turnDisclosedToolIds]).not.toContain('marketing/board_read');
  });

  test('the CMO briefing carries the ONE board line; another lane carries no briefing', async () => {
    const briefing = await __test._cmoBriefingSection(lane(CMO));
    const line = 'THE BOARD: lay your operator\'s MARKETING board out for what they need to see for each company (board_read, marketing/board-arrange); the panels they pinned are theirs.';
    expect(briefing.split('\n').filter((l) => l.includes('board_read'))).toEqual([line]);
    expect(await __test._cmoBriefingSection(lane(PEER))).toBe('');
  });
});
