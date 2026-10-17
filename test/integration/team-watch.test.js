/**
 * THE EYE on a working run (#577) — proven on the real path: the team/run
 * intent with the member turn wired as production wires it, real member turns
 * over a loopback provider taking its time, the real notification bus and its
 * store (the operator's tray), the real house post into the seated Optio's
 * inbox, the real run store.
 *
 * Design note, 2026-10-13: […]
 *
 * Under proof:
 *  - with no clock at all, a working run checks in on its cadence — the
 *    operator's tray and the Optio's inbox — and stops once the run settles;
 *  - a clock acting raises an alert at once, to both;
 *  - a part the run gives up on raises an alert while its other parts work;
 *  - a cadence of none sends no check-ins.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { startLocalProvider } from '../helpers/local-provider.js';

const WALLET = '0x5777777777777777777777777777777777777779';
const LEAD = 'watch-lead';
const MEMBER = 'watch-member';
const OPTIO = 'watch-optio';
const DONE = (text) => `${text}\nSTATUS:\ndone`;
const settle = (ms) => new Promise((r) => { setTimeout(r, ms); });

describe('the eye: a working run checks in and raises alerts — to the operator\'s tray and the Optio\'s inbox', () => {
  let provider, httpServer, wss, serverWs, client, clientLog, prevRealm, saved, houseRoot;
  let sweepIntents, setTeamRunSeams, setMemberTurn, readRun, setRealmRoot, setWorkspacesRoot, neumaWorkspace, readNotifications, cosDesignation, arena;

  beforeAll(async () => {
    const root = await createTempDir('team-watch');
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
    for (const id of [LEAD, MEMBER, OPTIO]) {
      await neumaWorkspace.create(id);
      await writeOwner(path.dirname(neumaWorkspace.pathFor(id)), id, WALLET);
      await neumaWorkspace.writeDNA(id, { version: '1.0.0', identity: { name: id }, genesis: `# Essence\nI am ${id}.` });
    }
    // The house's ground and its seated Optio — the office the eye reports to.
    houseRoot = path.join(root, 'house');
    const { setHouseWorkspace } = await import('../../backend/services/house-workspace.js');
    await setHouseWorkspace(WALLET, houseRoot);
    ({ cosDesignation } = await import('../../backend/services/staff/cos-designation.js'));
    ({ readNotifications } = await import('../../backend/services/notification-store.js'));
    arena = path.join(root, 'arena');
    const { connectFilesystemServer } = await import('../../backend/services/mcp-filesystem.js');
    await connectFilesystemServer();
    provider = await startLocalProvider({ reply: DONE('the part') });
    const { setConfig } = await import('../../backend/services/llm-provider.js');
    setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '' });

    ({ sweepIntents } = await import('../../backend/services/intents/intent-sweep.js'));
    ({ setTeamRunSeams, setMemberTurn } = await import('../../backend/services/intents/team-run.js'));
    const { runMemberTurn } = await import('../../backend/services/team-member-turn.js');
    setMemberTurn(runMemberTurn);
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

  const runPlan = async (name, steps, governs = {}) => {
    const connection = {
      ws: serverWs, companion: { name: 'Lead', neumaId: LEAD }, walletAddress: WALLET,
      _approvedPlan: Object.freeze({
        name, goal: 'Prove the eye.',
        workspace: Object.freeze({ root: path.join(arena, name), budgetBytes: 1024 * 1024 }),
        steps: Object.freeze(steps.map((s) => Object.freeze({ ...s, neumaId: MEMBER, needs: Object.freeze([]) }))),
        memberNames: Object.freeze({ [MEMBER]: 'Member' }),
        approvedAt: new Date().toISOString(),
        ...governs,
      }),
    };
    const dir = path.join(neumaWorkspace.pathFor(LEAD), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ type: 'team/run' }));
    let settled = null;
    setTeamRunSeams({ checkSubstrate: async () => true, getCapacity: async () => ({ maxParallel: 3 }), continueWaits: [20, 20, 20], onSettled: (p) => { settled = p; } });
    await sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: () => {} });
    setTeamRunSeams(null);
    // The operator seats the house's Optio while the run works (seated before,
    // it would hold dispatch and lead the run itself).
    await cosDesignation.designate(WALLET, OPTIO);
    const outcome = await settled;
    await settle(300);
    await cosDesignation.clear(WALLET);
    const start = clientLog.find((m) => m.type === 'operator:team_start' && m.name === name);
    return { runId: start.id, outcome, record: await readRun(start.id, WALLET) };
  };
  // The operator's tray and the Optio's inbox, for one run.
  const cardsOf = async (runId) => (await readNotifications(WALLET)).records.filter((r) => r.ref?.runId === runId);
  const postsOf = async (runId) => {
    const raw = await fs.readFile(path.join(houseRoot, 'post', OPTIO, 'inbox.jsonl'), 'utf8').catch(() => '');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((p) => p.body.includes(runId));
  };

  test('no clock, still watched: a long part checks in on its cadence — the tray and the Optio — and the checking stops when the run settles', async () => {
    provider.setScript([{ reply: DONE('Long work, done.'), delayMs: 3000 }]);
    const { runId, outcome } = await runPlan('watched', [{ id: 'long', task: 'do the long work' }], { checkIn: 0.012 });
    expect(outcome.status).toBe('done');
    await settle(300);
    const checkIns = (await cardsOf(runId)).filter((r) => r.kind === 'run_check_in');
    expect(checkIns.length).toBeGreaterThanOrEqual(2);
    expect(checkIns[0]).toMatchObject({ standing: 'neuma', actor: { id: LEAD, name: 'Lead' } });
    expect(checkIns[0].title).toMatch(/^watched — \dm in: 1 working, 0 waiting, 0 done$/);
    expect(checkIns[0].detail).toBe('every working part is moving');
    const posts = await postsOf(runId);
    expect(posts.length).toBeGreaterThanOrEqual(2);
    expect(posts[0]).toMatchObject({ from: LEAD, to: OPTIO, re: `Team run ${runId}: check-in` });
    expect(posts[0].body).toMatch(/^CHECK-IN — watched — \dm in: 1 working/);
    expect(posts[0].body).toContain('- long · Member: working; worked');
    // Settled: the eye is closed — no check-in after the run's end.
    const after = checkIns.length;
    await settle(1200);
    expect((await cardsOf(runId)).filter((r) => r.kind === 'run_check_in')).toHaveLength(after);
  }, 60000);

  test('a clock acting raises an alert at once — to the tray and the Optio', async () => {
    provider.setScript([{ reply: DONE('Still working, done.'), delayMs: 3500 }]);
    const { runId, outcome } = await runPlan('clock-alert', [{ id: 'paced', task: 'work past your clock' }], { clock: { work: 0.03, dueDate: null, dueTime: null, then: 'notify' }, checkIn: 0 });
    expect(outcome.status).toBe('done');
    await settle(300);
    const alerts = (await cardsOf(runId)).filter((r) => r.kind === 'run_alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe('clock-alert: Member\'s clock passed — it keeps working');
    expect(alerts[0].detail).toBe('paced: 0m of work, then notify; its working time ran out'); // 0.03 min — a test-sized clock
    const [post] = await postsOf(runId);
    expect(post.re).toBe(`Team run ${runId}: a clock passed`);
    expect(post.body).toContain('team/tune changes its clock or width');
    // A cadence of none: no check-ins at all.
    expect((await cardsOf(runId)).filter((r) => r.kind === 'run_check_in')).toHaveLength(0);
  }, 60000);

  test('a part the run gives up on raises an alert while its other parts work on', async () => {
    provider.setScript([
      { status: 400, errorMessage: 'refused' }, { status: 400, errorMessage: 'refused' },
      { status: 400, errorMessage: 'refused' }, { status: 400, errorMessage: 'refused' },
      { reply: DONE('The other part, done.') },
    ]);
    const { runId, outcome, record } = await runPlan('gave-up', [{ id: 'doomed', task: 'never answered' }], { checkIn: 0 });
    expect(outcome.status).toBe('failed');
    expect(record.failures.doomed).toBeTruthy();
    await settle(300);
    const alerts = (await cardsOf(runId)).filter((r) => r.kind === 'run_alert');
    expect(alerts.map((a) => a.title)).toEqual(['gave-up: Member stopped and will not be continued on its own']);
    expect(alerts[0].detail).toMatch(/^doomed: /);
    const [post] = await postsOf(runId);
    expect(post.re).toBe(`Team run ${runId}: a member gave up`);
  }, 60000);
});
