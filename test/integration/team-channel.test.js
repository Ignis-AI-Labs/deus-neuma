/**
 * The TEAM CHANNEL and the room it is read in (2026-10-12): members tell each
 * other what they need while they work.
 *
 * Founder: […] This proves it on the real path: the team/run intent with the
 * member turn wired as production wires it, each part a REAL
 * streamConsciousness turn over a real loopback OpenAI-wire provider (its
 * scripted answers carry the members' real tool calls), the REAL intent sweep
 * settling the member's team/post, the REAL sandbox, the real run store and
 * the real disk. No weights run here.
 *
 * Under proof:
 *  - a member's team/post joins the channel: on the run's record, in the team
 *    room's channel.md, on the operator's desk;
 *  - the next member is briefed on the room, and reads the post with its OWN
 *    file tools;
 *  - the room's board and finished parts are kept whole;
 *  - a member cannot write the room.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { startLocalProvider } from '../helpers/local-provider.js';

const WALLET = '0x7777777777777777777777777777777777777777';
const LEAD = 'room-lead';
const SCOUT = 'room-scout';
const BUILDER = 'room-builder';
const OFFER = 'The offer is a flat $499 migration, Datadog first.';

describe('the team channel — members speak, the room keeps it, the next member reads it with its own hands', () => {
  let provider, httpServer, wss, serverWs, client, clientLog, prevRealm, saved;
  let sweepIntents, setTeamRunSeams, setMemberTurn, readRun, setRealmRoot, setWorkspacesRoot, neumaWorkspace, arena;

  beforeAll(async () => {
    const root = await createTempDir('team-channel');
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
    for (const id of [LEAD, SCOUT, BUILDER]) {
      await neumaWorkspace.create(id);
      await writeOwner(path.dirname(neumaWorkspace.pathFor(id)), id, WALLET);
      await neumaWorkspace.writeDNA(id, { version: '1.0.0', identity: { name: id }, genesis: `# Essence\nI am ${id}.` });
    }
    arena = path.join(root, 'arena');
    const { connectFilesystemServer } = await import('../../backend/services/mcp-filesystem.js');
    await connectFilesystemServer();

    // One completion per round, in order (maxParallel 1 — the scout's part,
    // then the builder's): the scout posts to the builder through the act
    // channel, tries to write the room itself, then reports; the builder
    // reads the channel with its own hands, then reports.
    const call = (tool, args) => `[TOOL: ${tool} ${JSON.stringify(args)}]`;
    const room = path.join(arena, '.team');
    provider = await startLocalProvider({
      script: [
        { reply: call('fs/write', { path: path.join(neumaWorkspace.pathFor(SCOUT), 'intents', 'tell-builder.json'), content: JSON.stringify({ type: 'team/post', to: 'Builder', text: OFFER }) }) },
        { reply: call('fs/write', { path: path.join(room, 'channel.md'), content: 'rewritten by a member' }) },
        { reply: 'The offer is set and posted to the builder.\nSTATUS:\noffer set' },
        { reply: call('fs/read', { path: path.join(room, 'channel.md') }) },
        { reply: 'Built the page on the posted offer: $499 flat.\nSTATUS:\npage built' },
      ],
    });
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

  test('the scout posts to the builder; the room keeps it; the builder reads it with its own hands and builds on it', async () => {
    const connection = {
      ws: serverWs, companion: { name: 'Lead', neumaId: LEAD }, walletAddress: WALLET,
      _approvedPlan: Object.freeze({
        name: 'ROOM CREW', goal: 'Ship the offer page on the real offer.',
        workspace: Object.freeze({ root: arena, budgetBytes: 1024 * 1024 }),
        steps: Object.freeze([
          Object.freeze({ id: 'scout', neumaId: SCOUT, role: 'validation', task: 'set the offer', needs: Object.freeze([]) }),
          Object.freeze({ id: 'build', neumaId: BUILDER, role: 'production', task: 'write the offer page', needs: Object.freeze([]) }),
        ]),
        memberNames: Object.freeze({ [SCOUT]: 'Scout', [BUILDER]: 'Builder' }),
        approvedAt: new Date().toISOString(),
      }),
    };
    const dir = path.join(neumaWorkspace.pathFor(LEAD), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'room-run.json'), JSON.stringify({ type: 'team/run' }));
    let settled = null;
    setTeamRunSeams({ checkSubstrate: async () => true, getCapacity: async () => ({ maxParallel: 2 }), continueWaits: [20, 20, 20], onSettled: (p) => { settled = p; } });
    await sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: () => {} });
    setTeamRunSeams(null);
    const outcome = await settled;
    expect(outcome.status).toBe('done');

    // THE CHANNEL: on the record, in the room, on the operator's desk.
    const start = clientLog.find((m) => m.type === 'operator:team_start' && m.name === 'ROOM CREW');
    const record = await readRun(start.id, WALLET);
    expect(record.channel).toHaveLength(1);
    expect(record.channel[0]).toMatchObject({ from: 'Scout (scout)', fromStep: 'scout', to: 'Builder', toStep: 'build', text: OFFER });
    const sent = clientLog.find((m) => m.type === 'operator:team_message' && m.id === start.id);
    expect(sent.text).toBe(OFFER);
    const channelFile = await fs.readFile(path.join(arena, '.team', 'channel.md'), 'utf8');
    expect(channelFile).toContain(`Scout (scout) → Builder: ${OFFER}`);
    expect(channelFile).not.toContain('rewritten by a member'); // the member's write never landed

    // The scout's write into the room was refused by the sandbox, and said why.
    const refused = clientLog.find((m) => m.type === 'operator:team_tool' && m.stepId === 'scout' && /error|denied/i.test(m.status) && /team room/i.test(`${m.summary} ${m.detail}`));
    expect(refused).toBeTruthy();

    // THE NEXT MEMBER: briefed on the room, read the post with its own hands.
    const builderBrief = JSON.stringify(provider.turns[3].messages);
    expect(builderBrief).toContain("YOUR TEAM'S ROOM is");
    expect(builderBrief).toContain(path.join(arena, '.team'));
    const builderAfterRead = JSON.stringify(provider.turns[4].messages);
    expect(builderAfterRead).toContain(OFFER);
    expect(record.completed.build).toContain('$499 flat');

    // The room's board and the finished parts, whole.
    expect(await fs.readFile(path.join(arena, '.team', 'board.md'), 'utf8')).toMatch(/scout · Scout · validation · DONE/);
    expect(await fs.readFile(path.join(arena, '.team', 'parts', 'scout-scout.md'), 'utf8')).toContain('The offer is set and posted to the builder.');
  }, 120000);
});
