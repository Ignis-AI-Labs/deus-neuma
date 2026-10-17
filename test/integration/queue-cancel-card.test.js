/**
 * THE CANCELLATION CARD (RULE 0) — `queue_cancel` is an approval-gated act,
 * and its ACTS chip named no post: `cardArgs` was `{}` for everything that was
 * not `read_x`, so `approvalPreview({})` rendered '' and the operator was asked
 * to approve pulling a staged post without being told WHICH post, what it says,
 * or when it was due. The consent that landed in the act ledger carried the
 * same nothing — a record of agreement to an unnamed act.
 *
 * Everything here runs for real: the REAL queue store on real temp disk, the
 * REAL social handler, the REAL policy cascade (mode 'ask', so the chip
 * actually rises), the REAL approval broker, and a REAL WebSocket pair. The
 * operator's answer travels the real portal frame in both directions.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { readActs } from '../../backend/services/act-ledger.js';
import { postQueue } from '../../backend/services/social/post-queue.js';

const { _handleSocialTool } = __test;
const LANE = 'cancelcardlane';

describe('the cancellation card — the operator is told which post they are pulling', () => {
  let house, httpServer, wss, serverWs, client, savedPath;
  let clientLog;
  let decide = null; // armed per test — the operator's chip answer

  const freshConnection = () => ({
    ws: serverWs,
    companion: { name: 'Kagipem', neumaId: LANE },
  });

  // mode 'ask' keeps approval_required as approval_required — the chip rises.
  const call = (connection, toolName, args = {}) =>
    _handleSocialTool(serverWs, connection, null, 'ask', { toolName, tool: `social/${toolName}` }, args);

  const untilClient = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = clientLog.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error('client message never arrived'));
      setTimeout(tick, 20);
    };
    tick();
  });

  const stage = (text, extra = {}) =>
    postQueue.add({ channelId: 'x', text, authorNeumaId: LANE, queuedBy: LANE, ...extra });

  beforeAll(async () => {
    house = await createTempDir('queue-cancel-card');
    savedPath = process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = `${house}/post-queue.json`;

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
    const linked = new Promise((r) => {
      wss.once('connection', (ws) => {
        serverWs = ws;
        // The operator's answer re-enters through the REAL broker.
        ws.on('message', (d) => {
          const m = JSON.parse(d.toString());
          if (m.type === 'tool:approval_response') resolveToolApproval(ws.__connection, m.id, m.decision);
        });
        r();
      });
    });
    client = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}`);
    const opened = new Promise((r) => client.once('open', r));
    clientLog = [];
    client.on('message', (d) => {
      const msg = JSON.parse(d.toString());
      clientLog.push(msg);
      if (msg.type === 'tool:approval_request' && decide) {
        client.send(JSON.stringify({ type: 'tool:approval_response', id: msg.id, decision: decide(msg) }));
      }
    });
    await Promise.all([linked, opened]);
  });

  afterAll(async () => {
    if (client?.readyState === WebSocket.OPEN) client.terminate();
    if (serverWs?.readyState === WebSocket.OPEN) serverWs.terminate();
    await new Promise((r) => wss.close(r));
    await new Promise((r) => httpServer.close(r));
    if (savedPath === undefined) delete process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
    else process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = savedPath;
    await fs.rm(house, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, '[]');
    clientLog.length = 0;
    decide = null;
  });

  test('the chip carries the post: its id, standing, slot and the copy being pulled', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    const staged = await stage('The route matters more than the price. Here is why.', {
      scheduledFor: '2999-01-01T09:00:00Z', campaignId: 'aug2026', pillar: 'Market Structure',
    });
    await postQueue.approve(staged.id, { decidedBy: 'Founder' });
    decide = () => 'allow';

    const result = await call(connection, 'queue_cancel', { id: staged.id, reason: 'figure was corrected' });
    const ask = await untilClient((m) => m.type === 'tool:approval_request');

    expect(ask.tool).toBe('social/queue_cancel');
    // The operator reads the actual copy before agreeing it should never run.
    expect(ask.args).toContain('The route matters more than the price');
    expect(ask.args).toContain(staged.id);
    expect(ask.args).toContain('approved');
    expect(ask.args).toContain('2999-01-01T09:00:00Z');
    expect(ask.args).toContain('figure was corrected');
    // And the stakes in one sentence, not just a tool name.
    expect(ask.scope).toContain('never publish');
    expect(ask.scope).toContain(staged.id);
    expect(result.status).toBe('ok');

    // THE CONSENT RECORD. `recordAct` keeps the hand-declared scope, and
    // `scopeOf({})` was null — so an approved cancellation used to land in the
    // operator's own ledger naming no post at all. This reads the REAL ledger
    // this approval just appended to.
    const mine = (await readActs({ laneIds: [LANE] })).filter((a) => a.tool === 'social/queue_cancel');
    expect(mine.at(-1).decision).toBe('approved');
    expect(mine.at(-1).scope).toContain(staged.id);
  }, 30000);

  test('DENY leaves the post standing, and the card still named it', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    const staged = await stage('copy the operator wants kept');
    decide = () => 'deny';

    const result = await call(connection, 'queue_cancel', { id: staged.id });
    const ask = await untilClient((m) => m.type === 'tool:approval_request');

    expect(ask.args).toContain('copy the operator wants kept');
    expect(result.status).toBe('denied');
    expect((await postQueue.load())[0].status).toBe('draft');
  }, 30000);

  test('an id that names no post refuses BEFORE the operator is asked', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    await stage('an unrelated staged line');
    decide = () => 'allow';

    const result = await call(connection, 'queue_cancel', { id: 'ffffffffffffffff' });

    expect(result.status).toBe('error');
    expect(result.error).toContain('no such queued post');
    // Asking a human to decide on a post that does not exist is a card that
    // cannot be read — the refusal belongs before the interruption.
    await new Promise((r) => { setTimeout(r, 40); });
    expect(clientLog.filter((m) => m.type === 'tool:approval_request')).toHaveLength(0);
  }, 30000);

  test('a post that already went out refuses before the ask, not after it', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    const staged = await stage('already public');
    await postQueue.approve(staged.id, { decidedBy: 'Founder' });
    await postQueue.claimForSend(staged.id);
    await postQueue.recordOutcome(staged.id, { ok: true, id: '1948800000000000004' });
    decide = () => 'allow';

    const result = await call(connection, 'queue_cancel', { id: staged.id });

    expect(result.status).toBe('error');
    expect(result.error).toContain('cannot act on a sent post');
    await new Promise((r) => { setTimeout(r, 40); });
    expect(clientLog.filter((m) => m.type === 'tool:approval_request')).toHaveLength(0);
    expect((await postQueue.load())[0].status).toBe('sent');
  }, 30000);

  test('a missing id is still answered, never thrown, and never reaches the operator', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    decide = () => 'allow';

    const result = await call(connection, 'queue_cancel', {});

    expect(result.status).toBe('error');
    expect(result.error).toContain('full id from queue_list');
    await new Promise((r) => { setTimeout(r, 40); });
    expect(clientLog.filter((m) => m.type === 'tool:approval_request')).toHaveLength(0);
  }, 30000);

  test('read_x still carries its own args — the shared card builder did not regress', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    decide = () => 'deny';

    await call(connection, 'read_x', { what: 'mentions', limit: 5 });
    const ask = await untilClient((m) => m.type === 'tool:approval_request');

    expect(ask.tool).toBe('social/read_x');
    expect(ask.args).toContain('mentions');
    expect(ask.args).toContain('5');
  }, 30000);
});
