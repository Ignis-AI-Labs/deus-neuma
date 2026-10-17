/**
 * Team members work with their OWN HANDS (Design note, 2026-10-10: member tools are
 * in this campaign), on the real path: the team/run intent with the member
 * turn wired as production wires it (setMemberTurn(runMemberTurn)), each step
 * a REAL streamConsciousness turn on a synthetic portal connection — real
 * prompt assembly, real tool dispatch, the REAL sandbox, the REAL filesystem
 * organ on REAL disk — over a real loopback OpenAI-wire provider whose
 * scripted replies carry the tool calls (no weights run here; real models
 * are proven in team-run-house-live.test.js).
 *
 * Under proof:
 *  - a member's fs/write lands INSIDE the team arena, on disk;
 *  - a write outside the arena is refused by the sandbox;
 *  - a part that NAMES a file it never wrote FAILS, and the step that
 *    depends on it never starts — "done" is the platform's check, not the
 *    member's word;
 *  - an act that needs the operator's approval is refused at once with the
 *    member's reason — the turn never hangs on a card nobody sees;
 *  - each member's step is a real session in its own lane (its transcript).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { startLocalProvider } from '../helpers/local-provider.js';

const WALLET = '0x5555555555555555555555555555555555555555';
const LEAD = 'hands-lead';
const SCRIBE = 'hands-scribe';
const BOASTER = 'hands-boaster';

describe('team members work with their own hands — real turns, real sandbox, real disk', () => {
  let provider, httpServer, wss, serverWs, client, clientLog, prevRealm, saved;
  let sweepIntents, setTeamRunSeams, setMemberTurn, readRun, setRealmRoot, setWorkspacesRoot, neumaWorkspace, arena, outside;

  beforeAll(async () => {
    const root = await createTempDir('team-member-tools');
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
    for (const id of [LEAD, SCRIBE, BOASTER]) {
      await neumaWorkspace.create(id);
      await writeOwner(path.dirname(neumaWorkspace.pathFor(id)), id, WALLET);
      await neumaWorkspace.writeDNA(id, { version: '1.0.0', identity: { name: id }, genesis: `# Essence\nI am ${id}.` });
    }
    arena = path.join(root, 'arena');
    outside = path.join(neumaWorkspace.pathFor(SCRIBE), 'escaped.md');
    const { connectFilesystemServer } = await import('../../backend/services/mcp-filesystem.js');
    await connectFilesystemServer();

    // One completion per turn round, in order (maxParallel 1): the scribe
    // writes inside the arena, tries outside, then reports; the boaster
    // claims a file it never wrote; the scribe's second step tries a delete.
    const call = (tool, args) => `[TOOL: ${tool} ${JSON.stringify(args)}]`;
    provider = await startLocalProvider({
      script: [
        { reply: call('fs/write', { path: path.join(arena, 'scribe.md'), content: 'THE SCRIBE WROTE THIS' }) },
        { reply: call('fs/write', { path: outside, content: 'should never land' }) },
        { reply: 'I wrote scribe.md in the arena.\nSTATUS:\nnotes written' },
        { reply: 'I wrote boast.md, it is all done.\nSTATUS:\ndone' },
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

  test('a real write lands in the arena; a write outside is refused; a claimed file that is not there FAILS the part', async () => {
    const connection = {
      ws: serverWs,
      companion: { name: 'Lead', neumaId: LEAD },
      walletAddress: WALLET,
      _approvedPlan: Object.freeze({
        name: 'HANDS CREW',
        goal: 'Prove members write their own work, and only where they may.',
        workspace: Object.freeze({ root: arena, budgetBytes: 1024 * 1024 }),
        steps: Object.freeze([
          Object.freeze({ id: 'write', neumaId: SCRIBE, task: 'write the notes', files: Object.freeze(['scribe.md']), needs: Object.freeze([]) }),
          Object.freeze({ id: 'boast', neumaId: BOASTER, task: 'write your notes', files: Object.freeze(['boast.md']), needs: Object.freeze(['write']) }),
          Object.freeze({ id: 'after', neumaId: SCRIBE, task: 'build on the boast', needs: Object.freeze(['boast']) }),
        ]),
        memberNames: Object.freeze({ [SCRIBE]: 'Scribe', [BOASTER]: 'Boaster' }),
        approvedAt: new Date().toISOString(),
      }),
    };
    const dir = path.join(neumaWorkspace.pathFor(LEAD), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'hands-run.json'), JSON.stringify({ type: 'team/run' }));
    let settled = null;
    setTeamRunSeams({ checkSubstrate: async () => true, getCapacity: async () => ({ maxParallel: 1 }), onSettled: (p) => { settled = p; } });
    await sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: () => {} });
    // The member turn is wired; only the rig seams are set — so the members
    // ran as real turns, not through a scripted conduit.
    setTeamRunSeams(null);
    const outcome = await settled;

    // ON DISK: the scribe's write landed inside the arena; the escape did not.
    expect(await fs.readFile(path.join(arena, 'scribe.md'), 'utf8')).toBe('THE SCRIBE WROTE THIS');
    await expect(fs.access(outside)).rejects.toThrow();

    // The boaster's claimed file is not there — its part FAILED on the
    // platform's check, and the step built on it never started.
    expect(outcome.status).toBe('failed');
    const report = await fs.readFile(outcome.report, 'utf8');
    expect(report).toContain('boast (Boaster): FAILED — boast named files that are missing or empty in the team workspace: boast.md');
    expect(report).toContain('after: NEVER STARTED');
    expect(report).toContain('I wrote scribe.md in the arena.');

    // The operator watched the hands move: tool events per member, live.
    const tools = clientLog.filter((m) => m.type === 'operator:team_tool' && m.stepId === 'write');
    expect(tools.some((t) => /fs.*write/.test(t.tool) && /ok|success|done/i.test(t.status))).toBe(true);
    expect(tools.some((t) => /error|denied|refused/i.test(t.status))).toBe(true);

    // Each member's step is a real session in its own lane — its transcript.
    const part = clientLog.find((m) => m.type === 'operator:team_part' && m.stepId === 'write');
    expect(part.sessionId).toBeTruthy();
    const transcript = await neumaWorkspace.readSession(SCRIBE, part.sessionId);
    expect(JSON.stringify(transcript)).toContain('Your team lead Lead briefs you');

    const record = await readRun(outcome.report.split('/').pop().replace(/\.md$/, ''), WALLET);
    expect(record.status).toBe('failed');
  }, 120000);

  test('an answer written beside the tool call and repeated after it reaches the record ONCE', async () => {
    const call = (tool, args) => `[TOOL: ${tool} ${JSON.stringify(args)}]`;
    provider.setScript([
      { reply: `The arena holds the proof.\n${call('fs/write', { path: path.join(arena, 'once.md'), content: 'proof' })}` },
      { reply: 'The arena holds the proof.\nSTATUS:\n- once.md written' },
    ]);
    const connection = {
      ws: serverWs, companion: { name: 'Lead', neumaId: LEAD }, walletAddress: WALLET,
      _approvedPlan: Object.freeze({
        name: 'ONCE CREW', goal: 'Say it once.',
        workspace: Object.freeze({ root: arena, budgetBytes: 1024 * 1024 }),
        steps: Object.freeze([Object.freeze({ id: 'once', neumaId: SCRIBE, task: 'write once.md', files: Object.freeze(['once.md']), needs: Object.freeze([]) })]),
        memberNames: Object.freeze({ [SCRIBE]: 'Scribe' }),
        approvedAt: new Date().toISOString(),
      }),
    };
    const dir = path.join(neumaWorkspace.pathFor(LEAD), 'intents');
    await fs.writeFile(path.join(dir, 'once-run.json'), JSON.stringify({ type: 'team/run' }));
    let settled = null;
    setTeamRunSeams({ checkSubstrate: async () => true, getCapacity: async () => ({ maxParallel: 1 }), onSettled: (p) => { settled = p; } });
    await sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: () => {} });
    setTeamRunSeams(null);
    const outcome = await settled;
    expect(outcome.status).toBe('done');
    const part = clientLog.find((m) => m.type === 'operator:team_part' && m.stepId === 'once').output;
    expect(part).toBe('The arena holds the proof.');
  }, 120000);

  test('a member settles only the intents it files — the act its being filed in its own chat stays the being\'s', async () => {
    const call = (tool, args) => `[TOOL: ${tool} ${JSON.stringify(args)}]`;
    const own = path.join(neumaWorkspace.pathFor(SCRIBE), 'intents');
    await fs.mkdir(own, { recursive: true });
    // Filed by the scribe in its OWN chat a moment ago — in a live desk its
    // card would be waiting on the operator, who never got to answer it.
    await fs.writeFile(path.join(own, 'chat-act.json'), JSON.stringify({ type: 'nonesuch/act' }));
    provider.setScript([
      { reply: call('fs/write', { path: path.join(own, 'member-act.json'), content: JSON.stringify({ type: 'nonesuch/act' }) }) },
      { reply: 'Filed it.\nSTATUS:\n- filed' },
    ]);
    const connection = {
      ws: serverWs, companion: { name: 'Lead', neumaId: LEAD }, walletAddress: WALLET,
      _approvedPlan: Object.freeze({
        name: 'FILING CREW', goal: 'File one act.',
        workspace: Object.freeze({ root: arena, budgetBytes: 1024 * 1024 }),
        steps: Object.freeze([Object.freeze({ id: 'file', neumaId: SCRIBE, task: 'file the act', needs: Object.freeze([]) })]),
        memberNames: Object.freeze({ [SCRIBE]: 'Scribe' }),
        approvedAt: new Date().toISOString(),
      }),
    };
    const dir = path.join(neumaWorkspace.pathFor(LEAD), 'intents');
    await fs.writeFile(path.join(dir, 'filing-run.json'), JSON.stringify({ type: 'team/run' }));
    let settled = null;
    setTeamRunSeams({ checkSubstrate: async () => true, getCapacity: async () => ({ maxParallel: 1 }), onSettled: (p) => { settled = p; } });
    await sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: () => {} });
    setTeamRunSeams(null);
    expect((await settled).status).toBe('done');
    // The member's own filing was settled by the member, in its own round.
    expect(JSON.parse(await fs.readFile(path.join(own, 'member-act.result.json'), 'utf8')).status).toBe('invalid');
    // The being's chat act was never the member's to settle.
    await expect(fs.access(path.join(own, 'chat-act.result.json'))).rejects.toThrow();
    // The being's own sitting settles it, as it always would.
    await sweepIntents({ ws: serverWs, companion: { name: 'Scribe', neumaId: SCRIBE }, walletAddress: WALLET }, { mode: 'auto', lanePolicy: null, emit: () => {} });
    expect(JSON.parse(await fs.readFile(path.join(own, 'chat-act.result.json'), 'utf8')).status).toBe('invalid');
  }, 120000);

  test('a STOP that lands while the member\'s turn is still being assembled cuts it — no decode is ever asked for', async () => {
    const { runMemberTurn } = await import('../../backend/services/team-member-turn.js');
    provider.setScript([{ reply: 'this part should never be decoded\nSTATUS:\n- never' }]);
    const stop = new AbortController();
    const turn = runMemberTurn({
      neumaId: SCRIBE, name: 'Scribe', wallet: WALLET, brief: 'Write nothing yet.',
      workspace: { root: arena, budgetBytes: 1024 * 1024, usedBytes: 0 }, signal: stop.signal,
    });
    // The turn has begun but holds no decode yet: the stop lands in the gap.
    stop.abort(new Error('the operator stopped this member'));
    await expect(turn).rejects.toThrow('the operator stopped this member');
    expect(provider.turns).toHaveLength(0);
  }, 60000);

  test('an act that needs the operator\'s approval is refused at once — the member\'s turn never hangs', async () => {
    const { requestToolApproval } = await import('../../backend/services/tool-approval.js');
    const { createPortalConnection } = await import('../../backend/services/portal-connection.js');
    const { MEMBER_APPROVAL_REFUSAL } = await import('../../backend/services/team-member-turn.js');
    const sent = [];
    const connection = createPortalConnection({ ws: { OPEN: 1, readyState: 1, send: (s) => sent.push(JSON.parse(s)) }, walletAddress: WALLET });
    connection.companion = { name: 'Scribe', neumaId: SCRIBE };
    connection._approvalRefusal = MEMBER_APPROVAL_REFUSAL;
    const started = Date.now();
    const decision = await requestToolApproval(connection, { tool: 'filesystem/delete_file', args: { path: path.join(arena, 'scribe.md') } });
    expect(decision).toBe('deny');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(sent.some((f) => f.type === 'tool:approval_request')).toBe(false); // no card was ever raised
    // Every gate hands the member THIS reason — never "your operator denied".
    const { refusalForDecision, ACT_REFUSALS } = await import('../../backend/services/act-gate.js');
    expect(refusalForDecision(connection, 'deny').error).toBe(MEMBER_APPROVAL_REFUSAL);
    expect(refusalForDecision({}, 'deny')).toBe(ACT_REFUSALS.deny);
    expect(refusalForDecision(connection, 'interrupted')).toBe(ACT_REFUSALS.interrupted);
    // The member's own journal holds the refusal, with the reason it can act on.
    const journal = await neumaWorkspace.readJournal(SCRIBE);
    expect(JSON.stringify(journal)).toContain('Team members cannot take acts that need the operator');
  });
});
