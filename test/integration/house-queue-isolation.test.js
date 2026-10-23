/**
 * ONE QUEUE FILE, TWO HOUSES — the being's side of the post queue never
 * crosses a house (GitHub #583; campaign plan slice 1). Real tmp disk, the
 * real queue store, the real social handlers over a REAL WebSocket pair, the
 * real CMO briefing, the real pipeline posture and the real house probe; no
 * double anywhere (RULE 0).
 *
 * Both houses' lanes stand on ONE served ground (the case the scheduler and
 * the routes already guard): `alpha-cmo` is house A's, `beta-cmo` house B's.
 * Proven: house A's lane cannot list, read, withdraw, edit or thread onto
 * house B's entry by its id (each answers as if absent, and the entry is
 * untouched); an edit tool refuses a post of another platform; the CMO
 * briefing and pipeline_state count only the house's own queue; and the
 * house probe reads the house's own credential file's mode bits.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { standTwoHouses, HOUSE_A, HOUSE_B } from '../helpers/house-office-kit.js';
import { writeOwner } from '../helpers/audit-auth.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { getChannel } from '../../backend/services/social/channel-registry.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';
import { setChannelCredential, channelCredentialsPath } from '../../backend/services/social/channel-credentials.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { computePipelineState } from '../../backend/services/marketing/pipeline-state.js';
import { runHouseProbe } from '../../backend/services/security/house-probe.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';

const { _handleSocialTool, _handleNeumaQueueUpdate, _handleNeumaQueueBulkUpdate, _handleNeumaSelfReply, _cmoBriefingSection } = __test;
const ALPHA = 'alpha-cmo';
const BETA = 'beta-cmo';
const SOON = () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

describe('one queue file, two houses — a being reaches only its own house\'s posts', () => {
  let houses, httpServer, wss, serverWs, client, savedQueue;
  let x;

  const laneOf = (neumaId, walletAddress) => ({ ws: serverWs, walletAddress, companion: { name: neumaId, neumaId } });
  const social = (conn, toolName, args = {}) =>
    _handleSocialTool(serverWs, conn, null, 'auto', { toolName, tool: `social/${toolName}` }, args);
  // Staged the way the social/queue intent stages: the author's lane names the house.
  const stage = (laneId, text, extra = {}) =>
    postQueue.add({ channelId: 'x', text, scheduledFor: SOON(), authorNeumaId: laneId, queuedBy: laneId, ...extra });
  const entryOf = async (id) => (await postQueue.load()).find((e) => e.id === id);

  beforeAll(async () => {
    // Both houses' lanes on ONE served ground.
    houses = await standTwoHouses({ label: 'house-queue-isolation', lanesA: [ALPHA], lanesB: [] });
    await writeOwner(houses.rootA, BETA, HOUSE_B);
    savedQueue = process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(houses.settings, 'social-post-queue.json');
    await channelBindings.bind(HOUSE_A, 'x', { neumaId: ALPHA });
    await channelBindings.bind(HOUSE_B, 'x', { neumaId: BETA });
    x = getChannel('x');

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
    const linked = new Promise((r) => wss.once('connection', (s) => { serverWs = s; r(); }));
    client = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}`);
    await Promise.all([linked, new Promise((r) => client.once('open', r))]);
  });

  afterAll(async () => {
    if (client?.readyState === WebSocket.OPEN) client.terminate();
    if (serverWs?.readyState === WebSocket.OPEN) serverWs.terminate();
    await new Promise((r) => wss.close(r));
    await new Promise((r) => httpServer.close(r));
    houses.restore();
    if (savedQueue === undefined) delete process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
    else process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = savedQueue;
  });

  beforeEach(async () => {
    await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, '[]');
  });

  test('queue_list and queue_get show only the lane\'s own house', async () => {
    const mine = await stage(ALPHA, 'alpha copy for the week');
    const theirs = await stage(BETA, 'beta copy nobody else may read');

    const listA = await social(laneOf(ALPHA, HOUSE_A), 'queue_list', { status: 'all', view: 'index' });
    expect(listA.status).toBe('ok');
    expect(listA.content).toContain(mine.id);
    expect(listA.content).not.toContain(theirs.id);
    expect(listA.content).not.toContain('beta copy');
    const listB = await social(laneOf(BETA, HOUSE_B), 'queue_list', { status: 'all', view: 'index' });
    expect(listB.content).toContain(theirs.id);
    expect(listB.content).not.toContain(mine.id);

    const getAcross = await social(laneOf(ALPHA, HOUSE_A), 'queue_get', { id: theirs.id });
    expect(getAcross.status).toBe('error');
    expect(getAcross.error).not.toContain('beta copy');
    const getOwn = await social(laneOf(ALPHA, HOUSE_A), 'queue_get', { id: mine.id });
    expect(getOwn.status).toBe('ok');
    expect(getOwn.content).toContain('alpha copy for the week');

    // The duplicate check (q:) counts only this house's copy.
    const dup = await social(laneOf(ALPHA, HOUSE_A), 'queue_list', { q: 'beta copy' });
    expect(dup.content).not.toContain(theirs.id);
  });

  test('queue_cancel of another house\'s id answers "no such queued post" and the entry stands', async () => {
    const theirs = await stage(BETA, 'beta copy that must still publish');
    const pulled = await social(laneOf(ALPHA, HOUSE_A), 'queue_cancel', { id: theirs.id, reason: 'not mine' });
    expect(pulled.status).toBe('error');
    expect(pulled.error).toContain('no such queued post');
    expect((await entryOf(theirs.id)).status).toBe('draft');
  });

  test('queue_update_to_x (single and bulk) cannot edit another house\'s post', async () => {
    const theirs = await stage(BETA, 'beta words stay beta words');
    const single = await _handleNeumaQueueUpdate(serverWs, laneOf(ALPHA, HOUSE_A), null, 'auto',
      { id: theirs.id, text: 'rewritten across houses' }, x);
    expect(single.status).toBe('error');
    expect(single.error).toContain('no such queued post');

    const bulk = await _handleNeumaQueueBulkUpdate(serverWs, laneOf(ALPHA, HOUSE_A), null, 'auto',
      { updates: [{ id: theirs.id, text: 'bulk across houses' }] }, x);
    expect(bulk.results[0]).toMatchObject({ id: theirs.id, ok: false, error: 'no such queued post' });
    expect((await entryOf(theirs.id)).text).toBe('beta words stay beta words');

    // The same house edits its own post — the gate is the house, not the tool.
    const mine = await stage(ALPHA, 'alpha words');
    const own = await _handleNeumaQueueUpdate(serverWs, laneOf(ALPHA, HOUSE_A), null, 'auto',
      { id: mine.id, scheduledFor: '2999-02-02T02:00:00Z' }, x);
    expect(own.status).toBe('ok');
    expect((await entryOf(mine.id)).scheduledFor).toBe('2999-02-02T02:00:00Z');
  });

  test('an X edit tool refuses the house\'s own post on another platform', async () => {
    const telegram = await stage(ALPHA, 'a telegram line', { channelId: 'telegram' });
    const refused = await _handleNeumaQueueUpdate(serverWs, laneOf(ALPHA, HOUSE_A), null, 'auto',
      { id: telegram.id, text: 'edited through the X tool' }, x);
    expect(refused.status).toBe('error');
    expect(refused.error).toBe('that post is not a X (Twitter) post');
    expect((await entryOf(telegram.id)).text).toBe('a telegram line');
  });

  test('a follow-up cannot thread onto another house\'s post', async () => {
    const theirs = await stage(BETA, 'beta parent');
    const thread = await _handleNeumaSelfReply(serverWs, laneOf(ALPHA, HOUSE_A), null, 'auto',
      { parentQueueId: theirs.id, text: 'riding under a stranger' }, x);
    expect(thread.status).toBe('denied');
    expect(thread.error).toContain('no queue entry');
    expect((await postQueue.load()).filter((e) => e.kind === 'self-reply')).toEqual([]);
  });

  test('the CMO briefing and pipeline_state count only the house\'s own queue', async () => {
    await cmoDesignation.designate(HOUSE_A, ALPHA);
    await stage(ALPHA, 'alpha launch post');
    await stage(BETA, 'beta launch post');
    await stage(BETA, 'beta second post');

    const briefing = await _cmoBriefingSection(laneOf(ALPHA, HOUSE_A));
    expect(briefing).toContain('alpha launch post');
    expect(briefing).not.toContain('beta launch post');
    expect(briefing).not.toContain('beta second post');

    const a = await computePipelineState({ laneId: ALPHA, wallet: HOUSE_A });
    expect(a.queue.counts.draft).toBe(1);
    expect(a.queue.pendingApproval).toBe(1);
    const b = await computePipelineState({ laneId: BETA, wallet: HOUSE_B });
    expect(b.queue.counts.draft).toBe(2);
    // No house, no queue.
    expect((await computePipelineState({})).queue.counts.draft).toBe(0);
    await cmoDesignation.clear(HOUSE_A);
  });

  test('the house probe reads the house\'s own credential file\'s mode bits', async () => {
    // Placeholder values (never a real key): the store is written by its own writer.
    await setChannelCredential(HOUSE_A, 'telegram', { botToken: 'test-placeholder-token', chatId: '-100' });
    const file = channelCredentialsPath(HOUSE_A);
    const probe = (wallet) => runHouseProbe({
      wallet, workspace: neumaWorkspace, repoRoot: houses.tmp, settingsDir: houses.settings,
    });
    const label = 'house:perms:house/social-channel-credentials.json';
    expect((await probe(HOUSE_A)).findings.map((f) => f.externalId)).not.toContain(label);

    await fs.chmod(file, 0o644);
    const loose = (await probe(HOUSE_A)).findings.find((f) => f.externalId === label);
    expect(loose).toMatchObject({ severity: 'high', title: expect.stringContaining('0644') });
    // House B's probe never reports house A's file.
    expect((await probe(HOUSE_B)).findings.map((f) => f.externalId)).not.toContain(label);
    await fs.chmod(file, 0o600);
  });
});
