/**
 * A RUN'S CLOCK AND WIDTH (#577) — proven on the real path: the team/run
 * intent with the member turn wired as production wires it, every attempt a
 * REAL streamConsciousness turn over a real loopback OpenAI-wire provider
 * (its answers held back by `delayMs` — a model taking its time), the real
 * substrate line, the real run store and the real encrypted workspace.
 *
 * Design note, 2026-10-13: […]
 *
 * Under proof:
 *  - a clock counts WORKING time: a member that waits its turn in the line
 *    longer than its whole budget is not cut (the 30:00 cut of 2026-10-12 ran
 *    while members waited);
 *  - each action: notify (told, keeps working), wrap-up (hands in what it has
 *    in its own sitting — the part stands PARTIAL), stop (stopped, resumable —
 *    and the clock that acted never acts again after the resume);
 *  - a calendar due already past acts before the member works;
 *  - the run's width holds its parts, and a hand widens it while it runs;
 *  - a hand's new clock re-arms a part that is working.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { startLocalProvider } from '../helpers/local-provider.js';

const WALLET = '0x5777777777777777777777777777777777777777';
const LEAD = 'clock-lead';
const MEMBER = 'clock-member';
const DONE = (text) => `${text}\nSTATUS:\ndone`;

describe('a run\'s clock counts working time and does what it was told; its width is the plan\'s and the hands\'', () => {
  let provider, httpServer, wss, serverWs, client, clientLog, prevRealm, saved;
  let sweepIntents, setTeamRunSeams, setMemberTurn, resumeTeamRun, readRun, setRealmRoot, setWorkspacesRoot, neumaWorkspace;
  let withLease, runForMember, tuneRun, arena;

  beforeAll(async () => {
    const root = await createTempDir('team-run-clock');
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
    provider = await startLocalProvider({ reply: DONE('the part') });
    const { setConfig } = await import('../../backend/services/llm-provider.js');
    setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '' });

    ({ sweepIntents } = await import('../../backend/services/intents/intent-sweep.js'));
    ({ setTeamRunSeams, setMemberTurn, resumeTeamRun } = await import('../../backend/services/intents/team-run.js'));
    const { runMemberTurn } = await import('../../backend/services/team-member-turn.js');
    setMemberTurn(runMemberTurn); // exactly as team-live-routes.js wires it
    ({ readRun } = await import('../../backend/services/team-run-store.js'));
    ({ withLease } = await import('../../backend/services/substrate-lease.js'));
    ({ runForMember } = await import('../../backend/services/team-run-live.js'));
    ({ tuneRun } = await import('../../backend/services/team-run-tune.js'));

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

  const rigSeams = (maxParallel, onSettled) => ({
    checkSubstrate: async () => true, getCapacity: async () => ({ maxParallel }),
    continueWaits: [20, 20, 20], onSettled,
  });

  // File a plan through the REAL sweep. Resolves once the run has STARTED:
  // its id, and the promise of its settling.
  const startPlan = async (name, steps, { clock = null, concurrency = null, maxParallel = 2 } = {}) => {
    const connection = {
      ws: serverWs, companion: { name: 'Lead', neumaId: LEAD }, walletAddress: WALLET,
      _approvedPlan: Object.freeze({
        name, goal: 'Prove the clock and the width.',
        workspace: Object.freeze({ root: path.join(arena, name), budgetBytes: 1024 * 1024 }),
        steps: Object.freeze(steps.map((s) => Object.freeze({ ...s, neumaId: MEMBER, needs: Object.freeze([]) }))),
        memberNames: Object.freeze({ [MEMBER]: 'Member' }),
        approvedAt: new Date().toISOString(),
        ...(clock ? { clock } : {}),
        ...(concurrency ? { concurrency } : {}),
      }),
    };
    const dir = path.join(neumaWorkspace.pathFor(LEAD), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ type: 'team/run' }));
    let settled = null;
    setTeamRunSeams(rigSeams(maxParallel, (p) => { settled = p; }));
    await sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: () => {} });
    setTeamRunSeams(null);
    const start = clientLog.find((m) => m.type === 'operator:team_start' && m.name === name);
    return { runId: start.id, settled };
  };
  const runPlan = async (...args) => {
    const { runId, settled } = await startPlan(...args);
    const outcome = await settled;
    return { runId, outcome, record: await readRun(runId, WALLET) };
  };
  const logOf = (runId, stepId) => neumaWorkspace.readTeamLog(MEMBER, runId, stepId);
  const until = async (check, ms = 20000) => {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error('timed out waiting');
      await new Promise((r) => { setTimeout(r, 25); });
    }
  };

  test('waiting its turn in the line never counts: a member held past its whole budget works on, under budget', async () => {
    provider.setScript([{ reply: DONE('Finished after my wait.') }]);
    // Three members of another run hold every member place in the line (4 slots, the operator keeps one).
    let release;
    const blocked = new Promise((r) => { release = r; });
    const blockers = [1, 2, 3].map((n) => withLease({ kind: 'member', label: `blocker ${n}` }, () => blocked));
    const BUDGET_MS = 1800; // 0.03 min of working time — then STOP
    const { runId, settled } = await startPlan('line-is-not-work', [{ id: 'wait', task: 'finish after your wait' }], { clock: { work: 0.03, dueDate: null, dueTime: null, then: 'stop' } });
    await until(() => clientLog.some((m) => m.type === 'operator:team_line' && m.id === runId && m.stepId === 'wait' && m.state === 'waiting'));
    await new Promise((r) => { setTimeout(r, BUDGET_MS + 1500); }); // longer in line than its whole budget
    release();
    await Promise.all(blockers);
    const outcome = await settled;
    const record = await readRun(runId, WALLET);
    expect(outcome.status).toBe('done');
    expect(record.completed.wait).toBe('Finished after my wait.');
    expect(record.clockState?.wait).toBeUndefined();
    expect(record.worked.wait).toBeLessThan(BUDGET_MS);
    const lines = (await logOf(runId, 'wait')).filter((e) => e.kind === 'line').map((e) => e.state);
    expect(lines).toEqual(['waiting', 'running']);
  }, 60000);

  test('notify: the clock passes while the member works — the operator is told, the member keeps working', async () => {
    provider.setScript([{ reply: DONE('Long work, done.'), delayMs: 4500 }]);
    clientLog.length = 0;
    const { runId, outcome, record } = await runPlan('notify-only', [{ id: 'long', task: 'do the long work' }], { clock: { work: 0.04, dueDate: null, dueTime: null, then: 'notify' } });
    expect(outcome.status).toBe('done');
    expect(record.completed.long).toBe('Long work, done.');
    expect(record.clockState.long).toMatchObject({ passed: true, by: 'work', then: 'notify' });
    const told = clientLog.find((m) => m.type === 'operator:team_clock' && m.id === runId && m.passed);
    expect(told.passed).toMatchObject({ by: 'work', then: 'notify' });
    expect(provider.turns).toHaveLength(1); // never cut, never re-asked
    const kinds = (await logOf(runId, 'long')).filter((e) => ['open', 'clock', 'end'].includes(e.kind)).map((e) => e.kind);
    expect(kinds).toEqual(['open', 'clock', 'end']);
  }, 60000);

  test('wrap-up: the clock cuts the attempt and the member hands in what it has, in its own sitting — the part stands PARTIAL', async () => {
    provider.setScript([
      { reply: DONE('This answer never arrives.'), delayMs: 9000 },
      { reply: DONE('Here is what I have: two of the three gaps mapped. Left: the third.') },
    ]);
    const { runId, outcome, record } = await runPlan('wrap-up', [{ id: 'deep', task: 'map all three gaps' }], { clock: { work: 0.04, dueDate: null, dueTime: null, then: 'wrap-up' } });
    expect(outcome.status).toBe('done');
    expect(record.completed.deep).toMatch(/^\[PARTIAL — this part's clock ran out \(\d+m of work, then wrap up\); it handed in what it had\.\]\n\nHere is what I have: two of the three gaps mapped\. Left: the third\.$/);
    expect(record.clockState.deep).toMatchObject({ by: 'work', then: 'wrap-up' });
    // ONE sitting: the hand-in rode the same conversation, told why and what to do.
    expect(provider.turns).toHaveLength(2);
    const sent = JSON.stringify(provider.turns[1].messages);
    expect(sent).toContain('map all three gaps');
    expect(sent).toContain('YOUR PART CONTINUES. Your clock has run out');
    expect(sent).toContain('HAND IN WHAT YOU HAVE NOW');
    const shape = (await logOf(runId, 'deep')).filter((e) => ['open', 'clock', 'end'].includes(e.kind)).map((e) => [e.kind, e.how ?? e.outcome ?? e.then ?? null]);
    expect(shape).toEqual([['open', 'brief'], ['clock', 'wrap-up'], ['end', 'wrap-up'], ['open', 'wrap-up'], ['end', 'answered']]);
  }, 60000);

  test('stop: the part stops where it stands — and a RESUME continues it, its clock never acting twice', async () => {
    provider.setScript([
      { reply: DONE('This answer never arrives.'), delayMs: 9000 },
      { reply: DONE('Resumed and finished the part.') },
    ]);
    const { runId, outcome, record } = await runPlan('stop-then-resume', [{ id: 'cut', task: 'map the gap' }], { clock: { work: 0.04, dueDate: null, dueTime: null, then: 'stop' } });
    expect(outcome.status).toBe('failed');
    expect(record.failures.cut).toMatch(/^its clock ran out \(\d+m of work, then stop\) — stopped where it stands; resume the run to continue it$/);
    expect(record.clockState.cut).toMatchObject({ by: 'work', then: 'stop' });
    expect(record.worked.cut).toBeGreaterThanOrEqual(2400);

    let settled = null;
    setTeamRunSeams(rigSeams(2, (p) => { settled = p; }));
    const resumed = await resumeTeamRun({ id: runId, wallet: WALLET });
    setTeamRunSeams(null);
    expect(resumed.ok).toBe(true);
    const again = await settled;
    expect(again.status).toBe('done');
    const after = await readRun(runId, WALLET);
    expect(after.completed.cut).toBe('Resumed and finished the part.');
    expect(after.worked.cut).toBeGreaterThanOrEqual(record.worked.cut); // the count continued
    // It continued in its own sitting — told the run had stopped and been picked up.
    expect(JSON.stringify(provider.turns.at(-1).messages)).toContain('has been picked up again');
    const clocks = (await logOf(runId, 'cut')).filter((e) => e.kind === 'clock');
    expect(clocks).toHaveLength(1);
  }, 60000);

  test('a calendar due already past acts before the member works: stop means the model is never asked', async () => {
    provider.setScript([{ reply: DONE('Never asked.') }]);
    const { runId, outcome, record } = await runPlan('past-due', [{ id: 'late', task: 'too late' }], { clock: { work: null, dueDate: '2020-01-01', dueTime: '09:00', then: 'stop' } });
    expect(outcome.status).toBe('failed');
    expect(record.clockState.late).toMatchObject({ by: 'due', then: 'stop' });
    expect(record.failures.late).toContain('its clock ran out (due 2020-01-01 09:00, then stop)');
    expect(provider.turns).toHaveLength(0);
    expect((await logOf(runId, 'late')).map((e) => e.kind)).toEqual(['open', 'clock', 'end']);
  }, 60000);

  test('the plan\'s width holds its parts one at a time — and a hand widens it while it runs', async () => {
    provider.setScript([{ reply: DONE('A part, done.'), delayMs: 2500 }]);
    clientLog.length = 0;
    const steps = ['w1', 'w2', 'w3'].map((id) => ({ id, task: `work ${id}` }));
    const { runId, settled } = await startPlan('one-at-a-time', steps, { concurrency: 1, maxParallel: 4 });
    await until(() => provider.turns.length >= 1);
    await new Promise((r) => { setTimeout(r, 500); });
    expect(provider.maxInFlight()).toBe(1);
    const held = clientLog.filter((m) => m.type === 'operator:team_line' && m.id === runId && m.state === 'held');
    expect(new Set(held.map((m) => m.stepId)).size).toBe(2);
    expect(held[0].of).toBe(1);

    // The operator (or the CoS, or the lead) widens the run: the held parts go now.
    const tuned = tuneRun(runForMember(runId), { concurrency: 3, by: 'your operator' });
    expect(tuned).toMatchObject({ ok: true, concurrency: 3 });
    await until(() => provider.turns.length >= 3);
    expect(provider.maxInFlight()).toBeGreaterThanOrEqual(2);
    const outcome = await settled;
    expect(outcome.status).toBe('done');
    const record = await readRun(runId, WALLET);
    expect(record.concurrency).toBe(3);
    expect(clientLog.find((m) => m.type === 'operator:team_tune' && m.id === runId)).toMatchObject({ concurrency: 3, ceiling: 3, by: 'your operator' });
    // Never past the rig: the ceiling is the member slots (4 − the operator's 1).
    expect(tuneRun(runForMember(runId) ?? { board: [], clocks: {}, clockState: {}, clockWatch: new Map(), ceiling: 3 }, { concurrency: 9 }).concurrency).toBe(3);
  }, 60000);

  test('a hand\'s new clock re-arms a part that is working — set mid-work, it acts at once', async () => {
    provider.setScript([{ reply: DONE('Kept working.'), delayMs: 4000 }]);
    clientLog.length = 0;
    const { runId, settled } = await startPlan('rearmed', [{ id: 'live', task: 'work on' }]);
    await until(() => provider.turns.length >= 1);
    await new Promise((r) => { setTimeout(r, 1200); });
    const tuned = tuneRun(runForMember(runId), { stepId: 'live', clock: { work: 0.01, then: 'notify' }, by: 'Zezebur (the Optio)' });
    expect(tuned.ok).toBe(true);
    const outcome = await settled;
    expect(outcome.status).toBe('done');
    const record = await readRun(runId, WALLET);
    expect(record.clocks.live).toMatchObject({ work: 0.01, then: 'notify' });
    expect(record.clockState.live).toMatchObject({ by: 'work', then: 'notify' });
    expect(record.completed.live).toBe('Kept working.');
    expect(clientLog.find((m) => m.type === 'operator:team_tune' && m.id === runId)).toMatchObject({ stepId: 'live', by: 'Zezebur (the Optio)' });
  }, 60000);
});
