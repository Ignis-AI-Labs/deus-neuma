/**
 * social/post INTENT gate — the strict rules a being's outward speech rides,
 * proven end to end with NO mock on the claimed path (RULE 0): REAL intent
 * files on REAL disk, REAL policy cascade, REAL approval flow over a REAL
 * WebSocket pair, REAL result files.
 *
 * Stage 2 of the being-tool-surface doctrine: `post_to_x` the tool is gone;
 * the act is a filed intent settled by the sweep. The `intents` policy rows
 * default to requireApproval — fail-closed — so every post needs the
 * operator: deny works, observe holds (pending, never a verdict), and one
 * ALWAYS is a deliberate, persisted grant. The network itself is NOT touched
 * here (credentials are cleared, so an approved post ends at the executor's
 * honest not-configured outcome) — the live wire was proven separately by
 * scripts/x-post-verify.mjs.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';
import { usePositionHouse, ownLane, POSITION_HOUSE } from '../helpers/position-house.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const NEUMA_ID = 'postgateecho';
const X_ENV = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
const SOCIAL_PATHS = ['NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH'];

describe('social/post intent gate (real WS + real policy cascade, gnosis)', () => {
  let house, origRoot, httpServer, wss, serverWs, client, port, intentsDir, positionHouse;
  let clientLog;
  let decide = null; // armed per test — the operator's chip answer
  const savedEnv = {};

  const freshConnection = (extra = {}) => ({
    ws: serverWs,
    companion: { name: 'PostGateEcho', neumaId: NEUMA_ID },
    ...extra,
  });

  const fileIntent = async (name, payload, laneId = NEUMA_ID) => {
    const dir = path.join(workspace.pathFor(laneId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(payload));
  };
  const readResult = async (name) => {
    try {
      return JSON.parse(await fs.readFile(path.join(intentsDir, `${name}.result.json`), 'utf8'));
    } catch { return null; }
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
    // No credentials in this suite — a "post" that survives the gate must end
    // at the executor's honest not-configured outcome, never the real network.
    for (const k of X_ENV) { savedEnv[k] = process.env[k]; delete process.env[k]; }

    house = await createTempDir('x-post-gate-house');

    // The channel-binding standing rule is real here too: point both social
    // stores at the temp house and bind X to this being — the position under
    // test.
    for (const k of SOCIAL_PATHS) { savedEnv[k] = process.env[k]; }
    process.env.NEUMA_SOCIAL_BINDINGS_PATH = `${house}/social-channel-bindings.json`;
    process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = `${house}/social-channel-credentials.json`;
    positionHouse = usePositionHouse(house);
    await channelBindings.bind(POSITION_HOUSE, 'x', { neumaId: NEUMA_ID });
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);
    await ownLane(NEUMA_ID);
    intentsDir = path.join(workspace.pathFor(NEUMA_ID), 'intents');

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws) => {
        serverWs = ws;
        // The route's side of the chip: an operator answer settles the pending ask.
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

  afterAll(async () => {
    for (const k of X_ENV) { if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k]; }
    for (const k of SOCIAL_PATHS) {
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

  test('FAIL-CLOSED DEFAULT — a filed post waits on the operator card; DENY settles it denied', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'deny';

    await fileIntent('first-post', { type: 'social/post', channel: 'x', text: 'hello world' });
    const receipts = await sweep(connection, 'ask');

    expect(receipts[0].status).toBe('denied');
    expect(receipts[0].error).toBeTruthy();
    const request = await untilClient((m) => m.type === 'tool:approval_request');
    expect(request.tool).toBe('intents/social.post');
    expect(request.args).toContain('hello world'); // the operator reads the EXACT words before they go out
    expect(request.scope).toContain('publish to x NOW');
    expect((await readResult('first-post')).status).toBe('denied');
  }, 30000);

  test('OBSERVE MODE holds the post PENDING — watching is not a verdict', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = null; // no card should even be asked

    await fileIntent('held-post', { type: 'social/post', channel: 'x', text: 'held speech' });
    const receipts = await sweep(connection, 'observe');

    expect(receipts).toEqual([]);
    expect(await readResult('held-post')).toBeNull(); // pending, not denied
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('ALWAYS — the grant persists to the intents policy row; the next post skips the card', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'always';

    await fileIntent('always-post', { type: 'social/post', channel: 'x', text: 'first post' });
    const first = await sweep(connection, 'ask');
    // The gate passed; with no credentials the executor answers honestly —
    // a failed result, never a fake done.
    expect(first[0].status).toBe('error');
    expect(first[0].error).toContain('not configured');
    expect((await readResult('always-post')).status).toBe('failed');
    await untilClient((m) => m.type === 'tool:approval_request');

    // The grant landed on the being's own persisted policy (real disk).
    const persisted = await workspace.readToolPolicy(NEUMA_ID);
    expect(persisted.intents.allowed).toContain('social.post');

    // A second filing rides the standing grant — no card.
    clientLog.length = 0;
    decide = null;
    await fileIntent('always-post-two', { type: 'social/post', channel: 'x', text: 'second post' });
    const second = await sweep(connection, 'ask');
    expect(second[0].status).toBe('error'); // still honest about the missing credentials
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);

    await workspace.writeToolPolicy(NEUMA_ID, {});
  }, 30000);

  test('NO CROSS-ROUTING — a being that does not hold the channel is refused before any card', async () => {
    const connection = freshConnection({ companion: { name: 'Intruder', neumaId: 'someotherneuma' } });
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = null; // the operator must never even be asked

    await fileIntent('cross-route', { type: 'social/post', channel: 'x', text: 'not my channel' }, 'someotherneuma');
    const receipts = await sweep(connection, 'auto');

    expect(receipts[0].status).toBe('denied');
    expect(receipts[0].error).toContain('not yours to speak through');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('CALL-TIME BINDING — releasing the channel refuses the former holder on the very next intent', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = null;

    // The operator releases the channel; no socket is reopened. If the binding
    // were cached at socket open, the former holder could keep speaking.
    await channelBindings.unbind(POSITION_HOUSE, 'x');
    await fileIntent('after-release', { type: 'social/post', channel: 'x', text: 'after release' });
    const released = await sweep(connection, 'auto');
    expect(released[0].status).toBe('denied');
    expect(released[0].error).toContain('not yours to speak through');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);

    // Rebinding restores the lane just as live — read per act, both ways.
    // AUTO's protocol guard (182ca2f5f): outward speech pauses on the
    // operator's card even in AUTO — the rebound holder is ASKED first, and
    // only past the card does the honest no-credentials outcome answer.
    await channelBindings.bind(POSITION_HOUSE, 'x', { neumaId: NEUMA_ID });
    await fileIntent('after-rebind', { type: 'social/post', channel: 'x', text: 'after rebind' });
    decide = () => 'allow';
    const restored = await sweep(connection, 'auto');
    expect(clientLog.some((m) => m.type === 'tool:approval_request' && m.tool === 'intents/social.post')).toBe(true);
    expect(restored[0].status).toBe('error'); // past the standing rule, honest no-credentials outcome
    expect(restored[0].error).toContain('not configured');
  }, 30000);

  test('shape law — empty text settles invalid before any card or wire', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = null;

    await fileIntent('empty-post', { type: 'social/post', channel: 'x', text: '   ' });
    const receipts = await sweep(connection, 'ask');
    expect(receipts[0].status).toBe('error');
    expect(receipts[0].error).toContain('needs text');
    expect((await readResult('empty-post')).status).toBe('invalid');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);
});
