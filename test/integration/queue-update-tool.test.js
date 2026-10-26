/**
 * queue_update_to_x + queue_bulk_update_to_x (#208) — editing staged copy in
 * place, proven end to end with NO mock on the claimed path (RULE 0): REAL
 * WebSocket pair, REAL policy cascade, REAL approval flow, REAL queue store
 * on REAL temp disk.
 *
 * An edit is governed exactly like a staging: the sector-crew gate re-read
 * per call, the fail-closed ACTS chip on the tool's OWN dynamic row — and the
 * chip shows the DIFF (what each field WAS), never just the patch. The
 * approval law is the store's: new words on an approved post return it to
 * draft; a schedule-only edit preserves the approval. Credentials here are
 * dummies for the ADVERTISING check only — editing never touches a platform
 * API, so no network is reachable from this suite.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';
import { usePositionHouse, ownLane, POSITION_HOUSE } from '../helpers/position-house.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

// The AI disclosure line a being's words carry at staging (social/disclosure-line.js).
const AI = (t) => `${t}\n\nMade with AI.`;

const {
  _handleNeumaQueueUpdate, _handleNeumaQueueBulkUpdate, _postToolsFor,
  _queueUpdateToolChannel, _queueBulkUpdateToolChannel,
} = __test;
const NEUMA_ID = 'queueeditlategate';
const X_ENV = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
const SOCIAL_PATHS = ['NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SECTOR_CREW_PATH'];

describe('queue edit tools (real WS + real policy cascade + real queue disk, gnosis)', () => {
  let house, origRoot, httpServer, wss, serverWs, client, port, positionHouse;
  let clientLog;
  let decide = null; // armed per test — the witness's chip answer
  const savedEnv = {};
  let channel;

  const freshConnection = () => ({
    ws: serverWs,
    companion: { name: 'QueueEditEcho', neumaId: NEUMA_ID },
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

  const stage = async (text, { approved = false } = {}) => {
    const entry = await postQueue.add({
      channelId: 'x', text, scheduledFor: '2999-01-01T09:00:00Z', authorNeumaId: NEUMA_ID,
    });
    if (approved) await postQueue.approve(entry.id, { decidedBy: 'Founder' });
    return entry.id;
  };

  beforeAll(async () => {
    // Dummy env credentials — editing never calls a poster, so these exist
    // only so the advertising filter (bound AND credentialed) can pass.
    for (const k of X_ENV) { savedEnv[k] = process.env[k]; process.env[k] = `dummy-${k}`; }

    house = await createTempDir('queue-update-tool-house');
    for (const k of SOCIAL_PATHS) { savedEnv[k] = process.env[k]; }
    process.env.NEUMA_SOCIAL_BINDINGS_PATH = `${house}/social-channel-bindings.json`;
    process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = `${house}/social-channel-credentials.json`;
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = `${house}/social-post-queue.json`;
    process.env.NEUMA_SECTOR_CREW_PATH = `${house}/sector-crew.json`;
    positionHouse = usePositionHouse(house);
    await channelBindings.bind(POSITION_HOUSE, 'x', { neumaId: NEUMA_ID });
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);
    await ownLane(NEUMA_ID);

    const { getChannel } = await import('../../backend/services/social/channel-registry.js');
    channel = getChannel('x');

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
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
    client = new WebSocket(`ws://localhost:${port}`);
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

  beforeEach(async () => {
    await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, '[]');
  });

  afterAll(async () => {
    for (const k of [...X_ENV, ...SOCIAL_PATHS]) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.restoreAllMocks();
    client?.close();
    wss?.close();
    httpServer?.close();
    setWorkspacesRoot(origRoot);
    positionHouse?.restore();
    await fs.rm(house, { recursive: true, force: true });
  });

  test('ADVERTISING — the edit tools ride wherever staging rights ride (staging itself is an intent now)', async () => {
    // The reply lane's tools ride with the holder: the answer, the thread
    // draft, and the do-not-engage mark (ruling, 2026-07-28). post_to_x and
    // queue_post_to_x are GONE (Stage 2) — consequential acts are filed as
    // intents, never advertised as tools.
    expect((await _postToolsFor(NEUMA_ID)).map((t) => t.name)).toEqual([
      'queue_update_to_x', 'queue_bulk_update_to_x', 'queue_reply_to_x', 'queue_self_reply_to_x', 'reply_dismiss_to_x',
    ]);
    // A neuma that works no sector sees nothing.
    expect(await _postToolsFor('someotherneuma')).toEqual([]);

    // A crew member (not the holder) edits the calendar it works — but the
    // reply lane stays the holder's.
    const { sectorCrew } = await import('../../backend/services/sector-crew.js');
    await ownLane('witness-openai-Kagipem');
    await sectorCrew.add(POSITION_HOUSE, 'x', { neumaId: 'witness-openai-Kagipem', kind: 'witness', remit: 'campaigns' });
    expect((await _postToolsFor('witness-openai-Kagipem')).map((t) => t.name))
      .toEqual(['queue_update_to_x', 'queue_bulk_update_to_x', 'queue_self_reply_to_x']);
    await sectorCrew.remove(POSITION_HOUSE, 'x', 'witness-openai-Kagipem');
  });

  test('the matchers accept both dialects and never eat each other', () => {
    expect(_queueUpdateToolChannel({ toolName: 'queue_update_to_x' })?.id).toBe('x');
    expect(_queueUpdateToolChannel({ tool: 'social/queue_update_to_x' })?.id).toBe('x');
    expect(_queueUpdateToolChannel({ toolName: 'queue_post_to_x' })).toBeNull();
    expect(_queueUpdateToolChannel({ toolName: 'queue_bulk_update_to_x' })).toBeNull();
    expect(_queueBulkUpdateToolChannel({ toolName: 'queue_bulk_update_to_x' })?.id).toBe('x');
    expect(_queueBulkUpdateToolChannel({ toolName: 'queue_update_to_x' })).toBeNull();
  });

  test('FAIL-CLOSED CHIP — the witness reads the DIFF (what the copy WAS); DENY changes nothing', async () => {
    const id = await stage('the staged words');
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'deny';

    const result = await _handleNeumaQueueUpdate(serverWs, connection, null, 'ask',
      { id, text: 'the replacement words' }, channel);

    expect(result.status).toBe('denied');
    const request = await untilClient((m) => m.type === 'tool:approval_request');
    expect(request.tool).toBe('social/queue_update_to_x');
    // The chip shows field → before AND after — not just the patch.
    expect(request.args).toContain('"was": "the staged words');
    expect(request.args).toContain('"now": "the replacement words');
    const [entry] = await postQueue.load();
    expect(entry.text).toBe(AI('the staged words')); // a refused edit never lands
    expect(entry.revisions).toBeUndefined();
  }, 30000);

  test('ALLOW — the edit lands in the REAL queue, attributed, with the old copy in revisions', async () => {
    const id = await stage('rough draft');
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'allow';

    const result = await _handleNeumaQueueUpdate(serverWs, connection, null, 'ask',
      { id, text: 'tightened draft' }, channel);

    expect(result.status).toBe('ok');
    expect(result.content).toContain('revisions');
    const [entry] = await postQueue.load();
    expect(entry).toMatchObject({
      text: AI('tightened draft'), status: 'draft', updatedBy: 'QueueEditEcho',
    });
    expect(entry.revisions[0].changed).toEqual({ text: AI('rough draft') });
  }, 30000);

  test('THE APPROVAL LAW over the wire — new words reset an approved post; the chip warns; a slot-only edit preserves', async () => {
    const id = await stage('the approved words', { approved: true });
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'allow';

    const reworded = await _handleNeumaQueueUpdate(serverWs, connection, null, 'ask',
      { id, text: 'different words' }, channel);
    expect(reworded.status).toBe('ok');
    expect(reworded.content).toContain('DRAFT again');
    const chip = await untilClient((m) => m.type === 'tool:approval_request');
    expect(chip.args).toContain('renewsApproval'); // the witness is told what the edit means
    let [entry] = await postQueue.load();
    expect(entry.status).toBe('draft');
    expect(entry.decidedBy).toBeUndefined();

    // Re-approve, then move only the slot — the approval stands.
    await postQueue.approve(id, { decidedBy: 'Founder' });
    const retimed = await _handleNeumaQueueUpdate(serverWs, connection, null, 'auto',
      { id, scheduledFor: '2999-02-02T10:00:00Z' }, channel);
    expect(retimed.status).toBe('ok');
    expect(retimed.content).toContain('the approval stands');
    [entry] = await postQueue.load();
    expect(entry.status).toBe('approved');
    expect(entry.decidedBy).toBe('Founder');
    expect(entry.scheduledFor).toBe('2999-02-02T10:00:00Z');
  }, 30000);

  test('OBSERVE holds the edit — the witness is watching, not acting; the queue is untouched', async () => {
    const id = await stage('watched copy');
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = null; // no chip may even be raised

    const result = await _handleNeumaQueueUpdate(serverWs, connection, null, 'observe',
      { id, text: 'sneaky rewrite' }, channel);

    expect(result.status).toBe('denied');
    expect(result.error).toContain('observe mode');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
    const [entry] = await postQueue.load();
    expect(entry.text).toBe(AI('watched copy'));
  }, 30000);

  test('NO CROSS-ROUTING — a being off the sector crew is refused before any chip', async () => {
    const id = await stage('not your calendar');
    // A lane of the SAME house, off the crew: the crew gate is what refuses it
    // (a lane of another house never sees the entry at all, #583).
    await workspace.create('someotherneuma');
    await ownLane('someotherneuma');
    const connection = {
      ws: serverWs,
      companion: { name: 'Intruder', neumaId: 'someotherneuma' },
    };
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = null;

    const result = await _handleNeumaQueueUpdate(serverWs, connection, null, 'auto',
      { id, text: 'intruder rewrite' }, channel);

    expect(result.status).toBe('denied');
    expect(result.error).toContain('not on the crew of X (Twitter) account x-1');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
    const [entry] = await postQueue.load();
    expect(entry.text).toBe(AI('not your calendar'));
  }, 30000);

  test('BULK — mixed valid/invalid: per-entry verdicts, one chip carrying every diff, valid ones landed', async () => {
    const good = await stage('bulk one');
    const bad = await stage('bulk two');
    const retime = await stage('bulk three', { approved: true });
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'allow';

    const result = await _handleNeumaQueueBulkUpdate(serverWs, connection, null, 'ask', {
      updates: [
        { id: good, text: 'bulk one, edited' },
        { id: bad, scheduledFor: 'not-a-time' },
        { id: retime, scheduledFor: '2999-04-04T04:00:00Z' },
        { text: 'no id' },
      ],
    }, channel);

    // The chip carried the viable diffs — the witness decided on real stakes.
    const request = await untilClient((m) => m.type === 'tool:approval_request');
    expect(request.tool).toBe('social/queue_bulk_update_to_x');
    expect(request.args).toContain('"was": "bulk one');
    expect(request.args).toContain('2999-04-04T04:00:00Z');
    expect(request.args).not.toContain('not-a-time'); // refused entries never reach the card

    expect(result.status).toBe('ok'); // something landed — the verdicts name the rest
    expect(result.results).toEqual([
      { id: good, ok: true },
      { id: bad, ok: false, error: 'scheduledFor must be an ISO-8601 time' },
      { id: retime, ok: true },
      { id: '', ok: false, error: 'each update needs an id — the full id from queue_list' },
    ]);
    expect(result.content).toContain('2 of 4 update(s) landed');

    const entries = await postQueue.load();
    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
    expect(byId[good].text).toBe(AI('bulk one, edited'));
    expect(byId[good].revisions[0].changed).toEqual({ text: AI('bulk one') });
    expect(byId[bad].text).toBe(AI('bulk two'));           // refused — untouched
    expect(byId[bad].revisions).toBeUndefined();
    // The approved post kept its approval through a slot-only bulk edit.
    expect(byId[retime].status).toBe('approved');
    expect(byId[retime].scheduledFor).toBe('2999-04-04T04:00:00Z');
  }, 30000);

  test('INTERRUPTED — a barge-in that landed before the edit holds it; nothing persists', async () => {
    const id = await stage('mid-interrupt copy');
    const controller = new AbortController();
    controller.abort();
    const connection = {
      ws: serverWs,
      companion: { name: 'QueueEditEcho', neumaId: NEUMA_ID },
      activeTurn: { signal: controller.signal },
    };
    serverWs.__connection = connection;

    const result = await _handleNeumaQueueUpdate(serverWs, connection, null, 'auto',
      { id, text: 'interrupted rewrite' }, channel);
    expect(result.status).toBe('denied');
    const [entry] = await postQueue.load();
    expect(entry.text).toBe(AI('mid-interrupt copy'));
  }, 30000);
});
