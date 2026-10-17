/**
 * Lead tools governance gate — the being's window onto the house lead
 * ledger, proven end to end with NO mock on the claimed path (RULE 0): REAL
 * WebSocket pair, REAL policy cascade, REAL approval flow, REAL ledger store
 * on real temp disk.
 *
 * The ledger is house work state shared across the team, so unlike the
 * social channels there is no single-holder gate — the laws under test are
 * the fail-closed ACTS default, the per-tool grant rows, and the append-only
 * touch record (every move carries who made it; handoffs are never silent).
 *
 * THE CATALOG CUT (#414): `lead_add` and `lead_touch` are the `leads/*`
 * intents now, so every act below is FILED and settled by the real sweep —
 * the same broker raises the same chip, on the intent's own policy row. Only
 * `lead_list` is still a tool: its prompt replacement is the CMO briefing,
 * which renders for the CMO office alone.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { viaIntent, fileIntent, sweep, settled } from '../helpers/intent-path.js';
import { retiredToolHint } from '../../backend/services/intents/retired-tools.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const { _handleLeadTool, _isLeadTool, LEAD_TOOLS } = __test;
const NEUMA_ID = 'leadgateecho';
// The house the connection belongs to — its ledger is the one every act lands in.
const WALLET = `0x${'e'.repeat(40)}`;
const priorRealm = getRealmRoot();
const ledger = () => leadLedgerFor(WALLET);

describe('lead tools gate (real WS + real policy cascade + real ledger disk, gnosis)', () => {
  let house, origRoot, httpServer, wss, serverWs, client, port;
  let clientLog;
  let decide = null; // armed per test — the witness's chip answer
  let savedPath;

  const freshConnection = () => ({
    ws: serverWs,
    walletAddress: WALLET,
    companion: { name: 'LeadGateEcho', neumaId: NEUMA_ID },
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
    house = await createTempDir('lead-tools-gate-house');
    savedPath = process.env.NEUMA_LEAD_LEDGER_PATH;
    process.env.NEUMA_LEAD_LEDGER_PATH = `${house}/lead-ledger.json`;
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    setRealmRoot(`${house}/realm`);
    await workspace.create(NEUMA_ID);

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

  afterAll(async () => {
    if (savedPath === undefined) delete process.env.NEUMA_LEAD_LEDGER_PATH;
    else process.env.NEUMA_LEAD_LEDGER_PATH = savedPath;
    vi.restoreAllMocks();
    client?.close();
    wss?.close();
    httpServer?.close();
    setWorkspacesRoot(origRoot);
    setRealmRoot(priorRealm);
    await fs.rm(house, { recursive: true, force: true });
  });

  test('only the READ is advertised — the two acts left with the catalog cut', () => {
    expect(LEAD_TOOLS.map((t) => t.name)).toEqual(['lead_list']);
    for (const t of LEAD_TOOLS) {
      expect(Object.isFrozen(t)).toBe(true);
      expect(t.server).toBe('leads');
    }
    expect(_isLeadTool({ toolName: 'lead_list' })).toBe(true);
    expect(_isLeadTool({ tool: 'leads/lead_list' })).toBe(true);
    expect(_isLeadTool({ tool: 'tasks/task_list' })).toBe(false);

    // THE CUT: neither act dispatches any more, so neither can fail
    // `checkToolAccess` closed into a card nobody asked for — and a stale call
    // from an old plan is handed the intent it should file instead.
    for (const retired of ['lead_add', 'lead_touch']) {
      expect(_isLeadTool({ toolName: retired }), `${retired} still dispatches`).toBe(false);
      expect(_isLeadTool({ tool: `leads/${retired}` }), `${retired} still dispatches`).toBe(false);
      expect(retiredToolHint(retired)).toContain(`leads/${retired.replace('lead_', '')}`);
    }
  });

  test('FAIL-CLOSED DEFAULT — a capture waits on the witness chip; DENY leaves the ledger empty', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'deny';

    const [result] = await viaIntent(connection, 'leads/add', { name: 'Ada Artisan', contact: '@ada' }, 'ask');

    expect(result.status).toBe('denied');
    const request = await untilClient((m) => m.type === 'tool:approval_request');
    expect(request.tool).toBe('intents/leads.add');
    expect(await (await ledger()).load()).toEqual([]);
  }, 30000);

  test('ALLOW — the capture lands on the REAL ledger under the being\'s own name, held by them', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'allow';

    const [result] = await viaIntent(connection, 'leads/add',
      { name: 'Ada Artisan', contact: '@ada', channelId: 'x', source: 'porch thread reply' }, 'ask');

    expect(result.status).toBe('ok');
    expect(result.content).toContain('yours to work');
    const [lead] = await (await ledger()).load();
    expect(lead).toMatchObject({
      name: 'Ada Artisan', channelId: 'x', status: 'cold',
      ownerNeumaId: NEUMA_ID,
    });
    expect(lead.touches[0].by).toBe(NEUMA_ID);
  }, 30000);

  test('ALWAYS — the grant persists on the leads/lead_add row; the next capture skips the chip', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'always';

    const [first] = await viaIntent(connection, 'leads/add', { name: 'Brin Builder' }, 'ask');
    expect(first.status).toBe('ok');
    await untilClient((m) => m.type === 'tool:approval_request');

    // The grant lands on the INTENT's own row, which is where the act lives now.
    const persisted = await workspace.readToolPolicy(NEUMA_ID);
    expect(persisted.intents.allowed).toContain('leads.add');

    clientLog.length = 0;
    decide = null;
    const [second] = await viaIntent(connection, 'leads/add', { name: 'Cyra Curator' }, 'ask',
      persisted);
    expect(second.status).toBe('ok');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('TOUCH by prefix id — status, note, and a HANDOFF all land as one recorded touch', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    const leads = await (await ledger()).load();
    const ada = leads.find((l) => l.name === 'Ada Artisan');

    const [result] = await viaIntent(connection, 'leads/touch',
      { id: ada.id.slice(0, 8), status: 'contacted', note: 'sent the first thread', ownerNeumaId: 'keir' },
      'auto');

    expect(result.status).toBe('ok');
    expect(result.content).toContain('held by keir');
    const updated = (await (await ledger()).load()).find((l) => l.id === ada.id);
    expect(updated.status).toBe('contacted');
    expect(updated.ownerNeumaId).toBe('keir');
    const touch = updated.touches[updated.touches.length - 1];
    expect(touch).toMatchObject({
      by: NEUMA_ID, status: 'contacted',
      ownerFrom: NEUMA_ID, ownerTo: 'keir',
      note: 'sent the first thread',
    });
  }, 30000);

  test('a prefix that matches nothing refuses honestly — nothing is touched', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    const before = await (await ledger()).load();
    const [result] = await viaIntent(connection, 'leads/touch', { id: 'zzzz', status: 'won' }, 'auto');
    expect(result.status).toBe('error');
    expect(result.error).toContain('no such lead');
    expect(await (await ledger()).load()).toEqual(before);
  }, 30000);

  test('an ambiguous prefix refuses honestly — the being is told to use more of the id', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;

    // Ids are random hex, so ambiguity cannot be staged — but 16 possible
    // first characters mean capture-until-collision MUST land within 17
    // captures (pigeonhole), every one through the real tool and real disk.
    const sharedFirstChar = async () => {
      const ids = (await (await ledger()).load()).map((l) => l.id);
      return [...new Set(ids.map((id) => id[0]))]
        .find((ch) => ids.filter((id) => id[0] === ch).length > 1) || null;
    };
    let shared = await sharedFirstChar();
    for (let i = 0; shared === null && i < 17; i += 1) {
      const [added] = await viaIntent(connection, 'leads/add', { name: `Pigeon ${i}` }, 'auto');
      expect(added.status).toBe('ok');
      shared = await sharedFirstChar();
    }
    expect(shared).not.toBeNull();

    const before = await (await ledger()).load();
    const [result] = await viaIntent(connection, 'leads/touch', { id: shared, status: 'won' }, 'auto');
    expect(result.status).toBe('error');
    expect(result.error).toContain('matches several leads');
    expect(await (await ledger()).load()).toEqual(before);
  }, 30000);

  test('LIST — the being reads the real board, holders and last notes included', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    const result = await _handleLeadTool(serverWs, connection, null, 'auto', { toolName: 'lead_list' }, {});
    expect(result.status).toBe('ok');
    expect(result.content).toContain('Ada Artisan');
    expect(result.content).toContain('held by keir');
    expect(result.content).toContain('sent the first thread');
  }, 30000);

  test('OBSERVE holds the READ as a verdict and the ACT as a hold — they differ', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = null;

    // The TOOL is judged: observe refuses it and says so.
    const result = await _handleLeadTool(serverWs, connection, null, 'observe',
      { toolName: 'lead_list' }, {});
    expect(result.status).toBe('denied');
    expect(result.error).toContain('observe');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);

    // The ACT is not judged at all: no receipt, the filing stays PENDING, and
    // nothing reaches the ledger. Watching is not a verdict.
    const before = await (await ledger()).load();
    await fileIntent(connection, 'leads/add', { name: 'Watched Only' });
    expect(await sweep(connection, 'observe')).toEqual([]);
    expect(await settled(connection), 'observe wrote the act off instead of holding it').toBe(false);
    expect(await (await ledger()).load()).toEqual(before);
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);

    // …and that SAME pending filing lands under a mode that can judge it.
    const acted = await sweep(connection, 'auto');
    expect(acted).toHaveLength(1);
    expect(acted[0].status).toBe('ok');
    expect((await (await ledger()).load()).some((l) => l.name === 'Watched Only')).toBe(true);
  }, 30000);

  test('INTERRUPTED — a barge-in that landed before the write holds it; nothing lands on the ledger', async () => {
    const controller = new AbortController();
    controller.abort();
    const connection = {
      ws: serverWs,
      walletAddress: WALLET,
      companion: { name: 'LeadGateEcho', neumaId: NEUMA_ID },
      activeTurn: { signal: controller.signal },
    };
    serverWs.__connection = connection;
    const before = await (await ledger()).load();

    // An aborted turn yields NO receipt at all — the sweep leaves the filing
    // pending rather than acting after the operator barged in.
    expect(await viaIntent(connection, 'leads/add', { name: 'Interrupted Lead' }, 'auto')).toEqual([]);
    expect(await (await ledger()).load()).toEqual(before);
  }, 30000);

  test('no sovereign workspace on the connection — refused before the ledger', async () => {
    const connection = { ws: serverWs, companion: { name: 'ghost', neumaId: null } };
    serverWs.__connection = connection;
    const before = await (await ledger()).load();

    // The READ still refuses in words.
    const read = await _handleLeadTool(serverWs, connection, null, 'auto',
      { toolName: 'lead_list' }, {});
    expect(read.status).toBe('error');
    expect(read.error).toContain('no sovereign workspace');

    // The ACT has nowhere to be filed — a lane is where intents live — so the
    // sweep has nothing to settle and the ledger is untouched.
    expect(await sweep(connection, 'auto')).toEqual([]);
    expect(await (await ledger()).load()).toEqual(before);
  }, 30000);
});
