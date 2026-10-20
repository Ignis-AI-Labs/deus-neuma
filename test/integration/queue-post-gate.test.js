/**
 * social/queue INTENT gate — staging into the campaign queue, proven end to
 * end with NO mock on the claimed path (RULE 0): REAL WebSocket pair, REAL
 * policy cascade, REAL approval flow, REAL queue store on real disk, REAL
 * intent files written with plain fs.
 *
 * Stage 2 of the being-tool-surface doctrine: `queue_post_to_x` the tool is
 * gone; staging is a filed intent settled by the sweep. Staging is not egress
 * — the entry lands as a draft the operator decides, and the scheduler
 * re-checks the binding again at send time — but the same laws hold at this
 * door: the sector-crew standing rule (re-read per act) and the fail-closed
 * ACTS default on the intents rows. Credentials here are dummies for the
 * ADVERTISING check only — the staging path never touches a platform API, so
 * no network is reachable from this suite.
 *
 * The sweep's own mechanics (idempotency, invalid payloads, observe holds,
 * interrupt-pending, policy deny) are proven in intent-sweep.test.js; the
 * THREAD lane (queue_self_reply_to_x) stays a tool and keeps its tests here.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { verifySessionToken } from '../../backend/services/auth.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getWitnessesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const { _handleNeumaSelfReply, _postToolsFor } = __test;
const NEUMA_ID = 'queuegateecho';
const X_ENV = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
const SOCIAL_PATHS = ['NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SECTOR_CREW_PATH'];

describe('social/queue intent gate (real WS + real policy cascade + real queue disk, gnosis)', () => {
  let house, origRoot, httpServer, wss, serverWs, client, port;
  let clientLog;
  let decide = null; // armed per test — the operator's chip answer
  const savedEnv = {};
  let auth, oldRealm, oldWitnesses;
  let channel;

  const freshConnection = (extra = {}) => ({
    ws: serverWs,
    walletAddress: auth.address,
    companion: { name: 'QueueGateEcho', neumaId: NEUMA_ID },
    ...extra,
  });

  const fileIntent = async (name, payload, laneId = NEUMA_ID) => {
    const dir = path.join(workspace.pathFor(laneId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(payload));
  };

  const sweep = (connection, mode) => sweepIntents(connection, {
    mode, lanePolicy: null,
    emit: (event) => clientLog.push({ type: 'tool:usage', ...event }),
  });

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

  beforeAll(async () => {
    // Dummy env credentials — staging never calls a poster, so these exist
    // only so the advertising filter (bound AND credentialed) can pass.
    for (const k of X_ENV) { savedEnv[k] = process.env[k]; process.env[k] = `dummy-${k}`; }

    house = await createTempDir('queue-post-gate-house');
    oldRealm = getRealmRoot(); oldWitnesses = getWitnessesRoot();
    setRealmRoot(path.join(house, 'realm'));
    setWitnessesRoot(path.join(house, 'witnesses'));
    auth = await fullAuth();
    for (const k of SOCIAL_PATHS) { savedEnv[k] = process.env[k]; }
    process.env.NEUMA_SOCIAL_BINDINGS_PATH = `${house}/social-channel-bindings.json`;
    process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = `${house}/social-channel-credentials.json`;
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = `${house}/social-post-queue.json`;
    process.env.NEUMA_SECTOR_CREW_PATH = `${house}/sector-crew.json`;
    await channelBindings.bind(auth.address, 'x', { neumaId: NEUMA_ID });
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);
    await writeOwner(house, NEUMA_ID, auth.address);

    const { getChannel } = await import('../../backend/services/social/channel-registry.js');
    channel = getChannel('x');

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws, req) => {
        const verified = verifySessionToken(new URL(req.url, 'http://localhost').searchParams.get('token'));
        if (!verified || verified.address.toLowerCase() !== auth.address) { ws.close(1008); return; }
        serverWs = ws;
        ws.on('message', (d) => {
          const m = JSON.parse(d.toString());
          if (m.type === 'tool:approval_response') resolveToolApproval(ws.__connection, m.id, m.decision);
        });
        resolve();
      });
    });
    client = new WebSocket(`ws://localhost:${port}/?token=${encodeURIComponent(auth.token)}`);
    clientLog = [];
    client.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      clientLog.push(msg);
      if (msg.type === 'tool:approval_request' && decide) {
        client.send(JSON.stringify({ type: 'tool:approval_response', id: msg.id, decision: decide(msg) }));
      }
    });
    await linked;
  }, 60000);

  afterAll(async () => {
    for (const k of [...X_ENV, ...SOCIAL_PATHS]) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    client?.terminate(); serverWs?.terminate();
    if (wss) await new Promise((resolve) => wss.close(resolve));
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    setRealmRoot(oldRealm); setWitnessesRoot(oldWitnesses);
    setWorkspacesRoot(origRoot);
    await fs.rm(house, { recursive: true, force: true });
  });

  test('ADVERTISING — the bound holder sees the edit and reply lanes; posting and staging are intents now', async () => {
    const tools = await _postToolsFor(NEUMA_ID);
    // The reply lane's tools ride with the holder: the answer, the thread
    // draft, and the do-not-engage mark (ruling, 2026-07-28). post_to_x and
    // queue_post_to_x are GONE — consequential acts are filed as intents.
    expect(tools.map((t) => t.name)).toEqual([
      'queue_update_to_x', 'queue_bulk_update_to_x', 'queue_reply_to_x', 'queue_self_reply_to_x', 'reply_dismiss_to_x',
    ]);
    // And a neuma that holds nothing sees nothing.
    expect(await _postToolsFor('someotherneuma')).toEqual([]);
  });

  test('RETIRED NAME — the old channel-parameterized staging/posting tools point at their intents', async () => {
    // 2026-09-02 context-economy: a being that calls the retired
    // queue_post_to_<channel> family hit a bare "unavailable" wall and burned
    // rounds rediscovering that staging is a filed intent. The wall now names
    // the intent directly.
    const { retiredToolHint } = await import('../../backend/services/intents/retired-tools.js');
    expect(retiredToolHint('queue_post_to_x')).toContain('"type": "social/queue"');
    expect(retiredToolHint('queue_post_to_linkedin')).toContain('"type": "social/queue"');
    expect(retiredToolHint('social/queue_post_to_x')).toContain('"type": "social/queue"');
    expect(retiredToolHint('post_to_x')).toContain('"type": "social/post"');
    // Live tools never get a hint.
    expect(retiredToolHint('queue_update_to_x')).toBeNull();
  });

  test('ALLOW — a filed social/queue intent lands in the REAL queue carrying its author and schedule', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'allow';

    await fileIntent('calendar-entry', {
      type: 'social/queue', channel: 'x',
      text: 'first staged calendar entry', scheduledFor: '2999-01-01T09:00:00Z',
    });
    const receipts = await sweep(connection, 'ask');

    expect(receipts[0].status).toBe('ok');
    expect(receipts[0].content).toContain('operator decides');
    const entries = await postQueue.load();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      channelId: 'x',
      text: 'first staged calendar entry',
      scheduledFor: '2999-01-01T09:00:00Z',
      authorNeumaId: NEUMA_ID,
      queuedBy: NEUMA_ID,
      status: 'draft',
    });
    const request = await untilClient((m) => m.type === 'tool:usage');
    expect(request.tool).toBe('intents/social.queue');
    // NO stage-time card (posting-pipeline-v2): the draft's single operator
    // decision is the board's approve — the surface that shows the real card.
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
    await postQueue.remove(entries[0].id); // leave the floor clean for the next test
  }, 30000);

  test('NO CROSS-ROUTING — a being off the crew cannot fill the calendar, and is never asked', async () => {
    const connection = freshConnection({ companion: { name: 'Intruder', neumaId: 'someotherneuma' } });
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = null; // the operator must never even be asked

    await fileIntent('intruder-draft', { type: 'social/queue', channel: 'x', text: 'not my calendar' }, 'someotherneuma');
    const receipts = await sweep(connection, 'auto');

    expect(receipts[0].status).toBe('denied');
    expect(receipts[0].error).toContain('not on the X (Twitter) crew');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
    expect(await postQueue.load()).toEqual([]);
  }, 30000);

  test('THE CREW STAGES — a non-holder the operator seated may fill the calendar', async () => {
    // The point of the sector crew (ruling, 2026-07-26): a sealed witness on the
    // X crew drafts campaigns even though another being holds the keys.
    // Custody is untouched — this being still cannot POST, only stage.
    const { sectorCrew } = await import('../../backend/services/sector-crew.js');
    // The crew is the house's own: its operator seats a witness lane it manifested.
    await writeOwner(path.join(house, 'witnesses'), 'witness-openai-Kagipem', auth.address);
    await sectorCrew.add(auth.address, 'x', { neumaId: 'witness-openai-Kagipem', kind: 'witness', remit: 'campaigns' });

    const connection = freshConnection({
      companion: { name: 'Kagipem', neumaId: 'witness-openai-Kagipem' },
    });
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'allow';

    await fileIntent('crew-draft', { type: 'social/queue', channel: 'x', text: 'crew draft' }, 'witness-openai-Kagipem');
    const receipts = await sweep(connection, 'ask');
    expect(receipts[0].status).toBe('ok');
    const entries = await postQueue.load();
    expect(entries.at(-1)).toMatchObject({
      text: 'crew draft', authorNeumaId: 'witness-openai-Kagipem', status: 'draft',
    });

    // ...and the crew member is offered the EDIT lane only — never the
    // holder's reply lane.
    expect((await _postToolsFor('witness-openai-Kagipem')).map((t) => t.name))
      .toEqual(['queue_update_to_x', 'queue_bulk_update_to_x', 'queue_self_reply_to_x']);

    for (const e of entries) await postQueue.remove(e.id);
    await sectorCrew.remove(auth.address, 'x', 'witness-openai-Kagipem');
  }, 30000);

  test('CALL-TIME BINDING — releasing the channel refuses the former holder on the very next filing', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = null;

    await channelBindings.unbind(auth.address, 'x');
    await fileIntent('after-release', { type: 'social/queue', channel: 'x', text: 'after release' });
    const released = await sweep(connection, 'auto');
    expect(released[0].status).toBe('denied');
    expect(released[0].error).toContain('not on the X (Twitter) crew');

    await channelBindings.bind(auth.address, 'x', { neumaId: NEUMA_ID });
    await fileIntent('after-rebind', { type: 'social/queue', channel: 'x', text: 'after rebind' });
    // The board is the gate now (posting-pipeline-v2): AUTO stages the
    // rebound holder's draft with NO card — the old stage-time card is gone.
    decide = null;
    const restored = await sweep(connection, 'auto');
    expect(restored[0].status).toBe('ok');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
    for (const e of await postQueue.load()) await postQueue.remove(e.id);
  }, 30000);

  test('shape law — empty text and a malformed schedule settle invalid before any card', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = null;

    await fileIntent('empty-draft', { type: 'social/queue', channel: 'x', text: '   ' });
    const empty = await sweep(connection, 'auto');
    expect(empty[0].status).toBe('error');
    expect(empty[0].error).toContain('needs text');

    await fileIntent('bad-time', { type: 'social/queue', channel: 'x', text: 'fine words', scheduledFor: 'next tuesday-ish' });
    const badTime = await sweep(connection, 'auto');
    expect(badTime[0].status).toBe('error');
    expect(badTime[0].error).toContain('ISO-8601');
    expect(await postQueue.load()).toEqual([]);
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  // THE THREAD LANE (Founder/Kagipem 2026-07-29) — the follow-up's stage gate,
  // still a TOOL this stage, same real WS + real store as the intent gate above.
  test('THREAD — a follow-up stages under a REAL parent, with its linkage and the parent named', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'allow';

    const parent = await postQueue.add({
      channelId: 'x', text: 'the parent stands first', scheduledFor: '2999-01-01T09:00:00Z',
      queuedBy: '0xTestWitness',
    });
    const result = await _handleNeumaSelfReply(serverWs, connection, null, 'ask', {
      parentQueueId: parent.id, text: 'the follow-up lands the CTA',
    }, channel);

    expect(result.status).toBe('ok');
    expect(result.content).toContain(parent.id);
    const entries = await postQueue.load();
    const child = entries.find((e) => e.kind === 'self-reply');
    expect(child).toMatchObject({
      channelId: 'x',
      text: 'the follow-up lands the CTA',
      thread: { parentId: parent.id },
      scheduledFor: null, // it inherits the parent's moment — never its own
      authorNeumaId: NEUMA_ID,
      status: 'draft',
    });
    // The operator's chip carried the follow-up AND the parent's id.
    const request = await untilClient((m) => m.type === 'tool:approval_request');
    expect(request.tool).toBe('social/queue_self_reply_to_x');
    expect(request.args).toContain(parent.id);
    await postQueue.remove(child.id);
    await postQueue.remove(parent.id);
  }, 30000);

  test('THREAD — an invented or dead parent is refused before any chip', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = null; // the operator must never even be asked

    const ghost = await _handleNeumaSelfReply(serverWs, connection, null, 'ask', {
      parentQueueId: '0000000000000000', text: 'a thread onto nothing',
    }, channel);
    expect(ghost.status).toBe('denied');
    expect(ghost.error).toContain('no queue entry');

    const dead = await postQueue.add({ channelId: 'x', text: 'a failed parent', queuedBy: '0xTestWitness' });
    await postQueue.approve(dead.id, { decidedBy: 'test' });
    await postQueue.claimForSend(dead.id);
    await postQueue.recordOutcome(dead.id, { ok: false, detail: 'the wire said no' });
    const refused = await _handleNeumaSelfReply(serverWs, connection, null, 'ask', {
      parentQueueId: dead.id, text: 'a thread onto a grave',
    }, channel);
    expect(refused.status).toBe('denied');
    expect(refused.error).toContain('can never publish');

    expect(await postQueue.load()).toHaveLength(1); // only the dead parent, no children
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
    await postQueue.remove(dead.id);
  }, 30000);

  test('INTERRUPTED — a barge-in that landed before staging holds it; nothing persists', async () => {
    const parent = await postQueue.add({ channelId: 'x', text: 'the parent outlives the turn', queuedBy: '0xTestWitness' });
    const controller = new AbortController();
    controller.abort();
    const connection = freshConnection({ activeTurn: { signal: controller.signal } });
    serverWs.__connection = connection;

    const result = await _handleNeumaSelfReply(serverWs, connection, null, 'auto', { parentQueueId: parent.id, text: 'mid-interrupt' }, channel);
    expect(result.status).toBe('denied');
    expect(result.error).toContain('interrupted');
    expect((await postQueue.load()).filter((e) => e.kind === 'self-reply')).toEqual([]);
    await postQueue.remove(parent.id);
  }, 30000);
});
