/**
 * Campaign tools gate — UNIVERSAL ACCESS doctrine, proven end to end with NO
 * mock on the claimed path (RULE 0): REAL designation, campaign store, lead
 * ledger, and queue store on real temp disk, a REAL WebSocket pair, and the
 * REAL policy cascade (auto mode lifts the chip so the turn runs without a
 * witness answer — the cascade itself is real).
 *
 * The doctrine: every bound being sees the bench and the outreach reads;
 * marketing is the CMO's office BY PROTOCOL (descriptions, briefing,
 * playbook), never by a hard gate. The designation still decides exactly one
 * thing — which lane carries the per-turn CMO briefing — and only inside
 * its own house: the stores and the seat are the connection's house's
 * (Design note, 2026-10-16, the realm pinned to temp.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { viaIntent, granting } from '../helpers/intent-path.js';
import { retiredToolHint } from '../../backend/services/intents/retired-tools.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { campaignStoreFor } from '../../backend/services/marketing/campaign-store.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { writeOwner } from '../helpers/audit-auth.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { scaffoldCmoWorkspace } from '../../backend/services/marketing/marketing-scaffold.js';

const {
  _campaignToolsFor, _handleCampaignTool, _isCampaignTool,
  _cmoBriefingSection, CAMPAIGN_TOOLS, SOCIAL_TOOLS,
} = __test;
const LANE_A = 'cmolanea';
const LANE_B = 'otherlane';
const WALLET = `0x${'c'.repeat(40)}`;
const OTHER_HOUSE = `0x${'d'.repeat(40)}`;
const priorRealm = getRealmRoot();
const bench = () => campaignStoreFor(WALLET);
const ledger = () => leadLedgerFor(WALLET);
const ENV_PATHS = [
  'NEUMA_CAMPAIGNS_PATH', 'NEUMA_CMO_PATH', 'NEUMA_LEAD_LEDGER_PATH',
  'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_POST_QUEUE_PATH',
  'WORKSPACES_ROOT',
];

describe('campaign tools gate (universal access, real stores + real WS, gnosis)', () => {
  let house, httpServer, wss, serverWs, client, port;
  const savedEnv = {};

  const freshConnection = (neumaId, walletAddress = WALLET) => ({
    ws: serverWs,
    walletAddress,
    companion: { name: 'CmoEcho', neumaId },
  });

  beforeAll(async () => {
    house = await createTempDir('campaign-gate-house');
    for (const k of ENV_PATHS) { savedEnv[k] = process.env[k]; }
    process.env.NEUMA_CAMPAIGNS_PATH = `${house}/marketing-campaigns.json`;
    process.env.NEUMA_CMO_PATH = `${house}/marketing-cmo.json`;
    process.env.NEUMA_LEAD_LEDGER_PATH = `${house}/lead-ledger.json`;
    process.env.NEUMA_SOCIAL_BINDINGS_PATH = `${house}/social-channel-bindings.json`;
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = `${house}/social-post-queue.json`;
    process.env.WORKSPACES_ROOT = `${house}/workspaces`;
    setRealmRoot(`${house}/realm`);
    for (const lane of [LANE_A, LANE_B]) await writeOwner(`${house}/workspaces`, lane, WALLET);
    await channelBindings.bind('x', { neumaId: LANE_A, boundBy: '0xTestWitness' });

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws) => { serverWs = ws; resolve(); });
    });
    client = new WebSocket(`ws://localhost:${port}`);
    client.on('message', () => {}); // drain the tool events so nothing backs up
    await linked;
  }, 60000);

  afterAll(async () => {
    setRealmRoot(priorRealm);
    for (const k of ENV_PATHS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.restoreAllMocks();
    client?.close();
    wss?.close();
    httpServer?.close();
    await fs.rm(house, { recursive: true, force: true });
  });

  test('ADVERTISING — the bench READ exists with no CMO seated; the writes are intents', async () => {
    // THE CATALOG CUT (#414): campaign_create/campaign_update carry the same
    // acts as the campaigns/* intents, so advertising both described one act
    // twice. The read has no intent — and no prompt replacement outside the
    // CMO briefing — so it stays.
    expect((await _campaignToolsFor()).map((t) => t.name)).toEqual(['campaign_list']);
    // queue_cancel joined the family 2026-07-26: staged copy goes stale and a
    // being must be able to pull its own dead draft, not merely report it.
    // queue_get joined 2026-08-03: the list gives the month, but an edit made
    // against a list line is an edit made blind — the copy's revisions and its
    // thread only fit in a single-entry read.
    expect(SOCIAL_TOOLS.map((t) => t.name)).toEqual(['queue_list', 'queue_get', 'read_x', 'queue_cancel']);
  });

  test('ADVERTISING — the bench READ is all that is offered; a seated CMO changes no access', async () => {
    await cmoDesignation.designate(WALLET, LANE_A);
    expect((await _campaignToolsFor()).map((t) => t.name)).toEqual(['campaign_list']);
    // The office is carried in language, not gates: the bench description
    // names the CMO's office as the lead the house defers to. It rides the
    // READ now — the mutations it used to ride left with the catalog cut.
    const list = CAMPAIGN_TOOLS.find((t) => t.name === 'campaign_list');
    expect(list.description).toMatch(/CMO/);
    // THE CUT (#414): create/update are `campaigns/*` intents, so neither is
    // advertised and neither dispatches.
    expect(CAMPAIGN_TOOLS.map((t) => t.name)).toEqual(['campaign_list']);
    for (const retired of ['campaign_create', 'campaign_update']) {
      expect(_isCampaignTool({ toolName: retired }), `${retired} still dispatches`).toBe(false);
      expect(retiredToolHint(retired)).toContain(`campaigns/${retired.replace('campaign_', '')}`);
    }
    await cmoDesignation.clear(WALLET);
  });

  test('BENCH WORK — create → list → update ride the REAL store through the INTENT path', async () => {
    const connection = freshConnection(LANE_A);
    serverWs.__connection = connection;
    // Both bench mutations ask the operator (the tiers their tools carried), so
    // a persisted ALWAYS grant is what lets them settle unattended.
    const granted = granting('campaigns.create', 'campaigns.update');

    const [created] = await viaIntent(connection, 'campaigns/create',
      { name: 'First Light', brand: 'Neuma', pillars: ['craft', 'proof'], cadence: 'weekly' },
      'ask', granted);
    expect(created.status).toBe('ok');
    const [stored] = await (await bench()).load();
    expect(stored).toMatchObject({
      name: 'First Light', brand: 'Neuma', status: 'active',
      pillars: ['craft', 'proof'], cadence: 'weekly',
    });

    // The READ is still a tool — the prompt replacement is CMO-only, so every
    // other being would have been left with no way to see the bench at all.
    const listed = await _handleCampaignTool(serverWs, connection, null, 'auto',
      { toolName: 'campaign_list' }, {});
    expect(listed.status).toBe('ok');
    expect(listed.content).toContain('First Light');
    expect(listed.content).toContain(stored.id.slice(0, 8));

    const [updated] = await viaIntent(connection, 'campaigns/update',
      { id: stored.id.slice(0, 8), status: 'paused' }, 'ask', granted);
    expect(updated.status).toBe('ok');
    expect((await (await bench()).load())[0].status).toBe('paused');

    await (await bench()).remove(stored.id);
  }, 30000);

  test('QUEUE — campaignId and pillar ride a staged draft into the REAL queue file', async () => {
    const connection = freshConnection(LANE_A);
    serverWs.__connection = connection;

    // Staging is a filed INTENT now (Stage 2) — the being writes the file,
    // the sweep settles it into the same queue store. AUTO's protocol guard
    // (182ca2f5f) cards staged outward speech even in auto and this harness
    // answers no cards, so the unattended-settle lane is the ask tier with a
    // standing ALWAYS grant — exactly what the operator's chip leaves behind.
    const { default: neumaWorkspace } = await import('../../core/workspace/neuma-workspace.js');
    const intentsDir = path.join(neumaWorkspace.pathFor(LANE_A), 'intents');
    await fs.mkdir(intentsDir, { recursive: true });
    await fs.writeFile(path.join(intentsDir, 'banner-draft.json'), JSON.stringify({
      type: 'social/queue', channel: 'x',
      text: 'speech under a banner', campaignId: 'cmp-first-light', pillar: 'craft',
    }));
    const receipts = await sweepIntents(connection, {
      mode: 'ask', lanePolicy: granting('social.queue'), emit: () => {},
    });
    expect(receipts[0].status).toBe('ok');

    const entries = await postQueue.load();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      channelId: 'x',
      text: 'speech under a banner',
      campaignId: 'cmp-first-light',
      pillar: 'craft',
      status: 'draft',
    });
    await postQueue.remove(entries[0].id);
  }, 30000);

  test('BRIEFING — only the seated CMO carries the office section, built from the REAL stores', async () => {
    await cmoDesignation.designate(WALLET, LANE_A);
    await (await bench()).add({ name: 'Umbrae Launch', brand: 'Umbrae', cadence: '1 post/day' });
    await postQueue.add({
      channelId: 'x', text: 'the weekly signal drops Friday',
      scheduledFor: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      queuedBy: LANE_A,
    });
    await (await ledger()).add({ name: 'Real Prospect', contact: 'prospect@example.com', addedBy: LANE_A });

    const briefing = await _cmoBriefingSection(freshConnection(LANE_A));
    expect(briefing).toContain('CMO office');
    expect(briefing).toContain('Umbrae Launch');
    expect(briefing).toContain('the weekly signal drops Friday');
    expect(briefing).toContain('Real Prospect');

    // Every other lane — and an unseated office — proceeds without the section.
    expect(await _cmoBriefingSection(freshConnection(LANE_B))).toBe('');
    // The same lane id in ANOTHER house holds no office there.
    expect(await _cmoBriefingSection(freshConnection(LANE_A, OTHER_HOUSE))).toBe('');
    await cmoDesignation.clear(WALLET);
    expect(await _cmoBriefingSection(freshConnection(LANE_A))).toBe('');

    const [c] = await (await bench()).load();
    await (await bench()).remove(c.id);
    const [q] = await postQueue.load();
    await postQueue.remove(q.id);
    const [l] = await (await ledger()).load();
    await (await ledger()).remove(l.id);
  }, 30000);

  test('SCAFFOLD — the office lands on REAL disk and a re-seat never clobbers an edit', async () => {
    const first = await scaffoldCmoWorkspace(LANE_A);
    expect(first.seeded.sort()).toEqual(['brand-voice.md', 'playbook.md']);
    const voice = await fs.readFile(`${first.dir}/brand-voice.md`, 'utf8');
    expect(voice).toContain('Brand Voice');
    await fs.access(`${first.dir}/playbook.md`);
    await fs.access(`${first.dir}/research`);

    // The being (or the operator) edits the voice sheet…
    await fs.writeFile(`${first.dir}/brand-voice.md`, '# Brand Voice\n\nOur actual voice, edited.\n');
    // …and a re-scaffold authors NOTHING over it.
    const second = await scaffoldCmoWorkspace(LANE_A);
    expect(second.seeded).toEqual([]);
    const kept = await fs.readFile(`${first.dir}/brand-voice.md`, 'utf8');
    expect(kept).toContain('Our actual voice, edited.');
  }, 30000);
});
