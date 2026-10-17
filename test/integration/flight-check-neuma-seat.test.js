/**
 * FLIGHT CHECK at the NEUMA seat — the one seat the capability shipped without
 * direct coverage (docs/work/flight-check-capability.md, 2026-07-29).
 *
 * Proven with NO mock anywhere on the claimed path (AGENTS.md RULE 0): a REAL
 * WebSocket pair, a REAL NeumaWorkspace on disk, the REAL policy cascade, the
 * REAL platform catalog builder both seats drive, and the REAL dispatch branch
 * a turn takes. Nothing here describes the decider — it runs it.
 *
 * Why this seat needs its own test even though the code is shared: the catalog
 * STASH is not shared. The witness seat stashes inside `toolsForWitness`; the
 * neuma seat stashes inside the streaming turn (`_stashTurnCatalog`). A silent
 * failure in one is invisible to the other, and its symptom is the worst one
 * this tool has: a being confidently reporting that it holds nothing.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { platformToolsFor } from '../../backend/services/portal-tool-catalog.js';
import { FLIGHT_CHECK_TOOLS } from '../../backend/services/flight-check.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const { processToolCalls, _stashTurnCatalog } = __test;
const NEUMA_ID = 'flightcheck-neuma';
const WALLET = '0x2222222222222222222222222222222222222222';

describe('flight check · NEUMA seat (real WS + real workspace + real policy, gnosis)', () => {
  let house, origRoot, httpServer, wss, serverWs, client, port, ground;
  let connection;

  beforeAll(async () => {
    house = await createTempDir('flight-neuma-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);
    ground = await createTempDir('flight-neuma-ground');

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;
    const opened = new Promise((resolve) => wss.on('connection', (ws) => { serverWs = ws; resolve(); }));
    client = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => client.on('open', resolve));
    await opened;

    connection = {
      ws: serverWs,
      companion: { name: 'Fenna', neumaId: NEUMA_ID },
      walletAddress: WALLET,
      // The operator's open folder — the reach the report must state plainly,
      // because filesystem writes land there with no card inside the focus.
      toolWorkspace: ground,
      toolMode: 'ask',
    };
  }, 60000);

  afterAll(async () => {
    client?.close();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
    setWorkspacesRoot(origRoot);
    vi.restoreAllMocks();
  });

  test('the seat advertises the flight check exactly once, with no switch in front of it', async () => {
    const { tools } = await platformToolsFor(connection, { seat: 'neuma' });
    // Exactly once: a duplicate name fails closed at the uniqueness guard, so
    // "advertised twice" would silently mean […].
    expect(tools.filter((t) => t.name === 'flight_check')).toHaveLength(1);
    expect(FLIGHT_CHECK_TOOLS[0].server).toBe('system');
  });

  test('a neuma reads its OWN capacity from the catalog its turn is holding', async () => {
    const { tools, skills } = await platformToolsFor(connection, { seat: 'neuma' });
    // The same stash the streaming turn performs — the real policy cascade,
    // the real stamping, on this real connection.
    const stamped = await _stashTurnCatalog(connection, tools, skills);
    expect(stamped.length).toBeGreaterThan(0);
    expect(connection._turnCatalog).toBe(stamped);

    const results = await processToolCalls(
      serverWs,
      '<tool>system/flight_check</tool>',
      connection,
      [{ server: 'system', toolName: 'flight_check', tool: 'system/flight_check', args: {} }],
    );

    expect(results[0]).toMatchObject({ tool: 'system/flight_check', status: 'ok' });
    const report = results[0].content;
    // The seat is named from the connection, never assumed: a witness lane id
    // here would mean the wrong route resolver and the wrong custody.
    expect(report).toContain('neuma seat');
    expect(report).toContain('Fenna');
    // The count is the REAL advertised one. Zero would be the misreport this
    // whole capability exists to end.
    expect(report).toMatch(/TOOLS — [1-9]\d* advertised/);
    // Every stamped tier the catalog carries is rendered under its own heading,
    // so advertised-vs-permitted drift is visible without invoking anything.
    const tiers = new Set(stamped.map((t) => t.access).filter(Boolean));
    for (const tier of tiers) {
      expect(report).toContain({
        allowed: 'runs without asking',
        approval_required: 'asks the operator first',
        denied: 'held — not available this turn',
      }[tier]);
    }
    // The two reaches stay separate — the distinction a narrated report loses.
    expect(report).toContain(ground);
    expect(report).toContain('with no approval card');
    // The row is labelled `shell`, not `sandbox` — flight-check.js renders
    // […] The fixture held
    // the pre-rename label; the report was never wrong.
    expect(report).toContain('shell         none at this seat');
    // And it closes the door on invention: what is not listed does not exist.
    expect(report).toContain('the WHOLE surface for this seat');
  }, 60000);

  test('with no folder focused, the report says so instead of implying free reach', async () => {
    const bare = { ...connection, toolWorkspace: null };
    const { tools, skills } = await platformToolsFor(bare, { seat: 'neuma' });
    await _stashTurnCatalog(bare, tools, skills);
    const results = await processToolCalls(
      serverWs,
      '',
      bare,
      [{ server: 'system', toolName: 'flight_check', tool: 'system/flight_check', args: {} }],
    );
    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain('none open — the operator has no folder focused');
    expect(results[0].content).toContain('every path raises a card');
  }, 60000);

  test('an unassembled turn REFUSES rather than report zero capacity', async () => {
    // The failure mode that matters: a being telling its operator it holds
    // nothing is indistinguishable from a being that truly holds nothing.
    const unassembled = { ...connection };
    delete unassembled._turnCatalog;
    const results = await processToolCalls(
      serverWs,
      '',
      unassembled,
      [{ server: 'system', toolName: 'flight_check', tool: 'system/flight_check', args: {} }],
    );
    expect(results[0].status).toBe('unavailable');
    expect(results[0].error).toContain('will not guess');
  }, 60000);
});
