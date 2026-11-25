/**
 * THE QUEUE, ORGANIZED (RULE 0) — Design note, 2026-11-16: a being asked for […] and got
 * forty sent posts from July, verbatim, then a refusal ([…]). […]
 *
 * The real queue store on real temp disk, the real social handler and policy cascade, and a real
 * WebSocket pair for the chip. Nothing on the claimed path is mocked.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { useServedHouse } from '../helpers/served-house.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { localDay } from '../../backend/services/social/queue-overview.js';

const { _handleSocialTool } = __test;
const LANE = 'queueorganizedlane';

describe('the queue, organized — the map first, then exactly the slice', () => {
  let servedHouse;
  let house, httpServer, wss, serverWs, client, savedPath;
  let frames;

  const call = (toolName, args = {}) => _handleSocialTool(serverWs, {
    ws: serverWs, toolMode: 'auto', companion: { name: 'Juniper', neumaId: LANE },
  }, null, 'auto', { toolName, tool: `social/${toolName}` }, args);
  const stage = (text, extra = {}) => postQueue.add({ channelId: 'x', text, authorNeumaId: LANE, queuedBy: LANE, ...extra });
  const send = async (entry, postId) => {
    await postQueue.approve(entry.id, { decidedBy: 'Ada' });
    await postQueue.claimForSend(entry.id);
    await postQueue.recordOutcome(entry.id, { ok: true, id: postId });
  };
  const idsIn = (content) => [...content.matchAll(/^\[([0-9a-f]{16})\]/gm)].map((m) => m[1]);
  const chip = () => frames.filter((f) => f.type === 'tool:usage' && f.tool === 'social/queue_list').pop()?.summary;

  // A record like the one Founder's being met: copy that went out, copy that was pulled, one draft.
  let draft, approved, sentOne, sentTwo, pulled, declined;
  beforeEach(async () => {
    await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, '[]');
    frames.length = 0;
    draft = await stage('a draft awaiting the operator', { campaignId: 'launch' });
    approved = await stage('approved and coming', { campaignId: 'launch', scheduledFor: new Date(Date.now() + 86_400_000).toISOString() });
    await postQueue.approve(approved.id, { decidedBy: 'Ada' });
    sentOne = await stage('the first line that went out', { campaignId: 'launch' });
    sentTwo = await stage('the second line that went out', { campaignId: 'umbrae' });
    await send(sentOne, '1948800000000000011');
    await send(sentTwo, '1948800000000000012');
    pulled = await stage('copy the operator pulled');
    await postQueue.withdraw(pulled.id, { withdrawnBy: 'Ada', reason: 'superseded' });
    declined = await stage('copy the operator declined');
    await postQueue.reject(declined.id, { decidedBy: 'Ada' });
  });

  beforeAll(async () => {
    servedHouse = await useServedHouse({ lanes: [LANE] });
    house = await createTempDir('queue-organized-read');
    savedPath = process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = `${house}/post-queue.json`;
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
    const linked = new Promise((r) => wss.once('connection', (s) => { serverWs = s; r(); }));
    client = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}`);
    await Promise.all([linked, new Promise((r) => client.once('open', r))]);
    frames = [];
    client.on('message', (d) => frames.push(JSON.parse(d.toString())));
  });

  afterAll(async () => {
    servedHouse.restore();
    client?.terminate();
    serverWs?.terminate();
    await new Promise((r) => wss.close(r));
    await new Promise((r) => httpServer.close(r));
    if (savedPath === undefined) delete process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
    else process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = savedPath;
    await fs.rm(house, { recursive: true, force: true });
  });

  test("view:'summary' maps the whole record by standing, day, campaign and channel — and carries no copy", async () => {
    const result = await call('queue_list', { view: 'summary' });
    const today = localDay(Date.now());
    expect(result.status).toBe('ok');
    expect(result.content).toContain('THE QUEUE AT A GLANCE — 6 post(s)');
    expect(result.content).toContain('STANDING: 1 draft (await your operator) · 1 approved (scheduled) · 2 sent · 1 withdrawn · 1 declined');
    expect(result.content).toContain(`SENT, by day (newest first): ${today} ×2`);
    expect(result.content).toContain(`WITHDRAWN / DECLINED / TAKEN DOWN, by day (newest first): ${today} ×2`);
    expect(result.content).toContain(`COMING, by day: ${localDay(Date.now() + 86_400_000)} ×1 · 1 unscheduled`);
    expect(result.content).toContain('launch: 1 draft, 1 approved, 1 sent');
    expect(result.content).toContain('CHANNELS: x 6');
    expect(result.content).toContain("{status:'sent', day:");
    expect(result.content).not.toContain('went out');
    await new Promise((r) => { setTimeout(r, 30); });
    expect(chip()).toBe('the queue at a glance · 6 post(s)');
  });

  test('a bare read is what can still move; sent and pulled copy stay out and are named', async () => {
    const result = await call('queue_list');
    expect(idsIn(result.content).sort()).toEqual([draft.id, approved.id].sort());
    expect(result.content).toContain('(open — draft, approved, sending, failed)');
    expect(result.content).toContain("2 sent in the record, not shown (status:'sent' reads them");
    expect(result.content).toContain('2 withdrawn/declined left in the record');
    expect(result.content).toContain("queue_list {view:'summary'} maps the whole record by day");
  });

  test('the words a being reaches for read as the standing it means, never as invalid args', async () => {
    const pending = await call('queue_list', { status: 'pending' });
    expect(pending.status).toBe('ok');
    expect(idsIn(pending.content)).toEqual([draft.id]);
    expect(idsIn((await call('queue_list', { status: 'scheduled' })).content)).toEqual([approved.id]);
    expect(idsIn((await call('queue_list', { status: 'published' })).content).sort()).toEqual([sentOne.id, sentTwo.id].sort());
    expect(idsIn((await call('queue_list', { status: 'dead' })).content).sort()).toEqual([pulled.id, declined.id].sort());
    expect(idsIn((await call('queue_list', { status: 'declined' })).content)).toEqual([declined.id]);
  });

  test('day reads what happened that day — sent by when it went out, pulled by when it was pulled', async () => {
    const sentToday = await call('queue_list', { status: 'sent', day: 'today' });
    expect(idsIn(sentToday.content).sort()).toEqual([sentOne.id, sentTwo.id].sort());
    await new Promise((r) => { setTimeout(r, 30); });
    expect(chip()).toBe(`2 sent post(s) · ${localDay(Date.now())}`);

    const deadToday = await call('queue_list', { status: 'dead', day: localDay(Date.now()) });
    expect(idsIn(deadToday.content).sort()).toEqual([pulled.id, declined.id].sort());

    // A day and no status: everything that happened on it, any standing.
    const everything = await call('queue_list', { day: 'today' });
    expect(idsIn(everything.content).sort()).toEqual([sentOne.id, sentTwo.id, pulled.id, declined.id].sort());

    const tomorrow = await call('queue_list', { day: 'tomorrow' });
    expect(idsIn(tomorrow.content)).toEqual([approved.id]);
    expect(idsIn((await call('queue_list', { status: 'sent', day: 'yesterday' })).content)).toEqual([]);

    const bad = await call('queue_list', { day: 'last tuesday' });
    expect(bad.status).toBe('error');
    expect(bad.error).toContain('day must be YYYY-MM-DD');
  });

  test('the next call keeps the filters, so paging one day stays on that day', async () => {
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await send(await stage(`more sent copy ${i}`), `19488000000000001${i}0`);
    }
    const first = await call('queue_list', { status: 'sent', day: 'today', limit: 2 });
    const next = first.content.match(/next: (queue_list \{[^}]+\})/)?.[1];
    expect(next).toBe(`queue_list {offset: 2, status: 'sent', day: '${localDay(Date.now())}'}`);
  });
});
