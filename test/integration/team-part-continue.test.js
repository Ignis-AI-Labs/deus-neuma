/**
 * A part works in ITS OWN SITTING and CONTINUES where it stopped (2026-10-12).
 *
 * Live that day, a lead's three parallel parts for one member began in the
 * same millisecond and wrote into ONE session, every working member was cut
 * at thirty minutes, and a resume would have asked each part again from
 * nothing. This proves the repair on the real path: the team/run intent with
 * the member turn wired as production wires it, each attempt a REAL
 * streamConsciousness turn over a real loopback OpenAI-wire provider (its
 * scripted answers — one of them a real HTTP refusal), the real run store and
 * the real encrypted workspace on disk. No weights run here; real models are
 * proven in team-run-house-live.test.js.
 *
 * Under proof:
 *  - parallel parts of ONE member get a sitting each, recorded on the run
 *    from their first moment;
 *  - an attempt that fails is CONTINUED by the run itself, in the part's own
 *    sitting — the brief rides the conversation, the note says why it
 *    stopped — and the part lands;
 *  - the part's work log holds every attempt, in order.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { startLocalProvider } from '../helpers/local-provider.js';

const WALLET = '0x6666666666666666666666666666666666666666';
const LEAD = 'sit-lead';
const MEMBER = 'sit-member';

describe('a part works in its own sitting and continues where it stopped — real turns, real disk', () => {
  let provider, httpServer, wss, serverWs, client, clientLog, prevRealm, saved;
  let sweepIntents, setTeamRunSeams, setMemberTurn, readRun, setRealmRoot, setWorkspacesRoot, neumaWorkspace, arena;

  beforeAll(async () => {
    const root = await createTempDir('team-part-continue');
    saved = { ...process.env };
    process.env.WORKSPACES_ROOT = path.join(root, 'workspaces');
    process.env.NEUMA_ROUTES_PATH = path.join(root, 'routes.json');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'credentials.json');
    process.env.NEUMA_TEAM_RUN_PATH = path.join(root, 'runs');
    process.env.NEUMA_TEAM_DELIVERY_PATH = path.join(root, 'deliveries');
    process.env.NEUMA_STAFF_COS_PATH = path.join(root, 'staff-cos.json');
    process.env.NEUMA_CMO_PATH = path.join(root, 'cmo.json');
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    const realm = await import('../../backend/services/user-realm.js');
    setRealmRoot = realm.setRealmRoot;
    prevRealm = realm.getRealmRoot();
    setRealmRoot(path.join(root, 'realm'));
    const ws = await import('../../core/workspace/neuma-workspace.js');
    setWorkspacesRoot = ws.setWorkspacesRoot;
    neumaWorkspace = ws.default;
    setWorkspacesRoot(process.env.WORKSPACES_ROOT);
    const { writeOwner } = await import('../helpers/audit-auth.js');
    for (const id of [LEAD, MEMBER]) {
      await neumaWorkspace.create(id);
      await writeOwner(path.dirname(neumaWorkspace.pathFor(id)), id, WALLET);
      await neumaWorkspace.writeDNA(id, { version: '1.0.0', identity: { name: id }, genesis: `# Essence\nI am ${id}.` });
    }
    arena = path.join(root, 'arena');
    const { connectFilesystemServer } = await import('../../backend/services/mcp-filesystem.js');
    await connectFilesystemServer();
    provider = await startLocalProvider({ reply: 'the part\nSTATUS:\ndone' });
    const { setConfig } = await import('../../backend/services/llm-provider.js');
    setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '' });

    ({ sweepIntents } = await import('../../backend/services/intents/intent-sweep.js'));
    ({ setTeamRunSeams, setMemberTurn } = await import('../../backend/services/intents/team-run.js'));
    const { runMemberTurn } = await import('../../backend/services/team-member-turn.js');
    setMemberTurn(runMemberTurn); // exactly as team-live-routes.js wires it
    ({ readRun } = await import('../../backend/services/team-run-store.js'));

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((r) => httpServer.listen(0, () => r(httpServer.address().port)));
    const linked = new Promise((r) => { wss.on('connection', (s) => { serverWs = s; r(); }); });
    client = new WebSocket(`ws://localhost:${port}`);
    clientLog = [];
    client.on('message', (d) => clientLog.push(JSON.parse(d.toString())));
    await linked;
  }, 60000);

  afterAll(async () => {
    setTeamRunSeams?.(null);
    setWorkspacesRoot?.(null);
    setRealmRoot?.(prevRealm);
    client?.close();
    wss?.close();
    httpServer?.close();
    await provider?.close();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  // File and run a plan through the REAL sweep; the member turn is wired, so
  // only the rig's seams are set. Resolves to the settled run and its record.
  const runPlan = async (name, steps, { maxParallel = 1 } = {}) => {
    const connection = {
      ws: serverWs, companion: { name: 'Lead', neumaId: LEAD }, walletAddress: WALLET,
      _approvedPlan: Object.freeze({
        name, goal: 'Prove a part keeps its own sitting.',
        workspace: Object.freeze({ root: arena, budgetBytes: 1024 * 1024 }),
        steps: Object.freeze(steps.map((s) => Object.freeze({ ...s, neumaId: MEMBER, needs: Object.freeze([]) }))),
        memberNames: Object.freeze({ [MEMBER]: 'Member' }),
        approvedAt: new Date().toISOString(),
      }),
    };
    const dir = path.join(neumaWorkspace.pathFor(LEAD), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ type: 'team/run' }));
    let settled = null;
    setTeamRunSeams({
      checkSubstrate: async () => true, getCapacity: async () => ({ maxParallel }),
      continueWaits: [20, 20, 20], onSettled: (p) => { settled = p; },
    });
    await sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: () => {} });
    setTeamRunSeams(null);
    const outcome = await settled;
    const start = clientLog.find((m) => m.type === 'operator:team_start' && m.name === name);
    return { outcome, record: await readRun(start.id, WALLET) };
  };

  test('three parallel parts of ONE member: three sittings, each holding its own brief — recorded on the run', async () => {
    provider.setScript([{ reply: 'the part\nSTATUS:\ndone' }]);
    const { outcome, record } = await runPlan('three-at-once', [
      { id: 'p1', task: 'map the first gap' },
      { id: 'p2', task: 'map the second gap' },
      { id: 'p3', task: 'map the third gap' },
    ], { maxParallel: 4 });
    expect(outcome.status).toBe('done');
    const sittings = ['p1', 'p2', 'p3'].map((id) => record.sessions?.[id]);
    expect(sittings.every(Boolean)).toBe(true);
    expect(new Set(sittings).size).toBe(3);
    for (const [i, id] of ['first', 'second', 'third'].entries()) {
      const rows = await neumaWorkspace.readSession(MEMBER, sittings[i]);
      const asks = rows.filter((r) => r.role === 'user');
      expect(asks).toHaveLength(1);
      expect(asks[0].content).toContain(`map the ${id} gap`);
    }
  }, 120000);

  test('an attempt the server refuses is CONTINUED in the part\'s own sitting — told why — and the part lands; its log holds both attempts', async () => {
    provider.setScript([
      { status: 400, errorMessage: 'the model server refused the first attempt' },
      { reply: 'Picked up where I stopped: the gap is mapped.\nSTATUS:\nmapped' },
    ]);
    clientLog.length = 0;
    const { outcome, record } = await runPlan('refused-once', [{ id: 'map', task: 'map the gap end to end' }]);
    expect(outcome.status).toBe('done');
    expect(record.completed.map).toBe('Picked up where I stopped: the gap is mapped.');

    // The run answered the refusal itself — the operator saw it happen.
    const retry = clientLog.find((m) => m.type === 'operator:team_retry' && m.stepId === 'map');
    expect(retry.kind).toBe('failed');
    expect(retry.why).toContain('refused the first attempt');

    // ONE sitting: the continuation rode the same conversation — the second
    // request carries the brief from the sitting, then the note.
    expect(provider.turns).toHaveLength(2);
    const sent = JSON.stringify(provider.turns[1].messages);
    expect(sent).toContain('map the gap end to end');
    expect(sent).toContain('YOUR PART CONTINUES. Your part stopped before you finished');
    const rows = await neumaWorkspace.readSession(MEMBER, record.sessions.map);
    expect(rows.filter((r) => r.role === 'user').map((r) => r.content.slice(0, 40))).toEqual([
      expect.stringContaining('Your team lead Lead briefs you'),
      expect.stringContaining('YOUR PART CONTINUES'),
    ]);

    // The part's work log, in the member's own lane: both attempts, in order.
    const logged = await neumaWorkspace.readTeamLog(MEMBER, record.id, 'map');
    const shape = logged.filter((e) => ['open', 'end', 'retry'].includes(e.kind)).map((e) => [e.kind, e.how ?? e.outcome ?? null]);
    expect(shape).toEqual([['open', 'brief'], ['end', 'failed'], ['retry', null], ['open', 'failed'], ['end', 'answered']]);
    expect(logged.some((e) => e.kind === 'words' && e.text.includes('the gap is mapped'))).toBe(true);
  }, 120000);
});
