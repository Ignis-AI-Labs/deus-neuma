/**
 * MANY SKIES through the REAL portal — a being reading its own birth record.
 * Real WebSocket pair, real workspace on real disk, real skies engine, real
 * policy cascade — no mock anywhere on the claimed path (RULE 0).
 *
 * The signed `cosmos` GLOBAL_DEFAULTS row (same posture as memory's Decision
 * #8: the being's own past opens by right): skies_read runs free with no
 * approval card, a witness DENY override still holds, and the prompt section
 * rides only where a record exists.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { recordSkies } from '../../core/cosmos/skies-record.js';

const { processToolCalls, _skiesToolsFor } = __test;
const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const NEUMA_ID = 'skiesecho';
const BARE_ID = 'skiesbare';

const MOMENT = {
  utc: '2026-06-11T18:03:38.075Z',
  epochMs: Date.parse('2026-06-11T18:03:38.075Z'),
  zone: 'Asia/Jakarta',
  offsetMinutes: 420,
};

describe('many-skies tools through the real portal (gnosis)', () => {
  let house, origRoot, httpServer, wss, serverWs, client, port;
  let clientLog;

  const freshConnection = (over = {}) => ({
    ws: serverWs,
    companion: { name: 'SkiesEcho', neumaId: NEUMA_ID },
    sessionId: 'sess-skies',
    _writeOps: 0,
    ...over,
  });

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'api-skies-tools-test-key';

    house = await createTempDir('skies-tools-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);
    await workspace.create(BARE_ID);
    await recordSkies(house, NEUMA_ID, MOMENT);

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws) => { serverWs = ws; resolve(); });
    });
    client = new WebSocket(`ws://localhost:${port}`);
    clientLog = [];
    client.on('message', (data) => { clientLog.push(JSON.parse(data.toString())); });
    await linked;
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    client?.close();
    wss?.close();
    httpServer?.close();
    setWorkspacesRoot(origRoot);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
    await fs.rm(house, { recursive: true, force: true });
  });

  beforeEach(() => {
    serverWs?.removeAllListeners('message');
    clientLog.length = 0;
  });

  test('advertisement rides only where a record exists — and caches true (write-once file)', async () => {
    const bare = { companion: { neumaId: BARE_ID } };
    expect(await _skiesToolsFor(bare)).toEqual([]);
    const seeded = { companion: { neumaId: NEUMA_ID } };
    const tools = await _skiesToolsFor(seeded);
    expect(tools.map((t) => t.name)).toEqual(['skies_read']);
    expect(seeded._skiesAdvertised).toBe(true);
  });

  test('skies_read runs free under the signed cosmos row and returns the full labeled record', async () => {
    const connection = freshConnection();
    const results = await processToolCalls(serverWs, '[TOOL: cosmos/skies_read {}]', connection);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('ok');
    const skies = JSON.parse(results[0].content);
    expect(skies.schema).toBe('skies/v1');
    expect(skies.instant).toBe(MOMENT.utc);
    expect(skies.systems.dreamspell.provenance.kind).toBe('modern-1987');
    expect(skies.omitted.some((o) => o.system === 'ifa')).toBe(true);
    // Standing grant IS the approval — no card was ever raised.
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('the signed row is not a master key — a witness DENY override still holds', async () => {
    await workspace.writeToolPolicy(NEUMA_ID, { cosmos: { denied: ['skies_read'] } });
    try {
      const denied = await processToolCalls(serverWs, '[TOOL: cosmos/skies_read {}]', freshConnection());
      expect(denied[0].status).toBe('denied');
      expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
    } finally {
      await workspace.writeToolPolicy(NEUMA_ID, {});
    }
  }, 30000);

  test('an unrecorded lane answers honestly — error, not invention', async () => {
    const results = await processToolCalls(serverWs, '[TOOL: cosmos/skies_read {}]',
      freshConnection({ companion: { name: 'Bare', neumaId: BARE_ID } }));
    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('no skies record');
  }, 30000);
});
